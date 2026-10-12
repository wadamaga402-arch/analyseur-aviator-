// Minimal emulator of Telegram Serverless 'sdk' / 'sdk/db', built from the official docs
// (docs/tgcloud-sdk.md in @tgcloud/cli 0.2.0). Values go through JSON like a real json() column,
// so code that relies on shared object references would fail here too.
export const calls = [];
export const tables = new Map();      // table name -> Map(primaryKey -> row)
let failSend = false;
export function setFailSend(v) { failSend = v; }

export class BotApiError extends Error { constructor(code, description, method) { super(description); this.code = code; this.description = description; this.method = method; } }
export const api = new Proxy({}, { get: (_, method) => async (params) => {
  calls.push({ method, params: JSON.parse(JSON.stringify(params || {})) });
  if (method === "sendMessage") {
    if (failSend) throw new BotApiError(403, "Forbidden: bot was blocked by the user", method);
    if (typeof params.text !== "string" || !params.text.length) throw new BotApiError(400, "Bad Request: message text is empty", method);
    if (params.text.length > 4096) throw new BotApiError(400, "Bad Request: message is too long", method);
    return { message_id: calls.length };
  }
  return true;
} });

/* ---- schema DSL ---- */
function col(name, type) { return { name, type, pk: false, primaryKey() { this.pk = true; return this; }, notNull() { return this; }, default() { return this; }, unique() { return this; } }; }
export const text = n => col(n, "text"), integer = n => col(n, "integer"), json = n => col(n, "json"), real = n => col(n, "real");
export function table(name, cols) {
  const t = { __name: name, __cols: cols };
  for (const [k, c] of Object.entries(cols)) { c.table = name; c.prop = k; t[k] = c; }
  if (!tables.has(name)) tables.set(name, new Map());
  return t;
}
export const eq = (c, v) => ({ op: "eq", c, v });
const pkOf = t => Object.values(t.__cols).find(c => c.pk);
const store = (t, row) => { const out = {}; for (const [k, c] of Object.entries(t.__cols)) out[k] = row[k] === undefined ? null : (c.type === "json" ? JSON.stringify(row[k]) : row[k]); return out; };
const load = (t, raw) => { const out = {}; for (const [k, c] of Object.entries(t.__cols)) out[k] = c.type === "json" && raw[k] != null ? JSON.parse(raw[k]) : raw[k]; return out; };
const match = (row, cond) => !cond || row[cond.c.prop] === cond.v;

export const db = {
  select() { return { from(t) { let cond = null; const q = {
    where(c) { cond = c; return q; },
    async get() { for (const raw of tables.get(t.__name).values()) if (match(raw, cond)) return load(t, raw); return null; },
    async all() { return [...tables.get(t.__name).values()].filter(r => match(r, cond)).map(r => load(t, r)); },
  }; return q; } }; },
  insert(t) { return { values(row) { let conflict = null; const q = {
    onConflictDoUpdate(o) { conflict = o; return q; },
    async run() {
      const pk = pkOf(t), key = row[pk.prop], m = tables.get(t.__name);
      if (m.has(key)) { if (!conflict) throw new Error("UNIQUE constraint failed: " + t.__name + "." + pk.name); const cur = load(t, m.get(key)); m.set(key, store(t, Object.assign(cur, conflict.set))); }
      else m.set(key, store(t, row));
      return { rowsAffected: 1, lastInsertRowid: 0, rows: [] };
    } }; return q; } }; },
  delete(t) { let cond = null; const q = { where(c) { cond = c; return q; }, async run() { const m = tables.get(t.__name); let n = 0; for (const [k, r] of m) if (match(r, cond)) { m.delete(k); n++; } return { rowsAffected: n, rows: [] }; } }; return q; },
};
