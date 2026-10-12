// NE Trade Partners: Hikvision Authorized Partners, DPP members, installation
// companies and dealers who buy from NE at agreed trade prices.
//
// A partner signs in with Google, applies from /partner/, and the admin
// approves them. Each partner has a default discount off the website price
// and can have their own price for any product (partner_prices). Partners
// order from the portal; on any line they may suggest a target price, which
// the admin can accept: it becomes their price and the order is updated.
//
// Partner orders live in the normal orders table (channel 'partner'), so the
// Orders tab, order PDF and WhatsApp updates all work for them too.

export const KINDS = [
  "Hikvision Authorized Partner",
  "Hikvision DPP member",
  "Installation company",
  "System integrator",
  "Dealer / electronics shop",
];
const STATUSES = ["pending", "approved", "rejected", "suspended"];

let ready = false;
export async function ensureTables(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS partners (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      company TEXT NOT NULL,
      contact TEXT NOT NULL,
      phone TEXT NOT NULL,
      town TEXT NOT NULL,
      kind TEXT NOT NULL,
      hik_id TEXT,                               -- Hikvision partner / DPP ID, if any
      kra_pin TEXT,
      note TEXT,                                 -- admin's private note
      status TEXT NOT NULL DEFAULT 'pending',    -- pending | approved | rejected | suspended
      discount REAL NOT NULL DEFAULT 0,          -- % off the website price where no own price is set
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS partner_prices (
      user_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      price INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, slug)
    )`),
    // Standing price requests ("can I always get this camera at X?"), not tied to an order.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS price_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      requested INTEGER NOT NULL,
      volume TEXT,                               -- expected quantity, e.g. "20 a month"
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',    -- pending | accepted | declined
      agreed INTEGER,                            -- the price agreed (may differ from requested)
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT
    )`),
  ]);
  ready = true;
}

function clean(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

export async function partnerOf(env, userId) {
  await ensureTables(env);
  return env.DB.prepare("SELECT * FROM partners WHERE user_id = ?1").bind(userId).first();
}

async function ownPrices(env, userId) {
  const { results } = await env.DB.prepare("SELECT slug, price FROM partner_prices WHERE user_id = ?1").bind(userId).all();
  return Object.fromEntries(results.map((r) => [r.slug, r.price]));
}

function tradePrice(retail, discount) {
  return Math.round(retail * (1 - (Number(discount) || 0) / 100));
}

// The partner's price for every product: their own price, else the website
// price less their default discount.
async function priceBook(env, partner, catalogue) {
  const own = await ownPrices(env, partner.user_id);
  return Object.entries(catalogue).map(([slug, p]) => ({
    slug, name: p.n, model: p.m, category: p.c, image: p.i, url: p.u, retail: p.p,
    price: own[slug] ?? tradePrice(p.p, partner.discount), own: slug in own,
  }));
}

function publicPartner(p) {
  return p && {
    company: p.company, contact: p.contact, phone: p.phone, town: p.town, kind: p.kind, hik_id: p.hik_id,
    kra_pin: p.kra_pin, status: p.status, discount: p.discount, created_at: p.created_at,
  };
}

// ---- partner portal ---------------------------------------------------------

export async function portal(env, user, catalogue) {
  const partner = await partnerOf(env, user.id);
  const out = { user: { name: user.name, email: user.email }, kinds: KINDS, partner: publicPartner(partner) };
  if (partner && partner.status === "approved") {
    out.products = await priceBook(env, partner, catalogue);
    const { results } = await env.DB.prepare(
      "SELECT number, view_token, total, status, created_at, updated_at, delivery, town, notes, items_json FROM orders WHERE user_id = ?1 AND channel = 'partner' ORDER BY id DESC LIMIT 50"
    ).bind(user.id).all();
    out.orders = results.map((o) => ({
      number: o.number, token: o.view_token, total: o.total, status: o.status, created_at: o.created_at,
      updated_at: o.updated_at, delivery: o.delivery, town: o.town, notes: o.notes, items: JSON.parse(o.items_json),
    }));
    const reqs = await env.DB.prepare(
      "SELECT id, slug, requested, volume, note, status, agreed, created_at, decided_at FROM price_requests WHERE user_id = ?1 ORDER BY id DESC LIMIT 100"
    ).bind(user.id).all();
    out.requests = reqs.results.map((r) => ({ ...r, name: catalogue[r.slug] ? catalogue[r.slug].n : r.slug, model: catalogue[r.slug] ? catalogue[r.slug].m : "" }));
  }
  return out;
}

export async function apply(env, user, body) {
  await ensureTables(env);
  const v = {
    company: clean(body.company, 100), contact: clean(body.contact, 80), phone: clean(body.phone, 30),
    town: clean(body.town, 80), kind: KINDS.includes(body.kind) ? body.kind : "", hik_id: clean(body.hik_id, 60),
    kra_pin: clean(body.kra_pin, 20).toUpperCase(),
  };
  if (!v.company) return { error: "Enter your company name." };
  if (!v.contact) return { error: "Enter the contact person's name." };
  if (!/^[+0-9 ()-]{9,20}$/.test(v.phone)) return { error: "Enter a valid phone number, e.g. 0712 345 678." };
  if (!v.town) return { error: "Enter your town or area." };
  if (!v.kind) return { error: "Choose what describes your business." };
  const existing = await partnerOf(env, user.id);
  if (existing && existing.status === "approved") return { error: "Your partner account is already active." };
  await env.DB.prepare(
    `INSERT INTO partners (user_id, company, contact, phone, town, kind, hik_id, kra_pin, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending')
     ON CONFLICT(user_id) DO UPDATE SET company = ?2, contact = ?3, phone = ?4, town = ?5, kind = ?6, hik_id = ?7,
       kra_pin = ?8, status = 'pending', updated_at = datetime('now'), decided_at = NULL`
  ).bind(user.id, v.company, v.contact, v.phone, v.town, v.kind, v.hik_id || null, v.kra_pin || null).run();
  return { ok: true };
}

// Standing price requests from the portal's "Request prices" page.
export async function requestPrices(env, user, body, catalogue) {
  const partner = await partnerOf(env, user.id);
  if (!partner || partner.status !== "approved") return { error: "Your partner account is not active yet." };
  const book = Object.fromEntries((await priceBook(env, partner, catalogue)).map((p) => [p.slug, p]));
  const note = clean(body.note, 500);
  const statements = [];
  for (const line of Array.isArray(body.items) ? body.items.slice(0, 50) : []) {
    const p = book[line.slug];
    const requested = Math.round(Number(line.requested));
    if (!p || !(requested > 0)) continue;
    if (requested >= p.price) return { error: `Your target for ${p.model} must be below your current price (KES ${p.price.toLocaleString("en-KE")}).` };
    statements.push(
      env.DB.prepare("DELETE FROM price_requests WHERE user_id = ?1 AND slug = ?2 AND status = 'pending'").bind(user.id, p.slug),
      env.DB.prepare("INSERT INTO price_requests (user_id, slug, requested, volume, note) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(user.id, p.slug, requested, clean(line.volume, 40) || null, note || null),
    );
  }
  if (!statements.length) return { error: "Add at least one product with your target price." };
  await env.DB.batch(statements);
  return { ok: true, count: statements.length / 2 };
}

const DELIVERY = ["pickup", "nairobi", "outside"];

// Builds a partner order. Returns { error } or the row values for the orders table.
export async function order(env, user, body, catalogue) {
  const partner = await partnerOf(env, user.id);
  if (!partner || partner.status !== "approved") return { error: "Your partner account is not active yet." };
  const book = Object.fromEntries((await priceBook(env, partner, catalogue)).map((p) => [p.slug, p]));
  const items = [];
  const seen = new Set();
  for (const line of Array.isArray(body.items) ? body.items.slice(0, 150) : []) {
    const p = book[line.slug];
    const qty = Math.floor(Number(line.qty));
    if (!p || seen.has(line.slug) || !(qty >= 1 && qty <= 9999)) continue;
    seen.add(line.slug);
    const item = { slug: p.slug, model: p.model, name: p.name, qty, price: p.price, retail: p.retail };
    const requested = Math.round(Number(line.requested));
    if (requested > 0 && requested < p.price) item.requested = requested;
    items.push(item);
  }
  if (!items.length) return { error: "Add at least one product with a quantity." };
  const delivery = DELIVERY.includes(body.delivery) ? body.delivery : "pickup";
  const town = delivery === "outside" ? clean(body.town, 80) : "";
  if (delivery === "outside" && !town) return { error: "Enter the town for delivery." };
  const subtotal = items.reduce((n, i) => n + i.qty * i.price, 0);
  return {
    partner, items, subtotal, delivery, town,
    notes: clean(body.notes, 800),
    name: `${partner.company} (${partner.contact})`,
    phone: partner.phone,
    email: user.email,
  };
}

// ---- admin -------------------------------------------------------------------

export async function adminList(env, catalogue) {
  await ensureTables(env);
  const { results } = await env.DB.prepare(
    `SELECT p.*, u.email, (SELECT count(*) FROM partner_prices pp WHERE pp.user_id = p.user_id) AS prices,
       (SELECT coalesce(sum(o.total), 0) FROM orders o WHERE o.user_id = p.user_id AND o.channel = 'partner' AND o.status IN ('paid', 'delivered')) AS bought
     FROM partners p JOIN users u ON u.id = p.user_id
     ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, p.company`
  ).all();
  return { partners: results, kinds: KINDS, requests: await priceRequests(env, catalogue) };
}

export async function adminDetail(env, userId, catalogue) {
  const partner = await partnerOf(env, userId);
  if (!partner) return null;
  return { partner: { ...partner, id: partner.user_id }, products: await priceBook(env, partner, catalogue) };
}

export async function adminUpdate(env, userId, body) {
  const partner = await partnerOf(env, userId);
  if (!partner) return { error: "Partner not found." };
  const status = STATUSES.includes(body.status) ? body.status : partner.status;
  const discount = body.discount === undefined ? partner.discount : Number(body.discount);
  if (!(discount >= 0 && discount < 90)) return { error: "Default discount must be between 0 and 90%." };
  const kind = KINDS.includes(body.kind) ? body.kind : partner.kind;
  const note = body.note === undefined ? partner.note : clean(body.note, 500);
  await env.DB.prepare(
    `UPDATE partners SET status = ?2, discount = ?3, kind = ?4, note = ?5, updated_at = datetime('now'),
       decided_at = CASE WHEN ?2 != status THEN datetime('now') ELSE decided_at END WHERE user_id = ?1`
  ).bind(userId, status, discount, kind, note).run();
  return { ok: true, partner: { ...partner, status, discount, kind, note }, changed: status !== partner.status };
}

// prices: [{ slug, price }] — a price of null or 0 removes the partner's own price.
export async function adminSetPrices(env, userId, prices, catalogue) {
  if (!(await partnerOf(env, userId))) return { error: "Partner not found." };
  const statements = [];
  for (const row of Array.isArray(prices) ? prices.slice(0, 500) : []) {
    if (!catalogue[row.slug]) continue;
    const price = Math.round(Number(row.price));
    statements.push(price > 0
      ? env.DB.prepare(
        `INSERT INTO partner_prices (user_id, slug, price) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, slug) DO UPDATE SET price = ?3, updated_at = datetime('now')`
      ).bind(userId, row.slug, price)
      : env.DB.prepare("DELETE FROM partner_prices WHERE user_id = ?1 AND slug = ?2").bind(userId, row.slug));
  }
  if (statements.length) await env.DB.batch(statements);
  return { ok: true, saved: statements.length };
}

// What partners asked for: standing requests from the "Request prices" page,
// and lines in open orders where they typed a target price.
async function priceRequests(env, catalogue) {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.number, o.user_id, o.items_json, o.created_at, p.company
     FROM orders o JOIN partners p ON p.user_id = o.user_id
     WHERE o.channel = 'partner' AND o.status IN ('new', 'confirmed') ORDER BY o.id DESC LIMIT 100`
  ).all();
  const out = [];
  const standing = await env.DB.prepare(
    `SELECT r.*, p.company, p.discount FROM price_requests r JOIN partners p ON p.user_id = r.user_id
     WHERE r.status = 'pending' ORDER BY r.id DESC LIMIT 100`
  ).all();
  for (const r of standing.results) {
    const c = catalogue[r.slug];
    const own = await env.DB.prepare("SELECT price FROM partner_prices WHERE user_id = ?1 AND slug = ?2").bind(r.user_id, r.slug).first();
    out.push({ type: "standing", id: r.id, user_id: r.user_id, company: r.company, created_at: r.created_at, slug: r.slug,
      model: c ? c.m : r.slug, name: c ? c.n : r.slug, retail: c ? c.p : 0, requested: r.requested, volume: r.volume, note: r.note,
      price: own ? own.price : c ? tradePrice(c.p, r.discount) : 0 });
  }
  for (const o of results) {
    for (const i of JSON.parse(o.items_json)) {
      if (i.requested && !i.request) {
        out.push({ type: "order", order_id: o.id, number: o.number, user_id: o.user_id, company: o.company, created_at: o.created_at,
          slug: i.slug, model: i.model, name: i.name, qty: i.qty, price: i.price, retail: i.retail, requested: i.requested });
      }
    }
  }
  return out;
}

// Accept: the requested price becomes the partner's price and the order line
// is repriced. Decline: the line keeps its price.
async function savePrice(env, userId, slug, price) {
  return env.DB.prepare(
    `INSERT INTO partner_prices (user_id, slug, price) VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id, slug) DO UPDATE SET price = ?3, updated_at = datetime('now')`
  ).bind(userId, slug, price);
}

// A standing request: accept (at the requested or a counter price) or decline.
export async function adminDecideStanding(env, id, accept, price) {
  await ensureTables(env);
  const r = await env.DB.prepare("SELECT * FROM price_requests WHERE id = ?1").bind(id).first();
  if (!r) return { error: "That price request was not found." };
  const agreed = accept ? Math.round(Number(price) || r.requested) : null;
  if (accept && !(agreed > 0)) return { error: "Enter the agreed price." };
  const statements = [env.DB.prepare(
    "UPDATE price_requests SET status = ?2, agreed = ?3, decided_at = datetime('now') WHERE id = ?1"
  ).bind(id, accept ? "accepted" : "declined", agreed)];
  if (accept) statements.push(await savePrice(env, r.user_id, r.slug, agreed));
  await env.DB.batch(statements);
  return { ok: true, agreed, slug: r.slug };
}

export async function adminDecide(env, orderId, slug, accept, price) {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1 AND channel = 'partner'").bind(orderId).first();
  if (!order) return { error: "Order not found." };
  const items = JSON.parse(order.items_json);
  const item = items.find((i) => i.slug === slug && i.requested);
  if (!item) return { error: "That price request was not found." };
  item.request = accept ? "accepted" : "declined";
  const statements = [];
  if (accept) {
    const agreed = Math.round(Number(price) || item.requested);
    if (!(agreed > 0)) return { error: "Enter the agreed price." };
    item.price = agreed;
    item.agreed = agreed;
    statements.push(await savePrice(env, order.user_id, slug, agreed));
  }
  const subtotal = items.reduce((n, i) => n + i.qty * i.price, 0);
  statements.push(env.DB.prepare(
    "UPDATE orders SET items_json = ?2, subtotal = ?3, total = ?3, updated_at = datetime('now') WHERE id = ?1"
  ).bind(orderId, JSON.stringify(items), subtotal));
  await env.DB.batch(statements);
  return { ok: true, number: order.number, total: subtotal, item };
}
