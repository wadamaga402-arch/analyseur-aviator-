// Builds public/index.html (full page served by Cloudflare) from site/analyseur.html (the same page Claude publishes)
// and refreshes src/engine.js so the bot uses exactly the site's statistics.
import { readFileSync, writeFileSync } from "node:fs";
const frag = readFileSync(new URL("../site/analyseur.html", import.meta.url), "utf8");
const head = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<meta name="robots" content="noindex"><style>:root{color-scheme:dark;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
writeFileSync(new URL("../public/index.html", import.meta.url), head + frag + "</body></html>\n");
console.log("public/index.html built");
