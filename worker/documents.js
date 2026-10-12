// Invoices and receipts the admin issues to customers and partners.
//
// Numbers run separately per kind: INV-1001, INV-1002 … and RCT-1001 … A
// document can start from an order (its items and customer are copied) or be
// typed in from scratch. Documents are never deleted, only voided, so the
// numbering has no gaps.

const KINDS = { invoice: "INV", receipt: "RCT" };
const METHODS = ["M-Pesa", "Cash", "Bank transfer", "Card", "Cheque"];

let ready = false;
async function ensureTable(env) {
  if (ready) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,                        -- invoice | receipt
    seq INTEGER NOT NULL,
    number TEXT NOT NULL UNIQUE,               -- INV-1001 / RCT-1001
    order_id INTEGER,
    against TEXT,                              -- receipt: the invoice or order it pays
    customer_json TEXT NOT NULL,               -- {name, phone, email, pin, address}
    items_json TEXT NOT NULL,                  -- [{name, model, qty, price}]
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,           -- invoice: paid so far; receipt: amount received
    method TEXT,
    reference TEXT,                            -- e.g. M-Pesa code
    due_date TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'issued',     -- issued | void
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  ready = true;
}

function clean(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function shape(row) {
  return {
    id: row.id, kind: row.kind, number: row.number, order_id: row.order_id, against: row.against,
    customer: JSON.parse(row.customer_json), items: JSON.parse(row.items_json), subtotal: row.subtotal,
    discount: row.discount, total: row.total, paid: row.paid, balance: Math.max(0, row.total - row.paid),
    method: row.method, reference: row.reference, due_date: row.due_date, notes: row.notes, status: row.status,
    created_by: row.created_by, created_at: row.created_at,
  };
}

export async function list(env, q) {
  await ensureTable(env);
  const like = `%${clean(q, 60)}%`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM documents WHERE ?1 = '%%' OR number LIKE ?1 OR customer_json LIKE ?1 OR against LIKE ?1
     ORDER BY id DESC LIMIT 200`
  ).bind(like).all();
  return { documents: results.map(shape), methods: METHODS };
}

export async function get(env, id) {
  await ensureTable(env);
  const row = await env.DB.prepare("SELECT * FROM documents WHERE id = ?1").bind(id).first();
  return row ? shape(row) : null;
}

export async function create(env, body, admin) {
  await ensureTable(env);
  const kind = KINDS[body.kind] ? body.kind : null;
  if (!kind) return { error: "Choose invoice or receipt." };
  const c = body.customer || {};
  const customer = {
    name: clean(c.name, 100), phone: clean(c.phone, 30), email: clean(c.email, 120),
    pin: clean(c.pin, 20).toUpperCase(), address: clean(c.address, 200),
  };
  if (!customer.name) return { error: "Enter the customer's name." };
  const items = [];
  for (const line of Array.isArray(body.items) ? body.items.slice(0, 100) : []) {
    const name = clean(line.name, 160);
    const qty = Number(line.qty);
    const price = Math.round(Number(line.price));
    if (!name || !(qty > 0 && qty <= 99999) || !(price >= 0)) continue;
    items.push({ name, model: clean(line.model, 80), qty, price });
  }
  if (!items.length) return { error: "Add at least one item with a quantity and price." };
  const subtotal = Math.round(items.reduce((n, i) => n + i.qty * i.price, 0));
  const discount = Math.max(0, Math.min(subtotal, Math.round(Number(body.discount) || 0)));
  const total = subtotal - discount;
  const paid = Math.max(0, Math.round(Number(body.paid) || 0));
  if (kind === "receipt" && !(paid > 0)) return { error: "Enter the amount received." };
  const method = METHODS.includes(body.method) ? body.method : null;
  const due = /^\d{4}-\d{2}-\d{2}$/.test(body.due_date || "") ? body.due_date : null;
  const orderId = Number.isInteger(body.order_id) ? body.order_id : null;

  const { seq } = await env.DB.prepare("SELECT coalesce(max(seq), 1000) + 1 AS seq FROM documents WHERE kind = ?1").bind(kind).first();
  const number = `${KINDS[kind]}-${seq}`;
  const row = await env.DB.prepare(
    `INSERT INTO documents (kind, seq, number, order_id, against, customer_json, items_json, subtotal, discount, total,
       paid, method, reference, due_date, notes, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16) RETURNING *`
  ).bind(kind, seq, number, orderId, clean(body.against, 40) || null, JSON.stringify(customer), JSON.stringify(items),
    subtotal, discount, total, paid, method, clean(body.reference, 60) || null, due, clean(body.notes, 800) || null,
    admin.email).first();
  return { ok: true, document: shape(row) };
}

export async function setVoid(env, id) {
  await ensureTable(env);
  const row = await env.DB.prepare("UPDATE documents SET status = 'void' WHERE id = ?1 RETURNING number").bind(id).first();
  return row ? { ok: true, message: `${row.number} is now void.` } : { error: "Document not found." };
}
