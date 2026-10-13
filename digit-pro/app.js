// Digit Pro — client Deriv (API WebSocket officielle) et bot de session.
// Le jeton API n'est jamais enregistré ni écrit dans le journal : il reste en mémoire pendant la visite.
import * as D from "./engine.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (v, cur) => (Number.isFinite(v) ? v.toFixed(2) : "—") + (cur ? " " + cur : "");
const pct = x => Number.isFinite(x) ? (x * 100).toFixed(1).replace(".", ",") + " %" : "—";
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= Deriv WebSocket client ================= */
class DerivClient {
  constructor(onEvent) { this.onEvent = onEvent; this.ws = null; this.reqId = 1; this.pending = new Map(); this.manual = false; this.retry = 0; this.listeners = new Set(); }
  get open() { return this.ws && this.ws.readyState === 1; }
  connect(url, appId) {
    this.url = url; this.appId = appId; this.manual = false;
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(`${url}?app_id=${encodeURIComponent(appId)}&l=FR`); } catch (e) { reject({ message: "Adresse du serveur invalide." }); return; }
      this.ws = ws; let opened = false;
      const to = setTimeout(() => { if (!opened) { try { ws.close(); } catch {} reject({ message: "Deriv ne répond pas (délai dépassé)." }); } }, 12000);
      ws.onopen = () => { opened = true; clearTimeout(to); this.retry = 0; clearInterval(this.ping); this.ping = setInterval(() => this.open && this.send({ ping: 1 }).catch(() => {}), 30000); resolve(); };
      ws.onerror = () => { if (!opened) { clearTimeout(to); reject({ message: "Connexion à Deriv impossible." }); } };
      ws.onmessage = ev => this.handle(ev.data);
      ws.onclose = () => {
        clearInterval(this.ping);
        for (const [, p] of this.pending) p.reject({ code: "Disconnected", message: "Connexion perdue" });
        this.pending.clear();
        this.onEvent("closed", { manual: this.manual });
        if (!this.manual && opened) this.scheduleReconnect();
      };
    });
  }
  scheduleReconnect() {
    const delay = Math.min(30000, 1000 * 2 ** this.retry++);
    this.onEvent("reconnecting", { delay });
    clearTimeout(this.rt);
    this.rt = setTimeout(async () => { try { await this.connect(this.url, this.appId); this.onEvent("reconnected"); } catch { this.scheduleReconnect(); } }, delay);
  }
  close() { this.manual = true; clearTimeout(this.rt); clearInterval(this.ping); try { this.ws && this.ws.close(); } catch {} }
  handle(raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const p = m.req_id != null && this.pending.get(m.req_id);
    if (p && !(m.subscription && p.done)) {
      p.done = true; this.pending.delete(m.req_id); clearTimeout(p.to);
      if (m.error) p.reject({ code: m.error.code, message: m.error.message }); else p.resolve(m);
    }
    for (const l of this.listeners) l(m);
  }
  send(req, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.open) { reject({ code: "Disconnected", message: "Non connecté à Deriv" }); return; }
      const req_id = this.reqId++;
      const to = setTimeout(() => { this.pending.delete(req_id); reject({ code: "Timeout", message: "Deriv n'a pas répondu à temps" }); }, timeoutMs);
      this.pending.set(req_id, { resolve, reject, to });
      this.ws.send(JSON.stringify(Object.assign({}, req, { req_id })));
    });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

/* ================= state ================= */
const S = {
  client: null, token: "", account: null, balance: NaN, currency: "USD", connected: false,
  symbol: "1HZ10V", pip: 2, digits: [], price: NaN, ticks: 0, lastUpdate: null, available: null,
  analysis: null, params: { ...D.DEFAULTS }, strategy: "matches",
  session: null, running: false, stopping: false, emergency: false, pendingBuy: null, trades: [], journal: [],
};
const log = (txt, kind = "") => { S.journal.unshift({ at: new Date(), txt, kind }); if (S.journal.length > 200) S.journal.pop(); renderJournal(); };

/* ================= connection ================= */
function onClientEvent(type, d) {
  if (type === "closed") { S.connected = false; renderStatus(); if (!d.manual) log("Connexion perdue avec Deriv.", "bad"); }
  if (type === "reconnecting") { log(`Nouvelle tentative de connexion dans ${Math.round(d.delay / 1000)} s…`); renderStatus("Reconnexion…"); }
  if (type === "reconnected") afterReconnect();
}
async function connect() {
  const url = $("apiUrl").value.trim() || "wss://ws.derivws.com/websockets/v3", appId = $("appId").value.trim() || "1089";
  S.token = $("token").value.trim(); $("token").value = "";
  if (S.client) S.client.close();
  S.client = new DerivClient(onClientEvent); S.client.on(onMessage);
  renderStatus("Connexion…");
  try {
    await S.client.connect(url, appId);
    S.connected = true; log("Connecté au serveur Deriv.", "ok");
    if (S.token) await authorize();
    await loadMarket();
  } catch (e) { S.connected = false; log("Échec de connexion : " + (e.message || "erreur"), "bad"); }
  renderAll();
}
async function authorize() {
  try {
    const r = await S.client.send({ authorize: S.token });
    const a = r.authorize;
    S.account = { loginid: a.loginid, isVirtual: !!a.is_virtual, currency: a.currency, name: a.fullname || "" };
    S.currency = a.currency || "USD"; S.balance = Number(a.balance);
    log(`Compte ${a.loginid} autorisé (${a.is_virtual ? "DÉMO" : "RÉEL"}, ${S.currency}).`, "ok");
    try { await S.client.send({ balance: 1, subscribe: 1 }); } catch {}
  } catch (e) {
    S.account = null; S.token = "";
    log("Jeton refusé par Deriv : " + (e.message || e.code) + ". Vérifiez qu'il a les droits Read et Trade.", "bad");
  }
}
function disconnect() { S.running = false; if (S.client) S.client.close(); S.connected = false; S.account = null; S.token = ""; log("Déconnecté."); renderAll(); }

function onMessage(m) {
  if (m.msg_type === "tick" && m.tick && m.tick.symbol === S.symbol) {
    S.pip = m.tick.pip_size ?? S.pip; S.price = m.tick.quote; S.ticks++; S.lastUpdate = new Date();
    S.digits.push(D.lastDigit(m.tick.quote, S.pip)); if (S.digits.length > 5000) S.digits.shift();
    renderDigits();
  }
  if (m.msg_type === "balance" && m.balance) { S.balance = Number(m.balance.balance); renderAccount(); }
}
async function loadMarket() {
  if (!S.client || !S.client.open) return;
  try { await S.client.send({ forget_all: "ticks" }); } catch {}
  S.digits = []; S.ticks = 0; S.analysis = null;
  try {
    const h = await S.client.send({ ticks_history: S.symbol, count: 1000, end: "latest", style: "ticks", subscribe: 1 });
    S.pip = h.pip_size ?? S.pip; S.digits = h.history.prices.map(p => D.lastDigit(p, S.pip)); S.ticks = S.digits.length; S.price = h.history.prices.at(-1); S.lastUpdate = new Date();
    log(`${S.digits.length} ticks réels reçus pour ${S.symbol}.`, "ok");
  } catch (e) { log(`Ticks indisponibles pour ${S.symbol} : ${e.message}`, "bad"); }
  try {
    const c = await S.client.send({ contracts_for: S.symbol, currency: S.currency, product_type: "basic" });
    const types = new Set((c.contracts_for.available || []).filter(x => x.contract_category === "digits").map(x => x.contract_type));
    S.available = types;
    log("Contrats Digits disponibles : " + ([...types].join(", ") || "aucun"), types.size ? "ok" : "bad");
  } catch (e) { S.available = new Set(); log(`Contrats indisponibles pour ${S.symbol} : ${e.message}`, "bad"); }
  renderAll();
}

/* ================= analysis ================= */
async function quote(strategy, stake, barrier) {
  const s = D.STRATEGIES[strategy];
  const req = { proposal: 1, amount: stake, basis: "stake", contract_type: s.type, currency: S.currency, duration: 1, duration_unit: "t", symbol: S.symbol };
  if (s.needsDigit) req.barrier = String(barrier ?? 5);
  return (await S.client.send(req)).proposal;
}
const STAGES = ["Récupération des ticks réels…", "Demande du paiement à Deriv…", "Test hors échantillon…"];
const setStage = i => { if (S.analysis && S.analysis.status === "running") { S.analysis.stage = i; renderAnalysis(); renderSignal(); } };
let analysing = false, again = false;
async function analyse() {
  if (analysing) { again = true; return; }
  analysing = true;
  try { await analyseOnce(); } finally { analysing = false; }
  if (again) { again = false; analyse(); }
}
async function analyseOnce() {
  if (!S.connected) { log("Connectez-vous d'abord à Deriv.", "bad"); renderSignal("Connectez-vous d'abord à Deriv (section Connexion)."); return; }
  if (S.available && !S.available.has(D.STRATEGIES[S.strategy].type)) { log("Ce contrat n'est pas proposé sur ce marché.", "bad"); return; }
  $("analyseBtn").disabled = true; $("sigBtn").disabled = true; S.analysis = { status: "running", stage: 0 }; renderAnalysis(); renderSignal();
  try {
    const h = await S.client.send({ ticks_history: S.symbol, count: 5000, end: "latest", style: "ticks" }, 30000);
    const digits = h.history.prices.map(p => D.lastDigit(p, h.pip_size ?? S.pip));
    setStage(1);
    const pr = await quote(S.strategy, 1);
    const ratio = Number(pr.payout) / Number(pr.ask_price);
    setStage(2);
    const v = D.validateStrategy(digits, S.strategy, ratio);
    S.analysis = Object.assign(v, { at: new Date(), payout: Number(pr.payout), ask: Number(pr.ask_price), symbol: S.symbol, strategy: S.strategy,
      now: v.status === "done" ? D.pick(S.strategy, digits.slice(-v.N)) : null });
    log(`Analyse ${S.strategy} sur ${digits.length} ticks réels : ${S.analysis.edge ? "avantage observé hors échantillon (à confirmer)" : "aucun avantage démontré"}.`, S.analysis.edge ? "ok" : "");
  } catch (e) { S.analysis = { status: "error", reason: e.message || "erreur" }; log("Analyse impossible : " + (e.message || e.code), "bad"); }
  $("analyseBtn").disabled = false; $("sigBtn").disabled = false; renderAll();
}

/* ---- signal card (same data as the analysis, presented as a signal screen) ---- */
const SHORT = { matches: "Matches", differs: "Differs", even: "Even", odd: "Odd" };
function renderSignal(msg) {
  const a = S.analysis, box = $("sigBox"), why = $("sigWhy"), go = $("sigGo");
  const m = D.MARKETS.find(x => x.symbol === S.symbol) || { label: S.symbol };
  $("sigMkt").textContent = m.label; $("sigIc").textContent = (m.label.match(/\d+/) || ["?"])[0];
  $("sigSub").textContent = `Deriv · ${SHORT[S.strategy]} · 1 tick · ${S.account ? (S.account.isVirtual ? "compte DÉMO" : "compte RÉEL") : S.connected ? "lecture seule" : "non connecté"}`;
  $("sigChips").innerHTML = Object.keys(SHORT).map(k => { const ok = !S.available || S.available.has(D.STRATEGIES[k].type); return `<button data-k="${k}" aria-pressed="${k === S.strategy}" ${ok && !S.running ? "" : "disabled"}>${SHORT[k]}</button>`; }).join("");
  why.hidden = true; go.hidden = true;
  if (msg) { box.innerHTML = `<p class="note">${esc(msg)}</p>`; return; }
  if (!a || (a.status === "done" && (a.symbol !== S.symbol || a.strategy !== S.strategy))) { box.innerHTML = `<div class="orb no">?</div><p class="note">${S.connected ? "Le signal se calcule automatiquement" : "Connexion à Deriv…"} : jusqu'à 5 000 vrais ticks et le vrai paiement Deriv.</p>`; return; }
  if (a.status === "running") { const i = a.stage || 0; box.innerHTML = `<div class="spin" aria-hidden="true"></div><p style="margin:0">${STAGES[i]}</p><div class="bar"><i style="width:${(i + 1) / STAGES.length * 100}%"></i></div>`; return; }
  if (a.status === "error") { box.innerHTML = `<p class="bad">Signal impossible : ${esc(a.reason)}</p>`; return; }
  if (a.status === "insufficient") { box.innerHTML = `<div class="orb no">…</div><p class="sigtitle no">PAS ASSEZ DE TICKS</p><p class="note">${a.n} reçus, ${a.need} nécessaires.</p>`; return; }
  const t = a.test, need = 1 / a.payoutRatio, r = x => pct(x);
  const what = a.now ? SHORT[a.strategy] + (a.now.barrier != null ? " " + a.now.barrier : "") : SHORT[a.strategy];
  box.innerHTML = a.edge
    ? `<div class="orb go">✓</div><p class="sigtitle go" id="sigTitle">${esc(what.toUpperCase())}</p><p class="note">Avantage observé sur des ticks jamais utilisés. À confirmer en démo : cela peut encore être du hasard.</p>`
    : `<div class="orb no">✕</div><p class="sigtitle no" id="sigTitle">PAS DE SIGNAL</p><p class="note">${esc(what)} ne bat pas la marge de Deriv sur ce marché. Ne pas trader.</p>`;
  const it = (k, txt) => `<li><i class="${k}">${k === "y" ? "✓" : k === "n" ? "✕" : "!"}</i><span>${txt}</span></li>`;
  const factors = [a.n >= 600, a.fit && a.fit.p < 0.05, t.hit > need, t.roiCI[0] > 0];
  why.innerHTML = `<h3>POURQUOI CE SIGNAL</h3><ul>
    ${it("y", `${a.n} vrais ticks de ${esc(a.symbol)} · ${a.at.toLocaleTimeString("fr-FR")}`)}
    ${it(a.theoEV >= 0 ? "y" : "n", `Paiement Deriv ${a.payout.toFixed(2)} pour ${a.ask.toFixed(2)} · il faut gagner ${r(need)} du temps (théorie : ${r(a.theoP)})`)}
    ${it(factors[1] ? "y" : "w", a.fit ? `Écart des chiffres : khi² p = ${a.fit.p.toFixed(3)} ${factors[1] ? "(déséquilibre)" : "(chiffres équilibrés)"}` : "Écart des chiffres : —")}
    ${it(factors[2] ? "y" : "n", `Réussite sur ticks jamais vus : ${r(t.hit)} sur ${t.n} cas`)}
    ${it(factors[3] ? "y" : "n", `Rendement test : ${t.roi >= 0 ? "+" : "−"}${pct(Math.abs(t.roi))} [${r(t.roiCI[0])} ; ${r(t.roiCI[1])}]`)}
    ${it(a.edge ? "y" : "w", `Critères remplis : ${factors.filter(Boolean).length} sur 4 · fenêtre ${a.N} ticks`)}
  </ul>`;
  why.hidden = false; go.hidden = false;
  go.textContent = a.edge ? "Ouvrir le bot (démo d'abord)" : "Ouvrir le bot (test technique en démo)";
}
/* ================= session bot ================= */
function readParams() {
  const n = id => Number(String($(id).value).replace(",", "."));
  return { stake: n("pStake"), maxTrades: n("pMaxTrades"), profitTarget: n("pTarget"), maxLoss: n("pMaxLoss"), pauseSec: n("pPause"), maxExposure: n("pExposure"), window: n("pWindow") };
}
function startCheck() {
  const p = readParams(), errs = D.validateParams(p), mode = $("mode").value;
  if (!S.connected) errs.push("Pas connecté à Deriv.");
  if (!S.account) errs.push("Aucun compte autorisé : entrez un jeton API Deriv.");
  if (S.available && !S.available.has(D.STRATEGIES[S.strategy].type)) errs.push("Contrat non disponible sur ce marché.");
  if (S.digits.length < p.window) errs.push(`Il faut au moins ${p.window} ticks reçus (actuellement ${S.digits.length}).`);
  const a = S.analysis, analysed = a && a.status === "done" && a.symbol === S.symbol && a.strategy === S.strategy;
  if (mode === "demo") {
    if (S.account && !S.account.isVirtual) errs.push("Mode Démo choisi mais le compte connecté est RÉEL : connectez un jeton de compte démo.");
    if (!(analysed && a.edge) && !$("execTest").checked) errs.push("Aucun avantage validé : cochez « test technique en démo » pour lancer quand même en démo.");
  } else {
    if (S.account && S.account.isVirtual) errs.push("Mode Réel choisi mais le compte connecté est DÉMO.");
    if (!analysed) errs.push("Mode Réel : lancez d'abord l'analyse de cette stratégie sur ce marché.");
    else if (!a.edge) errs.push("Mode Réel bloqué : l'analyse hors échantillon ne montre aucun avantage après le paiement Deriv.");
    if (!$("realOk").checked || $("realConfirm").value.trim().toUpperCase() !== "REEL") errs.push("Mode Réel : cochez la case de risque et tapez REEL.");
  }
  return { p, errs, mode };
}
async function start() {
  const { p, errs, mode } = startCheck();
  $("startErr").innerHTML = errs.map(e => `<li>${esc(e)}</li>`).join("");
  if (errs.length) { log("Démarrage refusé : " + errs.join(" · "), "bad"); return; }
  S.params = p; S.mode = mode; S.running = true; S.stopping = false; S.emergency = false;
  S.session = { startedAt: new Date(), done: 0, wins: 0, losses: 0, net: 0, open: null, staked: 0, stopReason: null, startBalance: S.balance };
  S.trades = [];
  log(`Session démarrée en ${mode === "demo" ? "DÉMO" : "RÉEL"} : ${D.STRATEGIES[S.strategy].label}, mise ${p.stake}, max ${p.maxTrades} transactions, objectif +${p.profitTarget}, perte max −${p.maxLoss}.`, "ok");
  renderAll();
  loop();
}
function stop(reason, emergency) {
  if (!S.session) return;
  S.running = false; S.emergency = !!emergency; S.session.stopReason = S.session.stopReason || reason;
  if (S.session.open) { S.stopping = true; log((emergency ? "ARRÊT D'URGENCE" : "Arrêt demandé") + " : aucune nouvelle transaction. Le contrat ouvert se termine tout seul (un contrat Digits de 1 tick ne peut pas être annulé).", "bad"); }
  else log((emergency ? "ARRÊT D'URGENCE" : "Session arrêtée") + " : " + reason + ".", emergency ? "bad" : "");
  renderAll();
}
async function interruptibleSleep(ms) { const end = Date.now() + ms; while (S.running && Date.now() < end) await sleep(Math.min(250, end - Date.now())); }

async function loop() {
  while (S.running) {
    if (!S.client.open) { await sleep(500); continue; }               // wait for reconnection, never trade blind
    const st = S.session, p = S.params;
    const chk = D.canBuy(st, p, S.balance);
    if (!chk.ok) { stop(chk.reason); break; }
    const win = S.digits.slice(-p.window);
    if (win.length < p.window) { await sleep(500); continue; }
    const choice = D.pick(S.strategy, win);
    let pr;
    try { pr = await quote(S.strategy, p.stake, choice.barrier); }
    catch (e) { log("Proposition refusée : " + (e.message || e.code), "bad"); await interruptibleSleep(3000); continue; }
    if (!S.running) break;
    if (Math.abs(Number(pr.ask_price) - p.stake) > 1e-9) { stop("prix proposé différent de la mise (" + pr.ask_price + ")"); break; }
    // one purchase at a time; never re-sent automatically
    S.pendingBuy = { at: Math.floor(Date.now() / 1000), stake: p.stake, type: choice.type, barrier: choice.barrier };
    let buy;
    try { buy = (await S.client.send({ buy: pr.id, price: p.stake }, 20000)).buy; }
    catch (e) {
      if (e.code === "Disconnected" || e.code === "Timeout") {
        log("Réponse d'achat perdue (réseau). Vérification sur le compte avant toute nouvelle transaction…", "bad");
        buy = await reconcilePendingBuy();
        if (!buy) { S.pendingBuy = null; if (S.running) await interruptibleSleep(p.pauseSec * 1000); continue; }
      } else { S.pendingBuy = null; log("Achat refusé : " + (e.message || e.code), "bad"); await interruptibleSleep(3000); continue; }
    }
    S.pendingBuy = null;
    const trade = { id: buy.contract_id, at: new Date(), type: choice.type, barrier: choice.barrier, stake: Number(buy.buy_price), payout: Number(buy.payout ?? pr.payout), status: "open", profit: 0 };
    st.open = trade; st.staked += trade.stake; S.trades.unshift(trade);
    log(`Achat #${trade.id} : ${trade.type}${trade.barrier != null ? " " + trade.barrier : ""}, mise ${trade.stake}.`);
    renderAll();
    await waitSettlement(trade);
    st.open = null; st.done++; st.net = Math.round((st.net + trade.profit) * 100) / 100;
    if (trade.status === "won") st.wins++; else st.losses++;
    log(`Contrat #${trade.id} ${trade.status === "won" ? "GAGNÉ" : "PERDU"} : ${trade.profit >= 0 ? "+" : ""}${trade.profit.toFixed(2)} · résultat de session ${st.net.toFixed(2)}.`, trade.status === "won" ? "ok" : "bad");
    renderAll();
    if (S.stopping) { S.stopping = false; log("Session arrêtée : " + st.stopReason + "."); renderAll(); break; }
    const r = D.stopReason(st, p);
    if (r) { stop(r); break; }
    await interruptibleSleep(p.pauseSec * 1000);
  }
  S.running = false; renderAll();
}
function waitSettlement(trade) {
  return new Promise(resolve => {
    let off = null;
    const finish = poc => {
      if (!poc || !poc.is_sold || trade.status !== "open") return;
      trade.status = poc.status === "won" || Number(poc.profit) > 0 ? "won" : "lost";
      trade.profit = Number(poc.profit); trade.exitDigit = poc.exit_tick_display_value != null ? D.lastDigit(poc.exit_tick_display_value, S.pip) : null;
      off && off(); S.waiting = null; resolve();
    };
    off = S.client.on(m => { if (m.msg_type === "proposal_open_contract" && m.proposal_open_contract && m.proposal_open_contract.contract_id === trade.id) finish(m.proposal_open_contract); });
    S.waiting = { trade, resubscribe: () => S.client.send({ proposal_open_contract: 1, contract_id: trade.id, subscribe: 1 }).then(r => finish(r.proposal_open_contract)).catch(() => {}) };
    S.waiting.resubscribe();
  });
}
// After a lost buy response: look for a contract bought at that moment. Adopt it if found; never buy twice.
async function reconcilePendingBuy() {
  const pb = S.pendingBuy;
  for (let i = 0; i < 60 && !S.client.open; i++) await sleep(500);
  if (!S.client.open) { stop("connexion perdue pendant un achat : vérifiez votre compte Deriv"); return null; }
  if (S.token && !S.account) await authorize();
  try {
    const port = await S.client.send({ portfolio: 1 });
    const c = (port.portfolio.contracts || []).find(x => x.purchase_time >= pb.at - 5 && x.contract_type === pb.type);
    if (c) { log(`Contrat #${c.contract_id} retrouvé sur le compte : il est suivi, aucun nouvel achat.`, "ok"); return { contract_id: c.contract_id, buy_price: c.buy_price, payout: c.payout }; }
    const pt = await S.client.send({ profit_table: 1, limit: 5, sort: "DESC", description: 1 });
    const t = (pt.profit_table.transactions || []).find(x => x.purchase_time >= pb.at - 5);
    if (t) { log(`Contrat #${t.contract_id} déjà terminé retrouvé : il est compté, aucun nouvel achat.`, "ok"); return { contract_id: t.contract_id, buy_price: t.buy_price, payout: t.payout }; }
    log("Aucun achat trouvé sur le compte : la transaction n'a pas eu lieu.");
    return null;
  } catch (e) { stop("vérification impossible après coupure : " + (e.message || e.code)); return null; }
}
async function afterReconnect() {
  S.connected = true; log("Reconnecté à Deriv.", "ok");
  if (S.token) { S.account = null; await authorize(); }
  try {
    const h = await S.client.send({ ticks_history: S.symbol, count: 1000, end: "latest", style: "ticks", subscribe: 1 });
    S.digits = h.history.prices.map(p => D.lastDigit(p, h.pip_size ?? S.pip));
  } catch {}
  if (S.waiting) S.waiting.resubscribe();
  renderAll();
}

/* ================= rendering ================= */
function renderStatus(txt) {
  const el = $("connPill");
  if (txt) { el.className = "pill warn"; el.textContent = txt; return; }
  if (!S.connected) { el.className = "pill bad"; el.textContent = "Hors ligne"; }
  else if (!S.account) { el.className = "pill warn"; el.textContent = "Connecté · lecture seule"; }
  else { el.className = "pill " + (S.account.isVirtual ? "ok" : "real"); el.textContent = "Connecté · " + (S.account.isVirtual ? "DÉMO" : "RÉEL"); }
  $("mktPill").textContent = (D.MARKETS.find(m => m.symbol === S.symbol) || {}).label || S.symbol;
}
function renderAccount() {
  $("acct").innerHTML = S.account
    ? `<div><span>Compte</span><b>${esc(S.account.loginid)}</b></div><div><span>Type</span><b class="${S.account.isVirtual ? "okc" : "realc"}">${S.account.isVirtual ? "Démo" : "Réel"}</b></div><div><span>Solde</span><b>${money(S.balance, S.currency)}</b></div>`
    : `<p class="note">${S.connected ? "Lecture seule : ticks réels sans compte. Entrez un jeton API pour trader en démo." : "Non connecté."}</p>`;
}
function renderDigits() {
  const p = Number($("pWindow").value) || 100, w = S.digits.slice(-p), c = D.digitCounts(w), n = w.length;
  const choice = n >= 10 && D.STRATEGIES[S.strategy].needsDigit ? D.pick(S.strategy, w).barrier : null;
  $("digits").innerHTML = c.map((k, d) => {
    const f = n ? k / n : 0, cls = d === choice ? "pick" : f > 0.12 ? "hi" : f < 0.08 ? "lo" : "mid";
    return `<div class="dg ${cls}"><b>${d}</b><span>${n ? pct(f) : "—"}</span><i style="width:${Math.min(100, f * 500)}%"></i></div>`;
  }).join("");
  const last = S.digits.at(-1); let even = 0; for (const x of w) if (x % 2 === 0) even++;
  $("cur").textContent = last ?? "—"; $("price").textContent = Number.isFinite(S.price) ? Number(S.price).toFixed(S.pip) : "—";
  $("ticks").textContent = S.ticks; $("eo").textContent = n ? Math.round(even / n * 100) + " / " + (100 - Math.round(even / n * 100)) + " %" : "—";
  $("upd").textContent = S.lastUpdate ? S.lastUpdate.toLocaleTimeString("fr-FR") : "—";
  const fit = D.chiSquareDigits(c); $("fit").textContent = fit ? (fit.p < 0.01 ? "écart inhabituel (p = " + fit.p.toFixed(3) + ")" : "écart normal (p = " + fit.p.toFixed(2) + ")") : "pas assez de ticks";
}
function renderAnalysis() {
  const a = S.analysis, el = $("analysis");
  if (!a) { el.innerHTML = `<p class="note">Appuyez sur <b>Analyser</b> : le moteur charge jusqu'à 5 000 ticks réels, demande à Deriv le paiement réel de la stratégie, puis teste la règle sur des ticks qu'il n'a pas utilisés pour la choisir.</p>`; return; }
  if (a.status === "running") { el.innerHTML = `<p class="note">Analyse en cours…</p>`; return; }
  if (a.status === "error") { el.innerHTML = `<p class="bad">Analyse impossible : ${esc(a.reason)}</p>`; return; }
  if (a.status === "insufficient") { el.innerHTML = `<p class="verdict">Données insuffisantes</p><p class="note">${a.n} ticks reçus, ${a.need} nécessaires.</p>`; return; }
  const t = a.test, r = x => pct(x), ci = c => `[${r(c[0])} ; ${r(c[1])}]`;
  el.innerHTML = `<p class="verdict ${a.edge ? "okc" : "badc"}">${a.edge ? "Avantage observé hors échantillon — à confirmer" : "Stratégie refusée : aucun avantage démontré"}</p>
    <dl class="kv">
      <dt>Données</dt><dd>${a.n} ticks réels de ${esc(a.symbol)} · ${a.at.toLocaleTimeString("fr-FR")}</dd>
      <dt>Paiement Deriv</dt><dd>${a.payout.toFixed(2)} pour ${a.ask.toFixed(2)} misé (×${a.payoutRatio.toFixed(3)})</dd>
      <dt>Probabilité théorique</dt><dd>${r(a.theoP)} · résultat moyen théorique ${a.theoEV >= 0 ? "+" : ""}${a.theoEV.toFixed(3)} par 1 misé</dd>
      <dt>Entraînement</dt><dd>${a.split} premiers ticks · fenêtre choisie : ${a.N} ticks · réussite ${r(a.train.hit)}</dd>
      <dt>Test (jamais vu)</dt><dd>${t.n} transactions simulées · réussite ${r(t.hit)} ${ci(t.hitCI)}</dd>
      <dt>Rendement test</dt><dd>${t.roi >= 0 ? "+" : ""}${(t.roi * 100).toFixed(1)} % par mise ${ci(t.roiCI)}</dd>
      <dt>Conformité</dt><dd>${a.fit ? "khi² p = " + a.fit.p.toFixed(3) : "—"}</dd>
    </dl>
    <p class="note">${a.edge ? "Le rendement reste positif sur des ticks non utilisés pour choisir la règle. Cela peut encore venir du hasard : recommencez sur de nouveaux ticks." : "Sur les ticks de test, la règle ne bat pas la marge de Deriv. Le mode Réel reste bloqué ; un test technique est possible en démo."}</p>`;
}
function renderSession() {
  const s = S.session, cur = S.currency;
  $("kTrades").textContent = s ? `${s.done} / ${S.params.maxTrades}` : "—";
  $("kWins").textContent = s ? s.wins : "—"; $("kLosses").textContent = s ? s.losses : "—";
  const n = $("kNet"); n.textContent = s ? (s.net >= 0 ? "+" : "") + money(s.net, cur) : "—"; n.className = s ? (s.net >= 0 ? "okc" : "badc") : "";
  $("kState").textContent = S.running ? (s && s.open ? "contrat ouvert" : "en marche") : S.stopping ? "arrêt en cours" : s ? "arrêté" + (s.stopReason ? " · " + s.stopReason : "") : "prêt";
  $("kRisk").textContent = s ? `perte restante avant arrêt : ${money(S.params.maxLoss + s.net, cur)} · exposé : ${money(s.open ? s.open.stake : 0, cur)}` : "—";
  $("history").innerHTML = S.trades.length ? S.trades.map(t => `<tr><td>${t.at.toLocaleTimeString("fr-FR")}</td><td>${t.type.replace("DIGIT", "")}${t.barrier != null ? " " + t.barrier : ""}</td><td>${t.stake.toFixed(2)}</td><td class="${t.status === "won" ? "okc" : t.status === "lost" ? "badc" : ""}">${t.status === "open" ? "ouvert" : t.status === "won" ? "gagné" : "perdu"}</td><td>${t.status === "open" ? "—" : (t.profit >= 0 ? "+" : "") + t.profit.toFixed(2)}</td><td class="mono">${t.id}</td></tr>`).join("") : `<tr><td colspan="6" class="note">Aucune transaction.</td></tr>`;
  drawPnl();
  $("startBtn").disabled = S.running || S.stopping; $("stopBtn").disabled = !S.running; $("urgBtn").disabled = !(S.running || S.stopping);
  const p = readParams();
  $("applied").textContent = `Marché ${S.symbol} · ${D.STRATEGIES[S.strategy].label} · mise ${p.stake} · max ${p.maxTrades} transactions · objectif +${p.profitTarget} · perte max −${p.maxLoss} · pause ${p.pauseSec} s · exposition max ${p.maxExposure} · 1 contrat à la fois · aucune martingale`;
}
function drawPnl() {
  const cv = $("pnl"), box = cv.parentElement, dpr = devicePixelRatio || 1, W = box.clientWidth, H = box.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const pts = [0]; let acc = 0; for (const t of [...S.trades].reverse()) if (t.status !== "open") { acc += t.profit; pts.push(acc); }
  cv.dataset.points = pts.length - 1; cv.dataset.last = acc.toFixed(2);
  const css = getComputedStyle(document.documentElement), col = k => css.getPropertyValue("--" + k).trim();
  const lim = S.session ? [S.params.profitTarget, -S.params.maxLoss] : [1, -1];
  const mx = Math.max(...pts, lim[0]), mn = Math.min(...pts, lim[1]), pad = 24, iw = W - pad * 2, ih = H - pad * 2;
  const y = v => pad + ih - (v - mn) / (mx - mn || 1) * ih, x = i => pad + (pts.length > 1 ? i / (pts.length - 1) : 0) * iw;
  g.font = "11px ui-monospace,monospace"; g.fillStyle = col("muted");
  [[0, col("line")], [lim[0], col("ok")], [lim[1], col("bad")]].forEach(([v, c]) => { g.strokeStyle = c; g.setLineDash(v ? [4, 4] : []); g.beginPath(); g.moveTo(pad, y(v)); g.lineTo(W - pad, y(v)); g.stroke(); g.fillText((v > 0 ? "+" : "") + v, 2, y(v) - 3); });
  g.setLineDash([]); g.strokeStyle = col("accent"); g.lineWidth = 2.5; g.beginPath(); pts.forEach((v, i) => i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))); g.stroke();
  pts.forEach((v, i) => { g.fillStyle = col("accent"); g.beginPath(); g.arc(x(i), y(v), 3, 0, 7); g.fill(); });
}
function renderJournal() { $("journal").innerHTML = S.journal.slice(0, 60).map(j => `<li class="${j.kind}"><span>${j.at.toLocaleTimeString("fr-FR")}</span>${esc(j.txt)}</li>`).join(""); }
function renderStrategies() {
  const sel = $("strategy");
  sel.innerHTML = Object.entries(D.STRATEGIES).map(([k, s]) => { const ok = !S.available || S.available.has(s.type); return `<option value="${k}" ${k === S.strategy ? "selected" : ""} ${ok ? "" : "disabled"}>${esc(s.label)}${ok ? "" : " — indisponible"}</option>`; }).join("");
}
function renderAll() { renderStatus(); renderAccount(); renderDigits(); renderAnalysis(); renderSignal(); renderSession(); renderStrategies(); renderJournal(); $("realBox").hidden = $("mode").value !== "real"; }

/* ================= automatic signal (read-only, no account needed) ================= */
// On opening, the page connects to Deriv WITHOUT a token (public ticks + public prices only) and computes the signal,
// then refreshes it every AUTO_SEC seconds while the page is visible and no session is running.
// Buying still requires a Deriv token: Deriv refuses any purchase without one.
const AUTO = !new URLSearchParams(location.search).has("manuel"), AUTO_SEC = 60;
async function autoSignal() {
  log("Signal automatique : connexion à Deriv en lecture seule (aucun compte nécessaire).");
  await connect();
  if (S.connected) analyse();
  setInterval(() => {
    if (!S.connected || S.running || S.stopping || document.hidden) return;
    if (S.analysis && S.analysis.status === "running") return;
    analyse();
  }, AUTO_SEC * 1000);
}

/* ================= wiring ================= */
function init() {
  $("market").innerHTML = D.MARKETS.map(m => `<option value="${m.symbol}" ${m.symbol === S.symbol ? "selected" : ""}>${esc(m.label)}</option>`).join("");
  for (const [id, k] of [["pStake", "stake"], ["pMaxTrades", "maxTrades"], ["pTarget", "profitTarget"], ["pMaxLoss", "maxLoss"], ["pPause", "pauseSec"], ["pExposure", "maxExposure"], ["pWindow", "window"]]) $(id).value = D.DEFAULTS[k];
  $("connectBtn").onclick = connect; $("disconnectBtn").onclick = disconnect;
  $("market").onchange = e => { if (S.running) { e.target.value = S.symbol; log("Arrêtez la session avant de changer de marché.", "bad"); return; } S.symbol = e.target.value; renderAll(); loadMarket().then(() => { if (AUTO && S.connected) analyse(); }); };
  $("strategy").onchange = e => { if (S.running) { renderStrategies(); return; } S.strategy = e.target.value; renderAll(); };
  $("analyseBtn").onclick = analyse; $("startBtn").onclick = start; $("sigBtn").onclick = analyse;
  $("sigChips").onclick = e => { const b = e.target.closest("button[data-k]"); if (!b || S.running) return; S.strategy = b.dataset.k; renderAll(); if (S.connected) analyse(); };
  $("sigGo").onclick = () => $("botCard").scrollIntoView({ behavior: "smooth", block: "start" });
  $("stopBtn").onclick = () => stop("arrêt manuel"); $("urgBtn").onclick = () => stop("arrêt d'urgence", true);
  $("mode").onchange = renderAll;
  document.querySelectorAll("#params input").forEach(i => i.addEventListener("input", () => { if (!S.running) renderSession(); renderDigits(); }));
  addEventListener("resize", drawPnl);
  renderAll();
  if (AUTO) autoSignal();
  // read-only view for tests and debugging; the API token is never exposed
  window.__digitpro = { get state() { const { token, client, ...rest } = S; return rest; } };
}
init();
