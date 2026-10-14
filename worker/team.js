// The NE team area (/team): staff sign in with Google, choose a username and
// wait for the owner to approve them and give them a role. Staff take orders
// at website prices, do the deliveries assigned to them and record the money
// they collect. Every collection stays "pending" until the owner (or finance)
// confirms the money reached NE, so each person's cash in hand is always known.
//
// Staff can never change prices, WhatsApp settings, partners or products: that
// stays in /admin, which only the owner can open.
//
// Tables (created on first use):
//   staff        one row per person (user_id = users.id)
//   deliveries   a delivery job for one order, assigned to one person
//   collections  money a person collected (cash, M-Pesa, bank…)
// Every action is also written to audit_log under the person's user id.

import { ensureTables as ensurePartners } from "./partners.js";

export const ROLES = {
  staff: { label: "Sales & delivery", can: ["orders"] },
  operations: { label: "Operations", can: ["orders", "dispatch"] },
  finance: { label: "Finance", can: ["confirm"] },
  hr: { label: "HR", can: ["team"] },
  management: { label: "Management", can: ["orders", "dispatch", "confirm", "team"] },
};
const OWNER = ["orders", "dispatch", "confirm", "team"];
export const METHODS = ["Cash", "M-Pesa", "Bank transfer", "Cheque", "Card", "Other"];
const PARTNER_METHODS = ["M-Pesa", "Bank transfer", "Cash", "Cheque", "Card"];   // accounts.METHODS
const MAX_PROOF = 1_500_000;
const DELIVERY = { pickup: "Pick up at the NE showroom", nairobi: "Delivery in Nairobi (free)", outside: "Outside Nairobi" };

let ready = false;
export async function ensureTables(env) {
  if (ready) return;
  await ensurePartners(env);
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS staff (
      user_id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      wanted TEXT,                                -- the job they said they do
      role TEXT,                                  -- set by the owner (ROLES)
      status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected | suspended
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      staff_id INTEGER NOT NULL,
      address TEXT,
      map_url TEXT,
      collect INTEGER NOT NULL DEFAULT 0,         -- KES to collect from the customer
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'assigned',    -- assigned | on_way | delivered | failed | cancelled
      reason TEXT,                                -- why it failed
      assigned_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      done_at TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS deliveries_staff ON deliveries(staff_id, status)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      order_id INTEGER,
      delivery_id INTEGER,
      partner_id INTEGER,                         -- a trade partner paying their account
      customer TEXT NOT NULL,
      phone TEXT,
      amount INTEGER NOT NULL,
      method TEXT NOT NULL,
      reference TEXT,
      note TEXT,
      has_proof INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',     -- pending | confirmed | rejected
      decided_by INTEGER,
      decided_note TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS collections_staff ON collections(staff_id, status)"),
    // End-of-day cash handover: one person hands in all the cash they hold at once.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS handovers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',     -- pending | confirmed | rejected
      decided_by INTEGER,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS collection_proofs (
      collection_id INTEGER PRIMARY KEY,
      mime TEXT NOT NULL,
      data TEXT NOT NULL
    )`),
  ]);
  // staff_id: who took the order. handler_id: who handles (and is credited with) the sale,
  // from the order pool or because the customer is theirs; finished_at: they said it is done.
  // deleted_*: an order a team member removed (status 'deleted'); the owner can restore it.
  for (const column of ["staff_id INTEGER", "handler_id INTEGER", "handled_at TEXT", "finished_at TEXT",
    "deleted_from TEXT", "deleted_by INTEGER", "deleted_at TEXT", "delete_reason TEXT"]) {
    try { await env.DB.prepare(`ALTER TABLE orders ADD COLUMN ${column}`).run(); } catch { /* already there */ }
  }
  try { await env.DB.prepare("ALTER TABLE collections ADD COLUMN handover_id INTEGER").run(); } catch { /* already there */ }
  // Orders staff took before the order pool existed are theirs.
  await env.DB.prepare("UPDATE orders SET handler_id = staff_id, handled_at = created_at WHERE handler_id IS NULL AND staff_id IS NOT NULL").run();
  ready = true;
}

function clean(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function kes(n) {
  return `KES ${Math.round(n).toLocaleString("en-KE")}`;
}

export async function staffOf(env, userId) {
  await ensureTables(env);
  return env.DB.prepare("SELECT * FROM staff WHERE user_id = ?1").bind(userId).first();
}

// What a signed-in person may do here. The owner (admin) can do everything.
export function permissions(staff, owner) {
  if (owner) return OWNER;
  if (!staff || staff.status !== "approved" || !ROLES[staff.role]) return null;
  return ROLES[staff.role].can;
}

export function displayName(s) {
  return s ? `${s.username}${s.full_name ? ` (${s.full_name})` : ""}` : "";
}

export async function log(env, userId, action, detail) {
  await env.DB.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?1, ?2, ?3)").bind(userId, action, detail.slice(0, 500)).run();
}

// ---- sign-up ---------------------------------------------------------------------

export async function apply(env, user, body) {
  await ensureTables(env);
  const username = clean(body.username, 24);
  const fullName = clean(body.full_name, 80);
  const phone = clean(body.phone, 20);
  const wanted = clean(body.wanted, 60);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,23}$/.test(username)) return { error: "Choose a username of 3 to 24 letters or numbers (no spaces)." };
  if (!fullName) return { error: "Enter your full name." };
  if (!/^[+0-9 ()-]{9,20}$/.test(phone)) return { error: "Enter your WhatsApp number, e.g. 0712 345 678." };
  const existing = await staffOf(env, user.id);
  if (existing && existing.status === "approved") return { error: "You are already on the team." };
  if (existing && existing.status === "suspended") return { error: "Your team account is suspended. Please talk to the owner." };
  const taken = await env.DB.prepare("SELECT user_id FROM staff WHERE username = ?1 AND user_id != ?2").bind(username, user.id).first();
  if (taken) return { error: `The username "${username}" is taken. Choose another.` };
  await env.DB.prepare(
    `INSERT INTO staff (user_id, username, full_name, phone, wanted) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id) DO UPDATE SET username = ?2, full_name = ?3, phone = ?4, wanted = ?5, status = 'pending',
       updated_at = datetime('now'), decided_at = NULL`
  ).bind(user.id, username, fullName, phone, wanted || null).run();
  await log(env, user.id, "staff-applied", `${username} (${fullName}, ${phone}) signed up for the team${wanted ? ` as ${wanted}` : ""}`);
  return { ok: true, staff: await staffOf(env, user.id) };
}

// ---- reading -----------------------------------------------------------------------

const JOB_SELECT = `SELECT d.*, o.number, o.name, o.phone, o.email, o.delivery, o.town, o.items_json, o.total, o.notes AS order_notes,
  o.status AS order_status, o.view_token, s.username, s.full_name, s.phone AS staff_phone
  FROM deliveries d JOIN orders o ON o.id = d.order_id LEFT JOIN staff s ON s.user_id = d.staff_id`;

function job(d) {
  return {
    id: d.id, order_id: d.order_id, number: d.number, customer: d.name, phone: d.phone, town: d.town,
    delivery: DELIVERY[d.delivery] || d.delivery, address: d.address, map_url: d.map_url, collect: d.collect,
    notes: d.notes, order_notes: d.order_notes, items: JSON.parse(d.items_json || "[]"), total: d.total,
    status: d.status, reason: d.reason, order_status: d.order_status, created_at: d.created_at, done_at: d.done_at,
    staff_id: d.staff_id, staff: d.username ? `${d.username}` : "Owner", staff_name: d.full_name || "",
  };
}

function collection(c) {
  return {
    id: c.id, staff_id: c.staff_id, staff: c.username || "Owner", order: c.number || null, delivery_id: c.delivery_id,
    partner: c.company || null, customer: c.customer, phone: c.phone, amount: c.amount, method: c.method,
    reference: c.reference, note: c.note, has_proof: c.has_proof, status: c.status, decided_note: c.decided_note,
    decided_at: c.decided_at, created_at: c.created_at, handover_id: c.handover_id || null,
  };
}

const COLLECTION_SELECT = `SELECT c.*, s.username, o.number, p.company FROM collections c
  LEFT JOIN staff s ON s.user_id = c.staff_id LEFT JOIN orders o ON o.id = c.order_id
  LEFT JOIN partners p ON p.user_id = c.partner_id`;

export async function jobById(env, id) {
  await ensureTables(env);
  const d = await env.DB.prepare(`${JOB_SELECT} WHERE d.id = ?1`).bind(id).first();
  return d ? job(d) : null;
}

export async function collectionById(env, id) {
  await ensureTables(env);
  const c = await env.DB.prepare(`${COLLECTION_SELECT} WHERE c.id = ?1`).bind(id).first();
  return c ? collection(c) : null;
}

// Money each person holds (collected, not yet confirmed) and what they handed in this month.
async function cashSummary(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.staff_id, s.username, s.full_name,
       sum(CASE WHEN c.status = 'pending' THEN c.amount ELSE 0 END) AS holding,
       sum(CASE WHEN c.status = 'pending' AND c.method = 'Cash' THEN c.amount ELSE 0 END) AS cash,
       sum(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END) AS pending,
       sum(CASE WHEN c.status = 'confirmed' AND c.decided_at >= date('now', 'start of month') THEN c.amount ELSE 0 END) AS month,
       min(CASE WHEN c.status = 'pending' AND c.method = 'Cash' THEN c.created_at END) AS cash_since
     FROM collections c LEFT JOIN staff s ON s.user_id = c.staff_id GROUP BY c.staff_id ORDER BY holding DESC`
  ).all();
  // Cash held for more than a day is flagged.
  const dayAgo = new Date(Date.now() - 86400000).toISOString().replace("T", " ").slice(0, 19);
  return results.map((r) => ({ ...r, username: r.username || "Owner", late: Boolean(r.cash_since && r.cash_since < dayAgo) }));
}

// ---- cash handover ----------------------------------------------------------------------

// Everything this person holds in cash (not yet confirmed, not already handed in), as one handover.
export async function handIn(env, user) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(
    "SELECT id, amount FROM collections WHERE staff_id = ?1 AND status = 'pending' AND method = 'Cash' AND handover_id IS NULL"
  ).bind(user.id).all();
  if (!results.length) return { error: "You have no cash waiting to hand in." };
  const amount = results.reduce((n, c) => n + c.amount, 0);
  const row = await env.DB.prepare("INSERT INTO handovers (staff_id, amount, count) VALUES (?1, ?2, ?3) RETURNING id")
    .bind(user.id, amount, results.length).first();
  await env.DB.prepare(`UPDATE collections SET handover_id = ?1 WHERE id IN (${results.map(() => "?").join(",")})`)
    .bind(row.id, ...results.map((c) => c.id)).run();
  await log(env, user.id, "cash-handover", `Handing in ${kes(amount)} cash (${results.length} payment${results.length === 1 ? "" : "s"}) — H-${row.id}`);
  return { ok: true, handover: { id: row.id, amount, count: results.length }, staff: await staffOf(env, user.id),
    message: `Handing in ${kes(amount)}. Give the cash to the office; it is confirmed in one go.` };
}

const HANDOVER_SELECT = `SELECT h.*, s.username FROM handovers h LEFT JOIN staff s ON s.user_id = h.staff_id`;

export async function pendingHandovers(env, staffId = null) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(`${HANDOVER_SELECT} WHERE h.status = 'pending' AND (?1 IS NULL OR h.staff_id = ?1) ORDER BY h.id DESC`)
    .bind(staffId).all();
  return results.map((h) => ({ id: h.id, staff_id: h.staff_id, staff: h.username || "Owner", amount: h.amount, count: h.count, created_at: h.created_at }));
}

// Counted and received (the caller then confirms each payment in it), or not received.
export async function decideHandover(env, actor, body, owner) {
  await ensureTables(env);
  const h = await env.DB.prepare(`${HANDOVER_SELECT} WHERE h.id = ?1`).bind(Number(body.id)).first();
  if (!h) return { error: "Handover not found." };
  if (h.status !== "pending") return { error: `This handover was already ${h.status}.` };
  if (h.staff_id === actor.id && !owner) return { error: "Someone else must count and confirm cash you hand in." };
  const accept = Boolean(body.accept);
  const note = clean(body.note, 200);
  if (!accept && !note) return { error: "Say what was wrong (e.g. the amount counted)." };
  const { results } = await env.DB.prepare("SELECT id FROM collections WHERE handover_id = ?1 AND status = 'pending'").bind(h.id).all();
  await env.DB.prepare("UPDATE handovers SET status = ?2, decided_by = ?3, note = ?4, decided_at = datetime('now') WHERE id = ?1")
    .bind(h.id, accept ? "confirmed" : "rejected", actor.id, note || null).run();
  // Not received: the payments go back to "with them" so they can hand in again.
  if (!accept) await env.DB.prepare("UPDATE collections SET handover_id = NULL WHERE handover_id = ?1").bind(h.id).run();
  await log(env, actor.id, "cash-handover-decided", `H-${h.id} from ${h.username}: ${kes(h.amount)} ${accept ? "received" : `not accepted (${note})`}`);
  return { ok: true, accept, ids: results.map((c) => c.id),
    message: accept ? `${kes(h.amount)} cash from ${h.username} received.` : `Handover from ${h.username} sent back: ${note}` };
}

async function approvedStaff(env) {
  const { results } = await env.DB.prepare(
    "SELECT user_id, username, full_name, phone, role FROM staff WHERE status = 'approved' ORDER BY username"
  ).all();
  return results;
}

// Everything the /team page shows for this person, by role.
export async function portal(env, user, owner) {
  await ensureTables(env);
  const staff = await staffOf(env, user.id);
  const can = permissions(staff, owner);
  const out = {
    user: { name: user.name, email: user.email }, owner, roles: Object.fromEntries(Object.entries(ROLES).map(([k, r]) => [k, r.label])),
    methods: METHODS, staff: staff || null, can: can || [],
  };
  if (!can) return out;
  const [jobs, mine] = await Promise.all([
    env.DB.prepare(`${JOB_SELECT} WHERE d.staff_id = ?1 AND d.status != 'cancelled' AND (d.status IN ('assigned', 'on_way') OR d.updated_at > datetime('now', '-14 days'))
      ORDER BY CASE WHEN d.status IN ('assigned', 'on_way') THEN 0 ELSE 1 END, d.id DESC LIMIT 40`).bind(user.id).all(),
    env.DB.prepare(`${COLLECTION_SELECT} WHERE c.staff_id = ?1 ORDER BY c.id DESC LIMIT 40`).bind(user.id).all(),
  ]);
  out.jobs = jobs.results.map(job);
  out.collections = mine.results.map(collection);
  out.holding = out.collections.filter((c) => c.status === "pending").reduce((n, c) => n + c.amount, 0);
  out.myHandovers = await pendingHandovers(env, user.id);
  const { results: partnerRows } = await env.DB.prepare(
    "SELECT user_id, company FROM partners WHERE status = 'approved' ORDER BY company"
  ).all();
  out.partners = partnerRows;
  if (can.includes("dispatch")) {
    const [orders, active] = await Promise.all([
      env.DB.prepare(
        `SELECT o.id, o.number, o.name, o.phone, o.delivery, o.town, o.total, o.status, o.created_at, o.items_json, o.notes,
           (SELECT d.id FROM deliveries d WHERE d.order_id = o.id AND d.status IN ('assigned', 'on_way', 'delivered') ORDER BY d.id DESC LIMIT 1) AS job
         FROM orders o WHERE o.status IN ('new', 'confirmed', 'paid') ORDER BY o.id DESC LIMIT 60`
      ).all(),
      env.DB.prepare(`${JOB_SELECT} WHERE d.status IN ('assigned', 'on_way') OR d.updated_at > datetime('now', '-3 days') ORDER BY d.id DESC LIMIT 60`).all(),
    ]);
    out.orders = orders.results.map((o) => ({
      id: o.id, number: o.number, name: o.name, phone: o.phone, delivery: DELIVERY[o.delivery] || o.delivery, town: o.town,
      total: o.total, status: o.status, created_at: o.created_at, job: o.job,
      on_account: String(o.notes || "").startsWith("Payment: on my account"),
      items: JSON.parse(o.items_json || "[]").reduce((n, i) => n + i.qty, 0),
    }));
    out.deliveries = active.results.map(job);
  }
  if (can.includes("dispatch") || can.includes("team")) out.team = await approvedStaff(env);
  if (can.includes("confirm")) {
    const { results } = await env.DB.prepare(`${COLLECTION_SELECT} WHERE c.status = 'pending' ORDER BY c.id DESC LIMIT 100`).all();
    out.toConfirm = results.map(collection);
    out.cash = await cashSummary(env);
    out.handovers = await pendingHandovers(env);
  }
  if (can.includes("team")) out.people = await teamList(env);
  return out;
}

// The team with what each person has done in the last 30 days.
async function teamList(env) {
  const { results } = await env.DB.prepare(
    `SELECT s.user_id, s.username, s.full_name, s.phone, s.role, s.status, s.wanted, s.created_at, s.decided_at, u.email, u.last_login,
       (SELECT count(*) FROM deliveries d WHERE d.staff_id = s.user_id AND d.status = 'delivered' AND d.done_at > datetime('now', '-30 days')) AS delivered,
       (SELECT count(*) FROM deliveries d WHERE d.staff_id = s.user_id AND d.status IN ('assigned', 'on_way')) AS open_jobs,
       (SELECT count(*) FROM orders o WHERE o.staff_id = s.user_id AND o.status != 'deleted' AND o.created_at > datetime('now', '-30 days')) AS orders,
       (SELECT coalesce(sum(amount), 0) FROM collections c WHERE c.staff_id = s.user_id AND c.status = 'pending') AS holding,
       (SELECT coalesce(sum(amount), 0) FROM collections c WHERE c.staff_id = s.user_id AND c.status = 'confirmed' AND c.created_at > datetime('now', '-30 days')) AS collected
     FROM staff s JOIN users u ON u.id = s.user_id
     ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, s.username`
  ).all();
  return results;
}

// ---- orders taken by staff -----------------------------------------------------------

// Website prices only: staff can't change a price. A discount request goes in the notes.
export async function createOrder(env, user, body, catalogue, token) {
  await ensureTables(env);
  const wanted = new Map();
  for (const item of Array.isArray(body.items) ? body.items.slice(0, 60) : []) {
    const qty = Math.floor(Number(item.qty));
    if (typeof item.slug !== "string" || !(qty >= 1 && qty <= 999)) continue;
    wanted.set(item.slug, Math.min(999, (wanted.get(item.slug) || 0) + qty));
  }
  const items = [];
  for (const [slug, qty] of wanted) {
    const p = catalogue[slug];
    if (p) items.push({ slug, model: p.m, name: p.n, qty, price: p.p });
  }
  if (!items.length) return { error: "Add at least one product." };
  const c = body.customer || {};
  const name = clean(c.name, 80);
  const phone = clean(c.phone, 20);
  const email = clean(c.email, 120).toLowerCase();
  if (!name) return { error: "Enter the customer's name." };
  if (!/^[+0-9 ()-]{9,20}$/.test(phone)) return { error: "Enter the customer's phone number, e.g. 0712 345 678." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email address does not look right." };
  const delivery = DELIVERY[body.delivery] ? body.delivery : null;
  if (!delivery) return { error: "Choose pick-up or delivery." };
  const town = delivery === "outside" ? clean(body.town, 80) : "";
  if (delivery === "outside" && !town) return { error: "Enter the town for delivery." };
  const subtotal = items.reduce((n, i) => n + i.qty * i.price, 0);
  const notes = clean(body.notes, 500);
  const row = await env.DB.prepare(
    `INSERT INTO orders (view_token, user_id, name, phone, email, delivery, town, transport, notes, items_json,
       subtotal, tech_discount, reward_used, total, earn_rate, channel, consent, staff_id, handler_id, handled_at)
     VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, 0, ?10, 0, 'staff', ?11, ?12, ?12, datetime('now')) RETURNING id`
  ).bind(token, name, phone, email || null, delivery, town || null, delivery === "outside" ? "courier" : null,
    notes || null, JSON.stringify(items), subtotal, body.consent ? 1 : 0, user.id).first();
  const number = `NE-${1000 + row.id}`;
  await env.DB.prepare("UPDATE orders SET number = ?2 WHERE id = ?1").bind(row.id, number).run();
  await log(env, user.id, "staff-order", `Took order ${number} for ${name} (${phone}): ${kes(subtotal)}`);
  return { ok: true, order: { id: row.id, number, view_token: token, name, phone, total: subtotal, delivery, town, consent: body.consent ? 1 : 0, items } };
}

// ---- delivery jobs ----------------------------------------------------------------

function validMapUrl(raw) {
  const v = clean(raw, 400);
  if (!v) return "";
  if (/^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(v)) return `https://maps.google.com/?q=${v.replace(/\s+/g, "")}`;
  return /^https:\/\//i.test(v) ? v : null;
}

// Assign (or re-assign) an order's delivery to one person.
export async function assign(env, actor, body) {
  await ensureTables(env);
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(Number(body.order_id)).first();
  if (!order) return { error: "Order not found." };
  if (order.status === "cancelled" || order.status === "delivered") return { error: `Order ${order.number} is ${order.status}.` };
  const staffId = Number(body.staff_id);
  const person = await staffOf(env, staffId);
  if (!person || person.status !== "approved") return { error: "Choose someone on the team." };
  const mapUrl = validMapUrl(body.map_url);
  if (mapUrl === null) return { error: "The map link should start with https:// (copy it from Google Maps), or be coordinates like -1.27, 36.85." };
  const onAccount = String(order.notes || "").startsWith("Payment: on my account");   // a partner order on credit
  const collect = body.collect === "" || body.collect == null ? (onAccount || order.status === "paid" ? 0 : order.total) : Math.round(Number(body.collect));
  if (!(collect >= 0)) return { error: "Enter the amount to collect (0 if already paid)." };
  const address = clean(body.address, 200) || order.town || "";
  if (!address && !mapUrl) return { error: "Enter the delivery address or a map link." };
  await env.DB.prepare(
    "UPDATE deliveries SET status = 'cancelled', reason = 'Re-assigned', updated_at = datetime('now') WHERE order_id = ?1 AND status IN ('assigned', 'on_way')"
  ).bind(order.id).run();
  const row = await env.DB.prepare(
    `INSERT INTO deliveries (order_id, staff_id, address, map_url, collect, notes, assigned_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`
  ).bind(order.id, staffId, address || null, mapUrl || null, collect, clean(body.notes, 300) || null, actor.id).first();
  await log(env, actor.id, "delivery-assigned", `Delivery of ${order.number} (${order.name}) assigned to ${person.username}; collect ${kes(collect)}`);
  return { ok: true, id: row.id, person, order, collect, address: address || "the map pin",
    message: `${order.number} assigned to ${person.username}. They get the job on WhatsApp (${person.phone}).` };
}

export async function cancelJob(env, actor, id) {
  await ensureTables(env);
  const d = await env.DB.prepare("SELECT d.*, o.number FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.id = ?1").bind(id).first();
  if (!d) return { error: "Delivery not found." };
  if (!["assigned", "on_way"].includes(d.status)) return { error: "This delivery is already finished." };
  await env.DB.prepare("UPDATE deliveries SET status = 'cancelled', reason = 'Cancelled', updated_at = datetime('now') WHERE id = ?1").bind(id).run();
  await log(env, actor.id, "delivery-cancelled", `Delivery job D-${id} for ${d.number} cancelled`);
  return { ok: true, message: `Delivery for ${d.number} cancelled.` };
}

// The assigned person: on the way, or could not deliver.
export async function jobStatus(env, user, body) {
  await ensureTables(env);
  const d = await env.DB.prepare("SELECT d.*, o.number FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.id = ?1 AND d.staff_id = ?2")
    .bind(Number(body.id), user.id).first();
  if (!d) return { error: "This job is not assigned to you." };
  if (!["assigned", "on_way"].includes(d.status)) return { error: "This job is already finished." };
  if (body.status === "on_way") {
    await env.DB.prepare("UPDATE deliveries SET status = 'on_way', updated_at = datetime('now') WHERE id = ?1").bind(d.id).run();
    await log(env, user.id, "delivery-on-way", `On the way with ${d.number}`);
    return { ok: true, message: "Marked on the way." };
  }
  if (body.status === "failed") {
    const reason = clean(body.reason, 200);
    if (!reason) return { error: "Say why it could not be delivered." };
    await env.DB.prepare("UPDATE deliveries SET status = 'failed', reason = ?2, updated_at = datetime('now'), done_at = datetime('now') WHERE id = ?1")
      .bind(d.id, reason).run();
    await log(env, user.id, "delivery-failed", `Could not deliver ${d.number}: ${reason}`);
    return { ok: true, message: "Saved. The office will arrange it again." };
  }
  return { error: "Unknown status." };
}

// Delivered, with the money collected (if any). Returns the order and collection
// so the caller can mark the order delivered and alert the owner.
export async function delivered(env, user, body) {
  await ensureTables(env);
  const d = await env.DB.prepare("SELECT * FROM deliveries WHERE id = ?1 AND staff_id = ?2").bind(Number(body.id), user.id).first();
  if (!d) return { error: "This job is not assigned to you." };
  if (!["assigned", "on_way"].includes(d.status)) return { error: "This job is already finished." };
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(d.order_id).first();
  let coll = null;
  if (Number(body.amount) > 0) {
    const out = await record(env, user, { ...body, order_id: order.id, delivery_id: d.id, customer: order.name, phone: order.phone });
    if (out.error) return out;
    coll = out.collection;
  } else if (d.collect > 0 && !clean(body.note, 300)) {
    return { error: `You were to collect ${kes(d.collect)}. Enter what you collected, or add a note saying why nothing was collected.` };
  }
  await env.DB.prepare("UPDATE deliveries SET status = 'delivered', updated_at = datetime('now'), done_at = datetime('now'), reason = ?2 WHERE id = ?1")
    .bind(d.id, coll ? null : clean(body.note, 200) || null).run();
  await log(env, user.id, "delivery-done", `Delivered ${order.number} to ${order.name}${coll ? `; collected ${kes(coll.amount)} by ${coll.method}` : ""}`);
  return { ok: true, order, collection: coll, message: coll ? "Delivered. The payment is waiting for the office to confirm." : "Marked delivered." };
}

// ---- money collected ----------------------------------------------------------------

export async function record(env, user, body) {
  await ensureTables(env);
  const amount = Math.round(Number(body.amount));
  if (!(amount > 0 && amount < 100_000_000)) return { error: "Enter the amount collected." };
  const method = METHODS.includes(body.method) ? body.method : null;
  if (!method) return { error: "Choose how the customer paid." };
  const reference = clean(body.reference, 60).toUpperCase();
  const note = clean(body.note, 300);
  if (method !== "Cash" && !reference && !body.proof) return { error: "Add the transaction code or a screenshot so the office can find the payment." };
  if (method === "Other" && !note) return { error: "Say how the customer paid in the note." };
  let order = null;
  if (body.order_id) order = await env.DB.prepare("SELECT id, number, name, phone, channel, user_id FROM orders WHERE id = ?1 AND status != 'deleted'").bind(Number(body.order_id)).first();
  else if (clean(body.order_number, 20)) {
    const n = clean(body.order_number, 20).toUpperCase().replace(/^(\d+)$/, "NE-$1");
    order = await env.DB.prepare("SELECT id, number, name, phone, channel, user_id FROM orders WHERE number = ?1 AND status != 'deleted'").bind(n).first();
    if (!order) return { error: `Order ${n} was not found. Check the number, or leave it empty.` };
  }
  let partnerId = Number(body.partner_id) || null;
  if (order && order.channel === "partner") partnerId = order.user_id;
  let partner = null;
  if (partnerId) {
    partner = await env.DB.prepare("SELECT user_id, company, phone FROM partners WHERE user_id = ?1").bind(partnerId).first();
    if (!partner) return { error: "Partner not found." };
    if (!PARTNER_METHODS.includes(method)) return { error: "For a trade partner choose Cash, M-Pesa, Bank transfer, Cheque or Card." };
  }
  const customer = clean(body.customer, 80) || (order && order.name) || (partner && partner.company) || "";
  if (!customer) return { error: "Enter who paid." };
  let proof = null;
  if (body.proof) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.proof));
    if (!m) return { error: "The screenshot could not be read. Try a JPG or PNG." };
    if (m[2].length > MAX_PROOF) return { error: "The screenshot is too large. Please try again." };
    proof = { mime: m[1], data: m[2] };
  }
  const row = await env.DB.prepare(
    `INSERT INTO collections (staff_id, order_id, delivery_id, partner_id, customer, phone, amount, method, reference, note, has_proof)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id`
  ).bind(user.id, order ? order.id : null, body.delivery_id || null, partnerId, customer,
    clean(body.phone, 20) || (order && order.phone) || (partner && partner.phone) || null,
    amount, method, reference || null, note || null, proof ? 1 : 0).first();
  if (proof) await env.DB.prepare("INSERT INTO collection_proofs (collection_id, mime, data) VALUES (?1, ?2, ?3)").bind(row.id, proof.mime, proof.data).run();
  await log(env, user.id, "collection", `Recorded ${kes(amount)} by ${method}${reference ? ` (${reference})` : ""} from ${customer}${order ? ` for ${order.number}` : ""} — C-${row.id}`);
  return { ok: true, collection: await collectionById(env, row.id), message: `Saved as C-${row.id}. The office has been told and will confirm it.` };
}

// The screenshot: for the person who sent it, or anyone who confirms payments.
export async function proof(env, id, userId) {
  await ensureTables(env);
  const row = await env.DB.prepare(
    `SELECT p.mime, p.data FROM collection_proofs p JOIN collections c ON c.id = p.collection_id
     WHERE p.collection_id = ?1 AND (?2 IS NULL OR c.staff_id = ?2)`
  ).bind(id, userId ?? null).first();
  if (!row) return null;
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "content-type": row.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}

// Confirm (money reached NE) or reject. Nobody confirms their own collection.
// Returns what the caller needs to update the order or the partner's account.
export async function decide(env, actor, body, owner) {
  await ensureTables(env);
  const c = await env.DB.prepare("SELECT * FROM collections WHERE id = ?1").bind(Number(body.id)).first();
  if (!c) return { error: "Payment not found." };
  if (c.status !== "pending") return { error: `This payment was already ${c.status}.` };
  if (c.staff_id === actor.id && !owner) return { error: "Someone else must confirm a payment you collected." };
  const accept = Boolean(body.accept);
  const note = clean(body.note, 200);
  if (!accept && !note) return { error: "Say why it is not confirmed (the staff member sees this)." };
  await env.DB.prepare("UPDATE collections SET status = ?2, decided_by = ?3, decided_note = ?4, decided_at = datetime('now') WHERE id = ?1")
    .bind(c.id, accept ? "confirmed" : "rejected", actor.id, note || null).run();
  await log(env, actor.id, "collection-decided",
    `C-${c.id}: ${kes(c.amount)} by ${c.method} from ${c.customer} ${accept ? "confirmed" : `rejected (${note})`}`);
  let paidOrder = null;
  if (accept && c.order_id) {
    const o = await env.DB.prepare(
      `SELECT o.*, (SELECT coalesce(sum(amount), 0) FROM collections WHERE order_id = o.id AND status = 'confirmed') AS paid FROM orders o WHERE o.id = ?1`
    ).bind(c.order_id).first();
    if (o && (o.status === "new" || o.status === "confirmed") && o.paid >= o.total) paidOrder = o;
  }
  return { ok: true, accepted: accept, collection: c, paidOrder, message: `C-${c.id} ${accept ? "confirmed" : "marked not received"}.` };
}

// ---- owner ---------------------------------------------------------------------------

export async function adminOverview(env) {
  await ensureTables(env);
  const [people, pending, active, cash, activity] = await Promise.all([
    teamList(env),
    env.DB.prepare(`${COLLECTION_SELECT} WHERE c.status = 'pending' ORDER BY c.id DESC LIMIT 100`).all(),
    env.DB.prepare(`${JOB_SELECT} WHERE d.status IN ('assigned', 'on_way') OR d.updated_at > datetime('now', '-3 days') ORDER BY d.id DESC LIMIT 60`).all(),
    cashSummary(env),
    env.DB.prepare(
      `SELECT a.action, a.detail, a.created_at, s.username FROM audit_log a JOIN staff s ON s.user_id = a.user_id ORDER BY a.id DESC LIMIT 40`
    ).all(),
  ]);
  return {
    roles: Object.fromEntries(Object.entries(ROLES).map(([k, r]) => [k, r.label])),
    people, toConfirm: pending.results.map(collection), deliveries: active.results.map(job), cash, activity: activity.results,
    handovers: await pendingHandovers(env),
  };
}

export async function adminUpdate(env, admin, body) {
  await ensureTables(env);
  const s = await staffOf(env, Number(body.id));
  if (!s) return { error: "Person not found." };
  const status = ["pending", "approved", "rejected", "suspended"].includes(body.status) ? body.status : s.status;
  const role = body.role === undefined ? s.role : ROLES[body.role] ? body.role : null;
  if (status === "approved" && !role) return { error: "Choose a role before approving." };
  const note = body.note === undefined ? s.note : clean(body.note, 300) || null;
  await env.DB.prepare(
    `UPDATE staff SET status = ?2, role = ?3, note = ?4, updated_at = datetime('now'),
       decided_at = CASE WHEN ?2 != status THEN datetime('now') ELSE decided_at END WHERE user_id = ?1`
  ).bind(s.user_id, status, role, note).run();
  await log(env, admin.id, "staff-update", `Team: ${s.username} is ${status}${role ? `, role ${ROLES[role].label}` : ""}`);
  return { ok: true, message: `${s.username}: ${status}${role ? ` as ${ROLES[role].label}` : ""}.`, staff: await staffOf(env, s.user_id) };
}
