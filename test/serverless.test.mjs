// Telegram Serverless version: runs the generated handler against the SDK emulator.
// Usage: node --import ./test/mocks/register.mjs --test test/serverless.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calls, tables, setFailSend } from "./mocks/sdk.mjs";
import handler from "../telegram-serverless/tgcloud/handlers/message.js";

const ME = 7001, OTHER = 8002;
let mid = 1;
async function say(text, from = ME, type = "private") {
  const before = calls.length;
  await handler({ message_id: mid++, chat: { id: from, type }, from: { id: from, first_name: "Moi" }, text }, { update: {} });
  const sent = calls.slice(before).filter(c => c.method === "sendMessage");
  return sent.length ? sent[sent.length - 1].params : null;
}
function rng(seed){ let x=seed>>>0; return ()=>{ x^=x<<13; x>>>=0; x^=x>>17; x^=x<<5; x>>>=0; return x/4294967296; }; }
const r = rng(31), fair = Array.from({ length: 297 }, () => Math.max(1, Math.floor((0.97 / (1 - r())) * 100) / 100));

test("fichiers : seuls 'sdk', 'sdk/db' et ../schema.js sont importés", () => {
  const src = readFileSync(new URL("../telegram-serverless/tgcloud/lib/starbot.js", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ["../schema.js", "sdk", "sdk/db"]);
  assert.doesNotMatch(src, /BOT_TOKEN\s*=|api\.telegram\.org/);   // no token, no raw Bot API URL
});
test("avant /start : personne n'est autorisé, rien n'est enregistré", async () => {
  const m = await say("/ajouter 2 3"); assert.match(m.text, /Envoyez \/start/);
  assert.equal(tables.get("kv").size, 0);
});
test("groupes ignorés", async () => { assert.equal(await say("/start", ME, "group"), null); });
test("/start : verrouillé sur le premier compte + menu des commandes", async () => {
  const m = await say("/start"); assert.match(m.text, /verrouillé sur votre compte/); assert.match(m.text, new RegExp(String(ME)));
  const cmds = calls.filter(c => c.method === "setMyCommands").at(-1).params.commands.map(c => c.command);
  assert.deepEqual(cmds, ["ajouter", "historique", "stats", "signal", "effacer", "test", "aide"]);
});
test("un autre compte est refusé, même avec /start", async () => {
  for (const t of ["/start", "/stats", "/ajouter 5 5 5", "/effacer oui"]) { const m = await say(t, OTHER); assert.equal(m.chat_id, OTHER); assert.match(m.text, /privé/); }
});
test("/stats et /signal sans données : DONNÉES INSUFFISANTES", async () => {
  assert.match((await say("/stats")).text, /DONNÉES INSUFFISANTES/);
  assert.match((await say("/signal")).text, /DONNÉES INSUFFISANTES/);
});
test("/ajouter : enregistre, confirme, statistiques, données insuffisantes", async () => {
  const m = await say("/ajouter 1,52 3.10 1,20 abc");
  assert.match(m.text, /3 manche\(s\) enregistrée\(s\) dans « Telegram »/); assert.match(m.text, /1 ignorée/); assert.match(m.text, /Aucune prédiction/);
});
test("/ajouter invalide et trop long", async () => {
  assert.match((await say("/ajouter abc")).text, /Aucune valeur lisible/);
  assert.match((await say("/ajouter " + Array(301).fill("2").join(" "))).text, /au plus 300/);
});
test("/historique : plus récente en premier", async () => { assert.match((await say("/historique")).text, /1,20×ᵗ  3,10×ᵗ  1,52×ᵗ/); });
test("300 manches : /stats calcule la vraie moyenne, /signal sans avantage", async () => {
  await say("/ajouter " + fair.map(v => v.toFixed(2).replace(".", ",")).join(" "));
  const all = [1.52, 3.1, 1.2, ...fair], mean = all.reduce((a, b) => a + b, 0) / all.length;
  const s = await say("/stats"); assert.match(s.text, /300 manche\(s\) analysée\(s\)/); assert.ok(s.text.includes("moyenne " + mean.toFixed(2).replace(".", ",") + "×"));
  const g = await say("/signal"); assert.match(g.text, /STAR BOT SIGNAL : AUCUN AVANTAGE STATISTIQUE DÉTECTÉ/); assert.match(g.text, /test sur 90 manches/); assert.doesNotMatch(g.text, /BUY|confiance/i);
});
test("messages sous la limite Telegram de 4096 caractères", async () => {
  for (const t of ["/aide", "/stats", "/signal", "/historique 50", "/test"]) { const m = await say(t); assert.ok(m.text.length < 4096, t + " : " + m.text.length); }
});
test("/test : 8/8 avec la base Serverless", async () => {
  const m = await say("/test"); assert.match(m.text, /8\/8 vérifications réussies/);
  assert.ok(!tables.get("kv").has("selftest"), "la clé de test doit être supprimée");
});
test("données conservées dans la base, pas en mémoire (nouvelle instance du module)", async () => {
  const fresh = await import("../telegram-serverless/tgcloud/lib/starbot.js?instance=2");
  const before = calls.length;
  await fresh.onMessage({ message_id: 999, chat: { id: ME, type: "private" }, from: { id: ME }, text: "/stats" });
  const m = calls.slice(before).find(c => c.method === "sendMessage").params;
  assert.match(m.text, /300 manche\(s\) analysée\(s\)/);
  const again = await import("../telegram-serverless/tgcloud/lib/starbot.js?instance=3");
  const b2 = calls.length; await again.onMessage({ message_id: 1000, chat: { id: OTHER, type: "private" }, from: { id: OTHER }, text: "/start" });
  assert.match(calls.slice(b2).find(c => c.method === "sendMessage").params.text, /privé/, "le verrouillage doit survivre");
});
test("/effacer : confirmation, puis effacement du seul profil", async () => {
  assert.match((await say("/effacer oui")).text, /Aucune demande/);
  assert.match((await say("/effacer")).text, /\/effacer oui/);
  assert.match((await say("/historique 1")).text, /300 au total/);
  assert.match((await say("/effacer oui")).text, /effacé \(300 manche/);
  assert.match((await say("/stats")).text, /DONNÉES INSUFFISANTES/);
  assert.match((await say("/effacer")).text, /déjà vide/);
});
test("erreur d'envoi Telegram : pas de plantage", async () => {
  setFailSend(true); await assert.doesNotReject(say("/aide")); setFailSend(false);
});
test("commande inconnue : aide ; aucune fonction de mise", async () => {
  assert.match((await say("/predire")).text, /Commande inconnue/);
  assert.ok(!calls.some(c => /bet|pari|mise/i.test(c.method)));
});
