import test from "node:test"; import assert from "node:assert/strict";
import * as D from "../digit-pro/engine.js";
function rng(seed){ let x=seed>>>0; return ()=>{ x^=x<<13; x>>>=0; x^=x>>17; x^=x<<5; x>>>=0; return x/4294967296; }; }
const fair = (n, seed) => { const r = rng(seed); return Array.from({ length: n }, () => Math.floor(r() * 10)); };

test("dernier chiffre selon la précision", () => { assert.equal(D.lastDigit(9494.76, 2), 6); assert.equal(D.lastDigit(1234.5, 3), 0); assert.equal(D.lastDigit(10.1, 2), 0); });
test("khi² à 9 ddl : valeur de référence", () => { assert.ok(Math.abs(D.gammaQ(4.5, 16.919 / 2) - 0.05) < 0.001); });
test("pick n'utilise que la fenêtre passée", () => {
  assert.deepEqual(D.pick("matches", [4, 4, 1, 2]), { type: "DIGITMATCH", barrier: 4 });
  assert.equal(D.pick("differs", [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1]).barrier, 9);
  assert.deepEqual(D.pick("even", [1, 3]), { type: "DIGITEVEN", barrier: null });
});
test("règles de gain des contrats", () => {
  assert.ok(D.wins("DIGITMATCH", 4, 4)); assert.ok(!D.wins("DIGITDIFF", 4, 4)); assert.ok(D.wins("DIGITEVEN", null, 0)); assert.ok(D.wins("DIGITODD", null, 7));
});
test("chiffres équitables : aucune stratégie validée (20 essais × 4 stratégies)", () => {
  const ratios = { matches: 9.5, differs: 1.06, even: 1.95, odd: 1.95 }; let edges = 0;
  for (let s = 1; s <= 20; s++) { const d = fair(3000, s * 13); for (const k of Object.keys(ratios)) { const v = D.validateStrategy(d, k, ratios[k]); assert.equal(v.status, "done"); if (v.edge) edges++; } }
  assert.ok(edges <= 2, "faux avantages : " + edges);
});
test("valeur théorique négative avec les paiements Deriv", () => {
  const v = D.validateStrategy(fair(1000, 3), "matches", 8.5); assert.ok(Math.abs(v.theoEV - (-0.15)) < 1e-9);
  assert.ok(D.validateStrategy(fair(1000, 3), "even", 1.95).theoEV < 0);
});
test("un vrai biais est détecté hors échantillon", () => {
  const r = rng(7), d = Array.from({ length: 3000 }, () => r() < 0.3 ? 4 : Math.floor(r() * 10));   // 4 sort ~37 % du temps
  const v = D.validateStrategy(d, "matches", 9.5); assert.equal(v.edge, true); assert.ok(v.test.roi > 0);
});
test("pas assez de ticks", () => { assert.equal(D.validateStrategy(fair(300, 1), "even", 1.95).status, "insufficient"); });
test("paramètres vérifiés", () => {
  assert.deepEqual(D.validateParams(D.DEFAULTS), []);
  assert.ok(D.validateParams({ ...D.DEFAULTS, stake: 10, maxLoss: 5 }).some(e => /perte maximale/.test(e)));
  assert.ok(D.validateParams({ ...D.DEFAULTS, maxTrades: 0 }).length);
  assert.ok(D.validateParams({ ...D.DEFAULTS, stake: "1" }).length);
});
test("arrêt après exactement 5 transactions, objectif, perte max", () => {
  const p = D.DEFAULTS;
  assert.equal(D.stopReason({ done: 4, net: 0 }, p), null); assert.match(D.stopReason({ done: 5, net: 0 }, p), /5\/5/);
  assert.match(D.stopReason({ done: 2, net: 2 }, p), /objectif/); assert.match(D.stopReason({ done: 2, net: -5 }, p), /perte maximale/);
});
test("avant achat : pire cas, contrat ouvert, solde", () => {
  const p = { ...D.DEFAULTS, maxLoss: 3, stake: 1 };
  assert.equal(D.canBuy({ done: 0, net: -2.5, open: false }, p, 100).ok, false);
  assert.equal(D.canBuy({ done: 0, net: 0, open: true }, p, 100).ok, false);
  assert.equal(D.canBuy({ done: 0, net: 0, open: false }, p, 0.5).ok, false);
  assert.equal(D.canBuy({ done: 0, net: 0, open: false }, p, 100).ok, true);
});
