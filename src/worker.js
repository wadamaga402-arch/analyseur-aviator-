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
function statsText(name, rounds) {
  const n = rounds.length;
  if (!n) return `<b>${esc(name)}</b>\nAucune manche pour l'instant. Ajoutez-en avec /ajouter 1,52 3,10 …`;
  const w = rounds.slice(-100), s = E.stats(w), q = E.quality(n);
  const lines = E.CATS.map(c => {
    const k = s.counts[c.key];
    return `${c.label} : ${fmtP(k / s.n)} (théorie ${fmtP(E.theoCat(c))})`;
  });
  return [
    `<b>Statistiques · ${esc(name)}</b>`,
    `${n} manches enregistrées · qualité ${q.txt}`,
    `Sur les ${s.n} dernières : moyenne ${fmtX(s.mean)}, médiane ${fmtX(s.median)}, max ${fmtX(s.max)}`,
    `≥ 2× : ${fmtP(s.ge2 / s.n)} observé · ${fmtP(E.theoGE(2))} en théorie`,
    "", ...lines, "",
    `Série actuelle sous 2× : ${s.streak}. Elle ne change pas la chance de la prochaine manche.`,
    `<i>Statistiques du passé, pas une prédiction.</i>`,
  ].join("\n");
}
function signalText(name, rounds) {
  const n = rounds.length, q = E.quality(n);
  const rows = [1.5, 2, 3, 5, 10].map(m => `≥ ${fmtX(m)} : ${fmtP(E.theoGE(m))} (théorie) · ${n ? fmtP(E.geRate(rounds, m)) : "—"} (observé)`);
  const v = n >= E.VAL.minRounds ? E.validate(rounds) : null;
  const sig = E.signalState(rounds, { validation: v || { status: "insufficient" } });
  return [
    `<b>${esc(sig.title)}</b>`,
    esc(sig.why),
    "",
    `<b>Signal statistique · ${esc(name)}</b>`,
    `Données : ${n} manches · qualité ${q.txt}`,
    v && v.status === "done" ? `Validation : test sur ${v.testN} manches · retour ${fmtP(v.test.roi)} contre ${fmtP(v.baseline.roi)} pour la référence` : `Validation : ${E.VAL.minRounds} manches nécessaires`,
    "", "Chance d'atteindre au moins :", ...rows, "",
    "Retour moyen : environ −3 % de la mise, quel que soit le niveau d'encaissement.",
    "Limite : chaque manche est indépendante. Aucun outil ne connaît la prochaine. Ce n'est pas un conseil de mise.",
  ].join("\n");
}
function historyText(name, rounds, src, k) {
  if (!rounds.length) return "Aucune manche enregistrée.";
  const start = Math.max(0, rounds.length - k);
  const items = rounds.slice(start).map((v, i) => fmtX(v) + (src[start + i] === "t" ? "ᵗ" : src[start + i] === "i" ? "ᶜ" : src[start + i] === "c" ? "ᵏ" : "")).reverse();
  return `<b>${Math.min(k, rounds.length)} dernières manches · ${esc(name)}</b> (la plus récente en premier)\n` + items.join("  ") +
    "\n<i>ᵗ Telegram · ᶜ CSV · ᵏ capture · sans marque : saisie sur le site</i>";
}
const HELP = [
  "<b>Commandes</b>",
  "/stats — statistiques du profil suivi",
  "/historique [n] — les n dernières manches (20 par défaut, 50 max)",
  "/ajouter 1,52 3,10 … — ajouter des manches réelles, de la plus ancienne à la plus récente",
  "/signal — probabilités théoriques et observées, avec leurs limites",
  "/aide — cette aide",
  "",
  "Ce bot ne se connecte pas à Bwin, ne prédit rien et ne place aucun pari.",
].join("\n");

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
async function handleUpdate(env, update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat || typeof msg.text !== "string") return;
  const chatId = msg.chat.id, text = msg.text.trim();
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, "");
  const c = await getConfig(env);

  if (c.chatId !== chatId) {
    const code = args[0] || "";
    if (cmd === "/start" && c.linkCode && code && timingSafeEqual(code, c.linkCode) && Date.now() < (c.linkExp || 0)) {
      const who = [msg.from?.first_name, msg.from?.username ? "@" + msg.from.username : ""].filter(Boolean).join(" ");
      await setConfig(env, { chatId, chatName: who || String(chatId), linkCode: null, linkExp: 0, linkedAt: Date.now(), lastTest: null });
      await send(env, chatId, "✅ <b>Bot relié à votre Analyseur Aviator.</b>\nRetournez sur le site et appuyez sur « Tester la connexion ».\n\n" + HELP);
    } else {
      await send(env, chatId, "Ce bot est privé. Pour le relier, appuyez sur « Connecter Telegram » sur votre site Analyseur Aviator.");
    }
    return;
  }

  const profiles = await getProfiles(env);
  const pid = c.tgProfile && profiles[c.tgProfile] ? c.tgProfile : Object.keys(profiles)[0];
  const pname = pid ? profiles[pid].name : "";
  const needProfile = () => send(env, chatId, "Aucun profil sur le site. Créez-en un dans « Profils de suivi », puis réessayez.");

  if (cmd === "/start" || cmd === "/aide" || cmd === "/help") return send(env, chatId, HELP);
  if (cmd === "/stats") { if (!pid) return needProfile(); const d = await getRounds(env, pid); return send(env, chatId, statsText(pname, d.rounds)); }
  if (cmd === "/signal") { if (!pid) return needProfile(); const d = await getRounds(env, pid); return send(env, chatId, signalText(pname, d.rounds)); }
  if (cmd === "/historique") {
    if (!pid) return needProfile();
    const k = Math.min(50, Math.max(1, parseInt(args[0], 10) || 20));
    const d = await getRounds(env, pid); return send(env, chatId, historyText(pname, d.rounds, d.src, k));
  }
  if (cmd === "/ajouter") {
    if (!pid) return needProfile();
    const { ok, bad } = E.parseList(args.join(" "));
    if (!ok.length) return send(env, chatId, "Aucune valeur lisible. Exemple : /ajouter 1,52 3,10 1,02\nMinimum 1,00. De la plus ancienne à la plus récente.");
    const r = await appendRounds(env, pid, ok, "t");
    if (r.error) return send(env, chatId, r.error);
    const s = E.stats(r.data.rounds.slice(-100));
    return send(env, chatId, [
      `✅ ${r.added.length} manche(s) ajoutée(s) à « ${esc(pname)} »` + (bad.length ? ` · ${bad.length} ignorée(s)` : "") + (r.dropped ? ` · ${r.dropped} doublon(s) retiré(s)` : ""),
      `Total : ${r.data.rounds.length} · ≥ 2× sur les ${s.n} dernières : ${fmtP(s.ge2 / s.n)}`,
    ].join("\n"));
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
    out[id] = Object.assign({}, profiles[id], { rounds: d.rounds, src: d.src });
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
    return json({ ok: true, service: "analyseur-aviator", botTokenSet: !!env.BOT_TOKEN, adminKeySet: !!(env.ADMIN_KEY && env.ADMIN_KEY.length >= 12), liveSource: null });
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
    await store(env).write("profiles", profiles); await store(env).remove("rounds:" + del[1]);
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
      { command: "signal", description: "Probabilités et limites" },
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
