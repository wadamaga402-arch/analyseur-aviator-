// Telegram fallback test: the bot alone (no web page involved), restricted to ALLOWED_USER_ID,
// every command, errors, permissions, statistics, and data kept across a server restart.
// Real local Cloudflare runtime (wrangler dev / workerd) + a fake Telegram API that records every call.
// Usage: node test/telegram.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import { createHash } from "node:crypto";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const ROOT = new URL("..", import.meta.url).pathname;
const TG_PORT = 18978, W_PORT = 18789, BASE = `http://127.0.0.1:${W_PORT}`;
const BOT_TOKEN = "987654:TG-test", ADMIN_KEY = "cle-telegram-12345", ME = 5550001, STRANGER = 6660002;
const PERSIST = mkdtempSync(join(tmpdir(), "starbot-"));

const calls = [];
const tgServer = http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/); const payload = body ? JSON.parse(body) : {};
    calls.push({ method: m && m[2], payload });
    let out = { ok: true, result: true };
    if (!m || m[1] !== BOT_TOKEN) out = { ok: false, error_code: 401, description: "Unauthorized" };
    else if (m[2] === "getMe") out = { ok: true, result: { id: 1, is_bot: true, username: "star_test_bot" } };
    else if (m[2] === "getWebhookInfo") out = { ok: true, result: { url: BASE + "/telegram/webhook" } };
    else if (m[2] === "sendMessage") out = { ok: true, result: { message_id: calls.length } };
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(out));
  });
});
await new Promise(r => tgServer.listen(TG_PORT, "127.0.0.1", r));
try { await fetch(BASE + "/api/health"); console.error("Port " + W_PORT + " déjà utilisé : lancez sh scripts/stop-test-servers.sh"); process.exit(2); } catch {}

writeFileSync(ROOT + ".dev.vars", `BOT_TOKEN=${BOT_TOKEN}\nADMIN_KEY=${ADMIN_KEY}\nALLOWED_USER_ID=${ME}\nTG_API=http://127.0.0.1:${TG_PORT}\n`);
let wr, log = "";
async function startServer() {
  wr = spawn("npx", ["wrangler", "dev", "--port", String(W_PORT), "--ip", "127.0.0.1", "--persist-to", PERSIST], { cwd: ROOT, env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
  wr.stdout.on("data", d => log += d); wr.stderr.on("data", d => log += d);
  for (let i = 0; i < 90; i++) { try { if ((await fetch(BASE + "/api/health")).ok) return; } catch {} await new Promise(r => setTimeout(r, 1000)); }
  throw new Error("le serveur local n'a pas démarré");
}
async function stopServer() { wr.kill("SIGTERM"); for (let i = 0; i < 30; i++) { try { await fetch(BASE + "/api/health"); } catch { return; } await new Promise(r => setTimeout(r, 500)); } }
await startServer();

const secret = createHash("sha256").update(`tg-webhook:${BOT_TOKEN}:${ADMIN_KEY}`).digest("hex").slice(0, 48);
let uid = 1;
const say = async (text, from = ME, chatType = "private") => {
  const before = calls.length;
  const r = await fetch(BASE + "/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify({ update_id: uid++, message: { message_id: uid, chat: { id: from, type: chatType }, from: { id: from, first_name: "Moi" }, text } }) });
  await new Promise(r => setTimeout(r, 150));
  const sent = calls.slice(before).filter(c => c.method === "sendMessage");
  return { status: r.status, reply: sent.length ? sent[sent.length - 1].payload : null };
};
const results = []; let failed = 0;
async function step(name, fn) { try { await fn(); results.push("ok   - " + name); } catch (e) { failed++; results.push("FAIL - " + name + " :: " + (e && e.message)); } }

await step("santé : jeton, clé et identifiant autorisé détectés", async () => { const h = await (await fetch(BASE + "/api/health")).json(); assert.equal(h.botTokenSet && h.adminKeySet && h.allowedUserSet, true); });
await step("page d'installation de secours servie", async () => { const t = await (await fetch(BASE + "/setup")).text(); assert.match(t, /Installer le bot/); });
await step("installation : webhook posé avec secret", async () => {
  const r = await fetch(BASE + "/api/telegram/connect", { method: "POST", headers: { authorization: "Bearer " + ADMIN_KEY } });
  assert.equal(r.status, 200); const hook = calls.find(c => c.method === "setWebhook"); assert.equal(hook.payload.secret_token, secret);
  const cmds = calls.find(c => c.method === "setMyCommands").payload.commands.map(c => c.command); for (const k of ["stats", "historique", "ajouter", "signal", "regle", "effacer", "test", "aide"]) assert.ok(cmds.includes(k), k);
});
await step("webhook sans secret refusé (403)", async () => { const r = await fetch(BASE + "/telegram/webhook", { method: "POST", body: "{}" }); assert.equal(r.status, 403); });
await step("permissions : un inconnu est refusé et voit son identifiant", async () => { const { reply } = await say("/stats", STRANGER); assert.equal(reply.chat_id, STRANGER); assert.match(reply.text, /privé/); assert.match(reply.text, new RegExp(String(STRANGER))); });
await step("permissions : l'inconnu ne peut rien ajouter", async () => { await say("/ajouter 2 3 4", STRANGER); const st = await (await fetch(BASE + "/api/state", { headers: { authorization: "Bearer " + ADMIN_KEY } })).json(); assert.equal(Object.keys(st.profiles).length, 0); });
await step("groupes ignorés", async () => { const { reply } = await say("/stats", ME, "group"); assert.equal(reply, null); });
await step("/start : relié sans passer par le site + menu", async () => { const { reply } = await say("/start"); assert.match(reply.text, /Bot relié/); assert.match(reply.text, /\/effacer/); assert.match(reply.text, /\/test/); });
await step("/stats sans données : DONNÉES INSUFFISANTES", async () => { const { reply } = await say("/stats"); assert.match(reply.text, /DONNÉES INSUFFISANTES/); });
await step("/signal sans données : DONNÉES INSUFFISANTES", async () => { const { reply } = await say("/signal"); assert.match(reply.text, /DONNÉES INSUFFISANTES/); });
await step("/ajouter invalide : message d'aide, rien d'enregistré", async () => { const { reply } = await say("/ajouter abc 0,5"); assert.match(reply.text, /Aucune valeur lisible/); });
await step("/ajouter : profil « Telegram » créé, confirmation + stats + données insuffisantes", async () => {
  const { reply } = await say("/ajouter 1,52 3.10 1,20 abc");
  assert.match(reply.text, /3 manche\(s\) enregistrée\(s\) dans « Telegram »/); assert.match(reply.text, /1 ignorée/);
  assert.match(reply.text, /Total : 3/); assert.match(reply.text, /DONNÉES INSUFFISANTES/); assert.match(reply.text, /Aucune prédiction/);
});
await step("/historique : plus récente en premier", async () => { const { reply } = await say("/historique"); assert.match(reply.text, /1,20×ᵗ  3,10×ᵗ  1,52×ᵗ/); });
await step("/ajouter : trop de valeurs refusées", async () => { const { reply } = await say("/ajouter " + Array(301).fill("2").join(" ")); assert.match(reply.text, /au plus 300/); });
// 297 more rounds drawn like the real game, then a full analysis
function rng(seed){ let x=seed>>>0; return ()=>{ x^=x<<13; x>>>=0; x^=x>>17; x^=x<<5; x>>>=0; return x/4294967296; }; }
const r = rng(99), more = Array.from({ length: 297 }, () => Math.max(1, Math.floor((0.97 / (1 - r())) * 100) / 100));
await step("/ajouter 297 manches : statistiques recalculées", async () => { const { reply } = await say("/ajouter " + more.map(v => v.toFixed(2).replace(".", ",")).join(" ")); assert.match(reply.text, /Total : 300/); assert.match(reply.text, /Statistiques mises à jour/); });
await step("/stats : vrais calculs (nombre, moyenne exacte, qualité)", async () => {
  const all = [1.52, 3.1, 1.2, ...more], mean = all.reduce((a, b) => a + b, 0) / all.length;
  const { reply } = await say("/stats"); assert.match(reply.text, /300 manche\(s\) analysée\(s\)/);
  assert.ok(reply.text.includes("moyenne " + mean.toFixed(2).replace(".", ",") + "×"), reply.text.slice(0, 200)); assert.match(reply.text, /qualité des données : (bonne|à vérifier)/);
});
await step("/signal : aucun avantage, validation et limites affichées", async () => {
  const { reply } = await say("/signal"); assert.match(reply.text, /STAR BOT SIGNAL : AUCUN AVANTAGE STATISTIQUE DÉTECTÉ/);
  assert.match(reply.text, /Validation hors échantillon : test sur 90 manches/); assert.match(reply.text, /Observations historiques/); assert.match(reply.text, /Aucun outil ne connaît la prochaine/);
  assert.doesNotMatch(reply.text, /BUY|confiance/i);
});
await step("/regle : test d'une règle de signal en euros", async () => {
  const { reply } = await say("/regle 1.5 1 10"); assert.match(reply.text, /Cycles joués : \d+/); assert.match(reply.text, /hasard pur : 87,5 %/); assert.match(reply.text, /Résultat :/);
  const bad = await say("/regle 200"); assert.match(bad.reply.text, /Format : \/regle/);
});
await step("/test : moteur et stockage vérifiés", async () => { const { reply } = await say("/test"); assert.match(reply.text, /8\/8 vérifications réussies/); assert.match(reply.text, /stockage permanent/); });
await step("/test n'ajoute rien aux données", async () => { const st = await (await fetch(BASE + "/api/state", { headers: { authorization: "Bearer " + ADMIN_KEY } })).json(); assert.equal(Object.values(st.profiles)[0].rounds.length, 300); });
await step("analyses enregistrées (Signal History partagé avec le site)", async () => { const st = await (await fetch(BASE + "/api/state", { headers: { authorization: "Bearer " + ADMIN_KEY } })).json(); assert.equal(Object.values(st.profiles)[0].log.length, 2); });
await step("/effacer oui sans demande : refusé", async () => { const { reply } = await say("/effacer oui"); assert.match(reply.text, /Aucune demande/); });

/* restart: data must survive */
await stopServer(); await startServer();
await step("redémarrage du serveur : données conservées", async () => { const { reply } = await say("/stats"); assert.match(reply.text, /300 manche\(s\) analysée\(s\)/); });
await step("redémarrage : toujours relié et restreint", async () => { const { reply } = await say("/stats", STRANGER); assert.match(reply.text, /privé/); });

await step("/effacer : demande de confirmation, rien d'effacé", async () => { const { reply } = await say("/effacer"); assert.match(reply.text, /\/effacer oui/); const h = await say("/historique 1"); assert.match(h.reply.text, /300 au total/); });
await step("/effacer oui : historique vidé, profil conservé", async () => { const { reply } = await say("/effacer oui"); assert.match(reply.text, /effacé \(300 manche/); const s = await say("/stats"); assert.match(s.reply.text, /DONNÉES INSUFFISANTES/); });
await step("/effacer sur historique vide", async () => { const { reply } = await say("/effacer"); assert.match(reply.text, /déjà vide/); });
await step("commande inconnue : aide", async () => { const { reply } = await say("/predire"); assert.match(reply.text, /Commande inconnue/); });
await step("aucune fonction de mise", async () => { assert.ok(!calls.some(c => /bet|pari|mise/i.test(c.method || ""))); });

console.log(results.join("\n"));
console.log(failed ? `\n${failed} test(s) en échec` : `\n${results.length} tests réussis`);
await stopServer(); tgServer.close(); rmSync(ROOT + ".dev.vars", { force: true }); rmSync(PERSIST, { recursive: true, force: true });
if (failed) console.log(log.slice(-2500));
process.exit(failed ? 1 : 0);
