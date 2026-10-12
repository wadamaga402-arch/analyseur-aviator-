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
function demoRound(){
  // Fictitious round drawn from the theoretical crash distribution (RTP 97%)
  const u = Math.random();
  const v = Math.max(1, Math.floor((RTP/(1-u))*100)/100);
  return Math.min(v, 10000);
}

export {RTP,CATS,catOf,theoGE,theoCat,toNum,validRound,parseList,parseCSV,median,wilson,stats,geRate,dependence,quality,SRC,normSrc,srcCounts,parseCaptureResult,dedupeOverlap,demoRound};
