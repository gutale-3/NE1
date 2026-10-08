// WhatsApp Cloud API: automatic updates from NE's updates-only number.
//
// The updates number (WHATSAPP_PHONE_ID) only sends: order received / confirmed /
// paid / delivered, reward earned, credit-expiry reminders, and a new-order
// alert to the owner's own WhatsApp (OWNER_WHATSAPP). Anyone who writes to it
// gets a polite auto-reply pointing to the shop's main WhatsApp, and the
// message shows in the admin panel.
//
// Secrets: WHATSAPP_TOKEN (permanent access token), META_APP_SECRET (checks
// webhook signatures; the webhook verify token is derived from it).
// Vars: WHATSAPP_PHONE_ID, WHATSAPP_WABA_ID, OWNER_WHATSAPP, MAIN_WHATSAPP_LABEL.

const GRAPH = "https://graph.facebook.com/v23.0";
const SITE = "https://nashnaal.com";
const FOOTER = "Updates only. Chat with us on WhatsApp: 0737 454 891";
const VIEW_ORDER = { type: "URL", text: "View order", url: `${SITE}/order/?{{1}}`, example: [`${SITE}/order/?n=NE-1005&k=a1b2c3`] };

// Message templates (Meta must approve each one before it can be sent).
export const TEMPLATES = [
  {
    name: "ne_order_received",
    body: "Hi {{1}}, thank you for your order {{2}} with Nashnaal Electronics. Total: KES {{3}}. Our team will confirm stock and delivery with you shortly.",
    example: ["Mary", "NE-1005", "20,150"], button: VIEW_ORDER,
  },
  {
    name: "ne_order_confirmed",
    body: "Hi {{1}}, good news: your order {{2}} is confirmed and your items are set aside for you. We will contact you about payment and delivery.",
    example: ["Mary", "NE-1005"], button: VIEW_ORDER,
  },
  {
    name: "ne_order_paid",
    body: "Hi {{1}}, we have received your payment of KES {{2}} for order {{3}}. Thank you for shopping with Nashnaal Electronics.",
    example: ["Mary", "20,150", "NE-1005"], button: VIEW_ORDER,
  },
  {
    name: "ne_order_delivered",
    body: "Hi {{1}}, your order {{2}} has been delivered. If you need help with installation or setup, our Hikvision-certified technicians are ready to assist.",
    example: ["Mary", "NE-1005"], button: VIEW_ORDER,
  },
  {
    name: "ne_reward_earned",
    body: "Hi {{1}}, you earned KES {{2}} reward credit on order {{3}}. Your reward balance is now KES {{4}}. This credit is valid until {{5}} and comes off your next order at nashnaal.com when you sign in.",
    example: ["Mary", "403", "NE-1005", "533", "6 Apr 2027"],
  },
  {
    name: "ne_credit_expiring",
    body: "Hi {{1}}, a quick reminder that KES {{2}} of your NE reward credit expires on {{3}}. Sign in at nashnaal.com and it comes off your next order automatically.",
    example: ["Mary", "403", "6 Apr 2027"],
  },
  {
    name: "ne_new_order_alert",
    body: "New website order {{1}} from {{2}}, phone {{3}}. Total: KES {{4}} for {{5}} items. Delivery: {{6}}. Open the admin panel to confirm it.",
    example: ["NE-1005", "Mary Wanjiku", "0712 345 678", "20,150", "8", "Nairobi (free)"],
    button: { type: "URL", text: "Open admin", url: `${SITE}/admin/` }, footer: "Nashnaal Electronics website",
  },
  {
    name: "ne_customer_message",
    body: "New WhatsApp message on the NE updates number from {{1}} ({{2}}): {{3}} Reply from the WhatsApp tab in the NE admin panel.",
    example: ["Mary Wanjiku", "+254712345678", "Is the 4MP ColorVu camera in stock?"],
    button: { type: "URL", text: "Open chats", url: `${SITE}/admin/#wa` }, footer: "Nashnaal Electronics website",
  },
];

const AUTO_REPLY =
  "Hello, and thank you for messaging Nashnaal Electronics (NE)! We have received your message and will reply here shortly " +
  "(Monday to Saturday 8am to 8pm, Sunday 9am to 6pm).\n\nFor urgent help, call or WhatsApp 0737 454 891.";

const PROFILE = {
  about: "Nashnaal Electronics: orders, updates and support",
  description: "Nashnaal Electronics (NE), Hikvision Authorized National Distributor in Nairobi. Order updates, rewards and support. You can also call or WhatsApp 0737 454 891.",
  address: "BBS Mall, Shop GFE 61, Eastleigh, Nairobi, Kenya",
  websites: [SITE],
  vertical: "RETAIL",
};

export function configured(env) {
  return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID);
}

// "0712 345 678", "+254 712…", "712345678" -> "254712345678"; null if not Kenyan-looking.
export function waNumber(raw) {
  let d = String(raw || "").replace(/[^0-9]/g, "");
  if (d.startsWith("0")) d = "254" + d.slice(1);
  else if (d.length === 9 && /^[17]/.test(d)) d = "254" + d;
  return /^254[17]\d{8}$/.test(d) ? d : null;
}

let tableReady = false;
async function ensureTable(env) {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wa_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,            -- out | in
      phone TEXT NOT NULL,
      kind TEXT NOT NULL,                 -- template name, auto_reply, text
      order_id INTEGER,
      user_id INTEGER,
      dedupe TEXT UNIQUE,                 -- stops the same update going twice
      wa_id TEXT,
      status TEXT NOT NULL DEFAULT 'sent',-- sent | delivered | read | failed | received
      body TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS wa_messages_wa_id ON wa_messages (wa_id)"),
  ]);
  tableReady = true;
}

async function graph(env, path, body, method = body ? "POST" : "GET") {
  const res = await fetch(`${env.GRAPH_API || GRAPH}/${path}`, {
    method,
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && (data.error.error_user_msg || data.error.message)) || `WhatsApp API error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Sends a template and logs it. meta.dedupe skips a message already sent.
export async function sendTemplate(env, to, name, params, meta = {}) {
  if (!configured(env)) return { skipped: "not configured" };
  const phone = waNumber(to);
  if (!phone) return { skipped: "bad number" };
  await ensureTable(env);
  const tpl = TEMPLATES.find((t) => t.name === name);
  const rendered = tpl.body.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");
  if (meta.dedupe) {
    const seen = await env.DB.prepare("SELECT 1 FROM wa_messages WHERE dedupe = ?1").bind(meta.dedupe).first();
    if (seen) return { skipped: "already sent" };
  }
  const components = [{ type: "body", parameters: params.map((text) => ({ type: "text", text: String(text) })) }];
  if (tpl.button && tpl.button.url.includes("{{1}}")) {
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: meta.buttonParam || "" }] });
  }
  let waId = null, status = "sent", error = null;
  try {
    const out = await graph(env, `${env.WHATSAPP_PHONE_ID}/messages`, {
      messaging_product: "whatsapp", to: phone, type: "template",
      template: { name, language: { code: "en" }, components },
    });
    waId = out.messages && out.messages[0] && out.messages[0].id;
  } catch (e) {
    status = "failed";
    error = friendly(e.message);
  }
  await env.DB.prepare(
    `INSERT INTO wa_messages (direction, phone, kind, order_id, user_id, dedupe, wa_id, status, body, error)
     VALUES ('out', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(dedupe) DO NOTHING`
  ).bind(phone, name, meta.orderId || null, meta.userId || null, meta.dedupe || null, waId, status, rendered, error).run();
  return { status, error };
}

// Meta's error codes, in words the admin can act on.
function friendly(message) {
  if (/#132001|does not exist/i.test(message)) return "This message template isn't approved by Meta yet (see Message templates in the admin).";
  if (/#131026|undeliverable/i.test(message)) return "The customer's number isn't on WhatsApp.";
  if (/#131047|re-engagement/i.test(message)) return "More than 24 hours since the customer's last message.";
  if (/#190|access token|session has expired/i.test(message)) return "The WhatsApp access key is invalid or expired: update WHATSAPP_TOKEN in Cloudflare.";
  if (/#200|#10\b|authori[sz]ation|permission/i.test(message)) return "The WhatsApp access key has no permission for this WhatsApp account.";
  return message;
}

async function sendText(env, phone, text, kind) {
  let waId = null, status = "sent", error = null;
  try {
    const out = await graph(env, `${env.WHATSAPP_PHONE_ID}/messages`, {
      messaging_product: "whatsapp", to: phone, type: "text", text: { body: text, preview_url: false },
    });
    waId = out.messages && out.messages[0] && out.messages[0].id;
  } catch (e) {
    status = "failed";
    error = friendly(e.message);
  }
  await env.DB.prepare("INSERT INTO wa_messages (direction, phone, kind, wa_id, status, body, error) VALUES ('out', ?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(phone, kind, waId, status, text, error).run();
  return { status, error };
}

const first = (name) => String(name || "").trim().split(/\s+/)[0] || "there";
const kes = (n) => Math.round(n || 0).toLocaleString("en-KE");
const day = (sql) => new Date(String(sql).replace(" ", "T") + "Z").toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const DELIVERY = { pickup: "pick-up at the showroom", nairobi: "Nairobi (free)", outside: "outside Nairobi" };

// order: a row from the orders table (number, view_token, name, phone, total, consent, ...)
export async function orderCreated(env, order, itemCount) {
  const owner = env.OWNER_WHATSAPP;
  const tasks = [];
  if (owner) {
    tasks.push(sendTemplate(env, owner, "ne_new_order_alert",
      [order.number, order.name, order.phone, kes(order.total), String(itemCount),
        DELIVERY[order.delivery] + (order.town ? ` (${order.town})` : "")],
      { orderId: order.id, dedupe: `alert:${order.id}` }));
  }
  if (order.consent) {
    tasks.push(sendTemplate(env, order.phone, "ne_order_received", [first(order.name), order.number, kes(order.total)],
      { orderId: order.id, userId: order.user_id, dedupe: `received:${order.id}`, buttonParam: `n=${order.number}&k=${order.view_token}` }));
  }
  await Promise.all(tasks);
}

// After an admin changes an order's status. reward: { earned, balance, expires } or null.
export async function orderStatusChanged(env, order, status, reward) {
  if (!order.consent) return;
  const button = `n=${order.number}&k=${order.view_token}`;
  const meta = (key) => ({ orderId: order.id, userId: order.user_id, dedupe: `${key}:${order.id}`, buttonParam: button });
  if (status === "confirmed") await sendTemplate(env, order.phone, "ne_order_confirmed", [first(order.name), order.number], meta("confirmed"));
  if (status === "paid") await sendTemplate(env, order.phone, "ne_order_paid", [first(order.name), kes(order.total), order.number], meta("paid"));
  if (status === "delivered") await sendTemplate(env, order.phone, "ne_order_delivered", [first(order.name), order.number], meta("delivered"));
  if (reward && reward.earned > 0) {
    await sendTemplate(env, order.phone, "ne_reward_earned",
      [first(order.name), kes(reward.earned), order.number, kes(reward.balance), day(reward.expires)], meta("reward"));
  }
}

// Daily: remind customers 30 and 7 days before their next credit expires.
// replay(userId) -> { balance, next: { amount, expires } }
export async function expiryReminders(env, replay) {
  if (!configured(env)) return;
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name,
       (SELECT o.phone FROM orders o WHERE o.user_id = u.id AND o.consent = 1 ORDER BY o.id DESC LIMIT 1) AS phone
     FROM users u WHERE EXISTS (SELECT 1 FROM reward_ledger r WHERE r.user_id = u.id AND r.kind = 'earn')`
  ).all();
  const today = new Date();
  const inDays = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  for (const user of results) {
    if (!user.phone) continue;
    const { balance, next } = await replay(user.id);
    if (!balance || !next) continue;
    const date = String(next.expires).slice(0, 10);
    for (const days of [30, 7]) {
      if (date !== inDays(days)) continue;
      await sendTemplate(env, user.phone, "ne_credit_expiring", [first(user.name), kes(next.amount), day(next.expires)],
        { userId: user.id, dedupe: `expiry:${user.id}:${date}:${days}` });
    }
  }
}

// ---- webhook ---------------------------------------------------------------

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, typeof data === "string" ? new TextEncoder().encode(data) : data);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The token Meta sends when the webhook is set up; shown to the admin.
export async function verifyToken(env) {
  return env.META_APP_SECRET ? (await hmacHex(env.META_APP_SECRET, "ne-webhook-verify")).slice(0, 32) : null;
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function webhook(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const token = await verifyToken(env);
    if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token) {
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST" || !env.META_APP_SECRET) return new Response("Not found", { status: 404 });
  const raw = await request.arrayBuffer();
  const signature = (request.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
  if (!signature || !same(signature, await hmacHex(env.META_APP_SECRET, raw))) return new Response("Bad signature", { status: 401 });
  const payload = JSON.parse(new TextDecoder().decode(raw));
  await ensureTable(env);
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const st of value.statuses || []) {
        const error = st.errors && st.errors[0] ? `${st.errors[0].title || ""} ${st.errors[0].message || ""}`.trim() : null;
        await env.DB.prepare("UPDATE wa_messages SET status = ?2, error = coalesce(?3, error), updated_at = datetime('now') WHERE wa_id = ?1")
          .bind(st.id, st.status, error).run();
      }
      for (const msg of value.messages || []) {
        const phone = msg.from;
        const contact = (value.contacts || []).find((c) => c.wa_id === phone);
        const text = msg.type === "text" ? msg.text.body : `[${msg.type}]`;
        await env.DB.prepare("INSERT INTO wa_messages (direction, phone, kind, wa_id, status, body) VALUES ('in', ?1, ?2, ?3, 'received', ?4)")
          .bind(phone, contact && contact.profile ? contact.profile.name || "message" : "message", msg.id, text.slice(0, 2000)).run();
        if (!configured(env)) continue;
        // Auto-reply at most once per person every 12 hours, and never while staff are replying.
        const recent = await env.DB.prepare(
          "SELECT 1 FROM wa_messages WHERE phone = ?1 AND kind IN ('auto_reply', 'reply') AND created_at > datetime('now', '-12 hours')"
        ).bind(phone).first();
        if (!recent) await sendText(env, phone, AUTO_REPLY, "auto_reply");
        // Tell the owner on their own WhatsApp (at most every 30 minutes per customer).
        const owner = waNumber(env.OWNER_WHATSAPP);
        if (owner && owner !== phone) {
          const alerted = await env.DB.prepare(
            "SELECT 1 FROM wa_messages WHERE kind = 'ne_customer_message' AND body LIKE ?1 AND created_at > datetime('now', '-30 minutes')"
          ).bind(`%(+${phone})%`).first();
          const name = contact && contact.profile && contact.profile.name ? contact.profile.name : "a customer";
          if (!alerted) {
            await sendTemplate(env, owner, "ne_customer_message",
              [name.slice(0, 60), `+${phone}`, `"${text.replace(/\s+/g, " ").trim().slice(0, 180)}"`], {});
          }
        }
      }
    }
  }
  return new Response("OK", { status: 200 });
}

// ---- admin: conversations ---------------------------------------------------

// Everyone who has written to the updates number, newest first. "waiting" means
// their last message came after our last reply.
export async function chats(env) {
  await ensureTable(env);
  const { results } = await env.DB.prepare(
    `SELECT phone, max(created_at) AS last_at,
       (SELECT body FROM wa_messages b WHERE b.phone = m.phone ORDER BY id DESC LIMIT 1) AS last_body,
       (SELECT direction FROM wa_messages b WHERE b.phone = m.phone ORDER BY id DESC LIMIT 1) AS last_dir,
       (SELECT kind FROM wa_messages b WHERE b.phone = m.phone AND direction = 'in' ORDER BY id DESC LIMIT 1) AS name,
       (SELECT max(created_at) FROM wa_messages b WHERE b.phone = m.phone AND direction = 'in') AS last_in,
       (SELECT max(created_at) FROM wa_messages b WHERE b.phone = m.phone AND kind = 'reply') AS last_reply
     FROM wa_messages m
     WHERE phone IN (SELECT DISTINCT phone FROM wa_messages WHERE direction = 'in')
     GROUP BY phone ORDER BY last_at DESC LIMIT 100`
  ).all();
  const chatsOut = results.map((c) => ({ ...c, waiting: !c.last_reply || c.last_in > c.last_reply }));
  return { chats: chatsOut, waiting: chatsOut.filter((c) => c.waiting).length };
}

export async function chat(env, phone) {
  await ensureTable(env);
  const { results } = await env.DB.prepare(
    "SELECT id, direction, kind, status, body, error, created_at FROM wa_messages WHERE phone = ?1 ORDER BY id DESC LIMIT 200"
  ).bind(phone).all();
  const lastIn = results.find((m) => m.direction === "in");
  const open = Boolean(lastIn) && Date.now() - new Date(lastIn.created_at.replace(" ", "T") + "Z").getTime() < 24 * 3600 * 1000;
  return { phone, name: lastIn ? lastIn.kind : null, open, messages: results.reverse() };
}

// Free-form replies are only allowed within 24 hours of the customer's last message.
export async function reply(env, phone, text) {
  const body = String(text || "").trim().slice(0, 4000);
  if (!/^\d{8,15}$/.test(phone) || !body) return { error: "Write a message first." };
  const { open } = await chat(env, phone);
  if (!open) return { error: "It is more than 24 hours since this customer last wrote, so WhatsApp only allows approved templates. Message them from your 0737 WhatsApp instead." };
  return sendText(env, phone, body, "reply");
}

// ---- admin -----------------------------------------------------------------

export async function adminStatus(env, origin) {
  await ensureTable(env);
  const out = {
    configured: configured(env),
    hasToken: Boolean(env.WHATSAPP_TOKEN), hasAppSecret: Boolean(env.META_APP_SECRET),
    phoneId: env.WHATSAPP_PHONE_ID || null, wabaId: env.WHATSAPP_WABA_ID || null, owner: env.OWNER_WHATSAPP || null,
    webhookUrl: `${origin}/api/whatsapp/webhook`, verifyToken: await verifyToken(env),
    templates: [], number: null,
  };
  const { results } = await env.DB.prepare("SELECT * FROM wa_messages ORDER BY id DESC LIMIT 60").all();
  out.messages = results;
  if (out.configured) {
    try {
      const num = await graph(env, `${env.WHATSAPP_PHONE_ID}?fields=display_phone_number,verified_name,name_status,quality_rating,messaging_limit_tier`);
      out.number = num;
    } catch (e) { out.numberError = e.message; }
    if (env.WHATSAPP_WABA_ID) {
      try {
        const list = await graph(env, `${env.WHATSAPP_WABA_ID}/message_templates?fields=name,status,category,rejected_reason&limit=100`);
        out.templates = TEMPLATES.map((t) => {
          const found = (list.data || []).find((d) => d.name === t.name);
          return { name: t.name, body: t.body, status: found ? found.status : "NOT SUBMITTED", category: found ? found.category : null, reason: found ? found.rejected_reason : null };
        });
      } catch (e) { out.templatesError = e.message; }
    }
  }
  return out;
}

export async function submitTemplates(env) {
  const results = [];
  for (const t of TEMPLATES) {
    const components = [{ type: "BODY", text: t.body, example: { body_text: [t.example] } }, { type: "FOOTER", text: t.footer || FOOTER }];
    if (t.button) components.push({ type: "BUTTONS", buttons: [t.button.example ? t.button : { type: "URL", text: t.button.text, url: t.button.url }] });
    try {
      await graph(env, `${env.WHATSAPP_WABA_ID}/message_templates`, { name: t.name, language: "en", category: "UTILITY", components });
      results.push(`${t.name}: submitted`);
    } catch (e) {
      const msg = /already exists|duplicate|already .*content/i.test(e.message) ? "already submitted"
        : /category .* doesn't match/i.test(e.message) ? "already submitted (Meta filed it as Marketing)" : e.message;
      results.push(`${t.name}: ${msg}`);
    }
  }
  return results;
}

export async function updateProfile(env) {
  await graph(env, `${env.WHATSAPP_PHONE_ID}/whatsapp_business_profile`, { messaging_product: "whatsapp", ...PROFILE });
}

export async function sendTest(env) {
  return sendTemplate(env, env.OWNER_WHATSAPP, "ne_new_order_alert",
    ["NE-TEST", "Test customer", "0712 345 678", "1,000", "1", "pick-up at the showroom"], {});
}
