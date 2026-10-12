// Analyseur Aviator — serveur Cloudflare Worker
// - Sert le site (dossier public/)
// - Garde les profils et les manches dans un Durable Object (stockage gratuit)
// - Relie un bot Telegram privé (webhook) avec /start /stats /historique /ajouter /signal /aide
// Aucune connexion à Bwin : aucune source autorisée n'existe. Aucun pari n'est jamais placé.

import { DurableObject } from "cloudflare:workers";
import * as E from "./engine.js";

const MAXR = 5000;
const LINK_TTL_MS = 15 * 60 * 1000;

/* ---------------- storage ---------------- */
export class Store extends DurableObject {
  async read(key) { return (await this.ctx.storage.get(key)) ?? null; }
  async write(key, value) { await this.ctx.storage.put(key, value); return true; }
  async remove(key) { await this.ctx.storage.delete(key); return true; }
}
const store = env => env.STORE.get(env.STORE.idFromName("main"));

async function getProfiles(env) { return (await store(env).read("profiles")) || {}; }
async function getRounds(env, id) { return (await store(env).read("rounds:" + id)) || { rounds: [], src: "" }; }
async function getConfig(env) { return (await store(env).read("config")) || {}; }
async function setConfig(env, patch) {
  const c = Object.assign(await getConfig(env), patch);
  await store(env).write("config", c);
  return c;
}

/* ---------------- helpers ---------------- */
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const fail = (status, error) => json({ ok: false, error }, status);
const fmtX = v => v.toFixed(2).replace(".", ",") + "×";
const fmtP = p => Number.isFinite(p) ? (p * 100).toFixed(1).replace(".", ",") + " %" : "—";
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function webhookSecret(env) {
  const data = new TextEncoder().encode("tg-webhook:" + env.BOT_TOKEN + ":" + env.ADMIN_KEY);
  const h = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}
function authorized(req, env) {
  const h = req.headers.get("authorization") || "";
  return !!env.ADMIN_KEY && env.ADMIN_KEY.length >= 12 && timingSafeEqual(h.replace(/^Bearer\s+/i, ""), env.ADMIN_KEY);
}

/* ---------------- Telegram API ---------------- */
async function tg(env, method, payload) {
  if (!env.BOT_TOKEN) return { ok: false, description: "BOT_TOKEN manquant dans les secrets Cloudflare." };
  const base = env.TG_API || "https://api.telegram.org";
  try {
    const r = await fetch(`${base}/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload || {}),
    });
    const data = await r.json().catch(() => ({ ok: false, description: "Réponse illisible de Telegram (HTTP " + r.status + ")." }));
    return data;
  } catch (e) {
    return { ok: false, description: "Telegram injoignable : " + (e && e.message || e) };
  }
}
const send = (env, chatId, text) => tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });

/* ---------------- statistics text (shared engine) ---------------- */
function signalOf(rounds) {
  const v = rounds.length >= E.VAL.minRounds ? E.validate(rounds) : { status: "insufficient" };
  return { v, sig: E.signalState(rounds, { validation: v }) };
}
function statsText(name, rounds) {
  const n = rounds.length;
  if (!n) return `<b>${esc(name)}</b>\nDONNÉES INSUFFISANTES : aucune manche enregistrée.\nAjoutez vos manches réelles avec /ajouter 1,52 3,10 …`;
  const w = rounds.slice(-100), s = E.stats(w), all = E.stats(rounds), dq = E.dataQuality(rounds, 0);
  const lines = E.CATS.map(c => `${c.label} : ${fmtP(s.counts[c.key] / s.n)} (théorie ${fmtP(E.theoCat(c))})`);
  const flags = dq.items.filter(x => !x.ok).map(x => `⚠️ ${x.label} : ${x.detail}`);
  return [
    `<b>Statistiques · ${esc(name)}</b>`,
    `${n} manche(s) analysée(s) · qualité des données : ${dq.level}`,
    `Toutes : moyenne ${fmtX(all.mean)}, médiane ${fmtX(all.median)}, max ${fmtX(all.max)}`,
    `${s.n} dernières : ≥ 2× ${fmtP(s.ge2 / s.n)} (théorie ${fmtP(E.theoGE(2))})`,
    "", "<b>Répartition (" + s.n + " dernières)</b>", ...lines,
    ...(flags.length ? ["", ...flags] : []),
    "", `Signal : <b>${esc(signalOf(rounds).sig.title)}</b> · /signal pour le détail`,
    n < 30 ? "Moins de 30 manches : ces pourcentages varient beaucoup par simple hasard." : `Série actuelle sous 2× : ${s.streak}. Elle ne change pas la chance de la prochaine manche.`,
    `<i>Observations du passé, pas une prédiction.</i>`,
  ].join("\n");
}
function signalText(name, rounds) {
  const n = rounds.length, dq = E.dataQuality(rounds, 0);
  const rows = [1.5, 2, 3, 5, 10].map(m => `≥ ${fmtX(m)} : ${fmtP(E.theoGE(m))} (théorie) · ${n ? fmtP(E.geRate(rounds, m)) : "—"} (observé)`);
  const { v, sig } = signalOf(rounds);
  const wf = E.walkForward(rounds);
  return [
    `★ <b>STAR BOT SIGNAL : ${esc(sig.title)}</b>`,
    esc(sig.why),
    "",
    `Données : ${n} manche(s) réelle(s) · qualité ${dq.level} · 0 en direct`,
    v.status === "done" ? `Validation hors échantillon : test sur ${v.testN} manches · meilleure règle ${fmtP(v.test.roi)} par mise contre ${fmtP(v.baseline.roi)} pour la référence` : `Validation hors échantillon : ${E.VAL.minRounds} manches nécessaires`,
    wf.status === "done" ? `Estimations vs résultats : ${wf.better ? "meilleures que la théorie (à confirmer)" : "aucune amélioration sur la théorie"} (${wf.scored} manches)` : `Estimations vs résultats : ${wf.need} manches nécessaires`,
    "", "<b>Observations historiques</b> — chance d'atteindre au moins :", ...rows, "",
    "Retour moyen théorique : −3 % de la mise, quel que soit l'encaissement.",
    "<i>Limite : chaque manche est indépendante. Aucun outil ne connaît la prochaine. Ce n'est pas un conseil de mise.</i>",
  ].join("\n");
}
function historyText(name, rounds, src, k) {
  if (!rounds.length) return "Aucune manche enregistrée. Ajoutez-en avec /ajouter 1,52 3,10 …";
  const start = Math.max(0, rounds.length - k);
  const items = rounds.slice(start).map((v, i) => fmtX(v) + (src[start + i] === "t" ? "ᵗ" : src[start + i] === "i" ? "ᶜ" : src[start + i] === "c" ? "ᵏ" : "")).reverse();
  return `<b>${Math.min(k, rounds.length)} dernières manches · ${esc(name)}</b> (la plus récente en premier, ${rounds.length} au total)\n` + items.join("  ") +
    "\n<i>ᵗ Telegram · ᶜ CSV · ᵏ capture · sans marque : saisie sur le site</i>";
}
const HELP = [
  "<b>Aviator Star Bot</b> — statistiques sur vos manches réelles",
  "",
  "/ajouter 1,52 3,10 1,20 — ajouter des manches (de la plus ancienne à la plus récente)",
  "/historique [n] — les n dernières manches (20 par défaut, 50 max)",
  "/stats — statistiques et qualité des données",
  "/signal — STAR BOT SIGNAL : analyse, validation et limites",
  "/effacer — effacer l'historique du profil (avec confirmation)",
  "/test — vérifier le moteur d'analyse et le stockage",
  "/aide — cette aide",
  "",
  "Le bot fonctionne même si le site est fermé. Il ne se connecte pas à Bwin, ne prédit rien et ne place aucune mise.",
].join("\n");

/* deterministic sample shaped like Aviator's published distribution, for /test only (never stored, never shown as data) */
function selfTestSample(n, seed) {
  let x = seed >>> 0; const r = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  return Array.from({ length: n }, () => Math.max(1, Math.floor((E.RTP / (1 - r())) * 100) / 100));
}
async function selfTest(env) {
  const t0 = Date.now(), out = [];
  const check = (label, fn) => { try { out.push([label, !!fn()]); } catch (e) { out.push([label, false]); } };
  check("probabilité théorique ≥ 2× = 48,5 %", () => Math.abs(E.theoGE(2) - 0.485) < 1e-9);
  check("lecture des valeurs (1,52 / 3.10 / x)", () => { const r = E.parseList("1,52 3.10 x 0,5"); return r.ok.length === 2 && r.bad.length === 2; });
  check("statistiques (moyenne, médiane, série)", () => { const s = E.stats([2.5, 1.2, 1.1, 1.3]); return Math.abs(s.mean - 1.525) < 1e-9 && E.median([3, 1, 2]) === 2 && s.streak === 3; });
  check("test du khi² (valeur de référence)", () => Math.abs(E.gammaQ(1.5, 7.815 / 2) - 0.05) < 0.001);
  const sample = selfTestSample(1500, 20261013);
  check("validation : aucun faux avantage sur 1 500 manches conformes", () => { const v = E.validate(sample); return v.status === "done" && v.edge === false; });
  check("estimations vs résultats : pas d'amélioration factice", () => { const w = E.walkForward(sample); return w.status === "done" && !w.better; });
  check("qualité : données triées détectées", () => E.dataQuality(sample.slice().sort((a, b) => a - b), 0).items.some(x => x.label === "Ordre" && !x.ok));
  let storageOk = false;
  try { const k = "selftest", v = { at: Date.now() }; await store(env).write(k, v); const back = await store(env).read(k); storageOk = back && back.at === v.at; await store(env).remove(k); } catch {}
  out.push(["stockage permanent (écriture / lecture)", storageOk]);
  return { out, ms: Date.now() - t0, ok: out.every(x => x[1]) };
}

/* ---------------- rounds ---------------- */
async function appendRounds(env, profileId, values, src) {
  const profiles = await getProfiles(env);
  if (!profiles[profileId]) return { error: "Profil introuvable." };
  const data = await getRounds(env, profileId);
  const { fresh, dropped } = E.dedupeOverlap(data.rounds, values);
  data.rounds.push(...fresh); data.src += src.repeat(fresh.length);
  if (data.rounds.length > MAXR) { const cut = data.rounds.length - MAXR; data.rounds.splice(0, cut); data.src = data.src.slice(cut); }
  await store(env).write("rounds:" + profileId, data);
  profiles[profileId].updatedAt = Date.now();
  await store(env).write("profiles", profiles);
  return { profile: profiles[profileId], data, added: fresh, dropped };
}
async function appendLog(env, id, rounds, why) {
  const { sig } = signalOf(rounds);
  const e = Object.assign(E.logEntry(rounds, sig), { why });
  const log = (await store(env).read("log:" + id)) || [];
  log.push(e); if (log.length > 300) log.splice(0, log.length - 300);
  await store(env).write("log:" + id, log);
  return e;
}
async function clearProfile(env, id) {
  const profiles = await getProfiles(env);
  if (!profiles[id]) return false;
  await store(env).write("rounds:" + id, { rounds: [], src: "" }); await store(env).remove("log:" + id);
  profiles[id].updatedAt = Date.now(); await store(env).write("profiles", profiles);
  return true;
}
async function notifyNewRounds(env, profileId, added, src) {
  const c = await getConfig(env);
  if (!c.chatId || !added.length || (c.tgProfile && c.tgProfile !== profileId)) return;
  const profiles = await getProfiles(env), data = await getRounds(env, profileId);
  const last = data.rounds.slice(-100), s = E.stats(last);
  const shown = added.slice(-15).map(fmtX).join("  ") + (added.length > 15 ? " …" : "");
  await send(env, c.chatId, [
    `📥 <b>${added.length} nouvelle(s) manche(s)</b> · ${esc(E.SRC[src] || src)} · ${esc(profiles[profileId]?.name || "")}`,
    shown,
    `≥ 2× sur les ${s.n} dernières : ${fmtP(s.ge2 / s.n)} (théorie ${fmtP(E.theoGE(2))})`,
  ].join("\n"));
}

/* ---------------- Telegram webhook ---------------- */
const allowedId = env => String(env.ALLOWED_USER_ID || "").trim();
async function handleUpdate(env, update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat || typeof msg.text !== "string") return;
  if (msg.chat.type && msg.chat.type !== "private") return;          // private chats only
  const chatId = msg.chat.id, fromId = String(msg.from?.id ?? ""), text = msg.text.trim().slice(0, 4000);
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, "");
  const c = await getConfig(env);
  const who = [msg.from?.first_name, msg.from?.username ? "@" + msg.from.username : ""].filter(Boolean).join(" ") || String(chatId);
  const allow = allowedId(env);

  // 1. authorisation: only the Telegram account in ALLOWED_USER_ID (when set) may use the bot
  if (allow && fromId !== allow) {
    return send(env, chatId, `Ce bot est privé.\nVotre identifiant Telegram : <code>${esc(fromId)}</code>\nSi ce bot est le vôtre, mettez cet identifiant dans le secret ALLOWED_USER_ID sur Cloudflare.`);
  }
  if (c.chatId !== chatId) {
    const code = args[0] || "";
    const byCode = cmd === "/start" && c.linkCode && code && timingSafeEqual(code, c.linkCode) && Date.now() < (c.linkExp || 0);
    if (allow || byCode) {
      await setConfig(env, { chatId, chatName: who, linkCode: null, linkExp: 0, linkedAt: Date.now(), lastTest: null });
      const lock = allow ? "🔒 Bot verrouillé sur votre compte." : `🔓 Pour le verrouiller sur votre compte, ajoutez le secret ALLOWED_USER_ID = <code>${esc(fromId)}</code> dans Cloudflare.`;
      if (cmd === "/start") return send(env, chatId, "✅ <b>Bot relié.</b> Vos données sont gardées sur votre serveur, même si le site est fermé.\n" + lock + "\nEnvoyez /test pour vérifier que tout fonctionne.\n\n" + HELP);
    } else {
      return send(env, chatId, `Ce bot est privé.\nVotre identifiant Telegram : <code>${esc(fromId)}</code>\nPour l'utiliser, mettez cet identifiant dans le secret ALLOWED_USER_ID sur Cloudflare (ou appuyez sur « Connecter Telegram » sur le site).`);
    }
  }

  // 2. profile followed by the bot (created automatically if the site was never used)
  let profiles = await getProfiles(env);
  let pid = c.tgProfile && profiles[c.tgProfile] ? c.tgProfile : Object.keys(profiles)[0];
  if (!pid && cmd === "/ajouter") {
    pid = "p" + Date.now().toString(36) + "tg";
    profiles[pid] = { name: "Telegram", createdAt: Date.now(), updatedAt: Date.now() };
    await store(env).write("profiles", profiles); await store(env).write("rounds:" + pid, { rounds: [], src: "" });
    await setConfig(env, { tgProfile: pid });
  }
  const pname = pid ? profiles[pid].name : "";
  const noData = () => send(env, chatId, "DONNÉES INSUFFISANTES : aucune manche enregistrée.\nAjoutez vos manches réelles avec /ajouter 1,52 3,10 1,20");

  if (cmd === "/start" || cmd === "/aide" || cmd === "/help") return send(env, chatId, HELP);
  if (cmd === "/test") {
    const t = await selfTest(env);
    return send(env, chatId, [
      `${t.ok ? "✅" : "❌"} <b>Test du moteur : ${t.out.filter(x => x[1]).length}/${t.out.length} vérifications réussies</b> (${t.ms} ms)`,
      ...t.out.map(([l, ok]) => `${ok ? "✓" : "✗"} ${l}`),
      "✓ Telegram : ce message est bien arrivé",
      "",
      "<i>Le test utilise un échantillon calculé, jamais enregistré ni mélangé à vos données.</i>",
    ].join("\n"));
  }
  if (cmd === "/stats") { if (!pid) return noData(); const d = await getRounds(env, pid); return send(env, chatId, statsText(pname, d.rounds)); }
  if (cmd === "/signal") { if (!pid) return noData(); const d = await getRounds(env, pid); return send(env, chatId, signalText(pname, d.rounds)); }
  if (cmd === "/historique") {
    if (!pid) return noData();
    const k = Math.min(50, Math.max(1, parseInt(args[0], 10) || 20));
    const d = await getRounds(env, pid); return send(env, chatId, historyText(pname, d.rounds, d.src, k));
  }
  if (cmd === "/ajouter") {
    if (args.join("").length > 2000) return send(env, chatId, "Trop de valeurs d'un coup : envoyez-en au plus 300 par message.");
    const { ok, bad } = E.parseList(args.join(" "));
    if (!ok.length) return send(env, chatId, "Aucune valeur lisible. Exemple : /ajouter 1,52 3,10 1,02\nMinimum 1,00. De la plus ancienne à la plus récente.");
    if (ok.length > 300) return send(env, chatId, "Trop de valeurs d'un coup : envoyez-en au plus 300 par message.");
    const r = await appendRounds(env, pid, ok, "t");
    if (r.error) return send(env, chatId, r.error);
    const all = r.data.rounds, s = E.stats(all.slice(-100)), e = await appendLog(env, pid, all, "Telegram");
    return send(env, chatId, [
      `✅ ${r.added.length} manche(s) enregistrée(s) dans « ${esc(pname)} »` + (bad.length ? ` · ${bad.length} ignorée(s) (illisibles ou < 1,00)` : "") + (r.dropped ? ` · ${r.dropped} déjà présente(s) ignorée(s)` : ""),
      `Total : ${all.length} manche(s) · ≥ 2× sur les ${s.n} dernières : ${fmtP(s.ge2 / s.n)} (théorie ${fmtP(E.theoGE(2))})`,
      `Signal : <b>${esc(e.title)}</b>`,
      all.length < 30 ? `Données insuffisantes pour une analyse fiable : encore ${30 - all.length} manche(s) au minimum. Aucune prédiction n'est donnée.` : "Statistiques mises à jour · /stats et /signal pour le détail.",
    ].join("\n"));
  }
  if (cmd === "/effacer") {
    if (!pid) return noData();
    const d = await getRounds(env, pid);
    if ((args[0] || "").toLowerCase() === "oui") {
      if (!c.clearPending || c.clearPending.pid !== pid || Date.now() > c.clearPending.exp) return send(env, chatId, "Aucune demande d'effacement en cours (ou elle a expiré). Envoyez d'abord /effacer.");
      await clearProfile(env, pid); await setConfig(env, { clearPending: null });
      return send(env, chatId, `🗑 Historique de « ${esc(pname)} » effacé (${c.clearPending.n} manche(s)). Le profil est conservé.`);
    }
    if (!d.rounds.length) return send(env, chatId, "L'historique est déjà vide.");
    await setConfig(env, { clearPending: { pid, n: d.rounds.length, exp: Date.now() + 120000 } });
    return send(env, chatId, `⚠️ Effacer les ${d.rounds.length} manche(s) et les analyses de « ${esc(pname)} » ?\nPour confirmer, envoyez <b>/effacer oui</b> dans les 2 minutes. Sinon, rien n'est effacé.`);
  }
  return send(env, chatId, "Commande inconnue.\n\n" + HELP);
}

/* ---------------- HTTP API ---------------- */
async function readBody(req) { try { return await req.json(); } catch { return {}; } }

async function fullState(env) {
  const profiles = await getProfiles(env), c = await getConfig(env);
  const out = {};
  for (const id of Object.keys(profiles)) {
    const d = await getRounds(env, id);
    out[id] = Object.assign({}, profiles[id], { rounds: d.rounds, src: d.src, log: (await store(env).read("log:" + id)) || [] });
  }
  return {
    ok: true, profiles: out,
    telegram: {
      tokenSet: !!env.BOT_TOKEN, botUsername: c.botUsername || null, linked: !!c.chatId, chatName: c.chatName || null,
      pending: !!(c.linkCode && Date.now() < (c.linkExp || 0)), link: c.linkCode && Date.now() < (c.linkExp || 0) && c.botUsername ? `https://t.me/${c.botUsername}?start=${c.linkCode}` : null,
      tgProfile: c.tgProfile || null, lastTest: c.lastTest || null,
    },
  };
}

async function api(req, env, ctx, path) {
  if (path === "/api/health") {
    return json({ ok: true, service: "analyseur-aviator", botTokenSet: !!env.BOT_TOKEN, adminKeySet: !!(env.ADMIN_KEY && env.ADMIN_KEY.length >= 12), allowedUserSet: !!allowedId(env), liveSource: null });
  }
  if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 12) return fail(503, "ADMIN_KEY manquant ou trop court (12 caractères minimum) dans les secrets Cloudflare.");
  if (!authorized(req, env)) return fail(401, "Clé d'accès incorrecte.");

  if (path === "/api/state" && req.method === "GET") return json(await fullState(env));

  if (path === "/api/profiles" && req.method === "POST") {
    const b = await readBody(req); const name = String(b.name || "").trim().slice(0, 40);
    if (!name) return fail(400, "Nom de profil vide.");
    const profiles = await getProfiles(env);
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    profiles[id] = { name, createdAt: Date.now(), updatedAt: Date.now() };
    await store(env).write("profiles", profiles);
    await store(env).write("rounds:" + id, { rounds: [], src: "" });
    return json({ ok: true, id });
  }
  const del = path.match(/^\/api\/profiles\/([\w-]+)$/);
  if (del && req.method === "DELETE") {
    const profiles = await getProfiles(env);
    if (!profiles[del[1]]) return fail(404, "Profil introuvable.");
    delete profiles[del[1]];
    await store(env).write("profiles", profiles); await store(env).remove("rounds:" + del[1]); await store(env).remove("log:" + del[1]);
    const c = await getConfig(env); if (c.tgProfile === del[1]) await setConfig(env, { tgProfile: null });
    return json({ ok: true });
  }
  if (path === "/api/rounds" && req.method === "POST") {
    const b = await readBody(req);
    const src = ["m", "i", "c"].includes(b.src) ? b.src : "m";
    const values = (Array.isArray(b.values) ? b.values : []).map(E.toNum).filter(E.validRound).map(v => Math.round(v * 100) / 100);
    if (!values.length) return fail(400, "Aucune valeur valide (minimum 1,00).");
    const r = await appendRounds(env, String(b.profile || ""), values, src);
    if (r.error) return fail(404, r.error);
    ctx.waitUntil(notifyNewRounds(env, b.profile, r.added, src).catch(() => {}));
    return json({ ok: true, added: r.added.length, dropped: r.dropped });
  }
  if (path === "/api/log" && req.method === "POST") {
    const b = await readBody(req); const id = String(b.profile || ""); const e = b.entry || {};
    const profiles = await getProfiles(env);
    if (!profiles[id]) return fail(404, "Profil introuvable.");
    const n = Math.floor(Number(e.n));
    if (!Number.isFinite(n) || n < 0 || typeof e.code !== "string" || typeof e.title !== "string") return fail(400, "Analyse invalide.");
    const entry = { at: Number(e.at) || Date.now(), n, code: e.code.slice(0, 20), title: e.title.slice(0, 80), p2: Number.isFinite(e.p2) ? e.p2 : null, why: String(e.why || "").slice(0, 20) };
    const log = (await store(env).read("log:" + id)) || [];
    log.push(entry); if (log.length > 300) log.splice(0, log.length - 300);
    await store(env).write("log:" + id, log);
    return json({ ok: true, count: log.length });
  }
  if (path === "/api/rounds/clear" && req.method === "POST") {
    const b = await readBody(req); const id = String(b.profile || "");
    if (!(await clearProfile(env, id))) return fail(404, "Profil introuvable.");
    return json({ ok: true });
  }
  if (path === "/api/rounds/undo" && req.method === "POST") {
    const b = await readBody(req); const id = String(b.profile || "");
    const d = await getRounds(env, id);
    if (!d.rounds.length) return fail(400, "Aucune manche à retirer.");
    d.rounds.pop(); d.src = d.src.slice(0, -1);
    await store(env).write("rounds:" + id, d);
    return json({ ok: true });
  }

  if (path === "/api/telegram/connect" && req.method === "POST") {
    const me = await tg(env, "getMe");
    if (!me.ok) return fail(502, "Jeton du bot refusé par Telegram : " + (me.description || "erreur inconnue") + ". Vérifiez BOT_TOKEN.");
    const origin = new URL(req.url).origin;
    const hook = await tg(env, "setWebhook", { url: origin + "/telegram/webhook", secret_token: await webhookSecret(env), allowed_updates: ["message", "edited_message"], drop_pending_updates: true });
    if (!hook.ok) return fail(502, "Telegram a refusé l'adresse du serveur : " + (hook.description || "erreur inconnue"));
    await tg(env, "setMyCommands", { commands: [
      { command: "stats", description: "Statistiques du profil suivi" },
      { command: "historique", description: "Dernières manches" },
      { command: "ajouter", description: "Ajouter des manches réelles" },
      { command: "signal", description: "STAR BOT SIGNAL et limites" },
      { command: "effacer", description: "Effacer l'historique (avec confirmation)" },
      { command: "test", description: "Vérifier le moteur" },
      { command: "aide", description: "Aide" },
    ] });
    const code = [...crypto.getRandomValues(new Uint8Array(9))].map(b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
    await setConfig(env, { botUsername: me.result.username, linkCode: code, linkExp: Date.now() + LINK_TTL_MS, webhookAt: Date.now() });
    return json({ ok: true, botUsername: me.result.username, link: `https://t.me/${me.result.username}?start=${code}`, expiresInMin: LINK_TTL_MS / 60000 });
  }
  if (path === "/api/telegram/test" && req.method === "POST") {
    const c = await getConfig(env);
    const now = Date.now();
    let result;
    if (!c.chatId) result = { ok: false, error: "Le bot n'est pas encore relié : appuyez sur « Connecter Telegram » puis sur Démarrer dans Telegram." };
    else {
      const me = await tg(env, "getMe");
      const info = me.ok ? await tg(env, "getWebhookInfo") : null;
      if (!me.ok) result = { ok: false, error: "Jeton refusé : " + (me.description || "") };
      else if (!info || !info.ok || !info.result.url) result = { ok: false, error: "Webhook absent : appuyez à nouveau sur « Connecter Telegram »." };
      else {
        const s = await send(env, c.chatId, "🔔 Test de connexion réussi. Votre Analyseur Aviator peut vous écrire ici.");
        result = s.ok ? { ok: true } : { ok: false, error: "Envoi refusé par Telegram : " + (s.description || "") + (s.error_code === 403 ? " (le bot a été bloqué ou supprimé dans Telegram)." : "") };
        if (s.ok && info.result.last_error_message && info.result.last_error_date * 1000 > (c.webhookAt || 0)) result.warning = "Dernière erreur de réception : " + info.result.last_error_message;
      }
    }
    await setConfig(env, { lastTest: Object.assign({ at: now }, result) });
    return json(result, result.ok ? 200 : 409);
  }
  if (path === "/api/telegram/profile" && req.method === "POST") {
    const b = await readBody(req); const profiles = await getProfiles(env);
    if (b.profile && !profiles[b.profile]) return fail(404, "Profil introuvable.");
    await setConfig(env, { tgProfile: b.profile || null });
    return json({ ok: true });
  }
  if (path === "/api/telegram/disconnect" && req.method === "POST") {
    const c = await getConfig(env);
    if (c.chatId) await send(env, c.chatId, "Le bot a été déconnecté de votre Analyseur Aviator.");
    await tg(env, "deleteWebhook", {});
    await setConfig(env, { chatId: null, chatName: null, linkCode: null, linkExp: 0, lastTest: null });
    return json({ ok: true });
  }
  return fail(404, "Route inconnue.");
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/telegram/webhook") {
      if (req.method !== "POST") return new Response("ok");
      const got = req.headers.get("x-telegram-bot-api-secret-token") || "";
      if (!env.BOT_TOKEN || !timingSafeEqual(got, await webhookSecret(env))) return new Response("forbidden", { status: 403 });
      const update = await readBody(req);
      try { await handleUpdate(env, update); } catch (e) { console.error("update failed", e); }
      return new Response("ok"); // always 200 so Telegram does not resend in a loop
    }
    if (path.startsWith("/api/")) {
      try { return await api(req, env, ctx, path); }
      catch (e) { console.error(e); return fail(500, "Erreur interne du serveur : " + (e && e.message || e)); }
    }
    return env.ASSETS.fetch(req);
  },
};
