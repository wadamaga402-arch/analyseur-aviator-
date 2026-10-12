// Aviator Star Bot — Telegram logic shared by both hostings:
//   - Cloudflare Worker (src/worker.js)            S = Durable Object stub
//   - Telegram Serverless (telegram-serverless/)   S = SQLite key/value table
// S is any object with async read(key), write(key, value), remove(key).
// send(chatId, text) must resolve to { ok, description? } and never throw.
// No connection to Bwin, no prediction, no betting function.

import * as E from "./engine.js";

export const MAXR = 5000;
export const fmtX = v => v.toFixed(2).replace(".", ",") + "×";
export const fmtP = p => Number.isFinite(p) ? (p * 100).toFixed(1).replace(".", ",") + " %" : "—";
export const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------------- data ---------------- */
export async function getProfiles(S) { return (await S.read("profiles")) || {}; }
export async function getRounds(S, id) { return (await S.read("rounds:" + id)) || { rounds: [], src: "" }; }
export async function getConfig(S) { return (await S.read("config")) || {}; }
export async function setConfig(S, patch) { const c = Object.assign(await getConfig(S), patch); await S.write("config", c); return c; }

export async function appendRounds(S, profileId, values, src) {
  const profiles = await getProfiles(S);
  if (!profiles[profileId]) return { error: "Profil introuvable." };
  const data = await getRounds(S, profileId);
  const { fresh, dropped } = E.dedupeOverlap(data.rounds, values);
  data.rounds.push(...fresh); data.src += src.repeat(fresh.length);
  if (data.rounds.length > MAXR) { const cut = data.rounds.length - MAXR; data.rounds.splice(0, cut); data.src = data.src.slice(cut); }
  await S.write("rounds:" + profileId, data);
  profiles[profileId].updatedAt = Date.now();
  await S.write("profiles", profiles);
  return { profile: profiles[profileId], data, added: fresh, dropped };
}
export function signalOf(rounds) {
  const v = rounds.length >= E.VAL.minRounds ? E.validate(rounds) : { status: "insufficient" };
  return { v, sig: E.signalState(rounds, { validation: v }) };
}
export async function appendLog(S, id, rounds, why) {
  const { sig } = signalOf(rounds);
  const e = Object.assign(E.logEntry(rounds, sig), { why });
  const log = (await S.read("log:" + id)) || [];
  log.push(e); if (log.length > 300) log.splice(0, log.length - 300);
  await S.write("log:" + id, log);
  return e;
}
export async function clearProfile(S, id) {
  const profiles = await getProfiles(S);
  if (!profiles[id]) return false;
  await S.write("rounds:" + id, { rounds: [], src: "" }); await S.remove("log:" + id);
  profiles[id].updatedAt = Date.now(); await S.write("profiles", profiles);
  return true;
}

/* ---------------- texts ---------------- */
export function statsText(name, rounds) {
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
export function signalText(name, rounds) {
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
export function historyText(name, rounds, src, k) {
  if (!rounds.length) return "Aucune manche enregistrée. Ajoutez-en avec /ajouter 1,52 3,10 …";
  const start = Math.max(0, rounds.length - k);
  const items = rounds.slice(start).map((v, i) => fmtX(v) + (src[start + i] === "t" ? "ᵗ" : src[start + i] === "i" ? "ᶜ" : src[start + i] === "c" ? "ᵏ" : "")).reverse();
  return `<b>${Math.min(k, rounds.length)} dernières manches · ${esc(name)}</b> (la plus récente en premier, ${rounds.length} au total)\n` + items.join("  ") +
    "\n<i>ᵗ Telegram · ᶜ CSV · ᵏ capture · sans marque : saisie sur le site</i>";
}
export const HELP = [
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
export const COMMANDS = [
  { command: "ajouter", description: "Ajouter des manches réelles" },
  { command: "historique", description: "Dernières manches" },
  { command: "stats", description: "Statistiques du profil suivi" },
  { command: "signal", description: "STAR BOT SIGNAL et limites" },
  { command: "effacer", description: "Effacer l'historique (avec confirmation)" },
  { command: "test", description: "Vérifier le moteur" },
  { command: "aide", description: "Aide" },
];

/* ---------------- self-test ---------------- */
// deterministic sample shaped like Aviator's published distribution, for /test only (never stored, never shown as data)
function selfTestSample(n, seed) {
  let x = seed >>> 0; const r = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  return Array.from({ length: n }, () => Math.max(1, Math.floor((E.RTP / (1 - r())) * 100) / 100));
}
export async function selfTest(S) {
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
  try { const k = "selftest", v = { at: Date.now() }; await S.write(k, v); const back = await S.read(k); storageOk = !!back && back.at === v.at; await S.remove(k); } catch {}
  out.push(["stockage permanent (écriture / lecture)", storageOk]);
  return { out, ms: Date.now() - t0, ok: out.every(x => x[1]) };
}

/* ---------------- message handling ---------------- */
// deps: { S, send, allowed: "<telegram id>" | "", ownerClaim: boolean (Serverless: first /start becomes the owner) }
export async function handleMessage(deps, msg) {
  const { S, send } = deps;
  if (!msg || !msg.chat || typeof msg.text !== "string") return;
  if (msg.chat.type && msg.chat.type !== "private") return;          // private chats only
  const chatId = msg.chat.id, fromId = String(msg.from?.id ?? ""), text = msg.text.trim().slice(0, 4000);
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, "");
  let c = await getConfig(S);
  const who = [msg.from?.first_name, msg.from?.username ? "@" + msg.from.username : ""].filter(Boolean).join(" ") || String(chatId);

  // owner claim (Serverless, no secret store): the first person to send /start in private becomes the only allowed account
  if (deps.ownerClaim && !deps.allowed && !c.ownerId && cmd === "/start" && fromId) {
    c = await setConfig(S, { ownerId: fromId, chatId, chatName: who, linkedAt: Date.now() });
    return send(chatId, `✅ <b>Bot relié et verrouillé sur votre compte</b> (identifiant <code>${esc(fromId)}</code>).\nPersonne d'autre ne peut l'utiliser. Vos données sont gardées chez Telegram, même si le site est fermé.\nEnvoyez /test pour vérifier que tout fonctionne.\n\n` + HELP);
  }
  const allow = String(deps.allowed || (deps.ownerClaim ? c.ownerId || "" : "")).trim();

  // 1. authorisation
  if (allow && fromId !== allow) {
    return send(chatId, `Ce bot est privé.\nVotre identifiant Telegram : <code>${esc(fromId)}</code>`
      + (deps.ownerClaim ? "" : "\nSi ce bot est le vôtre, mettez cet identifiant dans le secret ALLOWED_USER_ID sur Cloudflare."));
  }
  if (deps.ownerClaim && !allow) {
    return send(chatId, "Envoyez /start pour relier ce bot à votre compte Telegram.");
  }
  if (c.chatId !== chatId) {
    const code = args[0] || "";
    const byCode = cmd === "/start" && c.linkCode && code && timingSafeEqual(code, c.linkCode) && Date.now() < (c.linkExp || 0);
    if (allow || byCode) {
      c = await setConfig(S, { chatId, chatName: who, linkCode: null, linkExp: 0, linkedAt: Date.now(), lastTest: null });
      const lock = allow ? "🔒 Bot verrouillé sur votre compte." : `🔓 Pour le verrouiller sur votre compte, ajoutez le secret ALLOWED_USER_ID = <code>${esc(fromId)}</code> dans Cloudflare.`;
      if (cmd === "/start") return send(chatId, "✅ <b>Bot relié.</b> Vos données sont gardées sur votre serveur, même si le site est fermé.\n" + lock + "\nEnvoyez /test pour vérifier que tout fonctionne.\n\n" + HELP);
    } else {
      return send(chatId, `Ce bot est privé.\nVotre identifiant Telegram : <code>${esc(fromId)}</code>\nPour l'utiliser, mettez cet identifiant dans le secret ALLOWED_USER_ID sur Cloudflare (ou appuyez sur « Connecter Telegram » sur le site).`);
    }
  }

  // 2. profile followed by the bot (created automatically if the site was never used)
  const profiles = await getProfiles(S);
  let pid = c.tgProfile && profiles[c.tgProfile] ? c.tgProfile : Object.keys(profiles)[0];
  if (!pid && cmd === "/ajouter") {
    pid = "p" + Date.now().toString(36) + "tg";
    profiles[pid] = { name: "Telegram", createdAt: Date.now(), updatedAt: Date.now() };
    await S.write("profiles", profiles); await S.write("rounds:" + pid, { rounds: [], src: "" });
    c = await setConfig(S, { tgProfile: pid });
  }
  const pname = pid ? profiles[pid].name : "";
  const noData = () => send(chatId, "DONNÉES INSUFFISANTES : aucune manche enregistrée.\nAjoutez vos manches réelles avec /ajouter 1,52 3,10 1,20");

  if (cmd === "/start" || cmd === "/aide" || cmd === "/help") return send(chatId, HELP);
  if (cmd === "/test") {
    const t = await selfTest(S);
    return send(chatId, [
      `${t.ok ? "✅" : "❌"} <b>Test du moteur : ${t.out.filter(x => x[1]).length}/${t.out.length} vérifications réussies</b> (${t.ms} ms)`,
      ...t.out.map(([l, ok]) => `${ok ? "✓" : "✗"} ${l}`),
      "✓ Telegram : ce message est bien arrivé",
      "",
      "<i>Le test utilise un échantillon calculé, jamais enregistré ni mélangé à vos données.</i>",
    ].join("\n"));
  }
  if (cmd === "/stats") { if (!pid) return noData(); const d = await getRounds(S, pid); return send(chatId, statsText(pname, d.rounds)); }
  if (cmd === "/signal") { if (!pid) return noData(); const d = await getRounds(S, pid); return send(chatId, signalText(pname, d.rounds)); }
  if (cmd === "/historique") {
    if (!pid) return noData();
    const k = Math.min(50, Math.max(1, parseInt(args[0], 10) || 20));
    const d = await getRounds(S, pid); return send(chatId, historyText(pname, d.rounds, d.src, k));
  }
  if (cmd === "/ajouter") {
    if (args.join("").length > 2000) return send(chatId, "Trop de valeurs d'un coup : envoyez-en au plus 300 par message.");
    const { ok, bad } = E.parseList(args.join(" "));
    if (!ok.length) return send(chatId, "Aucune valeur lisible. Exemple : /ajouter 1,52 3,10 1,02\nMinimum 1,00. De la plus ancienne à la plus récente.");
    if (ok.length > 300) return send(chatId, "Trop de valeurs d'un coup : envoyez-en au plus 300 par message.");
    const r = await appendRounds(S, pid, ok, "t");
    if (r.error) return send(chatId, r.error);
    const all = r.data.rounds, s = E.stats(all.slice(-100)), e = await appendLog(S, pid, all, "Telegram");
    return send(chatId, [
      `✅ ${r.added.length} manche(s) enregistrée(s) dans « ${esc(pname)} »` + (bad.length ? ` · ${bad.length} ignorée(s) (illisibles ou < 1,00)` : "") + (r.dropped ? ` · ${r.dropped} déjà présente(s) ignorée(s)` : ""),
      `Total : ${all.length} manche(s) · ≥ 2× sur les ${s.n} dernières : ${fmtP(s.ge2 / s.n)} (théorie ${fmtP(E.theoGE(2))})`,
      `Signal : <b>${esc(e.title)}</b>`,
      all.length < 30 ? `Données insuffisantes pour une analyse fiable : encore ${30 - all.length} manche(s) au minimum. Aucune prédiction n'est donnée.` : "Statistiques mises à jour · /stats et /signal pour le détail.",
    ].join("\n"));
  }
  if (cmd === "/effacer") {
    if (!pid) return noData();
    const d = await getRounds(S, pid);
    if ((args[0] || "").toLowerCase() === "oui") {
      if (!c.clearPending || c.clearPending.pid !== pid || Date.now() > c.clearPending.exp) return send(chatId, "Aucune demande d'effacement en cours (ou elle a expiré). Envoyez d'abord /effacer.");
      await clearProfile(S, pid); await setConfig(S, { clearPending: null });
      return send(chatId, `🗑 Historique de « ${esc(pname)} » effacé (${c.clearPending.n} manche(s)). Le profil est conservé.`);
    }
    if (!d.rounds.length) return send(chatId, "L'historique est déjà vide.");
    await setConfig(S, { clearPending: { pid, n: d.rounds.length, exp: Date.now() + 120000 } });
    return send(chatId, `⚠️ Effacer les ${d.rounds.length} manche(s) et les analyses de « ${esc(pname)} » ?\nPour confirmer, envoyez <b>/effacer oui</b> dans les 2 minutes. Sinon, rien n'est effacé.`);
  }
  return send(chatId, "Commande inconnue.\n\n" + HELP);
}
