// Who handles each sale.
//
// A new order from a customer nobody owns goes to the order pool: every team
// member who takes orders is told at once, and the first to accept it handles
// it. When they mark it finished, the sale is theirs (it counts in their numbers).
//
// A team member can claim a customer from an order they handle. Once the owner
// approves the claim, that customer's next orders go straight to them instead
// of the pool. Customers are keyed by account (u:12) or, for guests, by phone
// (p:254712345678).
//
// Team members also make their own invoices and receipts from the orders they
// handle. A receipt records the money as a collection, so it stays "with them"
// until the office confirms it.

import { ensureTables as ensureTeam, staffOf, log, record, ROLES } from "./team.js";
import * as docs from "./documents.js";

let ready = false;
async function ensureTables(env) {
  if (ready) return;
  await ensureTeam(env);
  await docs.ensureTable(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS customer_owners (
    customer_key TEXT PRIMARY KEY,               -- u:<user id> | p:<phone>
    label TEXT NOT NULL,                         -- name (company) when claimed
    phone TEXT,
    staff_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | rejected
    from_order TEXT,
    note TEXT,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  )`).run();
  ready = true;
}

function clean(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function kes(n) {
  return `KES ${Math.round(n).toLocaleString("en-KE")}`;
}

function phoneKey(raw) {
  let d = String(raw || "").replace(/[^0-9]/g, "");
  if (d.startsWith("0")) d = "254" + d.slice(1);
  else if (d.length === 9) d = "254" + d;
  return d;
}

export function customerKey(order) {
  return order.user_id ? `u:${order.user_id}` : `p:${phoneKey(order.phone)}`;
}

// The team members who take orders (they get pool alerts).
async function sellers(env) {
  const roles = Object.entries(ROLES).filter(([, r]) => r.can.includes("orders")).map(([k]) => k);
  const { results } = await env.DB.prepare(
    `SELECT user_id, username, full_name, phone FROM staff WHERE status = 'approved' AND role IN (${roles.map(() => "?").join(",")})`
  ).bind(...roles).all();
  return results;
}

// A new order: give it to the customer's own team member, or put it in the pool.
// Returns who to tell: { owner: staff } or { pool: [staff…] }.
export async function route(env, orderId) {
  await ensureTables(env);
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(orderId).first();
  if (!order || order.handler_id) return {};
  const own = await env.DB.prepare(
    `SELECT s.user_id, s.username, s.full_name, s.phone FROM customer_owners c JOIN staff s ON s.user_id = c.staff_id
     WHERE c.customer_key = ?1 AND c.status = 'approved' AND s.status = 'approved'`
  ).bind(customerKey(order)).first();
  if (own) {
    await env.DB.prepare("UPDATE orders SET handler_id = ?2, handled_at = datetime('now') WHERE id = ?1 AND handler_id IS NULL")
      .bind(order.id, own.user_id).run();
    await log(env, own.user_id, "order-routed", `${order.number} from their customer ${order.name} came straight to them`);
    return { order, owner: own };
  }
  return { order, pool: await sellers(env) };
}

const ORDER_COLS = `o.id, o.number, o.view_token, o.name, o.phone, o.email, o.user_id, o.delivery, o.town, o.notes, o.items_json,
  o.total, o.status, o.channel, o.created_at, o.handler_id, o.handled_at, o.finished_at, o.staff_id`;

function shapeOrder(o) {
  return {
    id: o.id, number: o.number, token: o.view_token, name: o.name, phone: o.phone, email: o.email, delivery: o.delivery,
    town: o.town, notes: o.notes, items: JSON.parse(o.items_json || "[]"), total: o.total, status: o.status,
    channel: o.channel, created_at: o.created_at, handled_at: o.handled_at, finished_at: o.finished_at,
    paid: o.paid || 0, job: o.job || null, claim: o.claim_status || null, claim_by: o.claim_by || null,
    customer: o.user_id ? "account" : "guest", company: o.company || null,
  };
}

// Orders waiting for someone to accept them.
export async function pool(env) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(
    `SELECT ${ORDER_COLS}, p.company FROM orders o LEFT JOIN partners p ON p.user_id = o.user_id
     WHERE o.handler_id IS NULL AND o.status IN ('new', 'confirmed', 'paid') AND o.created_at > datetime('now', '-30 days')
     ORDER BY o.id DESC LIMIT 50`
  ).all();
  return results.map(shapeOrder);
}

// What this person handles: open ones, and finished ones from the last 30 days.
export async function mine(env, userId) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(
    `SELECT ${ORDER_COLS}, p.company,
       (SELECT coalesce(sum(amount), 0) FROM collections WHERE order_id = o.id AND status != 'rejected') AS paid,
       (SELECT d.id FROM deliveries d WHERE d.order_id = o.id AND d.status IN ('assigned', 'on_way', 'delivered') ORDER BY d.id DESC LIMIT 1) AS job,
       c.status AS claim_status, cs.username AS claim_by
     FROM orders o LEFT JOIN partners p ON p.user_id = o.user_id
       LEFT JOIN customer_owners c ON c.customer_key = 'u:' || o.user_id
       LEFT JOIN staff cs ON cs.user_id = c.staff_id
     WHERE o.handler_id = ?1 AND o.status NOT IN ('cancelled', 'deleted') AND (o.finished_at IS NULL OR o.finished_at > datetime('now', '-30 days'))
     ORDER BY CASE WHEN o.finished_at IS NULL THEN 0 ELSE 1 END, o.id DESC LIMIT 60`
  ).bind(userId).all();
  // The phone key can't be built in SQL for guests, so fill guest claims in here.
  const out = results.map(shapeOrder);
  for (const o of out) {
    if (o.customer !== "guest") continue;
    const c = await env.DB.prepare(
      "SELECT c.status, s.username FROM customer_owners c JOIN staff s ON s.user_id = c.staff_id WHERE c.customer_key = ?1"
    ).bind(`p:${phoneKey(o.phone)}`).first();
    o.claim = c ? c.status : null;
    o.claim_by = c ? c.username : null;
  }
  return out;
}

export async function myCustomers(env, userId) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(
    "SELECT customer_key, label, phone, status, from_order, note, requested_at FROM customer_owners WHERE staff_id = ?1 AND status != 'rejected' ORDER BY label"
  ).bind(userId).all();
  return results;
}

async function handled(env, user, id) {
  return env.DB.prepare("SELECT * FROM orders WHERE id = ?1 AND handler_id = ?2").bind(Number(id), user.id).first();
}

export async function accept(env, user, staff, id) {
  await ensureTables(env);
  const row = await env.DB.prepare(
    `UPDATE orders SET handler_id = ?2, handled_at = datetime('now')
     WHERE id = ?1 AND handler_id IS NULL AND status NOT IN ('cancelled', 'deleted') RETURNING number, name`
  ).bind(Number(id), user.id).first();
  if (!row) {
    const o = await env.DB.prepare("SELECT o.number, s.username FROM orders o LEFT JOIN staff s ON s.user_id = o.handler_id WHERE o.id = ?1").bind(Number(id)).first();
    return { error: o && o.username ? `Too late: ${o.username} already accepted ${o.number}.` : "This order is no longer available." };
  }
  await log(env, user.id, "order-accepted", `Accepted ${row.number} (${row.name}) from the order pool`);
  return { ok: true, message: `${row.number} is yours. Call the customer, then deliver or arrange pick-up.` };
}

export async function release(env, user, id) {
  await ensureTables(env);
  const o = await handled(env, user, id);
  if (!o) return { error: "You don't handle this order." };
  if (o.finished_at) return { error: "This sale is already finished." };
  await env.DB.prepare("UPDATE orders SET handler_id = NULL, handled_at = NULL WHERE id = ?1").bind(o.id).run();
  await log(env, user.id, "order-released", `Gave ${o.number} back to the order pool`);
  return { ok: true, message: `${o.number} is back in the order pool for someone else.` };
}

export async function finish(env, user, id) {
  await ensureTables(env);
  const o = await handled(env, user, id);
  if (!o) return { error: "You don't handle this order." };
  if (o.finished_at) return { error: "Already finished." };
  if (o.status === "new") return { error: "The office hasn't confirmed this order yet. Finish it once it's confirmed, paid or delivered." };
  await env.DB.prepare("UPDATE orders SET finished_at = datetime('now') WHERE id = ?1").bind(o.id).run();
  await log(env, user.id, "sale-finished", `Finished ${o.number} for ${o.name}: ${kes(o.total)} counts as their sale`);
  return { ok: true, message: `Well done: ${o.number} (${kes(o.total)}) is counted as your sale.` };
}

// Ask to make an order's customer "mine". The owner approves it in the admin.
export async function claim(env, user, staff, id) {
  await ensureTables(env);
  const o = await handled(env, user, id);
  if (!o) return { error: "You can only claim customers of orders you handle." };
  const key = customerKey(o);
  const existing = await env.DB.prepare(
    "SELECT c.*, s.username FROM customer_owners c LEFT JOIN staff s ON s.user_id = c.staff_id WHERE c.customer_key = ?1"
  ).bind(key).first();
  if (existing && existing.status !== "rejected") {
    if (existing.staff_id === user.id) return { error: existing.status === "approved" ? "This is already your customer." : "You already asked for this customer. Waiting for the owner." };
    return { error: `${existing.username} has ${existing.status === "approved" ? "this customer" : "already asked for this customer"}.` };
  }
  let label = o.name;
  if (o.user_id) {
    const p = await env.DB.prepare("SELECT company FROM partners WHERE user_id = ?1").bind(o.user_id).first();
    if (p) label = `${p.company} (${o.name})`;
  }
  await env.DB.prepare(
    `INSERT INTO customer_owners (customer_key, label, phone, staff_id, status, from_order) VALUES (?1, ?2, ?3, ?4, 'pending', ?5)
     ON CONFLICT(customer_key) DO UPDATE SET label = ?2, phone = ?3, staff_id = ?4, status = 'pending', from_order = ?5,
       note = NULL, requested_at = datetime('now'), decided_at = NULL`
  ).bind(key, label.slice(0, 120), o.phone, user.id, o.number).run();
  await log(env, user.id, "customer-claimed", `Asked to make ${label} their customer (from ${o.number})`);
  return { ok: true, message: `Asked the owner to make ${label} your customer. Once approved, their orders come straight to you.` };
}

// ---- documents made by team members ---------------------------------------------------

// From an order this person handles: the order's products at the order's prices,
// plus optional service lines (installation, labour). No discounts.
export async function createDoc(env, user, staff, body) {
  await ensureTables(env);
  const o = await handled(env, user, body.order_id);
  if (!o) return { error: "Make invoices and receipts from an order you handle (My sales)." };
  const kind = body.kind === "receipt" ? "receipt" : "invoice";
  const items = JSON.parse(o.items_json || "[]").map((i) => ({ name: i.name, model: i.model, qty: i.qty, price: i.price }));
  for (const s of Array.isArray(body.services) ? body.services.slice(0, 10) : []) {
    const name = clean(s.name, 120);
    const price = Math.round(Number(s.price));
    const qty = Number(s.qty) || 1;
    if (name && price > 0) items.push({ name, model: "Service", qty, price });
  }
  const customer = { name: o.name, phone: o.phone, email: o.email || "", address: clean(body.address, 200) || o.town || "", pin: clean(body.pin, 20) };
  const actor = { email: user.email, staffName: staff ? staff.username : null, staffId: user.id };
  if (kind === "invoice") {
    const out = await docs.create(env, { kind, customer, items, order_id: o.id, against: o.number, due_date: body.due_date, notes: body.notes }, actor);
    if (out.ok) await log(env, user.id, "invoice", `Made invoice ${out.document.number} for ${o.number} (${o.name}): ${kes(out.document.total)}`);
    return out.ok ? { ok: true, id: out.document.id, number: out.document.number, message: `Invoice ${out.document.number} is ready.` } : out;
  }
  // A receipt is money received: record it first (it checks the method and code).
  const paid = Math.round(Number(body.amount));
  const note = body.notes || body.note;
  const coll = await record(env, user, { amount: paid, method: body.method, reference: body.reference, note, proof: body.proof, order_id: o.id });
  if (coll.error) return coll;
  const out = await docs.create(env, {
    kind, customer, items, order_id: o.id, against: o.number, paid, method: body.method === "Other" ? null : body.method,
    reference: body.reference, notes: note,
  }, actor);
  if (!out.ok) return out;
  await log(env, user.id, "receipt", `Made receipt ${out.document.number} for ${kes(paid)} on ${o.number}`);
  return { ok: true, id: out.document.id, number: out.document.number, collection: coll.collection,
    message: `Receipt ${out.document.number} is ready. The payment (C-${coll.collection.id}) waits for the office to confirm.` };
}

// ---- numbers for the charts ---------------------------------------------------------------

// Rows with a date -> one value per week (Monday start) or per month, oldest first.
export function buckets(rows, { by = "week", n = 8, date = "date", value = () => 1 }) {
  const now = new Date(Date.now() + 3 * 3600000);   // Nairobi
  const keys = [];
  if (by === "month") {
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      keys.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-KE", { month: "short", timeZone: "UTC" }) });
    }
  } else {
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(monday.getTime() - i * 7 * 86400000);
      keys.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" }) });
    }
  }
  const out = keys.map((k) => ({ ...k, value: 0 }));
  for (const r of rows) {
    if (!r[date]) continue;
    const t = new Date(String(r[date]).replace(" ", "T") + "Z").getTime() + 3 * 3600000;
    const d = new Date(t);
    let key;
    if (by === "month") key = d.toISOString().slice(0, 7);
    else key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
    const b = out.find((x) => x.key === key);
    if (b) b.value += value(r);
  }
  return out;
}

// This person's numbers, plus the team's sales this month for those who see the team.
export async function stats(env, userId, can) {
  await ensureTables(env);
  const [sales, jobs, money] = await Promise.all([
    env.DB.prepare("SELECT total, finished_at FROM orders WHERE handler_id = ?1 AND finished_at > datetime('now', '-60 days') AND status NOT IN ('cancelled', 'deleted')").bind(userId).all(),
    env.DB.prepare("SELECT done_at FROM deliveries WHERE staff_id = ?1 AND status = 'delivered' AND done_at > datetime('now', '-60 days')").bind(userId).all(),
    env.DB.prepare("SELECT method, amount, status FROM collections WHERE staff_id = ?1 AND status != 'rejected' AND created_at > datetime('now', '-30 days')").bind(userId).all(),
  ]);
  const byMethod = {};
  for (const c of money.results) byMethod[c.method] = (byMethod[c.method] || 0) + c.amount;
  const monthStart = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7);
  const out = {
    salesWeeks: buckets(sales.results, { date: "finished_at", value: (r) => r.total }),
    jobWeeks: buckets(jobs.results, { date: "done_at" }),
    methods: Object.entries(byMethod).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    salesMonth: sales.results.filter((r) => String(r.finished_at).slice(0, 7) === monthStart).reduce((n, r) => n + r.total, 0),
    countMonth: sales.results.filter((r) => String(r.finished_at).slice(0, 7) === monthStart).length,
    jobsMonth: jobs.results.filter((r) => String(r.done_at).slice(0, 7) === monthStart).length,
  };
  if (can.includes("team")) {
    const { results } = await env.DB.prepare(
      `SELECT s.username AS label, coalesce(sum(o.total), 0) AS value FROM staff s
       LEFT JOIN orders o ON o.handler_id = s.user_id AND o.finished_at >= date('now', 'start of month') AND o.status NOT IN ('cancelled', 'deleted')
       WHERE s.status = 'approved' GROUP BY s.user_id ORDER BY value DESC`
    ).all();
    out.teamMonth = results;
  }
  return out;
}

// ---- owner -----------------------------------------------------------------------------

export async function adminClaims(env) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(
    `SELECT c.*, s.username FROM customer_owners c JOIN staff s ON s.user_id = c.staff_id
     WHERE c.status IN ('pending', 'approved') ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.label`
  ).all();
  return results;
}

// approve | reject | remove (a customer goes back to the pool).
export async function adminDecideClaim(env, admin, body) {
  await ensureTables(env);
  const c = await env.DB.prepare("SELECT c.*, s.username FROM customer_owners c JOIN staff s ON s.user_id = c.staff_id WHERE c.customer_key = ?1")
    .bind(String(body.key || "")).first();
  if (!c) return { error: "Claim not found." };
  const status = { approve: "approved", reject: "rejected", remove: "rejected" }[body.decision];
  if (!status) return { error: "Unknown decision." };
  await env.DB.prepare("UPDATE customer_owners SET status = ?2, note = ?3, decided_at = datetime('now') WHERE customer_key = ?1")
    .bind(c.customer_key, status, clean(body.note, 200) || null).run();
  await log(env, admin.id, "customer-claim", `${c.label}: ${body.decision === "remove" ? "no longer" : status === "approved" ? "now" : "not"} ${c.username}'s customer`);
  return { ok: true, message: body.decision === "approve" ? `${c.label} is now ${c.username}'s customer. Their orders go straight to ${c.username}.`
    : body.decision === "remove" ? `${c.label} is no longer ${c.username}'s customer. Their orders go to the pool again.` : `Claim for ${c.label} declined.` };
}

// The owner moves an order to someone (or back to the pool with staff_id 0).
export async function adminSetHandler(env, admin, body) {
  await ensureTables(env);
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(Number(body.order_id)).first();
  if (!o) return { error: "Order not found." };
  const staffId = Number(body.staff_id) || null;
  let person = null;
  if (staffId) {
    person = await staffOf(env, staffId);
    if (!person || person.status !== "approved") return { error: "Choose someone on the team." };
  }
  await env.DB.prepare(
    "UPDATE orders SET handler_id = ?2, handled_at = CASE WHEN ?2 IS NULL THEN NULL ELSE datetime('now') END, finished_at = NULL WHERE id = ?1"
  ).bind(o.id, staffId).run();
  await log(env, admin.id, "order-handler", `${o.number} ${person ? `given to ${person.username}` : "put back in the order pool"}`);
  return { ok: true, message: person ? `${o.number} is now handled by ${person.username}.` : `${o.number} is back in the order pool.`, person, order: o };
}

// ---- removing orders (never erased: the owner sees who removed what, and can restore it) ----

// A team member removes an order they handle, or one from the pool (a duplicate or a fake).
// Orders with money already confirmed can't be removed from the team page.
export async function removeOrder(env, user, can, id, reason) {
  await ensureTables(env);
  const why = clean(reason, 200);
  if (!why) return { error: "Say why you are removing this order (e.g. duplicate, customer changed their mind)." };
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(Number(id)).first();
  if (!o || o.status === "deleted") return { error: "Order not found." };
  const mineOrPool = o.handler_id === user.id || (!o.handler_id && can.includes("orders"));
  if (!mineOrPool) return { error: "You can only remove orders you handle, or orders in the pool." };
  if (!["new", "confirmed"].includes(o.status)) return { error: `This order is ${o.status}, so only the owner can change it.` };
  const money = await env.DB.prepare("SELECT 1 FROM collections WHERE order_id = ?1 AND status != 'rejected'").bind(o.id).first();
  if (money) return { error: "Money was recorded on this order, so only the owner can cancel it." };
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE orders SET deleted_from = status, status = 'deleted', deleted_by = ?2, deleted_at = datetime('now'), delete_reason = ?3,
         updated_at = datetime('now') WHERE id = ?1`
    ).bind(o.id, user.id, why),
    env.DB.prepare("UPDATE deliveries SET status = 'cancelled', reason = 'Order removed', updated_at = datetime('now') WHERE order_id = ?1 AND status IN ('assigned', 'on_way')").bind(o.id),
  ]);
  await log(env, user.id, "order-removed", `Removed ${o.number} (${o.name}, ${kes(o.total)}): ${why}`);
  return { ok: true, removed: { number: o.number, name: o.name, total: o.total, reason: why },
    message: `${o.number} removed. The owner can see it and restore it if needed.` };
}

// The owner restores any removed order; a team member restores the ones they removed.
export async function restoreOrder(env, actor, id, owner) {
  await ensureTables(env);
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1 AND status = 'deleted'").bind(Number(id)).first();
  if (!o) return { error: "Removed order not found." };
  if (!owner && o.deleted_by !== actor.id) return { error: "Only the owner can restore an order someone else removed." };
  await env.DB.prepare(
    `UPDATE orders SET status = coalesce(deleted_from, 'new'), deleted_from = NULL, deleted_by = NULL, deleted_at = NULL,
       delete_reason = NULL, updated_at = datetime('now') WHERE id = ?1`
  ).bind(o.id).run();
  await log(env, actor.id, "order-restored", `Restored ${o.number} (${o.name}), removed earlier: ${o.delete_reason || ""}`);
  return { ok: true, message: `${o.number} is back (${o.deleted_from || "new"}).` };
}

// Removed orders: everyone's for the owner, or one person's.
export async function removedList(env, userId = null) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.number, o.name, o.phone, o.total, o.items_json, o.deleted_from, o.deleted_at, o.delete_reason, o.created_at,
       s.username AS deleted_by_name, o.deleted_by
     FROM orders o LEFT JOIN staff s ON s.user_id = o.deleted_by
     WHERE o.status = 'deleted' AND (?1 IS NULL OR o.deleted_by = ?1) ORDER BY o.deleted_at DESC LIMIT 100`
  ).bind(userId).all();
  return results.map((o) => ({
    id: o.id, number: o.number, name: o.name, phone: o.phone, total: o.total, was: o.deleted_from, at: o.deleted_at,
    reason: o.delete_reason, by: o.deleted_by_name || "Owner", created_at: o.created_at,
    items: JSON.parse(o.items_json || "[]").reduce((n, i) => n + i.qty, 0),
  }));
}

// ---- taking money from any customer -------------------------------------------------------

// Find open orders by phone or order number, to take a payment. Shows only what is
// needed to take the money: who, which order and what is still due, not what they bought.
export async function findForPayment(env, q) {
  await ensureTables(env);
  const text = clean(q, 30);
  const number = /^(ne-?)?\d{3,6}$/i.test(text) ? `NE-${text.replace(/\D/g, "")}` : null;
  const digits = text.replace(/\D/g, "");
  if (!number && digits.length < 6) return { error: "Type the customer's phone number (at least 6 digits) or the order number." };
  const tail = digits.replace(/^(254|0)/, "");
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.number, o.name, o.phone, o.total, o.status, o.created_at, p.company,
       (SELECT coalesce(sum(amount), 0) FROM collections WHERE order_id = o.id AND status != 'rejected') AS paid
     FROM orders o LEFT JOIN partners p ON p.user_id = o.user_id
     WHERE o.status IN ('new', 'confirmed', 'paid', 'delivered')
       AND (o.number = ?1 OR (?2 != '' AND replace(replace(replace(o.phone, ' ', ''), '-', ''), '+', '') LIKE '%' || ?2 || '%'))
     ORDER BY o.id DESC LIMIT 10`
  ).bind(number || "", number ? "" : tail).all();
  return {
    ok: true,
    results: results.map((o) => ({
      id: o.id, number: o.number, name: o.company || o.name, phone: `••• ${String(o.phone).replace(/\D/g, "").slice(-3)}`,
      total: o.total, paid: o.paid, due: Math.max(0, o.total - o.paid), status: o.status, created_at: o.created_at,
    })),
  };
}

// A simple receipt for money taken: "Payment received" against the order, no product list.
export async function paymentReceipt(env, user, staff, c) {
  await ensureTables(env);
  const o = c.order ? await env.DB.prepare("SELECT id, number, name, phone, email FROM orders WHERE number = ?1").bind(c.order).first() : null;
  const out = await docs.create(env, {
    kind: "receipt",
    customer: { name: c.partner || c.customer, phone: c.phone || (o && o.phone) || "", email: (o && o.email) || "" },
    items: [{ name: o ? `Payment for order ${o.number}` : "Payment received", model: "", qty: 1, price: c.amount }],
    order_id: o ? o.id : null, against: o ? o.number : "", paid: c.amount,
    method: ["M-Pesa", "Cash", "Bank transfer", "Card", "Cheque"].includes(c.method) ? c.method : null, reference: c.reference, notes: c.note,
  }, { email: user.email, staffName: staff ? staff.username : null, staffId: user.id });
  if (out.ok) await log(env, user.id, "receipt", `Made receipt ${out.document.number} for ${kes(c.amount)} (C-${c.id})`);
  return out.ok ? out.document : null;
}
