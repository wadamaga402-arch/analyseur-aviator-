// Builds the Telegram Serverless version (BotFather → Serverless) from the shared code:
//   telegram-serverless/tgcloud/schema.js           one key/value table
//   telegram-serverless/tgcloud/lib/starbot.js      engine + bot logic + storage, in ONE file (easy to paste on a phone)
//   telegram-serverless/tgcloud/handlers/message.js calls onMessage()
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const R = p => new URL("../" + p, import.meta.url);
const engine = readFileSync(R("src/engine.js"), "utf8");
const core = readFileSync(R("src/bot-core.js"), "utf8");

const engNames = engine.match(/export \{([^}]+)\};/)[1].split(",").map(s => s.trim()).filter(Boolean);
const engBody = engine.replace(/export \{[^}]+\};\s*$/, "").replace(/^\/\/ Generated.*\n/, "");
const coreNames = [...core.matchAll(/^export (?:async function|function|const) (\w+)/gm)].map(m => m[1]);
const coreBody = core.replace(/^import \* as E from "\.\/engine\.js";\n/m, "").replace(/^export (async function|function|const) /gm, "$1 ");
if (/^\s*import /m.test(coreBody) || /^\s*import /m.test(engBody)) throw new Error("unexpected import left in bundle");

const starbot = `// Aviator Star Bot — Telegram Serverless (BotFather → Serverless)
// Fichier généré automatiquement depuis src/engine.js et src/bot-core.js : ne pas modifier à la main.
// Statistiques sur les manches que vous envoyez. Aucune connexion à Bwin, aucune prédiction, aucune mise.
import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { kv } from '../schema.js';

// Réglage facultatif : votre identifiant Telegram. Laissez vide : le premier /start verrouille le bot sur votre compte.
const ALLOWED_USER_ID = "";

const E = (() => {
${engBody}
return { ${engNames.join(", ")} };
})();

const C = (() => {
${coreBody}
return { ${coreNames.join(", ")} };
})();

// Stockage permanent : une table clé → valeur dans la base SQLite du bot
const S = {
  async read(key) {
    const row = await db.select().from(kv).where(eq(kv.key, key)).get();
    return row ? (row.value ?? null) : null;
  },
  async write(key, value) {
    const now = Date.now();
    await db.insert(kv).values({ key, value, updated: now })
      .onConflictDoUpdate({ target: kv.key, set: { value, updated: now } }).run();
    return true;
  },
  async remove(key) {
    await db.delete(kv).where(eq(kv.key, key)).run();
    return true;
  },
};

async function send(chatId, text) {
  try { await api.sendMessage({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }); return { ok: true }; }
  catch (e) { console.log('sendMessage refusé :', e && (e.description || e.message)); return { ok: false, description: e && e.description }; }
}

export async function onMessage(message) {
  if (message && typeof message.text === 'string' && /^\\/start\\b/i.test(message.text)) {
    try { await api.setMyCommands({ commands: C.COMMANDS }); } catch (e) { console.log('setMyCommands :', e && e.description); }
  }
  try {
    await C.handleMessage({ S, send, allowed: ALLOWED_USER_ID, ownerClaim: true }, message);
  } catch (e) {
    console.log('Erreur :', e && (e.stack || e.message || e));
    if (message && message.chat) await send(message.chat.id, "❌ Erreur interne. Envoyez /test pour vérifier le moteur. Détail : " + C.esc(String(e && e.message || e)).slice(0, 200));
  }
}
`;
const schema = `// Base de données d'Aviator Star Bot : une seule table clé → valeur (profils, manches, analyses, réglages).
import { table, text, json, integer } from 'sdk/db';

export const kv = table('kv', {
  key: text('key').primaryKey(),
  value: json('value'),
  updated: integer('updated'),
});
`;
const handler = `// Chaque message reçu par le bot passe ici.
import { onMessage } from '../lib/starbot.js';

export default async function (message, ctx) {
  await onMessage(message);
}
`;
mkdirSync(R("telegram-serverless/tgcloud/lib"), { recursive: true });
mkdirSync(R("telegram-serverless/tgcloud/handlers"), { recursive: true });
writeFileSync(R("telegram-serverless/tgcloud/lib/starbot.js"), starbot);
writeFileSync(R("telegram-serverless/tgcloud/schema.js"), schema);
writeFileSync(R("telegram-serverless/tgcloud/handlers/message.js"), handler);
console.log("telegram-serverless built:", (starbot.length / 1024).toFixed(1) + " KiB starbot.js");
