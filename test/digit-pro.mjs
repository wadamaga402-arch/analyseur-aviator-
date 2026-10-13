// End-to-end test of Digit Pro (built page) against the fake Deriv API. Usage: PW_PATH=<playwright> node test/digit-pro.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { startMock } from "./deriv-mock.mjs";
import { WebSocket } from "ws";
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || "playwright");
const ROOT = new URL("..", import.meta.url).pathname;
writeFileSync("/tmp/digitpro.html", readFileSync(ROOT + "digit-pro/dist/index.html", "utf8"));
const mock = startMock({ tickMs: 120 });
const CTRL = "http://127.0.0.1:18991";
const ctrl = async p => (await fetch(CTRL + p)).json();

const results = []; let failed = 0;
const check = (n, c, i = "") => { if (c) results.push("ok   - " + n); else { failed++; results.push("FAIL - " + n + (i ? " :: " + i : "")); } };
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const T = async s => ((await p.textContent(s)) || "").replace(/\s+/g, " ").trim();
const st = () => p.evaluate(() => { const s = window.__digitpro.state; return { connected: s.connected, account: s.account, running: s.running, stopping: s.stopping, session: s.session && { done: s.session.done, wins: s.session.wins, losses: s.session.losses, net: s.session.net, stopReason: s.session.stopReason }, trades: s.trades.map(t => ({ id: t.id, status: t.status, profit: t.profit })), analysis: s.analysis && { status: s.analysis.status, edge: s.analysis.edge }, digits: s.digits.length }; });
const waitFor = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await p.waitForTimeout(150); } return false; };
const connect = async (token) => { await p.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true)); await p.fill("#apiUrl", "ws://127.0.0.1:18990"); await p.fill("#appId", "1089"); await p.fill("#token", token || ""); await p.click("#connectBtn"); await p.waitForTimeout(800); };
const setParams = async o => { for (const [id, v] of Object.entries(o)) await p.fill("#" + id, String(v)); };
const runSession = async () => { await p.click("#startBtn"); await waitFor(async () => { const s = await st(); return s.session && !s.running && !s.stopping; }, 60000); return st(); };

await p.goto("file:///tmp/digitpro.html?manuel"); await p.waitForTimeout(300);
check("hors ligne au démarrage", (await T("#connPill")) === "Hors ligne");
check("signal hors ligne : demande de connexion", (await (async () => { await p.click("#sigBtn"); return /Connectez-vous/.test(await T("#sigBox")); })()));
check("Start refusé hors ligne", (await (async () => { await p.click("#startBtn"); return /Pas connecté/.test(await T("#startErr")); })()));

/* connection */
await connect("");
check("connexion API sans jeton : lecture seule", /lecture seule/.test(await T("#connPill")));
check("ticks réels reçus (historique 1000)", (await st()).digits >= 1000);
await p.waitForTimeout(500);
check("ticks en direct reçus", Number(await T("#ticks")) > 1000);
check("contrats Digits détectés", /DIGITMATCH, DIGITDIFF, DIGITEVEN, DIGITODD/.test(await T("#journal")));
await connect("mauvais-jeton");
check("jeton refusé : message clair, pas de compte", /Jeton refusé/.test(await T("#journal")) && !(await st()).account);
await connect("demo-token-123");
check("compte démo autorisé + solde", /DÉMO/.test(await T("#connPill")) && /10000\.00 USD/.test(await T("#acct")));
const html = await p.content(), jt = await T("#journal");
check("jeton jamais affiché ni dans le journal ni dans l'état", !html.includes("demo-token-123") && !jt.includes("demo-token-123") && !JSON.stringify(await p.evaluate(() => window.__digitpro.state)).includes("demo-token-123"));

/* analysis on fair digits */
await p.selectOption("#strategy", "matches"); await p.click("#analyseBtn");
await waitFor(async () => (await st()).analysis?.status === "done");
check("analyse : paiement réel demandé à Deriv", /8\.50 pour 1\.00/.test(await T("#analysis")));
check("analyse : stratégie refusée sur chiffres équitables", /Stratégie refusée/.test(await T("#analysis")) && (await st()).analysis.edge === false);
check("signal : PAS DE SIGNAL sur chiffres équitables", (await T("#sigTitle")) === "PAS DE SIGNAL" && /POURQUOI CE SIGNAL/.test(await T("#sigWhy")) && /8\.50 pour 1\.00/.test(await T("#sigWhy")));
await p.click('#sigChips button[data-k="even"]');
check("signal : boutons de contrat = stratégie", (await p.inputValue("#strategy")) === "even");
await waitFor(async () => (await st()).analysis?.status === "done");
await p.click("#sigBtn"); const sawSpin = await waitFor(async () => !!(await p.$("#sigBox .spin")) || (await st()).analysis?.status === "done", 5000);
await waitFor(async () => (await st()).analysis?.status === "done");
check("signal : analyse en étapes puis verdict", sawSpin && (await T("#sigTitle")) === "PAS DE SIGNAL");
await p.click('#sigChips button[data-k="matches"]'); await p.click("#analyseBtn"); await waitFor(async () => (await st()).analysis?.status === "done");
check("analyse : espérance théorique négative affichée", /−0,150|-0\.150/.test(await T("#analysis")));

/* start gating */
await p.click("#startBtn");
check("démo sans avantage : refus tant que le test technique n'est pas coché", /cochez « test technique en démo »/.test(await T("#startErr")));
await p.selectOption("#mode", "real"); await p.click("#startBtn");
check("réel bloqué : compte démo + aucun avantage", /compte connecté est DÉMO/.test(await T("#startErr")) && /Mode Réel bloqué/.test(await T("#startErr")));
await p.selectOption("#mode", "demo");
await setParams({ pStake: 10, pMaxLoss: 5 }); await p.click("#startBtn");
check("paramètres invalides refusés", /mise ne peut pas dépasser la perte maximale/.test(await T("#startErr")));

/* 5 trades exactly */
await setParams({ pStake: 1, pMaxTrades: 5, pTarget: 1000, pMaxLoss: 100, pPause: 1, pExposure: 5 });
await p.check("#execTest"); await ctrl("/reset");
let s = await runSession(); let c = await ctrl("/stats");
check("arrêt après exactement 5 transactions terminées", s.session.done === 5 && c.buys === 5 && /5\/5/.test(s.session.stopReason), JSON.stringify({ done: s.session.done, buys: c.buys, r: s.session.stopReason }));
check("gagnées + perdues = 5, résultat = somme des contrats", s.session.wins + s.session.losses === 5 && Math.abs(s.session.net - s.trades.reduce((a, t) => a + t.profit, 0)) < 0.01);
check("pas de relance automatique", (await p.waitForTimeout(2500), (await ctrl("/stats")).buys === 5));
check("historique affiché (5 lignes)", (await p.$$("#history tr")).length === 5);
check("graphique = résultats", Number(await p.getAttribute("#pnl", "data-points")) === 5);

/* profit target */
await ctrl("/digits?mode=even"); await ctrl("/reset"); await ctrl("/digits?mode=even");
await p.selectOption("#strategy", "even"); await setParams({ pTarget: 2, pMaxTrades: 20 });
s = await runSession();
check("objectif de bénéfice : arrêt à +2,85 après 3 gains", s.session.done === 3 && s.session.wins === 3 && Math.abs(s.session.net - 2.85) < 0.01 && /objectif/.test(s.session.stopReason), JSON.stringify(s.session));

/* max loss */
await ctrl("/reset"); await ctrl("/digits?mode=odd");
await setParams({ pTarget: 100, pMaxLoss: 3 });
s = await runSession(); c = await ctrl("/stats");
check("perte maximale : arrêt à −3 après 3 pertes, jamais au-delà", s.session.done === 3 && s.session.net === -3 && c.buys === 3 && /perte maximale/.test(s.session.stopReason), JSON.stringify(s.session));

/* stop & emergency stop */
await ctrl("/reset"); await setParams({ pMaxLoss: 100, pMaxTrades: 20, pPause: 2 });
await p.click("#startBtn"); await waitFor(async () => (await st()).session?.done >= 1);
await p.click("#urgBtn"); await waitFor(async () => { const x = await st(); return !x.running && !x.stopping; });
const after = (await ctrl("/stats")).buys; await p.waitForTimeout(3000);
check("arrêt d'urgence : aucune nouvelle transaction", (await ctrl("/stats")).buys === after && (await st()).session.done === after, after + " achats");

/* lost buy response: reconnect, reconcile, no duplicate */
await ctrl("/reset"); await setParams({ pMaxTrades: 3, pPause: 1 });
await ctrl("/dropOnNextBuy");
s = await runSession(); c = await ctrl("/stats");
check("coupure pendant l'achat : contrat retrouvé, aucun doublon", c.buys === 3 && s.session.done === 3 && new Set(s.trades.map(t => t.id)).size === 3, JSON.stringify({ buys: c.buys, done: s.session.done }));
check("coupure : reconnexion journalisée", /Reconnecté à Deriv/.test(await T("#journal")) && /retrouvé sur le compte|déjà terminé retrouvé/.test(await T("#journal")));

/* drop while waiting for settlement */
await ctrl("/reset"); await setParams({ pMaxTrades: 2, pPause: 1 });
await p.click("#startBtn"); await waitFor(async () => (await st()).trades.some(t => t.status === "open"), 10000);
await ctrl("/drop");
await waitFor(async () => { const x = await st(); return x.session && !x.running && !x.stopping; }, 60000);
s = await st(); c = await ctrl("/stats");
check("coupure pendant le règlement : contrat suivi jusqu'au bout, pas de doublon", s.session.done === 2 && c.buys === 2 && s.trades.every(t => t.status !== "open"), JSON.stringify({ done: s.session.done, buys: c.buys }));

/* real mode only with validated edge */
await connect("real-token-456"); await ctrl("/digits?mode=bias");
await p.selectOption("#strategy", "matches"); await p.click("#analyseBtn");
await waitFor(async () => (await st()).analysis?.status === "done");
check("biais réel détecté : avantage hors échantillon", (await st()).analysis.edge === true, await T("#analysis"));
check("signal vert seulement avec avantage : MATCHES 4", (await T("#sigTitle")) === "MATCHES 4" && !!(await p.$("#sigBox .orb.go")), await T("#sigBox"));
await p.selectOption("#mode", "real"); await p.click("#startBtn");
check("réel : confirmation REEL exigée", /tapez REEL/.test(await T("#startErr")));
await p.check("#realOk"); await p.fill("#realConfirm", "reel"); await setParams({ pMaxTrades: 1, pStake: 1, pMaxLoss: 5 });
s = await runSession();
check("réel autorisé seulement avec avantage validé + confirmation", s.session.done === 1, JSON.stringify(s.session));

/* automatic read-only signal on opening (real Deriv address redirected to the mock) */
await ctrl("/reset");
const p2 = await b.newPage({ viewport: { width: 390, height: 844 } }); const errs2 = []; p2.on("pageerror", e => errs2.push(e.message));
await p2.routeWebSocket(/derivws\.com/, route => {   // pipe the real Deriv address to the local mock
  const up = new WebSocket("ws://127.0.0.1:18990/websockets/v3?app_id=1089"), q = [];
  up.on("open", () => { for (const m of q.splice(0)) up.send(m); }); up.on("message", d => route.send(d.toString())); up.on("close", () => route.close());
  route.onMessage(m => up.readyState === 1 ? up.send(m) : q.push(m)); route.onClose(() => up.close());
});
const buys0 = (await ctrl("/stats")).buys;
await p2.goto("file:///tmp/digitpro.html");
const autoOk = await (async () => { const end = Date.now() + 30000; while (Date.now() < end) { const a = await p2.evaluate(() => window.__digitpro.state.analysis); if (a && a.status === "done") return true; await p2.waitForTimeout(200); } return false; })();
check("ouverture : connexion automatique sans compte + signal calculé", autoOk && /lecture seule/.test(await p2.textContent("#connPill")) && (await p2.textContent("#sigTitle")) === "PAS DE SIGNAL", await p2.textContent("#sigBox"));
await p2.click('#sigChips button[data-k="even"]');
const autoEven = await (async () => { const end = Date.now() + 20000; while (Date.now() < end) { const a = await p2.evaluate(() => window.__digitpro.state.analysis); if (a && a.status === "done" && a.strategy === "even") return true; await p2.waitForTimeout(200); } return false; })();
check("changement de contrat : nouveau signal automatique", autoEven);
await p2.click("#startBtn");
check("sans compte : aucun achat possible", /jeton API/.test(await p2.textContent("#startErr")) && (await ctrl("/stats")).buys === buys0);
check("mode auto : aucune erreur JavaScript", !errs2.length, errs2.join(" | "));
await p2.close();

/* mobile */
for (const w of [320, 375, 430]) { await p.setViewportSize({ width: w, height: 800 }); check(`pas de débordement à ${w}px`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: "/tmp/digitpro.png", fullPage: true });
check("aucune erreur JavaScript", !errs.length, errs.join(" | "));
await b.close(); mock.close();
console.log(results.join("\n")); console.log(failed ? `\n${failed} test(s) en échec` : `\n${results.length} tests réussis`);
process.exit(failed ? 1 : 0);
