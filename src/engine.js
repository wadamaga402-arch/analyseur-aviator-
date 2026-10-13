// Generated from site/analyseur.html (ENGINE block). Run: node scripts/sync-engine.mjs

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
/* ---- "signal channel" rule checker: cash out at m, up to g extra tries ("gales") with the stake multiplied by f ---- */
function galeRule(a, opts){
  const o=opts||{}, m=o.m||1.5, g=Math.max(0,Math.min(5,Math.floor(o.gales??1))), s=o.stake||1, f=o.factor||2;
  const n=a.length;
  let i=0, greens=0, reds=0, staked=0, net=0, peak=0, maxDD=0, redRun=0, maxRedRun=0;
  while (i<n){
    let stake=s, won=false, k=0, cs=0, cn=0;
    for (; k<=g && i<n; k++){
      cs+=stake;
      if (a[i]>=m){ cn+=stake*(m-1); won=true; i++; break; }
      cn-=stake; stake*=f; i++;
    }
    if (!won && k<=g) break;                          // ran out of rounds mid-cycle: the incomplete cycle is not counted
    staked+=cs; net+=cn;
    if (won) { greens++; redRun=0; } else { reds++; redRun++; if (redRun>maxRedRun) maxRedRun=redRun; }
    if (net>peak) peak=net; if (peak-net>maxDD) maxDD=peak-net;
  }
  const cycles=greens+reds, p=theoGE(m), theoHit=1-Math.pow(1-p, g+1);
  return {m, gales:g, stake:s, factor:f, cycles, greens, reds, hit: cycles?greens/cycles:NaN, theoHit,
    staked: Math.round(staked*100)/100, net: Math.round(net*100)/100, roi: staked? net/staked : NaN, theoRoi: RTP-1,
    maxDrawdown: Math.round(maxDD*100)/100, maxRedRun, worstLoss: f===1 ? s*(g+1) : s*(Math.pow(f,g+1)-1)/(f-1)};
}
function demoRound(){
  // Fictitious round drawn from the theoretical crash distribution (RTP 97%)
  const u = Math.random();
  const v = Math.max(1, Math.floor((RTP/(1-u))*100)/100);
  return Math.min(v, 10000);
}

export {RTP,CATS,catOf,theoGE,theoCat,toNum,validRound,parseList,parseCSV,median,wilson,stats,geRate,dependence,quality,SRC,normSrc,srcCounts,parseCaptureResult,dedupeOverlap,demoRound,gammaQ,chiSquareFit,VAL,streaksBelow2,valRules,simulate,validate,signalState,walkForward,dataQuality,windowStats,logEntry,scoreLog,galeRule};
