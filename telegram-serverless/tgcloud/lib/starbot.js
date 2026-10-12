// Aviator Star Bot — Telegram Serverless (BotFather → Serverless)
// Fichier généré automatiquement depuis src/engine.js et src/bot-core.js : ne pas modifier à la main.
// Statistiques sur les manches que vous envoyez. Aucune connexion à Bwin, aucune prédiction, aucune mise.
import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { kv } from '../schema.js';

// Réglage facultatif : votre identifiant Telegram. Laissez vide : le premier /start verrouille le bot sur votre compte.
const ALLOWED_USER_ID = "";

const E = (() => {

const RTP = 0.97;
const CATS = [
  {key:"k1", label:"< 1,50×",       lo:0,   hi:1.5},
  {key:"k2", label:"1,50× – 2×",    lo:1.5, hi:2},
  {key:"k3", label:"2× – 5×",       lo:2,   hi:5},
  {key:"k4", label:"≥ 5×",          lo:5,   hi:Infinity},
];
function catOf(v){ for (const c of CATS) if (v>=c.lo && v<c.hi) return c.key; return "k4"; }
function theoGE(m){ return m<=1 ? 1 : Math.min(1, RTP/m); }
function theoCat(c){ return theoGE(Math.max(1,c.lo)) - (c.hi===Infinity?0:theoGE(c.hi)); }
function toNum(tok){
  if (tok==null) return NaN;
  const s = String(tok).trim().replace(/[x×\s]/gi,"").replace(",",".");
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return +s;
}
function validRound(v){ return Number.isFinite(v) && v>=1 && v<=1e6; }
function parseList(text){
  const toks = String(text).split(/[\s;|\n\r\t]+/).filter(Boolean);
  const ok=[], bad=[];
  for (const t of toks){ const v=toNum(t); if (validRound(v)) ok.push(Math.round(v*100)/100); else bad.push(t); }
  return {ok,bad};
}
function parseCSV(text){
  const lines = String(text).split(/\r?\n/).filter(l=>l.trim()!=="");
  if (!lines.length) return {ok:[],bad:[]};
  const sep = (lines[0].match(/;/g)||[]).length >= (lines[0].match(/,/g)||[]).length && lines[0].includes(";") ? ";" : (lines[0].includes("\t")?"\t":",");
  const split = l => l.split(sep).map(c=>c.trim().replace(/^"|"$/g,""));
  let col = -1, start = 0;
  const head = split(lines[0]).map(h=>h.toLowerCase());
  const hi = head.findIndex(h=>/mult|coef|crash|cote/.test(h));
  if (hi>=0){ col=hi; start=1; }
  else if (head.every(h=>!Number.isFinite(toNum(h)))) start=1;
  const ok=[], bad=[];
  for (let i=start;i<lines.length;i++){
    const cells = split(lines[i]);
    let v = NaN;
    if (col>=0) v = toNum(cells[col]);
    else if (cells.length===1 || sep===",") {
      // single column, or comma-separated where a French decimal may have been split
      v = toNum(cells.length===2 && /^\d+$/.test(cells[0]) && /^\d{1,2}$/.test(cells[1]) ? cells[0]+"."+cells[1] : cells[cells.length-1]);
    } else v = toNum(cells[cells.length-1]);
    if (validRound(v)) ok.push(Math.round(v*100)/100); else bad.push(lines[i]);
  }
  return {ok,bad};
}
function median(a){ if(!a.length) return NaN; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function wilson(k,n,z=1.96){
  if (!n) return [NaN,NaN];
  const p=k/n, d=1+z*z/n, c=p+z*z/(2*n), r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n));
  return [Math.max(0,(c-r)/d), Math.min(1,(c+r)/d)];
}
function stats(a){
  const n=a.length;
  const counts={k1:0,k2:0,k3:0,k4:0};
  let sum=0,mn=Infinity,mx=-Infinity,ge2=0;
  for (const v of a){ counts[catOf(v)]++; sum+=v; if(v<mn)mn=v; if(v>mx)mx=v; if(v>=2)ge2++; }
  let streak=0; for (let i=n-1;i>=0 && a[i]<2;i--) streak++;
  return {n,counts,mean:n?sum/n:NaN,median:median(a),min:n?mn:NaN,max:n?mx:NaN,ge2,streak};
}
function geRate(a,m){ if(!a.length) return NaN; let k=0; for(const v of a) if(v>=m) k++; return k/a.length; }
function dependence(a){
  // P(next >= 2 | previous < 2) vs P(next >= 2 | previous >= 2)
  let nl=0,kl=0,nh=0,kh=0;
  for (let i=1;i<a.length;i++){ if(a[i-1]<2){nl++; if(a[i]>=2)kl++;} else {nh++; if(a[i]>=2)kh++;} }
  return {nl,kl,nh,kh};
}
function quality(n,bad){
  if (n<30) return {lvl:"q-bad",txt:"insuffisante"};
  if (n<100) return {lvl:"q-mid",txt:"faible"};
  if (n<500) return {lvl:"q-mid",txt:"correcte"};
  return {lvl:"q-good",txt:"bonne"};
}
const SRC = {m:"saisie manuelle", i:"import CSV", c:"lue sur capture", t:"saisie Telegram", d:"démo (fictive)"};
function normSrc(rounds, src){
  // older saved profiles had no source list: their rounds were typed by hand
  if (!Array.isArray(src) || src.length!==rounds.length) return rounds.map(()=> "m");
  return src.map(s=> SRC[s] ? s : "m");
}
function srcCounts(src){ const c={m:0,i:0,c:0,t:0,d:0}; for (const s of src) c[s]=(c[s]||0)+1; return c; }
function parseCaptureResult(obj){
  // expected: {values:[numbers|strings], order:"newest_first"|"oldest_first"|"unknown", unreadable:n}
  if (!obj || typeof obj!=="object" || !Array.isArray(obj.values)) return {error:"format"};
  const ok=[], bad=[];
  for (const t of obj.values){ const v=toNum(t); if (validRound(v)) ok.push(Math.round(v*100)/100); else bad.push(String(t)); }
  const order = obj.order==="oldest_first" ? "oldest_first" : (obj.order==="newest_first" ? "newest_first" : "unknown");
  if (order!=="oldest_first") ok.reverse();   // Aviator's history strip shows the newest round first
  const unreadable = Math.max(0, Math.floor(+obj.unreadable||0));
  return {ok, bad, order, unreadable};
}
function dedupeOverlap(existing, incoming, minK=3){
  // a new capture often repeats the last rounds already saved: drop that overlap
  const max=Math.min(existing.length, incoming.length);
  for (let k=max;k>=minK;k--){
    let same=true;
    for (let j=0;j<k;j++) if (existing[existing.length-k+j]!==incoming[j]) { same=false; break; }
    if (same) return {fresh:incoming.slice(k), dropped:k};
  }
  return {fresh:incoming.slice(), dropped:0};
}
/* ---- goodness of fit: do the imported rounds look like Aviator's published distribution? ---- */
function lgamma(x){
  const g=7, c=[0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if (x<0.5) return Math.log(Math.PI/Math.sin(Math.PI*x)) - lgamma(1-x);
  x-=1; let a=c[0]; const t=x+g+0.5; for (let i=1;i<9;i++) a+=c[i]/(x+i);
  return 0.5*Math.log(2*Math.PI)+(x+0.5)*Math.log(t)-t+Math.log(a);
}
function gammaQ(a,x){
  // regularized upper incomplete gamma Q(a,x) (Numerical Recipes series / continued fraction)
  if (x<=0) return 1;
  const lead = -x + a*Math.log(x) - lgamma(a);
  if (x < a+1){
    let ap=a, sum=1/a, del=sum;
    for (let n=0;n<1000;n++){ ap++; del*=x/ap; sum+=del; if (Math.abs(del)<Math.abs(sum)*1e-15) break; }
    return Math.max(0, 1 - sum*Math.exp(lead));
  }
  const tiny=1e-300; let b=x+1-a, c=1/tiny, d=1/b, h=d;
  for (let i=1;i<1000;i++){
    const an=-i*(i-a); b+=2; d=an*d+b; if (Math.abs(d)<tiny) d=tiny; c=b+an/c; if (Math.abs(c)<tiny) c=tiny; d=1/d;
    const del=d*c; h*=del; if (Math.abs(del-1)<1e-15) break;
  }
  return Math.min(1, Math.exp(lead)*h);
}
function chiSquareFit(a){
  const n=a.length; if (n<30) return null;
  const s=stats(a); let chi=0;
  for (const c of CATS){ const e=n*theoCat(c); chi += (s.counts[c.key]-e)*(s.counts[c.key]-e)/e; }
  return {chi, df:3, p:gammaQ(1.5, chi/2), n};
}

/* ---- out-of-sample validation of simple betting rules (chronological train / test split) ---- */
const VAL = { targets:[1.2,1.5,2,3,5,10], minRounds:200, trainFrac:0.7, minTrainBets:30, minTestBets:100 };
function streaksBelow2(a){ const s=new Array(a.length); let k=0; for (let i=0;i<a.length;i++){ k = a[i]<2 ? k+1 : 0; s[i]=k; } return s; }
function valRules(){
  const rules=[{id:"always", label:"à chaque manche", test:()=>true}];
  for (const k of [2,3,4,5]) rules.push({id:"streak"+k, label:"après "+k+" manches de suite sous 2×", test:(a,s,i)=>i>0 && s[i-1]>=k});
  rules.push({id:"afterHigh", label:"après une manche ≥ 10×", test:(a,s,i)=>i>0 && a[i-1]>=10});
  rules.push({id:"afterLow", label:"après une manche < 1,20×", test:(a,s,i)=>i>0 && a[i-1]<1.2});
  return rules;
}
function simulate(a, s, from, to, rule, m){
  // one unit staked on each round the rule selects, cashed out at m if the round reaches m
  let bets=0, wins=0, sum=0, sum2=0;
  for (let i=Math.max(from,1);i<to;i++){
    if (!rule.test(a,s,i)) continue;
    bets++; const r = a[i]>=m ? m-1 : -1; if (r>0) wins++; sum+=r; sum2+=r*r;
  }
  const roi = bets ? sum/bets : NaN;
  const sd = bets>1 ? Math.sqrt(Math.max(0,(sum2 - bets*roi*roi)/(bets-1))) : NaN;
  const se = bets>1 ? sd/Math.sqrt(bets) : NaN;
  return {bets, wins, losses:bets-wins, roi, ci:[roi-1.96*se, roi+1.96*se], hit:bets?wins/bets:NaN, hitCI:wilson(wins,bets)};
}
function validate(a){
  const n=a.length;
  if (n < VAL.minRounds) return {status:"insufficient", n, need:VAL.minRounds};
  const s=streaksBelow2(a), split=Math.floor(n*VAL.trainFrac), rules=valRules();
  let best=null, combos=0;
  for (const rule of rules) for (const m of VAL.targets){
    combos++;
    const tr = simulate(a,s,0,split,rule,m);
    if (tr.bets < VAL.minTrainBets) continue;
    if (!best || tr.roi > best.train.roi) best = {rule, m, train:tr};
  }
  if (!best) return {status:"insufficient", n, need:VAL.minRounds};
  const test = simulate(a,s,split,n,best.rule,best.m);
  const base = simulate(a,s,split,n,rules[0],best.m);
  const theoRoi = theoGE(best.m)*best.m - 1;
  const edge = test.bets>=VAL.minTestBets && test.ci[0]>0 && test.roi>base.roi;
  return {status:"done", n, split, trainN:split, testN:n-split, combos,
    chosen:{label:best.rule.label, id:best.rule.id, m:best.m, trainRoi:best.train.roi, trainBets:best.train.bets},
    test, baseline:base, theoRoi, theoHit:theoGE(best.m), edge};
}
function signalState(a, opts){
  const o=opts||{}, n=a.length;
  if (o.running) return {code:"running", title:"ANALYSE EN COURS", tone:"info", why:"Recalcul des statistiques et de la validation sur "+n+" manches."};
  if (o.demo || n===0) return {code:"insufficient", title:"DONNÉES INSUFFISANTES", tone:"muted", why: o.demo ? "Le profil Démo contient des manches fictives : aucune analyse n'est faite dessus. Choisissez un profil avec vos manches réelles." : "Aucune manche réelle importée pour ce profil."};
  if (n<30) return {code:"insufficient", title:"DONNÉES INSUFFISANTES", tone:"muted", why:n+" manche(s) réelle(s). Il en faut au moins 30 pour des fréquences utilisables, et "+VAL.minRounds+" pour tester une stratégie."};
  const fit = chiSquareFit(a), badRate = (o.anomalies||0)/(n+(o.anomalies||0));
  if ((fit && fit.p<0.001) || badRate>0.1) return {code:"risk", title:"RISQUE ÉLEVÉ", tone:"bad",
    why: (fit && fit.p<0.001 ? "Vos données s'écartent fortement de la distribution publiée d'Aviator (p = "+fit.p.toExponential(1)+"). Elles sont probablement incomplètes, mal recopiées ou triées. " : "")
       + (badRate>0.1 ? Math.round(badRate*100)+" % des valeurs importées étaient illisibles. " : "")
       + "Toute analyse sur ces données est peu fiable."};
  if (n < VAL.minRounds) return {code:"history", title:"ANALYSE HISTORIQUE DISPONIBLE", tone:"info", why:"Fréquences et statistiques calculées sur "+n+" manches réelles. Le test hors échantillon d'une stratégie demande au moins "+VAL.minRounds+" manches."};
  const v = o.validation || validate(a);
  if (v.status==="done" && v.edge) return {code:"edge", title:"AVANTAGE OBSERVÉ HORS ÉCHANTILLON — À CONFIRMER", tone:"warn",
    why:"La règle « "+v.chosen.label+", encaisser à "+v.chosen.m+"× » a eu un retour positif sur les "+v.testN+" dernières manches, jamais vues pendant l'entraînement. "+v.combos+" combinaisons ont été essayées : un tel résultat peut encore venir du hasard. Ce n'est pas une garantie."};
  return {code:"none", title:"AUCUN AVANTAGE STATISTIQUE DÉTECTÉ", tone:"muted",
    why:"Sur "+n+" manches réelles, aucune des "+(v.combos||0)+" règles testées n'a battu le hasard hors échantillon. C'est le résultat attendu pour un jeu à tirages indépendants."};
}
/* ---- prospective check: estimates made with past rounds only, scored against the round that followed ---- */
function walkForward(a, opts){
  const o=opts||{}, win=o.win||100, start=o.start||30, m=o.m||2, prior=10;
  const n=a.length, need=start+20;
  if (n<need) return {status:"insufficient", n, need};
  const pt=theoGE(m);
  let c=0; for (let j=Math.max(0,start-win);j<start;j++) if (a[j]>=m) c++;
  let sm=0, st=0, sd=0, sd2=0, k=0, sumP=0, hits=0;
  for (let i=start;i<n;i++){
    const from=Math.max(0,i-win), len=i-from;
    const pe=(c+prior*pt)/(len+prior);           // empirical frequency of the last `win` rounds, lightly pulled toward theory
    const y=a[i]>=m?1:0;
    const bm=(pe-y)*(pe-y), bt=(pt-y)*(pt-y), d=bm-bt;
    sm+=bm; st+=bt; sd+=d; sd2+=d*d; k++; sumP+=pe; hits+=y;
    if (a[i]>=m) c++;                             // slide the window
    if (i-win>=0 && a[i-win]>=m) c--;
  }
  const md=sd/k, se=Math.sqrt(Math.max(0,(sd2-k*md*md)/(k-1)))/Math.sqrt(k);
  return {status:"done", n, scored:k, m, win, brierModel:sm/k, brierTheory:st/k, skill:1-sm/st,
    diffCI:[md-1.96*se, md+1.96*se], meanEstimate:sumP/k, observedRate:hits/k, theory:pt,
    better: md+1.96*se<0};                         // model better than theory only if the whole CI is below zero
}
/* ---- data quality checks ---- */
function dataQuality(a, anomalies){
  const n=a.length, bad=anomalies||0, items=[];
  items.push({ok:n>=VAL.minRounds, label:"Quantité", detail: n+" manche(s) réelle(s) · "+quality(n).txt+(n<VAL.minRounds?" · validation possible dès "+VAL.minRounds:"")});
  const badRate = n+bad ? bad/(n+bad) : 0;
  items.push({ok:badRate<=0.05, label:"Valeurs illisibles", detail: bad+" ignorée(s)"+(n+bad?" ("+(badRate*100).toFixed(1).replace(".",",")+" %)":"")});
  const fit=chiSquareFit(a);
  items.push({ok: !fit || fit.p>=0.001, label:"Conformité au jeu", detail: fit ? "khi² = "+fit.chi.toFixed(1).replace(".",",")+" · p = "+(fit.p<0.001?fit.p.toExponential(1):fit.p.toFixed(3).replace(".",",")) : "test possible dès 30 manches"});
  let run=1, maxRun=n?1:0; for (let i=1;i<n;i++){ run = a[i]===a[i-1] ? run+1 : 1; if (run>maxRun) maxRun=run; }
  items.push({ok:maxRun<3, label:"Valeurs répétées", detail: maxRun>=3 ? "la même valeur apparaît "+maxRun+" fois de suite : copie en double ?" : "aucune répétition suspecte"});
  let ge=0, le=0; for (let i=1;i<n;i++){ if (a[i]>=a[i-1]) ge++; if (a[i]<=a[i-1]) le++; }
  const geR = n>1 ? ge/(n-1) : 0.5, leR = n>1 ? le/(n-1) : 0.5, sortedLike = geR>=0.9 || leR>=0.9;
  items.push({ok: n<20 || !sortedLike, label:"Ordre", detail: n<20 ? "trop peu de manches pour juger" : (sortedLike ? "les valeurs semblent triées : l'ordre chronologique est peut-être perdu" : "ordre plausible ("+Math.round(geR*100)+" % de pas en hausse ou égaux)")});
  const ones = n ? a.filter(v=>v<1.01).length/n : 0;
  items.push({ok: n<50 || ones<0.12, label:"Manches à 1,00×", detail: n ? (ones*100).toFixed(1).replace(".",",")+" % (≈ 3 % attendus)" : "—"});
  items.push({ok:true, label:"Direct", detail:"0 manche en direct : aucune source autorisée"});
  const fails = items.filter(x=>!x.ok).length;
  return {n, items, fails, level: n<30 ? "insuffisante" : (fails>=2 ? "douteuse" : (fails===1 ? "à vérifier" : "bonne"))};
}
function windowStats(a){
  return [10,50,100,500,Infinity].map(k=>{ const x = k===Infinity ? a : a.slice(-k), s=stats(x);
    return {k, n:s.n, mean:s.mean, median:s.median, ge2:s.n?s.ge2/s.n:NaN, ge5:geRate(x,5), max:s.max}; });
}
function logEntry(a, sig, at){
  const last=a.slice(-100);
  return {at: at||Date.now(), n:a.length, code:sig.code, title:sig.title, p2: last.length>=30 ? +geRate(last,2).toFixed(4) : null};
}
function scoreLog(log, a){
  // what happened right after each recorded analysis (round number n+1), compared with the estimate stored at the time
  let k=0, hits=0, sumP=0, sumT=0;
  const rows = (log||[]).map(e=>{
    const next = e.n < a.length ? a[e.n] : null;
    if (next!=null && e.p2!=null){ k++; if (next>=2) hits++; sumP+=e.p2; sumT+=theoGE(2); }
    return Object.assign({}, e, {next});
  });
  return {rows, scored:k, hits, meanEstimate: k?sumP/k:NaN, theory: theoGE(2)};
}
function demoRound(){
  // Fictitious round drawn from the theoretical crash distribution (RTP 97%)
  const u = Math.random();
  const v = Math.max(1, Math.floor((RTP/(1-u))*100)/100);
  return Math.min(v, 10000);
}


return { RTP, CATS, catOf, theoGE, theoCat, toNum, validRound, parseList, parseCSV, median, wilson, stats, geRate, dependence, quality, SRC, normSrc, srcCounts, parseCaptureResult, dedupeOverlap, demoRound, gammaQ, chiSquareFit, VAL, streaksBelow2, valRules, simulate, validate, signalState, walkForward, dataQuality, windowStats, logEntry, scoreLog };
})();

const C = (() => {
// Aviator Star Bot — Telegram logic shared by both hostings:
//   - Cloudflare Worker (src/worker.js)            S = Durable Object stub
//   - Telegram Serverless (telegram-serverless/)   S = SQLite key/value table
// S is any object with async read(key), write(key, value), remove(key).
// send(chatId, text) must resolve to { ok, description? } and never throw.
// No connection to Bwin, no prediction, no betting function.


const MAXR = 5000;
const fmtX = v => v.toFixed(2).replace(".", ",") + "×";
const fmtP = p => Number.isFinite(p) ? (p * 100).toFixed(1).replace(".", ",") + " %" : "—";
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------------- data ---------------- */
async function getProfiles(S) { return (await S.read("profiles")) || {}; }
async function getRounds(S, id) { return (await S.read("rounds:" + id)) || { rounds: [], src: "" }; }
async function getConfig(S) { return (await S.read("config")) || {}; }
async function setConfig(S, patch) { const c = Object.assign(await getConfig(S), patch); await S.write("config", c); return c; }

async function appendRounds(S, profileId, values, src) {
  const profiles = await getProfiles(S);
  if (!profiles[profileId]) return { error: "Profil introuvable." };
  const data = await getRounds(S, profileId);
  const { fresh, dropped } = E.dedupeOverlap(data.rounds, values);
  data.rounds.push(...fresh); data.src += src.repeat(fresh.length);
  if (data.rounds.length > MAXR) { const cut = data.rounds.length - MAXR; data.rounds.splice(0, cut); data.src = data.src.slice(cut); }
  await S.write("rounds:" + profileId, data);
  profiles[profileId].updatedAt = Date.now();
  await S.write("profiles", profiles);
  return { profile: profiles[profileId], data, added: fresh, dropped };
}
function signalOf(rounds) {
  const v = rounds.length >= E.VAL.minRounds ? E.validate(rounds) : { status: "insufficient" };
  return { v, sig: E.signalState(rounds, { validation: v }) };
}
async function appendLog(S, id, rounds, why) {
  const { sig } = signalOf(rounds);
  const e = Object.assign(E.logEntry(rounds, sig), { why });
  const log = (await S.read("log:" + id)) || [];
  log.push(e); if (log.length > 300) log.splice(0, log.length - 300);
  await S.write("log:" + id, log);
  return e;
}
async function clearProfile(S, id) {
  const profiles = await getProfiles(S);
  if (!profiles[id]) return false;
  await S.write("rounds:" + id, { rounds: [], src: "" }); await S.remove("log:" + id);
  profiles[id].updatedAt = Date.now(); await S.write("profiles", profiles);
  return true;
}

/* ---------------- texts ---------------- */
function statsText(name, rounds) {
  const n = rounds.length;
  if (!n) return `<b>${esc(name)}</b>\nDONNÉES INSUFFISANTES : aucune manche enregistrée.\nAjoutez vos manches réelles avec /ajouter 1,52 3,10 …`;
  const w = rounds.slice(-100), s = E.stats(w), all = E.stats(rounds), dq = E.dataQuality(rounds, 0);
  const lines = E.CATS.map(c => `${c.label} : ${fmtP(s.counts[c.key] / s.n)} (théorie ${fmtP(E.theoCat(c))})`);
  const flags = dq.items.filter(x => !x.ok).map(x => `⚠️ ${x.label} : ${x.detail}`);
  return [
    `<b>Statistiques · ${esc(name)}</b>`,
    `${n} manche(s) analysée(s) · qualité des données : ${dq.level}`,
    `Toutes : moyenne ${fmtX(all.mean)}, médiane ${fmtX(all.median)}, max ${fmtX(all.max)}`,
    `${s.n} dernières : ≥ 2× ${fmtP(s.ge2 / s.n)} (théorie ${fmtP(E.theoGE(2))})`,
    "", "<b>Répartition (" + s.n + " dernières)</b>", ...lines,
    ...(flags.length ? ["", ...flags] : []),
    "", `Signal : <b>${esc(signalOf(rounds).sig.title)}</b> · /signal pour le détail`,
    n < 30 ? "Moins de 30 manches : ces pourcentages varient beaucoup par simple hasard." : `Série actuelle sous 2× : ${s.streak}. Elle ne change pas la chance de la prochaine manche.`,
    `<i>Observations du passé, pas une prédiction.</i>`,
  ].join("\n");
}
function signalText(name, rounds) {
  const n = rounds.length, dq = E.dataQuality(rounds, 0);
  const rows = [1.5, 2, 3, 5, 10].map(m => `≥ ${fmtX(m)} : ${fmtP(E.theoGE(m))} (théorie) · ${n ? fmtP(E.geRate(rounds, m)) : "—"} (observé)`);
  const { v, sig } = signalOf(rounds);
  const wf = E.walkForward(rounds);
  return [
    `★ <b>STAR BOT SIGNAL : ${esc(sig.title)}</b>`,
    esc(sig.why),
    "",
    `Données : ${n} manche(s) réelle(s) · qualité ${dq.level} · 0 en direct`,
    v.status === "done" ? `Validation hors échantillon : test sur ${v.testN} manches · meilleure règle ${fmtP(v.test.roi)} par mise contre ${fmtP(v.baseline.roi)} pour la référence` : `Validation hors échantillon : ${E.VAL.minRounds} manches nécessaires`,
    wf.status === "done" ? `Estimations vs résultats : ${wf.better ? "meilleures que la théorie (à confirmer)" : "aucune amélioration sur la théorie"} (${wf.scored} manches)` : `Estimations vs résultats : ${wf.need} manches nécessaires`,
    "", "<b>Observations historiques</b> — chance d'atteindre au moins :", ...rows, "",
    "Retour moyen théorique : −3 % de la mise, quel que soit l'encaissement.",
    "<i>Limite : chaque manche est indépendante. Aucun outil ne connaît la prochaine. Ce n'est pas un conseil de mise.</i>",
  ].join("\n");
}
function historyText(name, rounds, src, k) {
  if (!rounds.length) return "Aucune manche enregistrée. Ajoutez-en avec /ajouter 1,52 3,10 …";
  const start = Math.max(0, rounds.length - k);
  const items = rounds.slice(start).map((v, i) => fmtX(v) + (src[start + i] === "t" ? "ᵗ" : src[start + i] === "i" ? "ᶜ" : src[start + i] === "c" ? "ᵏ" : "")).reverse();
  return `<b>${Math.min(k, rounds.length)} dernières manches · ${esc(name)}</b> (la plus récente en premier, ${rounds.length} au total)\n` + items.join("  ") +
    "\n<i>ᵗ Telegram · ᶜ CSV · ᵏ capture · sans marque : saisie sur le site</i>";
}
const HELP = [
  "<b>Aviator Star Bot</b> — statistiques sur vos manches réelles",
  "",
  "/ajouter 1,52 3,10 1,20 — ajouter des manches (de la plus ancienne à la plus récente)",
  "/historique [n] — les n dernières manches (20 par défaut, 50 max)",
  "/stats — statistiques et qualité des données",
  "/signal — STAR BOT SIGNAL : analyse, validation et limites",
  "/effacer — effacer l'historique du profil (avec confirmation)",
  "/test — vérifier le moteur d'analyse et le stockage",
  "/aide — cette aide",
  "",
  "Le bot fonctionne même si le site est fermé. Il ne se connecte pas à Bwin, ne prédit rien et ne place aucune mise.",
].join("\n");
const COMMANDS = [
  { command: "ajouter", description: "Ajouter des manches réelles" },
  { command: "historique", description: "Dernières manches" },
  { command: "stats", description: "Statistiques du profil suivi" },
  { command: "signal", description: "STAR BOT SIGNAL et limites" },
  { command: "effacer", description: "Effacer l'historique (avec confirmation)" },
  { command: "test", description: "Vérifier le moteur" },
  { command: "aide", description: "Aide" },
];

/* ---------------- self-test ---------------- */
// deterministic sample shaped like Aviator's published distribution, for /test only (never stored, never shown as data)
function selfTestSample(n, seed) {
  let x = seed >>> 0; const r = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  return Array.from({ length: n }, () => Math.max(1, Math.floor((E.RTP / (1 - r())) * 100) / 100));
}
async function selfTest(S) {
  const t0 = Date.now(), out = [];
  const check = (label, fn) => { try { out.push([label, !!fn()]); } catch (e) { out.push([label, false]); } };
  check("probabilité théorique ≥ 2× = 48,5 %", () => Math.abs(E.theoGE(2) - 0.485) < 1e-9);
  check("lecture des valeurs (1,52 / 3.10 / x)", () => { const r = E.parseList("1,52 3.10 x 0,5"); return r.ok.length === 2 && r.bad.length === 2; });
  check("statistiques (moyenne, médiane, série)", () => { const s = E.stats([2.5, 1.2, 1.1, 1.3]); return Math.abs(s.mean - 1.525) < 1e-9 && E.median([3, 1, 2]) === 2 && s.streak === 3; });
  check("test du khi² (valeur de référence)", () => Math.abs(E.gammaQ(1.5, 7.815 / 2) - 0.05) < 0.001);
  const sample = selfTestSample(1500, 20261013);
  check("validation : aucun faux avantage sur 1 500 manches conformes", () => { const v = E.validate(sample); return v.status === "done" && v.edge === false; });
  check("estimations vs résultats : pas d'amélioration factice", () => { const w = E.walkForward(sample); return w.status === "done" && !w.better; });
  check("qualité : données triées détectées", () => E.dataQuality(sample.slice().sort((a, b) => a - b), 0).items.some(x => x.label === "Ordre" && !x.ok));
  let storageOk = false;
  try { const k = "selftest", v = { at: Date.now() }; await S.write(k, v); const back = await S.read(k); storageOk = !!back && back.at === v.at; await S.remove(k); } catch {}
  out.push(["stockage permanent (écriture / lecture)", storageOk]);
  return { out, ms: Date.now() - t0, ok: out.every(x => x[1]) };
}

/* ---------------- message handling ---------------- */
// deps: { S, send, allowed: "<telegram id>" | "", ownerClaim: boolean (Serverless: first /start becomes the owner) }
async function handleMessage(deps, msg) {
  const { S, send } = deps;
  if (!msg || !msg.chat || typeof msg.text !== "string") return;
  if (msg.chat.type && msg.chat.type !== "private") return;          // private chats only
  const chatId = msg.chat.id, fromId = String(msg.from?.id ?? ""), text = msg.text.trim().slice(0, 4000);
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, "");
  let c = await getConfig(S);
  const who = [msg.from?.first_name, msg.from?.username ? "@" + msg.from.username : ""].filter(Boolean).join(" ") || String(chatId);

  // owner claim (Serverless, no secret store): the first person to send /start in private becomes the only allowed account
  if (deps.ownerClaim && !deps.allowed && !c.ownerId && cmd === "/start" && fromId) {
    c = await setConfig(S, { ownerId: fromId, chatId, chatName: who, linkedAt: Date.now() });
    return send(chatId, `✅ <b>Bot relié et verrouillé sur votre compte</b> (identifiant <code>${esc(fromId)}</code>).\nPersonne d'autre ne peut l'utiliser. Vos données sont gardées chez Telegram, même si le site est fermé.\nEnvoyez /test pour vérifier que tout fonctionne.\n\n` + HELP);
  }
  const allow = String(deps.allowed || (deps.ownerClaim ? c.ownerId || "" : "")).trim();

  // 1. authorisation
  if (allow && fromId !== allow) {
    return send(chatId, `Ce bot est privé.\nVotre identifiant Telegram : <code>${esc(fromId)}</code>`
      + (deps.ownerClaim ? "" : "\nSi ce bot est le vôtre, mettez cet identifiant dans le secret ALLOWED_USER_ID sur Cloudflare."));
  }
  if (deps.ownerClaim && !allow) {
    return send(chatId, "Envoyez /start pour relier ce bot à votre compte Telegram.");
  }
  if (c.chatId !== chatId) {
    const code = args[0] || "";
    const byCode = cmd === "/start" && c.linkCode && code && timingSafeEqual(code, c.linkCode) && Date.now() < (c.linkExp || 0);
    if (allow || byCode) {
      c = await setConfig(S, { chatId, chatName: who, linkCode: null, linkExp: 0, linkedAt: Date.now(), lastTest: null });
      const lock = allow ? "🔒 Bot verrouillé sur votre compte." : `🔓 Pour le verrouiller sur votre compte, ajoutez le secret ALLOWED_USER_ID = <code>${esc(fromId)}</code> dans Cloudflare.`;
      if (cmd === "/start") return send(chatId, "✅ <b>Bot relié.</b> Vos données sont gardées sur votre serveur, même si le site est fermé.\n" + lock + "\nEnvoyez /test pour vérifier que tout fonctionne.\n\n" + HELP);
    } else {
      return send(chatId, `Ce bot est privé.\nVotre identifiant Telegram : <code>${esc(fromId)}</code>\nPour l'utiliser, mettez cet identifiant dans le secret ALLOWED_USER_ID sur Cloudflare (ou appuyez sur « Connecter Telegram » sur le site).`);
    }
  }

  // 2. profile followed by the bot (created automatically if the site was never used)
  const profiles = await getProfiles(S);
  let pid = c.tgProfile && profiles[c.tgProfile] ? c.tgProfile : Object.keys(profiles)[0];
  if (!pid && cmd === "/ajouter") {
    pid = "p" + Date.now().toString(36) + "tg";
    profiles[pid] = { name: "Telegram", createdAt: Date.now(), updatedAt: Date.now() };
    await S.write("profiles", profiles); await S.write("rounds:" + pid, { rounds: [], src: "" });
    c = await setConfig(S, { tgProfile: pid });
  }
  const pname = pid ? profiles[pid].name : "";
  const noData = () => send(chatId, "DONNÉES INSUFFISANTES : aucune manche enregistrée.\nAjoutez vos manches réelles avec /ajouter 1,52 3,10 1,20");

  if (cmd === "/start" || cmd === "/aide" || cmd === "/help") return send(chatId, HELP);
  if (cmd === "/test") {
    const t = await selfTest(S);
    return send(chatId, [
      `${t.ok ? "✅" : "❌"} <b>Test du moteur : ${t.out.filter(x => x[1]).length}/${t.out.length} vérifications réussies</b> (${t.ms} ms)`,
      ...t.out.map(([l, ok]) => `${ok ? "✓" : "✗"} ${l}`),
      "✓ Telegram : ce message est bien arrivé",
      "",
      "<i>Le test utilise un échantillon calculé, jamais enregistré ni mélangé à vos données.</i>",
    ].join("\n"));
  }
  if (cmd === "/stats") { if (!pid) return noData(); const d = await getRounds(S, pid); return send(chatId, statsText(pname, d.rounds)); }
  if (cmd === "/signal") { if (!pid) return noData(); const d = await getRounds(S, pid); return send(chatId, signalText(pname, d.rounds)); }
  if (cmd === "/historique") {
    if (!pid) return noData();
    const k = Math.min(50, Math.max(1, parseInt(args[0], 10) || 20));
    const d = await getRounds(S, pid); return send(chatId, historyText(pname, d.rounds, d.src, k));
  }
  if (cmd === "/ajouter") {
    if (args.join("").length > 2000) return send(chatId, "Trop de valeurs d'un coup : envoyez-en au plus 300 par message.");
    const { ok, bad } = E.parseList(args.join(" "));
    if (!ok.length) return send(chatId, "Aucune valeur lisible. Exemple : /ajouter 1,52 3,10 1,02\nMinimum 1,00. De la plus ancienne à la plus récente.");
    if (ok.length > 300) return send(chatId, "Trop de valeurs d'un coup : envoyez-en au plus 300 par message.");
    const r = await appendRounds(S, pid, ok, "t");
    if (r.error) return send(chatId, r.error);
    const all = r.data.rounds, s = E.stats(all.slice(-100)), e = await appendLog(S, pid, all, "Telegram");
    return send(chatId, [
      `✅ ${r.added.length} manche(s) enregistrée(s) dans « ${esc(pname)} »` + (bad.length ? ` · ${bad.length} ignorée(s) (illisibles ou < 1,00)` : "") + (r.dropped ? ` · ${r.dropped} déjà présente(s) ignorée(s)` : ""),
      `Total : ${all.length} manche(s) · ≥ 2× sur les ${s.n} dernières : ${fmtP(s.ge2 / s.n)} (théorie ${fmtP(E.theoGE(2))})`,
      `Signal : <b>${esc(e.title)}</b>`,
      all.length < 30 ? `Données insuffisantes pour une analyse fiable : encore ${30 - all.length} manche(s) au minimum. Aucune prédiction n'est donnée.` : "Statistiques mises à jour · /stats et /signal pour le détail.",
    ].join("\n"));
  }
  if (cmd === "/effacer") {
    if (!pid) return noData();
    const d = await getRounds(S, pid);
    if ((args[0] || "").toLowerCase() === "oui") {
      if (!c.clearPending || c.clearPending.pid !== pid || Date.now() > c.clearPending.exp) return send(chatId, "Aucune demande d'effacement en cours (ou elle a expiré). Envoyez d'abord /effacer.");
      await clearProfile(S, pid); await setConfig(S, { clearPending: null });
      return send(chatId, `🗑 Historique de « ${esc(pname)} » effacé (${c.clearPending.n} manche(s)). Le profil est conservé.`);
    }
    if (!d.rounds.length) return send(chatId, "L'historique est déjà vide.");
    await setConfig(S, { clearPending: { pid, n: d.rounds.length, exp: Date.now() + 120000 } });
    return send(chatId, `⚠️ Effacer les ${d.rounds.length} manche(s) et les analyses de « ${esc(pname)} » ?\nPour confirmer, envoyez <b>/effacer oui</b> dans les 2 minutes. Sinon, rien n'est effacé.`);
  }
  return send(chatId, "Commande inconnue.\n\n" + HELP);
}

return { MAXR, fmtX, fmtP, esc, timingSafeEqual, getProfiles, getRounds, getConfig, setConfig, appendRounds, signalOf, appendLog, clearProfile, statsText, signalText, historyText, HELP, COMMANDS, selfTest, handleMessage };
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
  if (message && typeof message.text === 'string' && /^\/start\b/i.test(message.text)) {
    try { await api.setMyCommands({ commands: C.COMMANDS }); } catch (e) { console.log('setMyCommands :', e && e.description); }
  }
  try {
    await C.handleMessage({ S, send, allowed: ALLOWED_USER_ID, ownerClaim: true }, message);
  } catch (e) {
    console.log('Erreur :', e && (e.stack || e.message || e));
    if (message && message.chat) await send(message.chat.id, "❌ Erreur interne. Envoyez /test pour vérifier le moteur. Détail : " + C.esc(String(e && e.message || e)).slice(0, 200));
  }
}
