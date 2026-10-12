// Partner accounts: what a trade partner owes NE (goods taken on credit) and
// the payments they make against it.
//
// Every entry is a row in partner_ledger:
//   charge   — NE adds an amount owed (e.g. an order taken on credit)
//   payment  — money received. A partner reports a payment from the portal
//              with a screenshot (status 'pending' until NE confirms it);
//              payments NE records itself are confirmed straight away.
// Only confirmed rows count towards the balance. Nothing is deleted: a wrong
// entry is voided, so the statement keeps a full history.
//
// Proof screenshots are small JPEGs (resized in the browser) kept in D1.

import { partnerOf, ensureTables as ensurePartners } from "./partners.js";

export const METHODS = ["M-Pesa", "Bank transfer", "Cash", "Cheque", "Card"];
const MAX_PROOF = 1_500_000; // base64 characters, about 1.1 MB

let ready = false;
async function ensureTables(env) {
  if (ready) return;
  await ensurePartners(env);
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,                        -- charge | payment
      amount INTEGER NOT NULL,                   -- KES, always positive
      description TEXT,
      ref TEXT,                                  -- order or invoice number
      method TEXT,                               -- payments: M-Pesa, bank transfer…
      reference TEXT,                            -- payments: transaction code
      paid_on TEXT,                              -- payments: date paid (YYYY-MM-DD)
      status TEXT NOT NULL DEFAULT 'confirmed',  -- pending | confirmed | rejected | void
      has_proof INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,                  -- partner | admin email
      note TEXT,                                 -- NE's note, e.g. why a payment was rejected
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS partner_ledger_user ON partner_ledger(user_id)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS payment_proofs (
      ledger_id INTEGER PRIMARY KEY,
      mime TEXT NOT NULL,
      data TEXT NOT NULL                         -- base64
    )`),
  ]);
  ready = true;
}

function clean(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function kes(n) {
  return `KES ${Math.round(n).toLocaleString("en-KE")}`;
}

const BALANCE = `coalesce(sum(CASE WHEN status = 'confirmed' AND kind = 'charge' THEN amount
  WHEN status = 'confirmed' AND kind = 'payment' THEN -amount ELSE 0 END), 0)`;

export async function balances(env) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(
    `SELECT user_id, ${BALANCE} AS balance, sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
     FROM partner_ledger GROUP BY user_id`
  ).all();
  return Object.fromEntries(results.map((r) => [r.user_id, r]));
}

// The statement: entries oldest first with a running balance, plus totals.
export async function account(env, userId) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(
    `SELECT id, kind, amount, description, ref, method, reference, paid_on, status, has_proof, created_by, note, created_at, decided_at
     FROM partner_ledger WHERE user_id = ?1 ORDER BY created_at, id`
  ).bind(userId).all();
  let running = 0;
  const entries = results.map((e) => {
    if (e.status === "confirmed") running += e.kind === "charge" ? e.amount : -e.amount;
    return { ...e, by_partner: e.created_by === "partner", created_by: undefined, running };
  });
  const pending = results.filter((e) => e.status === "pending").reduce((n, e) => n + e.amount, 0);
  return { balance: running, pending, entries: entries.reverse(), methods: METHODS };
}

function validPayment(body) {
  const amount = Math.round(Number(body.amount));
  if (!(amount > 0 && amount < 100_000_000)) return { error: "Enter the amount paid." };
  const method = METHODS.includes(body.method) ? body.method : null;
  if (!method) return { error: "Choose how you paid." };
  const reference = clean(body.reference, 60).toUpperCase();
  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(body.paid_on || "") ? body.paid_on : new Date().toISOString().slice(0, 10);
  return { amount, method, reference, paidOn, note: clean(body.note, 300) };
}

// A partner reports a payment, usually with a screenshot of the M-Pesa or bank message.
export async function reportPayment(env, user, body) {
  await ensureTables(env);
  const partner = await partnerOf(env, user.id);
  if (!partner || partner.status !== "approved") return { error: "Your partner account is not active." };
  const v = validPayment(body);
  if (v.error) return v;
  if (v.method !== "Cash" && !v.reference && !body.proof) return { error: "Add the transaction code or a screenshot so we can match your payment." };
  let proof = null;
  if (body.proof) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.proof));
    if (!m) return { error: "The screenshot could not be read. Try a JPG or PNG." };
    if (m[2].length > MAX_PROOF) return { error: "The screenshot is too large. Please try again." };
    proof = { mime: m[1], data: m[2] };
  }
  const row = await env.DB.prepare(
    `INSERT INTO partner_ledger (user_id, kind, amount, description, method, reference, paid_on, status, has_proof, created_by)
     VALUES (?1, 'payment', ?2, ?3, ?4, ?5, ?6, 'pending', ?7, 'partner') RETURNING id`
  ).bind(user.id, v.amount, v.note || null, v.method, v.reference || null, v.paidOn, proof ? 1 : 0).first();
  if (proof) await env.DB.prepare("INSERT INTO payment_proofs (ledger_id, mime, data) VALUES (?1, ?2, ?3)").bind(row.id, proof.mime, proof.data).run();
  return { ok: true, id: row.id, number: `P-${row.id}` };
}

// The screenshot, for the partner who sent it or for the admin.
export async function proof(env, entryId, userId) {
  await ensureTables(env);
  const row = await env.DB.prepare(
    `SELECT p.mime, p.data FROM payment_proofs p JOIN partner_ledger l ON l.id = p.ledger_id
     WHERE p.ledger_id = ?1 AND (?2 IS NULL OR l.user_id = ?2)`
  ).bind(entryId, userId ?? null).first();
  if (!row) return null;
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "content-type": row.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}

// ---- admin ---------------------------------------------------------------------

export async function adminAction(env, body, admin) {
  await ensureTables(env);
  const userId = Number(body.id);
  if (body.action === "charge") {
    if (!(await partnerOf(env, userId))) return { error: "Partner not found." };
    const amount = Math.round(Number(body.amount));
    if (!(amount > 0)) return { error: "Enter the amount owed." };
    const ref = clean(body.ref, 40);
    if (ref && await env.DB.prepare("SELECT 1 FROM partner_ledger WHERE user_id = ?1 AND kind = 'charge' AND ref = ?2 AND status = 'confirmed'").bind(userId, ref).first()) {
      return { error: `${ref} is already on this partner's account.` };
    }
    await env.DB.prepare(
      "INSERT INTO partner_ledger (user_id, kind, amount, description, ref, created_by) VALUES (?1, 'charge', ?2, ?3, ?4, ?5)"
    ).bind(userId, amount, clean(body.description, 200) || (ref ? `Goods on credit, ${ref}` : "Goods on credit"), ref || null, admin.email).run();
    return { ok: true, message: `${kes(amount)} added to the account.` };
  }
  if (body.action === "charge_order") {
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1 AND channel = 'partner'").bind(Number(body.order_id)).first();
    if (!order) return { error: "Partner order not found." };
    return adminAction(env, { action: "charge", id: order.user_id, amount: order.total, ref: order.number, description: `Goods on credit, order ${order.number}` }, admin);
  }
  if (body.action === "payment") {
    if (!(await partnerOf(env, userId))) return { error: "Partner not found." };
    const v = validPayment(body);
    if (v.error) return v;
    await env.DB.prepare(
      `INSERT INTO partner_ledger (user_id, kind, amount, description, method, reference, paid_on, status, created_by, decided_at)
       VALUES (?1, 'payment', ?2, ?3, ?4, ?5, ?6, 'confirmed', ?7, datetime('now'))`
    ).bind(userId, v.amount, v.note || null, v.method, v.reference || null, v.paidOn, admin.email).run();
    return { ok: true, message: `Payment of ${kes(v.amount)} recorded.` };
  }
  if (body.action === "decide_payment" || body.action === "void_entry") {
    const entry = await env.DB.prepare("SELECT * FROM partner_ledger WHERE id = ?1").bind(Number(body.entry_id)).first();
    if (!entry) return { error: "Entry not found." };
    const status = body.action === "void_entry" ? "void" : body.accept ? "confirmed" : "rejected";
    if (body.action === "decide_payment" && entry.status !== "pending") return { error: "This payment was already handled." };
    await env.DB.prepare("UPDATE partner_ledger SET status = ?2, note = ?3, decided_at = datetime('now') WHERE id = ?1")
      .bind(entry.id, status, clean(body.note, 200) || entry.note).run();
    const what = entry.kind === "payment" ? `Payment of ${kes(entry.amount)}` : `Charge of ${kes(entry.amount)}`;
    return { ok: true, message: `${what} ${status === "confirmed" ? "confirmed" : status === "rejected" ? "rejected" : "voided"}.` };
  }
  return { error: "Unknown action." };
}

// Payments partners reported that NE has not checked yet, for the admin list.
export async function pendingPayments(env) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.user_id, l.amount, l.method, l.reference, l.paid_on, l.description, l.has_proof, l.created_at, p.company
     FROM partner_ledger l JOIN partners p ON p.user_id = l.user_id
     WHERE l.kind = 'payment' AND l.status = 'pending' ORDER BY l.id DESC LIMIT 100`
  ).all();
  return results;
}
