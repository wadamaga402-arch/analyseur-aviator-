// Copies the statistics engine from public/index.html into src/engine.js so the site and the bot compute the same numbers.
import { readFileSync, writeFileSync } from "node:fs";
const html = readFileSync(new URL("../site/analyseur.html", import.meta.url), "utf8");
const eng = html.split("/* ===== ENGINE START ===== */")[1].split("/* ===== ENGINE END ===== */")[0];
const out = "// Generated from site/analyseur.html (ENGINE block). Run: node scripts/sync-engine.mjs\n" + eng +
  "\nexport {RTP,CATS,catOf,theoGE,theoCat,toNum,validRound,parseList,parseCSV,median,wilson,stats,geRate,dependence,quality,SRC,normSrc,srcCounts,parseCaptureResult,dedupeOverlap,demoRound};\n";
if (process.argv.includes("--check")) {
  if (readFileSync(new URL("../src/engine.js", import.meta.url), "utf8") !== out) { console.error("src/engine.js is out of date: run node scripts/sync-engine.mjs"); process.exit(1); }
  console.log("engine in sync");
} else { writeFileSync(new URL("../src/engine.js", import.meta.url), out); console.log("src/engine.js updated"); }
