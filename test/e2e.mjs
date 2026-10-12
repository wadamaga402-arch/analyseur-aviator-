// End-to-end test: real local Cloudflare runtime (wrangler dev / workerd) + a fake Telegram API that records every call.
// Usage: node test/e2e.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import { createHash } from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = new URL("..", import.meta.url).pathname;
const TG_PORT = 18977, W_PORT = 18788;
const BOT_TOKEN = "123456:TEST-token", ADMIN_KEY = "cle-de-test-123456";
const BASE = `http://127.0.0.1:${W_PORT}`;
let failSend = false;

/* ---- fake Telegram ---- */
const calls = [];
const tgServer = http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/);
    const payload = body ? JSON.parse(body) : {};
    calls.push({ token: m && m[1], method: m && m[2], payload });
    let out = { ok: true, result: true };
    if (!m || m[1] !== BOT_TOKEN) out = { ok: false, error_code: 401, description: "Unauthorized" };
    else if (m[2] === "getMe") out = { ok: true, result: { id: 1, is_bot: true, username: "test_aviator_bot" } };
    else if (m[2] === "getWebhookInfo") out = { ok: true, result: { url: BASE + "/telegram/webhook", pending_update_count: 0 } };
    else if (m[2] === "sendMessage" && failSend) out = { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
    else if (m[2] === "sendMessage") out = { ok: true, result: { message_id: calls.length } };
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(out));
  });
});
await new Promise(r => tgServer.listen(TG_PORT, "127.0.0.1", r));

/* ---- local Cloudflare runtime ---- */
rmSync(ROOT + ".wrangler/state", { recursive: true, force: true });
writeFileSync(ROOT + ".dev.vars", `BOT_TOKEN=${BOT_TOKEN}\nADMIN_KEY=${ADMIN_KEY}\nTG_API=http://127.0.0.1:${TG_PORT}\n`);
const wr = spawn("npx", ["wrangler", "dev", "--port", String(W_PORT), "--ip", "127.0.0.1"], { cwd: ROOT, env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
let log = ""; wr.stdout.on("data", d => log += d); wr.stderr.on("data", d => log += d);
for (let i = 0; i < 90; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch {} await new Promise(r => setTimeout(r, 1000)); }

const results = []; let failed = 0;
async function step(name, fn) {
  try { await fn(); results.push("ok   - " + name); }
  catch (e) { failed++; results.push("FAIL - " + name + " :: " + (e && e.message)); }
}
const api = async (method, path, body, key = ADMIN_KEY) => {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
};
const secret = createHash("sha256").update(`tg-webhook:${BOT_TOKEN}:${ADMIN_KEY}`).digest("hex").slice(0, 48);
const CHAT = 4242;
const tgUpdate = (text, chat = CHAT, sec = secret) => fetch(BASE + "/telegram/webhook", {
  method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": sec },
  body: JSON.stringify({ update_id: Date.now(), message: { message_id: 1, chat: { id: chat }, from: { first_name: "Testeur", username: "testeur" }, text } }),
});
const lastSent = () => [...calls].reverse().find(c => c.method === "sendMessage");
const settle = () => new Promise(r => setTimeout(r, 300));

await step("le site est servi", async () => { const t = await (await fetch(BASE + "/")).text(); assert.match(t, /Analyseur/); assert.match(t, /<!doctype html>/i); });
await step("santé : aucune source en direct déclarée", async () => { const h = await (await fetch(BASE + "/api/health")).json(); assert.equal(h.liveSource, null); assert.equal(h.botTokenSet, true); });
await step("API refuse une mauvaise clé (401)", async () => { const r = await api("GET", "/api/state", null, "mauvaise-cle-xxxx"); assert.equal(r.status, 401); assert.match(r.data.error, /Clé/); });
let pid;
await step("créer un profil", async () => { const r = await api("POST", "/api/profiles", { name: "Bwin soir" }); assert.equal(r.status, 200); pid = r.data.id; });
await step("rejeter des valeurs invalides (400)", async () => { const r = await api("POST", "/api/rounds", { profile: pid, values: ["abc", 0.5] }); assert.equal(r.status, 400); });
await step("ajouter des manches depuis le site", async () => { const r = await api("POST", "/api/rounds", { profile: pid, values: [1.52, 3.4, 1.02], src: "i" }); assert.equal(r.data.added, 3); });
await step("Telegram : test refusé tant que non relié", async () => { const r = await api("POST", "/api/telegram/test"); assert.equal(r.status, 409); assert.match(r.data.error, /pas encore relié/); });
let link;
await step("Connecter Telegram : getMe + setWebhook + lien", async () => {
  const r = await api("POST", "/api/telegram/connect"); assert.equal(r.status, 200, JSON.stringify(r.data));
  link = r.data.link; assert.match(link, /^https:\/\/t\.me\/test_aviator_bot\?start=[a-z0-9]{9}$/);
  const hook = calls.find(c => c.method === "setWebhook"); assert.equal(hook.payload.url, BASE + "/telegram/webhook"); assert.equal(hook.payload.secret_token, secret);
});
await step("webhook sans secret refusé (403)", async () => { const r = await tgUpdate("/stats", CHAT, "faux"); assert.equal(r.status, 403); });
await step("inconnu avec mauvais code : bot privé", async () => { await tgUpdate("/start mauvaiscode", 999); await settle(); const s = lastSent(); assert.equal(s.payload.chat_id, 999); assert.match(s.payload.text, /privé/); });
await step("/start avec le bon code relie le chat", async () => {
  await tgUpdate("/start " + link.split("start=")[1]); await settle();
  assert.match(lastSent().payload.text, /relié/);
  const st = (await api("GET", "/api/state")).data.telegram; assert.equal(st.linked, true); assert.equal(st.chatName, "Testeur @testeur");
});
await step("statut : pas « Connecté » avant un test réussi", async () => { const st = (await api("GET", "/api/state")).data.telegram; assert.equal(st.lastTest, null); });
await step("Tester la connexion : message réellement envoyé", async () => {
  const r = await api("POST", "/api/telegram/test"); assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(lastSent().payload.text, /Test de connexion réussi/);
  const st = (await api("GET", "/api/state")).data.telegram; assert.equal(st.lastTest.ok, true);
});
await step("échec d'envoi détecté et expliqué", async () => {
  failSend = true; const r = await api("POST", "/api/telegram/test"); failSend = false;
  assert.equal(r.status, 409); assert.match(r.data.error, /bloqué/);
  assert.equal((await api("GET", "/api/state")).data.telegram.lastTest.ok, false);
});
await step("/stats", async () => { await tgUpdate("/stats"); await settle(); const t = lastSent().payload.text; assert.match(t, /Statistiques · Bwin soir/); assert.match(t, /3 manches/); assert.match(t, /pas une prédiction/); });
await step("/ajouter ajoute des manches source Telegram", async () => {
  await tgUpdate("/ajouter 2,10 abc 7.85x"); await settle();
  assert.match(lastSent().payload.text, /2 manche\(s\) ajoutée\(s\).*1 ignorée/s);
  const p = (await api("GET", "/api/state")).data.profiles[pid]; assert.deepEqual(p.rounds, [1.52, 3.4, 1.02, 2.1, 7.85]); assert.equal(p.src, "iiitt");
});
await step("/ajouter sans valeur : message d'aide", async () => { await tgUpdate("/ajouter"); await settle(); assert.match(lastSent().payload.text, /Aucune valeur lisible/); });
await step("/historique", async () => { await tgUpdate("/historique 3"); await settle(); const t = lastSent().payload.text; assert.match(t, /3 dernières manches/); assert.match(t, /7,85×ᵗ  2,10×ᵗ  1,02×ᶜ/); });
await step("/signal : état, théorie, observé, limites", async () => { await tgUpdate("/signal"); await settle(); const t = lastSent().payload.text; assert.match(t, /DONNÉES INSUFFISANTES/); assert.match(t, /48,5 %/); assert.match(t, /Aucun outil ne connaît la prochaine/); });
await step("/aide et commande inconnue", async () => { await tgUpdate("/aide"); await settle(); assert.match(lastSent().payload.text, /\/historique/); await tgUpdate("/predire"); await settle(); assert.match(lastSent().payload.text, /Commande inconnue/); });
await step("notification à chaque nouvelle manche ajoutée sur le site", async () => {
  const before = calls.length;
  await api("POST", "/api/rounds", { profile: pid, values: [1.3, 4.44], src: "m" }); await new Promise(r => setTimeout(r, 600));
  const n = calls.slice(before).find(c => c.method === "sendMessage"); assert.ok(n, "aucune notification"); assert.match(n.payload.text, /2 nouvelle\(s\) manche\(s\).*saisie manuelle/s);
});
await step("doublons retirés côté serveur", async () => { const r = await api("POST", "/api/rounds", { profile: pid, values: [2.1, 7.85, 1.3, 4.44, 9.9], src: "c" }); assert.equal(r.data.added, 1); assert.equal(r.data.dropped, 4); });
await step("annuler la dernière manche", async () => { await api("POST", "/api/rounds/undo", { profile: pid }); const p = (await api("GET", "/api/state")).data.profiles[pid]; assert.equal(p.rounds.at(-1), 4.44); });
await step("aucune commande de pari n'existe", async () => { assert.ok(!calls.some(c => /bet|pari/i.test(c.method))); });
await step("déconnecter", async () => { await api("POST", "/api/telegram/disconnect"); const st = (await api("GET", "/api/state")).data.telegram; assert.equal(st.linked, false); assert.ok(calls.some(c => c.method === "deleteWebhook")); });

console.log(results.join("\n"));
console.log(failed ? `\n${failed} test(s) en échec` : `\n${results.length} tests réussis`);
if (process.argv.includes("--keep")) { console.log("serveur toujours lancé sur " + BASE); }
else { wr.kill("SIGTERM"); tgServer.close(); rmSync(ROOT + ".dev.vars", { force: true }); }
if (failed) { console.log(log.slice(-3000)); }
if (!process.argv.includes("--keep")) process.exit(failed ? 1 : 0);
