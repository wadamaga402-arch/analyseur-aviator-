import test from "node:test"; import assert from "node:assert/strict";
import * as E from "../src/engine.js";
test("lecture des nombres (virgule, point, x)", ()=>{ assert.equal(E.toNum("1,87"),1.87); assert.equal(E.toNum("2.5x"),2.5); assert.ok(Number.isNaN(E.toNum("abc"))); });
test("liste collée", ()=>{ const r=E.parseList("1,24 3.10;0,5 abc 7,85x\n1.00"); assert.deepEqual(r.ok,[1.24,3.1,7.85,1]); assert.deepEqual(r.bad,["0,5","abc"]); });
test("CSV avec colonne nommée", ()=>{ const r=E.parseCSV("id;heure;multiplicateur\n1;10:00;1,52\n2;10:01;3,4\n3;x;x"); assert.deepEqual(r.ok,[1.52,3.4]); assert.equal(r.bad.length,1); });
test("théorie : somme des tranches = 100 %", ()=>{ assert.ok(Math.abs(E.CATS.reduce((a,c)=>a+E.theoCat(c),0)-1)<1e-9); assert.ok(Math.abs(E.theoGE(2)-0.485)<1e-9); });
test("statistiques et série", ()=>{ const s=E.stats([2.5,1.2,1.1,1.3]); assert.equal(s.streak,3); assert.equal(s.ge2,1); assert.equal(E.median([3,1,2]),2); });
test("intervalle de Wilson", ()=>{ const [l,h]=E.wilson(50,100); assert.ok(l>0.40&&l<0.41&&h>0.59&&h<0.60); });
test("capture : plus récent en premier inversé", ()=>{ assert.deepEqual(E.parseCaptureResult({values:[5.1,"1,20"],order:"newest_first"}).ok,[1.2,5.1]); assert.equal(E.parseCaptureResult(null).error,"format"); });
test("doublons de chevauchement", ()=>{ assert.deepEqual(E.dedupeOverlap([1,2,3.5,4,5],[3.5,4,5,6]).fresh,[6]); assert.equal(E.dedupeOverlap([1,2,5],[2,5,6]).dropped,0); });
test("sources : anciens profils et Telegram", ()=>{ assert.deepEqual(E.normSrc([1,2],undefined),["m","m"]); assert.deepEqual(E.normSrc([1,2],["t","c"]),["t","c"]); assert.equal(E.SRC.t,"saisie Telegram"); });
test("démo suit la distribution théorique", ()=>{ const a=Array.from({length:100000},E.demoRound); assert.ok(Math.abs(E.geRate(a,2)-0.485)<0.008); assert.ok(a.every(v=>v>=1)); });

/* ---- validation engine ---- */
function rng(seed){ let x=seed>>>0; return ()=>{ x^=x<<13; x>>>=0; x^=x>>17; x^=x<<5; x>>>=0; return x/4294967296; }; }
function fairRounds(n, seed){ const r=rng(seed); return Array.from({length:n},()=>Math.max(1, Math.floor((E.RTP/(1-r()))*100)/100)); }
test("khi² : p-valeurs de référence", ()=>{
  assert.ok(Math.abs(E.gammaQ(1.5, 7.815/2)-0.05)<0.001);   // khi² 7,815 à 3 ddl = p 0,05
  assert.ok(Math.abs(E.gammaQ(1.5, 11.345/2)-0.01)<0.0005);
  assert.ok(Math.abs(E.gammaQ(1.5, 0.584/2)-0.90)<0.002);
});
test("khi² : données conformes acceptées, données triées rejetées", ()=>{
  const a=fairRounds(2000, 7); assert.ok(E.chiSquareFit(a).p>0.01);
  const biased=a.map(v=>v<2?v:Math.min(v,1.9)); assert.ok(E.chiSquareFit(biased).p<1e-6);
});
test("validation : pas assez de données sous 200 manches", ()=>{ assert.equal(E.validate(fairRounds(150,1)).status,"insufficient"); });
test("validation : le hasard pur ne produit pas de faux avantage (50 essais)", ()=>{
  let edges=0;
  for (let s=1;s<=50;s++){ const v=E.validate(fairRounds(3000, s*97)); assert.equal(v.status,"done"); if (v.edge) edges++; }
  assert.ok(edges<=3, "faux avantages détectés : "+edges+"/50");
});
test("validation : un vrai motif caché est détecté hors échantillon", ()=>{
  const a=fairRounds(6000, 4242);
  for (let i=0;i<a.length;i++) if (E.streaksBelow2(a.slice(Math.max(0,i-3),i)).at(-1)>=3) a[i]=Math.max(a[i],3.5); // after 3 lows, round always reaches 3.5x
  const v=E.validate(a);
  assert.equal(v.edge,true); assert.ok(v.test.roi>0); assert.ok(v.test.roi>v.baseline.roi);
});
test("validation : séparation chronologique 70/30 et chiffres cohérents", ()=>{
  const v=E.validate(fairRounds(1000, 3)); assert.equal(v.trainN,700); assert.equal(v.testN,300);
  assert.equal(v.test.wins+v.test.losses, v.test.bets); assert.ok(v.test.ci[0]<=v.test.roi && v.test.roi<=v.test.ci[1]);
  assert.ok(Math.abs(v.theoRoi+0.03)<1e-9);
});
test("signaux : chaque état", ()=>{
  assert.equal(E.signalState([], {}).code,"insufficient");
  assert.equal(E.signalState(fairRounds(500,5), {demo:true}).code,"insufficient");
  assert.equal(E.signalState(fairRounds(20,5), {}).code,"insufficient");
  assert.equal(E.signalState(fairRounds(100,5), {}).code,"history");
  assert.equal(E.signalState(fairRounds(100,5), {running:true}).code,"running");
  assert.equal(E.signalState(fairRounds(300,5).map(v=>Math.min(v,1.4)), {}).code,"risk");
  assert.equal(E.signalState(fairRounds(100,5), {anomalies:30}).code,"risk");
  assert.equal(E.signalState(fairRounds(3000,11), {}).code,"none");
});

/* ---- prospective evaluation, data quality, analysis log ---- */
test("prévisions vs résultats : sur des données conformes, l'estimation ne bat pas la théorie", ()=>{
  let better=0;
  for (let s=1;s<=30;s++){ const w=E.walkForward(fairRounds(1500, s*31)); assert.equal(w.status,"done"); if (w.better) better++; assert.ok(w.skill<0.01, "skill "+w.skill); }
  assert.ok(better<=2, "faux avantages : "+better);
});
test("prévisions vs résultats : une vraie dérive est détectée", ()=>{
  // the true chance of reaching 2x alternates between 80 % and 15 % in blocks of 300 rounds
  const r=rng(77), a=[]; for (let i=0;i<3000;i++){ const hi=Math.floor(i/300)%2===0; a.push(r() < (hi?0.8:0.15) ? 2+r()*3 : 1+r()*0.9); }
  const w=E.walkForward(a); assert.equal(w.better,true); assert.ok(w.skill>0.05);
});
test("prévisions vs résultats : chiffres cohérents et sans regard vers l'avenir", ()=>{
  const a=fairRounds(200, 5), w=E.walkForward(a); assert.equal(w.scored,170);
  const b=a.slice(); b[199]=1000; const w2=E.walkForward(b);   // changing the last round must not change any earlier estimate
  assert.ok(Math.abs(w.meanEstimate-w2.meanEstimate)<1e-12);
  assert.equal(E.walkForward(fairRounds(40,1)).status,"insufficient");
});
test("qualité : données propres = bonne", ()=>{ const q=E.dataQuality(fairRounds(500,8),0); assert.equal(q.level,"bonne", JSON.stringify(q.items.filter(x=>!x.ok))); });
test("qualité : données triées, doublons et illisibles détectés", ()=>{
  const sorted=fairRounds(300,2).sort((x,y)=>x-y), q=E.dataQuality(sorted, 60);
  assert.equal(q.level,"douteuse"); assert.ok(q.items.find(x=>x.label==="Ordre" && !x.ok)); assert.ok(q.items.find(x=>x.label==="Valeurs illisibles" && !x.ok));
  assert.ok(E.dataQuality([1.5,2,2,2,3],0).items.find(x=>x.label==="Valeurs répétées" && !x.ok));
  assert.equal(E.dataQuality([1.2,3],0).level,"insuffisante");
});
test("fenêtres : 10/50/100/500/tout", ()=>{ const w=E.windowStats(fairRounds(120,3)); assert.deepEqual(w.map(x=>x.n),[10,50,100,120,120]); });
test("historique des analyses : résultat suivant relié à l'estimation", ()=>{
  const a=fairRounds(60,4), sig={code:"history",title:"ANALYSE HISTORIQUE DISPONIBLE"};
  const e1=E.logEntry(a.slice(0,40), sig, 1), e2=E.logEntry(a, sig, 2);
  assert.equal(e1.n,40); assert.ok(e1.p2>0 && e1.p2<1);
  const s=E.scoreLog([e1,e2], a); assert.equal(s.rows[0].next, a[40]); assert.equal(s.rows[1].next, null); assert.equal(s.scored,1);
});
