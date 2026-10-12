// Browser test of the dashboard (standalone page, no server): every panel, empty data, small iPhone screens,
// chart = imported data, and no fictitious value shown as real.  Usage: PW_PATH=<playwright> node test/dashboard.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || "playwright");
const ROOT = new URL("..", import.meta.url).pathname;
writeFileSync("/tmp/dash.html", readFileSync(ROOT + "public/index.html", "utf8"));

function rng(seed){ let x=seed>>>0; return ()=>{ x^=x<<13; x>>>=0; x^=x>>17; x^=x<<5; x>>>=0; return x/4294967296; }; }
const fair = (n, seed) => { const r = rng(seed); return Array.from({ length: n }, () => Math.max(1, Math.floor((0.97 / (1 - r())) * 100) / 100)); };
const fmt = v => v.toFixed(2).replace(".", ",");

const results = []; let failed = 0;
const check = (name, cond, info="") => { if (cond) results.push("ok   - " + name); else { failed++; results.push("FAIL - " + name + (info ? " :: " + info : "")); } };

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const T = async s => ((await p.textContent(s)) || "").trim().replace(/\s+/g, " ");
const go = async v => { await p.click(`#nav button[data-go="${v}"]`); await p.waitForTimeout(150); };
const visibleViews = () => p.$$eval(".view", els => els.filter(e => !e.hidden).map(e => e.dataset.view));

await p.goto("file:///tmp/dash.html"); await p.waitForTimeout(600);

/* 1. empty state: only the Demo profile exists */
check("vide : signal DONNÉES INSUFFISANTES", (await T("#sigTitle")) === "DONNÉES INSUFFISANTES", await T("#sigTitle"));
check("vide : signal explique que la démo est exclue", /fictives/.test(await T("#sigWhy")));
for (const id of ["cAvg", "cTot", "cInt", "cMkt"]) check("vide : carte " + id + " = Données insuffisantes", (await T("#" + id)) === "Données insuffisantes", await T("#" + id));
check("vide : 10 dernières = état vide", /aucune manche réelle/i.test(await T("#last10")), await T("#last10"));
check("vide : graphique sans barre", (await p.getAttribute("#trendChart", "data-n")) === "0");
check("vide : cashout sans conseil", /Aucun multiplicateur conseillé/.test(await T("#cashBody")));
check("high rollers : Données indisponibles", /Données indisponibles/.test(await T('[aria-label="Top High Rollers"]')));
check("aucun pourcentage de confiance inventé", !/confiance\s*:?\s*\d|85 ?%/i.test(await T("#main")));

/* 2. navigation */
for (const v of ["history", "analytics", "strategy", "settings", "dashboard"]) { await go(v); const vis = await visibleViews(); check("menu : " + v + " seule vue affichée", vis.length === 1 && vis[0] === v, vis.join(",")); }

/* 3. real profile with 25 rounds */
await go("settings"); await p.fill("#newProf", "Bwin test"); await p.click("#addProf"); await p.waitForTimeout(150);
const a25 = fair(25, 1);
await go("history"); await p.fill("#bulk", a25.map(fmt).join(" ")); await p.click("#addBulk"); await p.waitForTimeout(200);
await go("dashboard");
check("25 manches : toujours DONNÉES INSUFFISANTES", (await T("#sigTitle")) === "DONNÉES INSUFFISANTES");
check("25 manches : carte total = 25", (await T("#cTot")) === "25");
const avg = a25.reduce((x, y) => x + y, 0) / 25;
check("25 manches : moyenne exacte", (await T("#cAvg")) === fmt(avg) + "×", (await T("#cAvg")) + " vs " + fmt(avg));
check("25 manches : marché = insuffisant (<30)", (await T("#cMkt")) === "Données insuffisantes");
check("graphique = données importées (nombre)", (await p.getAttribute("#trendChart", "data-n")) === "25");
check("graphique = données importées (dernière valeur)", Number(await p.getAttribute("#trendChart", "data-last")) === a25[24]);
const rows = await p.$$eval("#last10 li .rv", els => els.map(e => e.textContent));
check("10 dernières : 10 lignes, plus récente en premier", rows.length === 10 && rows[0] === fmt(a25[24]) + "×" && rows[9] === fmt(a25[15]) + "×", rows.join(" "));
check("10 dernières : source affichée", /saisie manuelle/.test(await T("#last10")));

/* 4. 120 rounds: historical analysis available, no validation yet */
await go("history"); await p.fill("#bulk", fair(95, 2).map(fmt).join(" ")); await p.click("#addBulk"); await p.waitForTimeout(200); await go("dashboard");
check("120 manches : ANALYSE HISTORIQUE DISPONIBLE", (await T("#sigTitle")) === "ANALYSE HISTORIQUE DISPONIBLE", await T("#sigTitle"));
check("120 manches : marché testé (khi²)", /khi²/.test(await T("#cMktS")), await T("#cMktS"));
await go("strategy");
check("120 manches : validation refusée (200 requises)", /Encore 80/.test(await T("#valBody")), await T("#valBody"));

/* 5. 1000 rounds: validation runs, no edge on fair data */
await go("history"); await p.fill("#bulk", fair(880, 3).map(fmt).join(" ")); await p.click("#addBulk"); await p.waitForTimeout(300);
await go("dashboard"); await p.click("#recalcBtn"); await p.waitForTimeout(500);
check("1000 manches : recalcul affiché", /Recalculé à .* 1000 manche/.test(await T("#recalcInfo")), await T("#recalcInfo"));
check("1000 manches : AUCUN AVANTAGE STATISTIQUE DÉTECTÉ", (await T("#sigTitle")) === "AUCUN AVANTAGE STATISTIQUE DÉTECTÉ", await T("#sigTitle"));
await go("strategy"); const vb = await T("#valBody");
check("validation : verdict sans avantage", /Aucun avantage démontré/.test(vb));
check("validation : split 700/300 affiché", /700 manches/.test(vb), vb.slice(0, 200));
check("validation : faux signaux + référence + théorie", /Faux signaux/.test(vb) && /Référence/.test(vb) && /−3,0 %|-3,0 %/.test(vb), vb.slice(0, 400));
await go("dashboard");
check("graphique limité aux 100 dernières", (await p.getAttribute("#trendChart", "data-n")) === "100");
check("cashout : toujours aucun conseil", /Aucun multiplicateur conseillé/.test(await T("#cashBody")));

/* 6. suspicious data -> RISQUE ÉLEVÉ */
await go("settings"); await p.fill("#newProf", "Données triées"); await p.click("#addProf"); await p.waitForTimeout(150);
await go("history"); await p.fill("#bulk", fair(150, 9).map(v => fmt(Math.min(v, 1.45))).join(" ")); await p.click("#addBulk"); await p.waitForTimeout(200);
await go("dashboard");
check("données faussées : RISQUE ÉLEVÉ", (await T("#sigTitle")) === "RISQUE ÉLEVÉ", await T("#sigTitle"));
check("données faussées : marché = écart fort", (await T("#cMkt")) === "Écart fort");

/* 7. demo profile never feeds the dashboard */
await p.selectOption("#profSel", "demo"); await p.waitForTimeout(150);
check("démo : cartes non remplies", (await T("#cAvg")) === "Données insuffisantes");
check("démo : graphique vide", (await p.getAttribute("#trendChart", "data-n")) === "0");
await p.selectOption("#profSel", { index: 0 }); await p.waitForTimeout(150);

/* 8. no horizontal overflow on small iPhones, every view */
for (const w of [320, 375, 390, 430]) {
  await p.setViewportSize({ width: w, height: 760 });
  for (const v of ["dashboard", "history", "analytics", "strategy", "settings"]) {
    await go(v);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`largeur ${w}px · ${v} : pas de débordement`, over <= 0, "dépasse de " + over + "px");
  }
}
await p.setViewportSize({ width: 390, height: 844 }); await go("dashboard");
await p.screenshot({ path: "/tmp/dash-390.png", fullPage: true });
await p.setViewportSize({ width: 1280, height: 900 }); await go("dashboard");
await p.screenshot({ path: "/tmp/dash-1280.png", fullPage: false });
check("aucune erreur JavaScript", errs.length === 0, errs.join(" | "));
await b.close();
console.log(results.join("\n"));
console.log(failed ? `\n${failed} test(s) en échec` : `\n${results.length} tests réussis`);
process.exit(failed ? 1 : 0);
