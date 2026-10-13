// Fake Deriv API (subset used by Digit Pro), for automated tests only. Follows the 2026 API (developers.deriv.com):
//   REST  GET  /trading/v1/options/accounts            (Authorization: Bearer <PAT>, Deriv-App-ID)
//   REST  POST /trading/v1/options/accounts/{id}/otp    → { data: { url: ".../ws/demo?otp=…" } }  (OTP single use)
//   WS    /trading/v1/options/ws/public                 ticks, ticks_history, contracts_for (no proposal/buy)
//   WS    /trading/v1/options/ws/demo|real?otp=…        + balance, proposal (underlying_symbol), buy, proposal_open_contract, portfolio, profit_table
// HTTP control on CTRL_PORT: /drop, /dropOnNextBuy, /digits?mode=fair|even|odd|bias, /stats, /reset
import { WebSocketServer } from "ws";
import http from "node:http";
import { randomBytes } from "node:crypto";

export function startMock({ port = 18990, ctrlPort = 18991, tickMs = 120 } = {}) {
  let rnd = 12345; const r = () => { rnd ^= rnd << 13; rnd >>>= 0; rnd ^= rnd >> 17; rnd ^= rnd << 5; rnd >>>= 0; return rnd / 4294967296; };
  const accounts = { "demo-token-123": { loginid: "DOT90004580", is_virtual: 1, currency: "USD", balance: 10000 }, "real-token-456": { loginid: "CR7654321", is_virtual: 0, currency: "USD", balance: 50 } };
  const APP_ID = "12345", otps = new Map();
  const RATIO = { DIGITMATCH: 8.5, DIGITDIFF: 1.06, DIGITEVEN: 1.95, DIGITODD: 1.95 };
  let mode = "fair", price = 9494.76, nextId = 5000, dropOnNextBuy = false;
  const stats = { buys: 0, proposals: 0, authorizes: 0, connections: 0 };
  const proposals = new Map(), contracts = new Map();
  const clients = new Set();
  const nextDigit = () => {
    if (mode === "even") return [0, 2, 4, 6, 8][Math.floor(r() * 5)];
    if (mode === "odd") return [1, 3, 5, 7, 9][Math.floor(r() * 5)];
    if (mode === "bias") return r() < 0.4 ? 4 : Math.floor(r() * 10);
    return Math.floor(r() * 10);
  };
  const quoteWith = d => { const base = Math.floor(price * 10) / 10; price = base + d / 100 + (r() < 0.5 ? -0.1 : 0.1); price = Math.round(price * 100) / 100; if (Math.round(price * 100) % 10 !== d) price = Math.floor(price * 10) / 10 + d / 100; return Math.round(price * 100) / 100; };
  const history = []; for (let i = 0; i < 6000; i++) history.push(quoteWith(nextDigit()));
  const rebuildHistory = () => { history.length = 0; for (let i = 0; i < 6000; i++) history.push(quoteWith(nextDigit())); };
  const wins = (c, d) => c.type === "DIGITMATCH" ? d === c.barrier : c.type === "DIGITDIFF" ? d !== c.barrier : c.type === "DIGITEVEN" ? d % 2 === 0 : d % 2 === 1;
  const pocMsg = c => ({ contract_id: c.id, is_sold: c.sold ? 1 : 0, status: c.sold ? (c.won ? "won" : "lost") : "open", profit: c.sold ? c.profit : 0, buy_price: c.stake, payout: c.payout, exit_tick_display_value: c.exit != null ? c.exit.toFixed(2) : undefined, contract_type: c.type, purchase_time: c.purchase_time });

  const tick = () => {
    const q = quoteWith(nextDigit()); history.push(q); if (history.length > 8000) history.shift();
    const d = Math.round(q * 100) % 10;
    for (const c of contracts.values()) if (!c.sold) {
      c.sold = true; c.exit = q; c.won = wins(c, d); c.profit = c.won ? Math.round((c.payout - c.stake) * 100) / 100 : -c.stake;
      const acc = accounts[c.token]; if (c.won) acc.balance = Math.round((acc.balance + c.payout) * 100) / 100;
      for (const cl of clients) { if (cl.token === c.token) { for (const sub of cl.pocSubs) if (sub.id === c.id) cl.send({ msg_type: "proposal_open_contract", proposal_open_contract: pocMsg(c), req_id: sub.req_id, subscription: { id: "poc" + c.id } }); if (cl.balSub) cl.send({ msg_type: "balance", balance: { balance: acc.balance, currency: acc.currency } }); } }
    }
    for (const cl of clients) if (cl.tickSym) cl.send({ msg_type: "tick", tick: { quote: q, epoch: Math.floor(Date.now() / 1000) }, req_id: cl.tickReq, subscription: { id: "t1" } });
  };
  const timer = setInterval(tick, tickMs);

  const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body)); };
  const restErr = (res, code, message) => json(res, code, { errors: [{ status: code, code: "Error", message }], meta: {} });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, deriv-app-id", "access-control-allow-methods": "GET, POST" }); return res.end(); }
    const tok = (req.headers.authorization || "").replace(/^Bearer /, ""), a = accounts[tok];
    if (!a) return restErr(res, 401, "Invalid or missing authentication credentials");
    if (req.headers["deriv-app-id"] !== APP_ID) return restErr(res, 401, "Deriv-App-ID header is required for PAT tokens");
    if (req.method === "GET" && u.pathname === "/trading/v1/options/accounts")
      return json(res, 200, { data: [{ account_id: a.loginid, balance: a.balance, currency: a.currency, group: "row", status: "active", account_type: a.is_virtual ? "demo" : "real" }], meta: { endpoint: "/accounts", method: "GET", timing: 5 } });
    const m = u.pathname.match(/^\/trading\/v1\/options\/accounts\/([^/]+)\/otp$/);
    if (req.method === "POST" && m) {
      if (m[1] !== a.loginid) return restErr(res, 400, "Invalid account ID format");
      const otp = randomBytes(8).toString("hex"); otps.set(otp, tok);
      return json(res, 200, { data: { url: `ws://127.0.0.1:${port}/trading/v1/options/ws/${a.is_virtual ? "demo" : "real"}?otp=${otp}` }, meta: {} });
    }
    return restErr(res, 404, "Not found");
  }).listen(port);
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    const u = new URL(req.url, "http://x"), kind = (u.pathname.match(/\/ws\/(public|demo|real)$/) || [])[1];
    const otpTok = u.searchParams.get("otp") ? otps.get(u.searchParams.get("otp")) : null;
    if (u.searchParams.get("otp")) otps.delete(u.searchParams.get("otp"));      // single use
    if (!kind || (kind !== "public" && !otpTok)) { ws.close(4001, "invalid otp"); return; }
    stats.connections++;
    const cl = { ws, token: kind === "public" ? null : otpTok, tickSym: null, pocSubs: [], balSub: false, send: m => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
    clients.add(cl); ws.on("close", () => clients.delete(cl));
    ws.on("message", raw => {
      const m = JSON.parse(raw), id = m.req_id, reply = (type, body) => cl.send(Object.assign({ msg_type: type, echo_req: m, req_id: id }, body));
      const err = (type, code, message) => reply(type, { error: { code, message } });
      const only = (type, keys) => { const bad = Object.keys(m).filter(k => !keys.includes(k)); if (bad.length) { err(type, "InputValidationFailed", "Properties not allowed: " + bad.join(", ")); return false; } return true; };
      if (m.ping) return reply("ping", { ping: "pong" });
      if (!cl.token && (m.balance || m.proposal || m.buy || m.proposal_open_contract || m.portfolio || m.profit_table)) return err(Object.keys(m)[0], "AuthorizationRequired", "Please log in.");
      if (m.balance) { if (!cl.token) return err("balance", "AuthorizationRequired", "Please log in."); cl.balSub = !!m.subscribe; const a = accounts[cl.token]; return reply("balance", { balance: { balance: a.balance, currency: a.currency } }); }
      if (m.forget_all) { cl.tickSym = null; return reply("forget_all", { forget_all: [] }); }
      if (m.ticks_history) {
        if (!only("history", ["ticks_history", "adjust_start_time", "count", "end", "granularity", "start", "style", "subscribe", "passthrough", "req_id"])) return;
        if (m.ticks_history === "R_BAD") return err("history", "MarketIsClosed", "This market is presently closed.");
        const prices = history.slice(-Math.min(m.count || 1000, 5000));
        if (m.subscribe) { cl.tickSym = m.ticks_history; cl.tickReq = id; }
        return reply("history", { history: { prices, times: prices.map((_, i) => i) }, pip_size: 2, subscription: m.subscribe ? { id: "t1" } : undefined });
      }
      if (m.contracts_for) return only("contracts_for", ["contracts_for", "passthrough", "req_id"]) && reply("contracts_for", { contracts_for: { available: ["DIGITMATCH", "DIGITDIFF", "DIGITEVEN", "DIGITODD", "CALL"].map(t => ({ contract_type: t, contract_category: t === "CALL" ? "callput" : "digits" })) } });
      if (m.proposal) {
        stats.proposals++;
        if (!only("proposal", ["proposal", "amount", "basis", "contract_type", "currency", "duration", "duration_unit", "barrier", "underlying_symbol", "subscribe", "passthrough", "req_id"])) return;
        if (!m.underlying_symbol || !m.currency) return err("proposal", "InputValidationFailed", "underlying_symbol and currency are required");
        const ratio = RATIO[m.contract_type]; if (!ratio) return err("proposal", "ContractBuyValidationError", "Invalid contract type");
        if ((m.contract_type === "DIGITMATCH" || m.contract_type === "DIGITDIFF") && !/^\d$/.test(String(m.barrier))) return err("proposal", "ContractCreationFailure", "Invalid barrier");
        const pid = "prop" + (nextId++); const payout = Math.round(m.amount * ratio * 100) / 100;
        proposals.set(pid, { type: m.contract_type, barrier: m.barrier != null ? +m.barrier : null, stake: m.amount, payout });
        return reply("proposal", { proposal: { id: pid, ask_price: m.amount, payout, longcode: "test" } });
      }
      if (m.buy) {
        if (!cl.token) return err("buy", "AuthorizationRequired", "Please log in.");
        const p = proposals.get(m.buy); if (!p) return err("buy", "InvalidContractProposal", "Proposal expired");
        proposals.delete(m.buy);
        const a = accounts[cl.token]; if (a.balance < p.stake) return err("buy", "InsufficientBalance", "Insufficient balance");
        stats.buys++; a.balance = Math.round((a.balance - p.stake) * 100) / 100;
        const c = { id: nextId++, ...p, token: cl.token, purchase_time: Math.floor(Date.now() / 1000), sold: false };
        contracts.set(c.id, c);
        if (dropOnNextBuy) { dropOnNextBuy = false; ws.terminate(); return; }   // purchase done, response lost
        return reply("buy", { buy: { contract_id: c.id, buy_price: c.stake, payout: c.payout, balance_after: a.balance, transaction_id: c.id * 10, purchase_time: c.purchase_time } });
      }
      if (m.proposal_open_contract) {
        const c = contracts.get(m.contract_id); if (!c || c.token !== cl.token) return err("proposal_open_contract", "ContractNotFound", "Not found");
        if (m.subscribe) cl.pocSubs.push({ id: c.id, req_id: id });
        return reply("proposal_open_contract", { proposal_open_contract: pocMsg(c), subscription: m.subscribe ? { id: "poc" + c.id } : undefined });
      }
      if (m.portfolio) return reply("portfolio", { portfolio: { contracts: [...contracts.values()].filter(c => c.token === cl.token && !c.sold).map(c => ({ contract_id: c.id, contract_type: c.type, buy_price: c.stake, payout: c.payout, purchase_time: c.purchase_time })) } });
      if (m.profit_table) return reply("profit_table", { profit_table: { transactions: [...contracts.values()].filter(c => c.token === cl.token && c.sold).sort((a, b) => b.id - a.id).slice(0, m.limit || 5).map(c => ({ contract_id: c.id, buy_price: c.stake, payout: c.payout, sell_price: c.won ? c.payout : 0, purchase_time: c.purchase_time })) } });
      return err("error", "UnrecognisedRequest", "Unrecognised request");
    });
  });

  const ctrl = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/drop") for (const c of clients) c.ws.terminate();
    if (u.pathname === "/dropOnNextBuy") dropOnNextBuy = true;
    if (u.pathname === "/digits") { mode = u.searchParams.get("mode") || "fair"; rebuildHistory(); }
    if (u.pathname === "/reset") { stats.buys = 0; stats.proposals = 0; mode = "fair"; dropOnNextBuy = false; rebuildHistory(); }
    res.setHeader("content-type", "application/json"); res.setHeader("access-control-allow-origin", "*");
    res.end(JSON.stringify({ ...stats, mode, balances: Object.fromEntries(Object.entries(accounts).map(([k, a]) => [a.loginid, a.balance])) }));
  }).listen(ctrlPort);

  return { close() { clearInterval(timer); for (const c of clients) c.ws.terminate(); wss.close(); server.close(); ctrl.close(); }, stats };
}
