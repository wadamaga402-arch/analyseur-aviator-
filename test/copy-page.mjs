// Checks the copy page: each textarea equals the tested file byte for byte; copy button works; no overflow on iPhone widths.
import { createRequire } from "node:module"; import { readFileSync, writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || "playwright");
const page = process.argv[2]; writeFileSync("/tmp/copy.html", "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" + readFileSync(page, "utf8"));
const F = p => readFileSync(new URL("../telegram-serverless/tgcloud/" + p, import.meta.url), "utf8");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 375, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto("file:///tmp/copy.html");
let fails = 0; const ok = (n, c, i = "") => { console.log((c ? "ok   - " : "FAIL - ") + n + (c ? "" : " :: " + i)); if (!c) fails++; };
for (const [id, path] of [["f1", "schema.js"], ["f2", "lib/starbot.js"], ["f3", "handlers/message.js"]]) {
  ok("textarea " + path + " identique au fichier", (await p.inputValue("#" + id)) === F(path));
  await p.click("#b-" + id); await p.waitForTimeout(150);
  ok("bouton copier " + path, (await p.evaluate(() => navigator.clipboard.readText())) === F(path) && /Copié/.test(await p.textContent("#b-" + id)));
}
for (const w of [320, 375, 430]) { await p.setViewportSize({ width: w, height: 800 }); ok("pas de débordement à " + w + "px", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: "/tmp/copy-390.png" });
ok("aucune erreur JavaScript", !errs.length, errs.join(" | "));
await b.close(); process.exit(fails ? 1 : 0);
