// Builds digit-pro/dist/index.html: one self-contained file (engine + app inlined) to upload on Netlify or any host.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const R = p => new URL("../digit-pro/" + p, import.meta.url);
const engine = readFileSync(R("engine.js"), "utf8"), app = readFileSync(R("app.js"), "utf8"), page = readFileSync(R("page.html"), "utf8");
const names = [...engine.matchAll(/^export (?:async function|function|const) (\w+)/gm)].map(m => m[1]);
const engBody = engine.replace(/^export (async function|function|const) /gm, "$1 ");
const appBody = app.replace(/^import \* as D from "\.\/engine\.js";\n/m, "");
if (/^\s*(import|export) /m.test(engBody + appBody)) throw new Error("module syntax left in bundle");
const script = `<script>\n"use strict";\n(() => {\nconst D = (() => {\n${engBody}\nreturn { ${names.join(", ")} };\n})();\n${appBody}\n})();\n</script>`;
const out = page.replace('<script type="module" src="./app.js"></script>', () => script);
mkdirSync(R("dist"), { recursive: true });
writeFileSync(R("dist/index.html"), out);
console.log("digit-pro/dist/index.html", (out.length / 1024).toFixed(1) + " KiB");
