// Builds a one-page "copy the 3 files" helper for BotFather → Serverless (published as a Claude artifact).
import { readFileSync, writeFileSync } from "node:fs";
const R = p => readFileSync(new URL("../telegram-serverless/tgcloud/" + p, import.meta.url), "utf8");
const files = [
  { id: "f1", path: "schema.js", where: "Schéma de la base (Schema / schema.js)", code: R("schema.js") },
  { id: "f2", path: "lib/starbot.js", where: "Module partagé lib, nommé exactement starbot", code: R("lib/starbot.js") },
  { id: "f3", path: "handlers/message.js", where: "Handler du type message", code: R("handlers/message.js") },
];
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const out = process.argv[2];
const html = `<title>Star Bot Serverless</title>
<style>
/* Layout: one column of numbered install steps; each code file is a card with a big copy button */
:root{color-scheme:dark;--bg:#0b0a0b;--panel:#151213;--panel2:#1e191a;--line:#2c2426;--fg:#f5f1f1;--muted:#a0918f;--red:#e3263b;--redsoft:#ff6b78;--green:#3ddc84;
--f-body:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--f-mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font:15px/1.55 var(--f-body)}
.wrap{max-width:720px;margin:0 auto;padding-inline:16px;padding-block:20px 48px;display:flex;flex-direction:column;gap:14px}
h1{font-size:clamp(24px,7vw,32px);margin:0;letter-spacing:.01em;line-height:1.1;text-wrap:balance}h1 span{color:var(--red)}
.lead{color:var(--muted);margin:0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.step{display:grid;grid-template-columns:30px minmax(0,1fr);gap:10px;align-items:start}
.num{width:30px;height:30px;border-radius:50%;background:var(--red);color:#fff;display:grid;place-items:center;font-weight:800;font-size:14px}
.step h2{font-size:16px;margin:3px 0 4px}
.step p{margin:0;color:var(--muted)}
.step b{color:var(--fg)}
code{font-family:var(--f-mono);background:var(--panel2);padding:1px 5px;border-radius:5px;font-size:13px;color:var(--fg)}
.file{border-color:color-mix(in srgb,var(--red) 40%,var(--line))}
.fhead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.fname{font-family:var(--f-mono);font-weight:700;font-size:15px}
.fwhere{color:var(--muted);font-size:13px}
button{font:inherit;font-weight:700;border-radius:10px;border:1px solid var(--red);background:var(--red);color:#fff;padding:12px 16px;cursor:pointer;min-height:46px;width:100%}
button.done{background:transparent;color:var(--green);border-color:var(--green)}
button:focus-visible,textarea:focus-visible{outline:2px solid var(--redsoft);outline-offset:2px}
textarea{width:100%;height:150px;background:var(--panel2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px;font:12px/1.4 var(--f-mono);resize:vertical}
.size{color:var(--muted);font-size:12px;font-family:var(--f-mono)}
.warn{border-left:3px solid var(--red);padding-left:10px;color:var(--muted);margin:0;font-size:14px}
.ok{border-left:3px solid var(--green);padding-left:10px;margin:0;font-size:14px}
</style>
<div class="wrap">
  <h1>Star Bot <span>Serverless</span></h1>
  <p class="lead">Installer Aviator Star Bot directement dans BotFather, sans GitHub ni Cloudflare. 3 fichiers à copier-coller, dans cet ordre.</p>

  <section class="card">
    <div class="step"><span class="num">1</span><div><h2>Ouvrir Serverless</h2><p>Dans Telegram : <b>@BotFather</b> → votre bot <b>@FrecheTradingBot</b> → <b>Serverless</b> → activez-le.</p></div></div>
    <div class="step"><span class="num">2</span><div><h2>Coller le schéma, puis appliquer</h2><p>Ouvrez le <b>schéma de la base</b> (<code>schema.js</code>), remplacez tout par le fichier 1, enregistrez, puis <b>appliquez les changements de base de données</b> proposés (une table <code>kv</code>).</p></div></div>
    <div class="step"><span class="num">3</span><div><h2>Ajouter le module starbot</h2><p>Dans la partie <b>lib</b> (modules partagés), créez un module nommé exactement <code>starbot</code> et collez le fichier 2. Enregistrez.</p></div></div>
    <div class="step"><span class="num">4</span><div><h2>Ajouter le handler message</h2><p>Ajoutez un <b>handler</b> de type <code>message</code>, remplacez tout par le fichier 3, enregistrez.</p></div></div>
    <div class="step"><span class="num">5</span><div><h2>Tester</h2><p>Ouvrez votre bot, envoyez <code>/start</code> (il se verrouille sur votre compte), puis <code>/test</code>. Réponse attendue : <b>8/8 vérifications réussies</b>.</p></div></div>
    <p class="warn">Les noms exacts des boutons de BotFather peuvent différer un peu. Si un écran ne correspond pas, envoyez une capture à Claude.</p>
  </section>

${files.map((f, i) => `  <section class="card file" aria-label="Fichier ${i + 1}">
    <div class="fhead"><span class="fname">${i + 1} · ${f.path}</span><span class="size">${(f.code.length / 1024).toFixed(1)} Ko · ${f.code.split("\n").length} lignes</span></div>
    <div class="fwhere">Où le coller : ${f.where}</div>
    <button type="button" data-copy="${f.id}" id="b-${f.id}">Copier le fichier ${i + 1}</button>
    <textarea id="${f.id}" readonly spellcheck="false" aria-label="Contenu de ${f.path}">${esc(f.code)}</textarea>
  </section>`).join("\n")}

  <p class="ok">Aucun jeton à copier : Serverless utilise directement votre bot. Le bot ne se connecte pas à Bwin, ne prédit rien et ne place aucune mise.</p>
</div>
<script>
document.querySelectorAll("button[data-copy]").forEach(b=>{
  b.addEventListener("click", ()=>{
    const ta=document.getElementById(b.dataset.copy), label=b.textContent;
    const ok=()=>{ b.textContent="Copié ✓"; b.classList.add("done"); setTimeout(()=>{ b.textContent=label; b.classList.remove("done"); }, 2500); };
    const fallback=()=>{ ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); let done=false; try{ done=document.execCommand("copy"); }catch(e){} if(done) ok(); else b.textContent="Texte sélectionné : appuyez sur Copier"; };
    try{ navigator.clipboard.writeText(ta.value).then(ok, fallback); }catch(e){ fallback(); }
  });
});
</script>
`;
writeFileSync(out, html);
console.log("copy page:", out, (html.length / 1024).toFixed(1) + " KiB");
