// Digit Pro — moteur d'analyse et règles de session (fonctions pures, testables).
// Ce fichier est inclus tel quel dans digit-pro/index.html par scripts/build-digit-pro.mjs.

export const STRATEGIES = {
  matches: { label: "Matches (chiffre le plus fréquent)", type: "DIGITMATCH", needsDigit: true, p: 0.1 },
  differs: { label: "Differs (chiffre le moins fréquent)", type: "DIGITDIFF", needsDigit: true, p: 0.9 },
  even:    { label: "Even (pair)", type: "DIGITEVEN", needsDigit: false, p: 0.5 },
  odd:     { label: "Odd (impair)", type: "DIGITODD", needsDigit: false, p: 0.5 },
};
export const MARKETS = [
  { symbol: "R_10", label: "Volatility 10 Index" }, { symbol: "1HZ10V", label: "Volatility 10 (1s) Index" },
  { symbol: "R_25", label: "Volatility 25 Index" }, { symbol: "1HZ25V", label: "Volatility 25 (1s) Index" },
  { symbol: "R_50", label: "Volatility 50 Index" }, { symbol: "1HZ50V", label: "Volatility 50 (1s) Index" },
  { symbol: "R_75", label: "Volatility 75 Index" }, { symbol: "1HZ75V", label: "Volatility 75 (1s) Index" },
  { symbol: "R_100", label: "Volatility 100 Index" }, { symbol: "1HZ100V", label: "Volatility 100 (1s) Index" },
];
export const DEFAULTS = { stake: 1, maxTrades: 5, profitTarget: 2, maxLoss: 5, pauseSec: 3, maxExposure: 5, window: 100 };

export function lastDigit(quote, pip) { const s = Number(quote).toFixed(pip); return +s[s.length - 1]; }
export function digitCounts(d) { const c = new Array(10).fill(0); for (const x of d) c[x]++; return c; }

/* ---- statistics ---- */
function lgamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5; for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
export function gammaQ(a, x) {
  if (x <= 0) return 1;
  const lead = -x + a * Math.log(x) - lgamma(a);
  if (x < a + 1) { let ap = a, sum = 1 / a, del = sum; for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; } return Math.max(0, 1 - sum * Math.exp(lead)); }
  const tiny = 1e-300; let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < tiny) d = tiny; c = b + an / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break; }
  return Math.min(1, Math.exp(lead) * h);
}
export function chiSquareDigits(counts) {
  const n = counts.reduce((a, b) => a + b, 0); if (n < 50) return null;
  const e = n / 10; let chi = 0; for (const o of counts) chi += (o - e) * (o - e) / e;
  return { chi, df: 9, p: gammaQ(4.5, chi / 2), n };
}
export function wilson(k, n, z = 1.96) {
  if (!n) return [NaN, NaN];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), r = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

/* ---- strategy rules ---- */
// Decide the contract from the last `window` digits only (never the digit being predicted).
export function pick(strategy, win) {
  const s = STRATEGIES[strategy]; if (!s) throw new Error("stratégie inconnue");
  if (!s.needsDigit) return { type: s.type, barrier: null };
  const c = digitCounts(win); let best = 0;
  for (let d = 1; d < 10; d++) if (strategy === "matches" ? c[d] > c[best] : c[d] < c[best]) best = d;
  return { type: s.type, barrier: best };
}
export function wins(type, barrier, digit) {
  if (type === "DIGITMATCH") return digit === barrier;
  if (type === "DIGITDIFF") return digit !== barrier;
  if (type === "DIGITEVEN") return digit % 2 === 0;
  if (type === "DIGITODD") return digit % 2 === 1;
  throw new Error("type inconnu");
}
// payoutRatio = payout / stake as quoted by Deriv (e.g. Matches ≈ 9.x, Even ≈ 1.95)
export function backtest(digits, strategy, N, payoutRatio, from, to) {
  let n = 0, w = 0;
  for (let t = Math.max(from, N); t < to; t++) {
    const p = pick(strategy, digits.slice(t - N, t));
    n++; if (wins(p.type, p.barrier, digits[t])) w++;
  }
  const hit = n ? w / n : NaN, ci = wilson(w, n);
  return { n, wins: w, losses: n - w, hit, hitCI: ci, roi: hit * payoutRatio - 1, roiCI: [ci[0] * payoutRatio - 1, ci[1] * payoutRatio - 1] };
}
export const VALID = { minDigits: 600, trainFrac: 0.6, windows: [25, 50, 100, 200], minTest: 300 };
// payoutRatio = payout / stake quoted by Deriv. Without an account Deriv gives no quote: pass null, and the rule is
// tested against a fair (no-margin) payout 1/p — "beats chance" only, which is necessary but NOT sufficient.
export function validateStrategy(digits, strategy, payoutRatio) {
  const n = digits.length, s = STRATEGIES[strategy];
  const payoutKnown = payoutRatio != null;
  if (!payoutKnown) payoutRatio = 1 / s.p;
  const theoEV = payoutKnown ? s.p * payoutRatio - 1 : null;
  if (!(payoutRatio > 1)) return { status: "error", reason: "Paiement Deriv invalide : impossible d'évaluer la stratégie." };
  if (n < VALID.minDigits) return { status: "insufficient", n, need: VALID.minDigits, theoEV, payoutKnown };
  const split = Math.floor(n * VALID.trainFrac);
  let best = null;
  for (const N of VALID.windows) {
    if (N >= split) continue;
    const tr = backtest(digits, strategy, N, payoutRatio, N, split);
    if (!best || tr.hit > best.train.hit) best = { N, train: tr };
  }
  const test = backtest(digits, strategy, best.N, payoutRatio, split, n);
  const edge = test.n >= VALID.minTest && test.roiCI[0] > 0;
  return { status: "done", n, split, N: best.N, train: best.train, test, theoP: s.p, theoEV, payoutRatio, payoutKnown, edge,
    fit: chiSquareDigits(digitCounts(digits)) };
}

/* ---- session rules ---- */
export function validateParams(p) {
  const e = [];
  const num = (k, lo, hi, label) => { const v = p[k]; if (!(typeof v === "number" && isFinite(v)) || v < lo || v > hi) e.push(`${label} : entre ${lo} et ${hi}`); };
  num("stake", 0.35, 1000, "Mise"); num("maxTrades", 1, 100, "Nombre maximal de transactions");
  num("profitTarget", 0.01, 100000, "Objectif de bénéfice"); num("maxLoss", 0.35, 100000, "Perte maximale");
  num("pauseSec", 1, 3600, "Pause entre transactions (s)"); num("maxExposure", 0.35, 100000, "Montant maximal exposé");
  num("window", 10, 1000, "Ticks analysés");
  if (!e.length && p.stake > p.maxLoss) e.push("La mise ne peut pas dépasser la perte maximale.");
  if (!e.length && p.stake > p.maxExposure) e.push("La mise ne peut pas dépasser le montant maximal exposé.");
  if (p.maxTrades % 1) e.push("Nombre maximal de transactions : nombre entier.");
  return e;
}
// Checked after every settled contract
export function stopReason(st, p) {
  if (st.done >= p.maxTrades) return `${st.done}/${p.maxTrades} transactions terminées`;
  if (st.net >= p.profitTarget) return `objectif de bénéfice atteint (${st.net.toFixed(2)})`;
  if (st.net <= -p.maxLoss) return `perte maximale atteinte (${st.net.toFixed(2)})`;
  return null;
}
// Checked before every purchase: the worst case of the next trade must stay inside the limits
export function canBuy(st, p, balance) {
  const r = stopReason(st, p); if (r) return { ok: false, reason: r };
  if (st.open) return { ok: false, reason: "un contrat est déjà ouvert" };
  if (st.net - p.stake < -p.maxLoss - 1e-9) return { ok: false, reason: "la prochaine mise pourrait dépasser la perte maximale" };
  if (p.stake > p.maxExposure) return { ok: false, reason: "mise supérieure au montant maximal exposé" };
  if (!(balance >= p.stake)) return { ok: false, reason: "solde insuffisant" };
  return { ok: true };
}
