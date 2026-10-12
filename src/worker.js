// Analyseur Aviator — serveur Cloudflare Worker
// - Sert le site (dossier public/)
// - Garde les profils et les manches dans un Durable Object (stockage gratuit)
// - Relie un bot Telegram privé (webhook) avec /start /stats /historique /ajouter /signal /aide
// Aucune connexion à Bwin : aucune source autorisée n'existe. Aucun pari n'est jamais placé.

import { DurableObject } from "cloudflare:workers";
import * as E from "./engine.js";
import * as C from "./bot-core.js";

const LINK_TTL_MS = 15 * 60 * 1000;

/* ---------------- storage ---------------- */
export class Store extends DurableObject {
  async read(key) { return (await this.ctx.storage.get(key)) ?? null; }
  async write(key, value) { await this.ctx.storage.put(key, value); return true; }
  async remove(key) { await this.ctx.storage.delete(key); return true; }
}
const store = env => env.STORE.get(env.STORE.idFromName("main"));

const getProfiles = env => C.getProfiles(store(env));
const getRounds = (env, id) => C.getRounds(store(env), id);
const getConfig = env => C.getConfig(store(env));
const setConfig = (env, patch) => C.setConfig(store(env), patch);

/* ---------------- helpers ---------------- */
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const fail = (status, error) => json({ ok: false, error }, status);
const { fmtX, fmtP, esc, timingSafeEqual } = C;
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

/* ---------------- shared bot logic (src/bot-core.js) ---------------- */
const allowedId = env => String(env.ALLOWED_USER_ID || "").trim();
const appendRounds = (env, id, values, src) => C.appendRounds(store(env), id, values, src);
const clearProfile = (env, id) => C.clearProfile(store(env), id);
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

async function handleUpdate(env, update) {
  const msg = update.message || update.edited_message;
  return C.handleMessage({ S: store(env), send: (chatId, text) => send(env, chatId, text), allowed: allowedId(env), ownerClaim: false }, msg);
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
    await tg(env, "setMyCommands", { commands: C.COMMANDS });
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
