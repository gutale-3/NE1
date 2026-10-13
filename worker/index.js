// NE back office: Google sign-in, sessions and the admin product editor.
//
// Every public page is still a static file. This Worker only runs for the
// paths listed in wrangler.jsonc `run_worker_first`; everything else falls
// through to env.ASSETS.
//
// Admin edits are committed to data/products.json on GitHub. The Cloudflare
// build then runs tools/build-catalog.py, so product pages stay static.

const SESSION_COOKIE = "ne_session";
const OAUTH_COOKIE = "ne_oauth";
const SESSION_DAYS = 30;
const PRODUCTS_PATH = "data/products.json";
// Readable by page scripts (unlike the session cookie), so static pages only
// call /api/me for people who have signed in.
const HINT_COOKIE = "ne_signed_in";
const WELCOME_COOKIE = "ne_welcome";

import * as wa from "./whatsapp.js";
import * as partners from "./partners.js";
import * as docs from "./documents.js";
import * as accounts from "./accounts.js";
import * as team from "./team.js";
import * as sales from "./sales.js";

// Runs a side job (e.g. a WhatsApp message) after the response, without failing the request.
function later(ctx, job) {
  const safe = Promise.resolve().then(job).catch((error) => console.error("background job failed:", error.stack || error));
  if (ctx && ctx.waitUntil) ctx.waitUntil(safe);
  return safe;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(wa.expiryReminders(env, (userId) => rewardBalance(env, userId)));
    ctx.waitUntil(wa.reviewRequests(env));
    ctx.waitUntil(creditJobs(env));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/auth/google/login") return await googleLogin(env, url);
      if (path === "/auth/google/callback") return await googleCallback(request, env, url);
      if (path === "/auth/logout") return await logout(request, env);
      if (path === "/api/me") return await me(request, env);
      if (path === "/admin" || path.startsWith("/admin/")) return await adminPage(request, env, url);
      if (path === "/account" || path.startsWith("/account/")) return await accountPage(request, env, url);
      if (path === "/partner" || path.startsWith("/partner/")) return await accountPage(request, env, url, "/partner/");
      if (path === "/api/partner") return await partnerApi(request, env, url, ctx);
      if (path === "/api/partner/proof") return await partnerProof(request, env, url);
      if (path === "/team" || path.startsWith("/team/")) return await accountPage(request, env, url, "/team/");
      if (path === "/api/team") return await teamApi(request, env, url, ctx);
      if (path === "/api/team/proof") return await teamProof(request, env, url);
      if (path === "/api/team/doc") return await teamDoc(request, env, url);
      if (path === "/api/account/application") return await accountApplication(request, env, url);
      if (path === "/api/account/summary") return await accountSummary(request, env);
      if (path === "/api/orders") return await createOrder(request, env, url, ctx);
      if (path === "/api/whatsapp/webhook") return await wa.webhook(request, env);
      // Order links from WhatsApp buttons can lose their "?", e.g. /order/n=NE-1005&k=…
      if (path.startsWith("/order/") && path !== "/order/" && !/\.(js|css|svg|png|webp)$/.test(path)) {
        return env.ASSETS.fetch(new Request(new URL("/order/", url.origin), request));
      }
      if (path === "/api/orders/view") return await viewOrder(request, env, url);
      if (path.startsWith("/api/admin/")) return await adminApi(request, env, url, ctx);
    } catch (error) {
      console.error(error.stack || error);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};

// ---- helpers ---------------------------------------------------------------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function randomToken(bytes = 32) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function hintCookie(on) {
  return `${HINT_COOKIE}=${on ? "1" : ""}; Path=/; Secure; SameSite=Lax; Max-Age=${on ? SESSION_DAYS * 86400 : 0}`;
}

function techDiscount(env) {
  const pct = Number(env.TECH_DISCOUNT_PERCENT || 5);
  return Number.isFinite(pct) && pct > 0 && pct < 50 ? pct : 5;
}

function siteOrigin(env, url) {
  return env.SITE_ORIGIN || url.origin;
}

function adminEmails(env) {
  return (env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function isAdmin(env, user) {
  return Boolean(user && adminEmails(env).includes(user.email.toLowerCase()));
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// A small branded page for sign-in problems. `actions` is [{ href, label, primary }].
function messagePage(status, title, message, actions = []) {
  const buttons = actions.map((a) =>
    `<a class="btn${a.primary ? " primary" : ""}" href="${escapeHtml(a.href)}">${escapeHtml(a.label)}</a>`).join("");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)} | NE</title><link rel="icon" type="image/png" href="/assets/nashnaal-favicon.png">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#F6F8FA;color:#10202E}
.card{width:100%;max-width:440px;background:#fff;border:1px solid #E7ECF1;border-radius:18px;padding:32px 28px;text-align:center;box-shadow:0 10px 30px rgba(16,32,46,.08)}
.card img{width:56px;height:56px;border-radius:12px}h1{font-size:22px;margin:16px 0 8px}
p{font-size:15px;line-height:1.6;color:#4A5B68;margin:0 0 24px}.actions{display:grid;gap:10px}
.btn{display:block;padding:13px 16px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;border:1.5px solid #D5DEE5;color:#10202E}
.btn.primary{background:#086E9E;border-color:#086E9E;color:#fff}
</style></head><body><main class="card">
<img src="/assets/nashnaal-logo-header.webp" alt="NE" width="56" height="56">
<h1>${escapeHtml(title)}</h1><p>${message}</p><div class="actions">${buttons}</div>
</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

const TRY_AGAIN = { href: "/auth/google/login?next=/admin", label: "Try again", primary: true };
const HOME = { href: "/", label: "Back to the website" };

// Only send people back to a path on this site.
function safeNext(value) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

// ---- Google sign-in (OAuth 2.0 authorization code + PKCE) ------------------

async function googleLoginRedirect(env, url) {
  const state = randomToken();
  const verifier = randomToken(48);
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${siteOrigin(env, url)}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  const payload = JSON.stringify({ state, verifier, next: safeNext(url.searchParams.get("next")) });
  return new Response(null, {
    status: 302,
    headers: {
      location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "set-cookie": cookie(OAUTH_COOKIE, payload, 600),
      "cache-control": "no-store",
    },
  });
}

function googleLogin(env, url) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return messagePage(503, "Sign-in is not ready", "Sign-in has not been set up on this site yet.", [HOME]);
  }
  return googleLoginRedirect(env, url);
}

async function googleCallback(request, env, url) {
  const saved = JSON.parse(getCookie(request, OAUTH_COOKIE) || "null");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) {
    return messagePage(400, "Sign-in cancelled", "You did not finish signing in with Google.", [TRY_AGAIN, HOME]);
  }
  if (!saved || !code || url.searchParams.get("state") !== saved.state) {
    return messagePage(400, "Sign-in expired", "That sign-in link has expired or was opened twice. Please start again.", [TRY_AGAIN, HOME]);
  }
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${siteOrigin(env, url)}/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenResponse.ok) {
    console.error("token exchange failed", await tokenResponse.text());
    return messagePage(400, "Google sign-in failed", "Google did not accept the sign-in. Please try again.", [TRY_AGAIN, HOME]);
  }
  const { id_token: idToken } = await tokenResponse.json();
  // The ID token came straight from Google's token endpoint over TLS, so its
  // claims can be read without verifying the signature; we still check them.
  const claims = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issuerOk || claims.aud !== env.GOOGLE_CLIENT_ID || !claims.email_verified || claims.exp * 1000 < Date.now()) {
    return messagePage(400, "Sign-in could not be verified", "Use a Google account with a verified email address.", [TRY_AGAIN, HOME]);
  }

  const email = String(claims.email).toLowerCase();
  const role = adminEmails(env).includes(email) ? "admin" : "customer";
  const user = await env.DB.prepare(
    `INSERT INTO users (google_sub, email, name, picture, role, last_login)
     VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
     ON CONFLICT(google_sub) DO UPDATE SET email = ?2, name = ?3, picture = ?4,
       role = CASE WHEN ?5 = 'admin' THEN 'admin' WHEN users.role = 'admin' THEN 'customer' ELSE users.role END,
       last_login = datetime('now')
     RETURNING id, created_at = last_login AS fresh`
  ).bind(claims.sub, email, claims.name || "", claims.picture || "", role).first();

  const sessionId = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(await sha256(sessionId), user.id, Date.now() + SESSION_DAYS * 86400 * 1000)
    .run();

  const headers = new Headers({ location: safeNext(saved.next), "cache-control": "no-store" });
  headers.append("set-cookie", cookie(SESSION_COOKIE, sessionId, SESSION_DAYS * 86400));
  headers.append("set-cookie", cookie(OAUTH_COOKIE, "", 0));
  headers.append("set-cookie", hintCookie(true));
  // First sign-in: the site shows a one-time welcome (js/site.js, account.js).
  if (user.fresh) headers.append("set-cookie", `${WELCOME_COOKIE}=1; Path=/; Secure; SameSite=Lax; Max-Age=900`);
  return new Response(null, { status: 302, headers });
}

async function currentUser(request, env) {
  const sessionId = getCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  return env.DB.prepare(
    `SELECT users.id, users.email, users.name, users.picture, users.role, users.technician_status
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ?1 AND sessions.expires_at > ?2`
  ).bind(await sha256(sessionId), Date.now()).first();
}

async function logout(request, env) {
  const sessionId = getCookie(request, SESSION_COOKIE);
  if (sessionId) await env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(await sha256(sessionId)).run();
  const headers = new Headers({ location: safeNext(new URL(request.url).searchParams.get("next")), "cache-control": "no-store" });
  headers.append("set-cookie", cookie(SESSION_COOKIE, "", 0));
  headers.append("set-cookie", hintCookie(false));
  return new Response(null, { status: 302, headers });
}

async function me(request, env) {
  const user = await currentUser(request, env);
  // A stale hint (session expired or signed out elsewhere) is cleared.
  if (!user) return json({ signedIn: false }, 200, { "set-cookie": hintCookie(false) });
  const approved = user.role === "technician" && user.technician_status === "approved";
  const partner = await partners.partnerOf(env, user.id);
  return json({
    signedIn: true, name: user.name, email: user.email, admin: isAdmin(env, user),
    partner: partner ? partner.status : null,
    technician: user.technician_status || null,
    techDiscount: approved ? techDiscount(env) : 0,
    rewardPercent: rewardPercent(env, approved),
  });
}

// ---- customer / technician account -------------------------------------------

// Signed-in pages: /account (customers and technicians) and /partner (trade partners).
async function accountPage(request, env, url, home = "/account/") {
  const user = await currentUser(request, env);
  if (!user) {
    const next = home === "/team/" && url.pathname.startsWith("/team/job/") ? url.pathname : home;
    return Response.redirect(`${url.origin}/auth/google/login?next=${encodeURIComponent(next)}`, 302);
  }
  // Job links from WhatsApp (/team/job/12) open the team page on that job.
  let assetPath = url.pathname === home.slice(0, -1) || /^\/team\/job\//.test(url.pathname) ? home : url.pathname;
  // Team members' invoices and receipts use the same printable page as the admin's.
  if (/^\/team\/doc\/?$/.test(url.pathname)) assetPath = "/admin/doc/";
  const asset = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin), request));
  const response = new Response(asset.body, asset);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-robots-tag", "noindex");
  return response;
}

const APPLICATION_FIELDS = {
  full_name: { label: "Full name", max: 80, required: true },
  phone: { label: "Phone / WhatsApp", max: 30, required: true },
  business: { label: "Business name", max: 100 },
  town: { label: "Town / area", max: 80, required: true },
  years: { label: "Years installing CCTV", max: 20 },
  cert_number: { label: "Hikvision certificate number", max: 80 },
  work_link: { label: "Link to your work", max: 300 },
};

async function accountApplication(request, env, url) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Please sign in first." }, 401);
  if (request.method === "GET") {
    const app = await env.DB.prepare("SELECT * FROM technician_applications WHERE user_id = ?1").bind(user.id).first();
    return json({ application: app || null, user: { name: user.name, email: user.email }, discount: techDiscount(env) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Bad request origin." }, 403);

  const body = await request.json();
  const values = {};
  for (const [key, rule] of Object.entries(APPLICATION_FIELDS)) {
    const value = String(body[key] ?? "").trim().slice(0, rule.max);
    if (rule.required && !value) return json({ error: `${rule.label} is required.` }, 400);
    values[key] = value;
  }
  if (!/^[+0-9 ()-]{9,20}$/.test(values.phone)) return json({ error: "Enter a valid phone number, e.g. 0712 345 678." }, 400);
  if (values.work_link && !/^https?:\/\//i.test(values.work_link)) values.work_link = `https://${values.work_link}`;

  const existing = await env.DB.prepare("SELECT status FROM technician_applications WHERE user_id = ?1").bind(user.id).first();
  if (existing && existing.status === "approved") return json({ error: "You are already an approved technician." }, 400);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO technician_applications (user_id, full_name, phone, business, town, years, cert_number, work_link, status)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending')
       ON CONFLICT(user_id) DO UPDATE SET full_name = ?2, phone = ?3, business = ?4, town = ?5, years = ?6,
         cert_number = ?7, work_link = ?8, status = 'pending', updated_at = datetime('now'), decided_at = NULL`
    ).bind(user.id, values.full_name, values.phone, values.business, values.town, values.years, values.cert_number, values.work_link),
    env.DB.prepare("UPDATE users SET technician_status = 'pending' WHERE id = ?1 AND role != 'admin'").bind(user.id),
  ]);
  return json({ ok: true, status: "pending" });
}

// ---- admin -----------------------------------------------------------------

async function adminPage(request, env, url) {
  // The printable invoice script is shared with /team/doc/ (it holds no data).
  if (url.pathname === "/admin/doc/doc.js") return env.ASSETS.fetch(request);
  const user = await currentUser(request, env);
  if (!user) {
    return Response.redirect(`${url.origin}/auth/google/login?next=${encodeURIComponent(url.pathname)}`, 302);
  }
  if (!isAdmin(env, user)) {
    return messagePage(403, "This account can't open the admin area",
      `You are signed in as <strong>${escapeHtml(user.email)}</strong>, which is not an NE admin account. ` +
      "Sign out, then sign in again with the admin Google account.",
      [{ href: "/auth/logout?next=" + encodeURIComponent("/auth/google/login?next=/admin"), label: "Sign out and use another account", primary: true },
       { href: "/auth/logout", label: "Sign out" }, HOME]);
  }
  const pay = /^\/admin\/payment\/(\d+)\/?$/.exec(url.pathname);
  if (pay) return paymentPage(env, Number(pay[1]));
  const coll = /^\/admin\/collection\/(\d+)\/?$/.exec(url.pathname);
  if (coll) return collectionPage(env, Number(coll[1]));
  const assetPath = url.pathname === "/admin" ? "/admin/" : url.pathname;
  const asset = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin), request));
  const response = new Response(asset.body, asset);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-robots-tag", "noindex");
  return response;
}

async function adminApi(request, env, url, ctx) {
  const user = await currentUser(request, env);
  if (!isAdmin(env, user)) return json({ error: "Not signed in as an admin." }, 401);
  if (request.method !== "GET") {
    // Cross-site request protection on top of SameSite cookies.
    const origin = request.headers.get("origin");
    if (origin !== url.origin || request.headers.get("x-ne-admin") !== "1") return json({ error: "Bad request origin." }, 403);
  }
  if (url.pathname === "/api/admin/technicians" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT a.*, u.email FROM technician_applications a JOIN users u ON u.id = a.user_id
       ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, a.updated_at DESC`
    ).all();
    return json({ technicians: results, discount: techDiscount(env) });
  }
  if (url.pathname === "/api/admin/technicians" && request.method === "POST") {
    return decideTechnician(request, env, user);
  }
  if (url.pathname === "/api/admin/orders") return adminOrders(request, env, url, user, ctx);
  if (url.pathname === "/api/admin/whatsapp") return adminWhatsApp(request, env, url);
  if (url.pathname === "/api/admin/whatsapp/chats" && request.method === "GET") return json(await wa.chats(env));
  if (url.pathname === "/api/admin/whatsapp/chat" && request.method === "GET") return json(await wa.chat(env, (url.searchParams.get("phone") || "").replace(/\D/g, "")));
  if (url.pathname === "/api/admin/customers" && request.method === "GET") return adminCustomers(env, url);
  if (url.pathname === "/api/admin/statement" && request.method === "GET") return adminStatement(env, url);
  if (url.pathname === "/api/admin/funnel" && request.method === "GET") return adminFunnel(env);
  if (url.pathname === "/api/admin/partners") return adminPartners(request, env, url, user);
  if (url.pathname === "/api/admin/documents") return adminDocuments(request, env, url, user);
  if (url.pathname === "/api/admin/team") return adminTeam(request, env, url, user, ctx);
  if (url.pathname === "/api/admin/products" && !env.GITHUB_TOKEN) {
    return json({ error: "GITHUB_TOKEN is not set in Cloudflare." }, 503);
  }

  if (url.pathname === "/api/admin/products" && request.method === "GET") {
    try {
      const { products } = await loadProducts(env);
      return json({ products: products.map(summary), user: { name: user.name, email: user.email } });
    } catch (error) {
      if (error.status) return json({ error: githubHelp(error) }, 502);
      throw error;
    }
  }
  if (url.pathname === "/api/admin/products" && request.method === "POST") {
    return saveProduct(request, env, user);
  }
  if (url.pathname === "/api/admin/log" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT action, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 30"
    ).all();
    return json({ log: results });
  }
  return json({ error: "Not found." }, 404);
}

async function decideTechnician(request, env, admin) {
  const { user_id: userId, decision } = await request.json();
  const status = { approve: "approved", reject: "rejected", remove: "removed" }[decision];
  if (!status || !Number.isInteger(userId)) return json({ error: "Bad request." }, 400);
  const app = await env.DB.prepare(
    "SELECT a.full_name, u.email FROM technician_applications a JOIN users u ON u.id = a.user_id WHERE a.user_id = ?1"
  ).bind(userId).first();
  if (!app) return json({ error: "Application not found." }, 404);
  await env.DB.batch([
    env.DB.prepare("UPDATE technician_applications SET status = ?2, decided_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?1")
      .bind(userId, status),
    env.DB.prepare(
      "UPDATE users SET technician_status = ?2, role = CASE WHEN role = 'admin' THEN role WHEN ?2 = 'approved' THEN 'technician' ELSE 'customer' END WHERE id = ?1"
    ).bind(userId, status),
    env.DB.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?1, ?2, ?3)")
      .bind(admin.id, `technician-${decision}`, `Technician ${status}: ${app.full_name} (${app.email})`),
  ]);
  return json({ ok: true, status });
}

function summary(p) {
  return {
    id: p.id, slug: p.slug, model: p.model, name: p.name, category: p.category, price: p.price,
    features: p.features || "", pcsCtn: p.pcsCtn || "", image: p.image, url: p.url, brand: p.brand,
  };
}

// Python's slugify in tools/catalog.py.
function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function githubHelp(error) {
  console.error(error.message);
  const detail = (error.message.match(/"message":\s*"([^"]+)"/) || [])[1] || "";
  if (error.status === 401) return "GitHub rejected the token (expired or wrong). Make a new GITHUB_TOKEN and update it in Cloudflare.";
  if (error.status === 403 || error.status === 404) {
    return "GitHub refused to save: the token can read but not write. Edit the token on GitHub and set Repository permissions → Contents → Read and write for gutale-3/NE1." +
      (detail ? ` (GitHub said: ${detail})` : "");
  }
  return `GitHub error ${error.status}${detail ? `: ${detail}` : ""}. Please try again.`;
}

// ---- GitHub (git data API, so one commit can hold the JSON and a photo) -----

async function gh(env, path, init = {}) {
  const response = await fetch(`${env.GITHUB_API || "https://api.github.com"}/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: init.accept || "application/vnd.github+json",
      "user-agent": "ne-admin",
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`GitHub ${init.method || "GET"} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return init.accept === "application/vnd.github.raw+json" ? response.text() : response.json();
}

async function loadProducts(env) {
  const branch = env.GITHUB_BRANCH || "main";
  const ref = await gh(env, `/git/ref/heads/${encodeURIComponent(branch)}`);
  const head = ref.object.sha;
  const text = await gh(env, `/contents/${PRODUCTS_PATH}?ref=${head}`, { accept: "application/vnd.github.raw+json" });
  return { head, products: JSON.parse(text) };
}

async function commitFiles(env, head, files, message, user) {
  const branch = env.GITHUB_BRANCH || "main";
  const commit = await gh(env, `/git/commits/${head}`);
  const tree = [];
  for (const file of files) {
    const blob = await gh(env, "/git/blobs", {
      method: "POST",
      body: JSON.stringify(file.base64 ? { content: file.base64, encoding: "base64" } : { content: file.text, encoding: "utf-8" }),
    });
    tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await gh(env, "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: commit.tree.sha, tree }) });
  const newCommit = await gh(env, "/git/commits", {
    method: "POST",
    body: JSON.stringify({
      message: `${message}\n\nEdited in the NE admin panel by ${user.email}.`,
      tree: newTree.sha,
      parents: [head],
      author: { name: user.name || user.email, email: user.email },
    }),
  });
  // Fails with 422 if someone else committed in between; the caller retries.
  await gh(env, `/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: JSON.stringify({ sha: newCommit.sha }) });
  return newCommit.sha;
}

const EDITABLE = ["name", "category", "price", "features", "pcsCtn"];

function cleanFields(input) {
  const out = {};
  for (const key of EDITABLE) {
    if (!(key in input)) continue;
    if (key === "price") {
      const price = Math.round(Number(input.price));
      if (!Number.isFinite(price) || price <= 0) throw new UserError("Price must be a number above 0.");
      out.price = price;
    } else {
      out[key] = String(input[key] ?? "").trim();
    }
  }
  if ("name" in out && !out.name) throw new UserError("Name cannot be empty.");
  if ("category" in out && !out.category) throw new UserError("Pick a category.");
  return out;
}

class UserError extends Error {}

async function saveProduct(request, env, user) {
  const body = await request.json();
  const action = body.action;
  if (!["update", "add", "delete"].includes(action)) return json({ error: "Unknown action." }, 400);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { head, products } = await loadProducts(env);
      const files = [];
      let message;
      let target;

      if (action === "add") {
        const model = String(body.product?.model || "").trim();
        if (!model) throw new UserError("Model number is required.");
        const slug = slugify(model);
        if (products.some((p) => p.slug === slug || p.model.trim() === model)) throw new UserError("A product with this model already exists.");
        const fields = cleanFields(body.product);
        for (const key of ["name", "category", "price"]) if (!(key in fields)) throw new UserError(`${key} is required.`);
        target = {
          category: fields.category, name: fields.name, model, features: fields.features || "",
          pcsCtn: fields.pcsCtn || "", retail: fields.price, price: fields.price, image: "",
          id: Math.max(0, ...products.map((p) => p.id || 0)) + 1, slug, url: `/product/${slug}`,
        };
        products.push(target);
        message = `Add product ${model}`;
      } else {
        target = products.find((p) => p.slug === body.slug);
        if (!target) throw new UserError("That product no longer exists. Reload the list.");
        if (action === "delete") {
          // Bundles are defined in tools/build-catalog.py; deleting one of their
          // products would fail the build, so the build publishes the list.
          const inBundles = JSON.parse(await gh(env, `/contents/data/bundle-models.json?ref=${head}`, { accept: "application/vnd.github.raw+json" }));
          if (inBundles.includes(target.model)) throw new UserError("This product is part of a bundle. Remove it from the bundle first (ask your developer).");
          products.splice(products.indexOf(target), 1);
          message = `Remove product ${target.model.trim()}`;
        } else {
          const fields = cleanFields(body.product || {});
          const changes = Object.keys(fields).filter((k) => fields[k] !== target[k]);
          Object.assign(target, fields);
          message = `Update ${target.model.trim()}: ${changes.join(", ") || "photo"}`;
          if (!changes.length && !body.image) return json({ ok: true, unchanged: true });
        }
      }

      if (body.image && action !== "delete") {
        const { base64, type } = body.image;
        if (!["image/webp", "image/jpeg", "image/png"].includes(type)) throw new UserError("Photo must be WebP, JPEG or PNG.");
        if (base64.length > 2_800_000) throw new UserError("Photo is too large (max about 2 MB).");
        const ext = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[type];
        const path = `images/uploads/${target.slug}-${Date.now().toString(36)}.${ext}`;
        files.push({ path, base64 });
        target.image = path;
      }
      if (action === "add" && !target.image) throw new UserError("Add a photo for the new product.");

      files.push({ path: PRODUCTS_PATH, text: JSON.stringify(products, null, 2) + "\n" });
      const sha = await commitFiles(env, head, files, message, user);
      await env.DB.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?1, ?2, ?3)")
        .bind(user.id, action, message).run();
      return json({ ok: true, commit: sha, message, product: action === "delete" ? null : summary(target) });
    } catch (error) {
      if (error instanceof UserError) return json({ error: error.message }, 400);
      if (error.status === 422 && attempt === 0) continue; // branch moved; reload and retry once
      if (error.status) return json({ error: githubHelp(error) }, 502);
      throw error;
    }
  }
  return json({ error: "Someone else saved at the same time. Please try again." }, 409);
}

// ---- cart orders and rewards -------------------------------------------------
//
// Anyone can order. Prices always come from data/prices.json (written by the
// build), never from the browser. Signed-in buyers earn REWARD_PERCENT (2%) of
// a paid order as credit, approved technicians TECH_REWARD_PERCENT (1%); credit
// expires after REWARD_MONTHS and is spent oldest-first.

const REWARD_MONTHS = 6;
const DELIVERY = { pickup: "Pick up at the NE showroom", nairobi: "Delivery in Nairobi (free)", outside: "Outside Nairobi" };
const TRANSPORT = { courier: "courier", bus: "bus", other: "other transport" };
let priceCache = { at: 0, data: null };

async function priceList(env, origin) {
  if (priceCache.data && Date.now() - priceCache.at < 60_000) return priceCache.data;
  const response = await env.ASSETS.fetch(new Request(`${origin}/data/prices.json`));
  priceCache = { at: Date.now(), data: await response.json() };
  return priceCache.data;
}

function rewardPercent(env, technician) {
  return Number(technician ? env.TECH_REWARD_PERCENT || 1 : env.REWARD_PERCENT || 2);
}

function isApprovedTech(user) {
  return Boolean(user && user.role === "technician" && user.technician_status === "approved");
}

function sqlNow(offsetMonths = 0) {
  const d = new Date();
  if (offsetMonths) d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function kes(n) {
  return `KES ${Math.round(n).toLocaleString("en-KE")}`;
}

// Replays the ledger: each spend uses the oldest credit that was still valid.
async function rewardBalance(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT kind, amount, expires_at, created_at FROM reward_ledger WHERE user_id = ?1 ORDER BY created_at, id"
  ).bind(userId).all();
  return replayLedger(results);
}

// rows: one user's ledger, oldest first. Returns what is still spendable, the
// next credit to expire, and the totals earned, spent and lost to expiry.
function replayLedger(rows) {
  const buckets = [];
  let earned = 0;
  let spent = 0;
  for (const row of rows) {
    if (row.kind === "earn") earned += row.amount; else spent += row.amount;
    if (row.kind === "earn") {
      buckets.push({ left: row.amount, expires: row.expires_at });
      buckets.sort((a, b) => (a.expires < b.expires ? -1 : 1));
    } else {
      let need = row.amount;
      for (const bucket of buckets) {
        if (need <= 0) break;
        if (bucket.expires <= row.created_at || bucket.left <= 0) continue;
        const take = Math.min(bucket.left, need);
        bucket.left -= take;
        need -= take;
      }
    }
  }
  const now = sqlNow();
  const live = buckets.filter((b) => b.left > 0 && b.expires > now);
  const balance = live.reduce((sum, b) => sum + b.left, 0);
  const expired = buckets.filter((b) => b.left > 0 && b.expires <= now).reduce((sum, b) => sum + b.left, 0);
  const next = live[0] ? { amount: live[0].left, expires: live[0].expires } : null;
  return { balance, next, earned, spent, expired };
}

function clean(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function orderMessage(order, items, url) {
  const lines = [`Hi NE, I'd like to place an order.`, `Order ${order.number}`, ""];
  for (const item of items) lines.push(`• ${item.qty} × ${item.name} (${item.model}) — ${kes(item.qty * item.price)}`);
  lines.push("", `Subtotal: ${kes(order.subtotal)}`);
  if (order.tech_discount) lines.push(`Technician discount: -${kes(order.tech_discount)}`);
  if (order.reward_used) lines.push(`Reward credit used: -${kes(order.reward_used)}`);
  lines.push(`Total: ${kes(order.total)}`, "");
  let delivery = DELIVERY[order.delivery];
  if (order.delivery === "outside") delivery += `: ${order.town}, by ${TRANSPORT[order.transport] || "courier"} (fare paid by me)`;
  lines.push(`Delivery: ${delivery}`, `Name: ${order.name}`, `Phone: ${order.phone}`);
  if (order.notes) lines.push(`Notes: ${order.notes}`);
  lines.push("", `Order details: ${url}`);
  return lines.join("\n");
}

async function createOrder(request, env, url, ctx) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Bad request origin." }, 403);
  const body = await request.json();

  const wanted = new Map();
  for (const item of Array.isArray(body.items) ? body.items.slice(0, 60) : []) {
    const qty = Math.floor(Number(item.qty));
    if (typeof item.slug !== "string" || !(qty >= 1 && qty <= 999)) continue;
    wanted.set(item.slug, Math.min(999, (wanted.get(item.slug) || 0) + qty));
  }
  if (!wanted.size) return json({ error: "Your cart is empty." }, 400);
  const prices = await priceList(env, url.origin);
  const items = [];
  for (const [slug, qty] of wanted) {
    const p = prices[slug];
    if (p) items.push({ slug, model: p.m, name: p.n, qty, price: p.p });
  }
  if (!items.length) return json({ error: "These products are no longer available. Please refresh the page." }, 400);

  const customer = body.customer || {};
  const name = clean(customer.name, 80);
  const phone = clean(customer.phone, 20);
  const email = clean(customer.email, 120).toLowerCase();
  if (!name) return json({ error: "Please enter your name." }, 400);
  if (!/^[+0-9 ()-]{9,20}$/.test(phone)) return json({ error: "Please enter a valid phone number, e.g. 0712 345 678." }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "That email address does not look right." }, 400);
  const delivery = DELIVERY[body.delivery?.type] ? body.delivery.type : null;
  if (!delivery) return json({ error: "Choose pick-up or delivery." }, 400);
  const town = delivery === "outside" ? clean(body.delivery.town, 80) : "";
  const transport = delivery === "outside" ? (TRANSPORT[body.delivery.transport] ? body.delivery.transport : "courier") : null;
  if (delivery === "outside" && !town) return json({ error: "Enter the town for delivery." }, 400);
  const channel = body.channel === "website" ? "website" : "whatsapp";

  const user = await currentUser(request, env);
  const tech = isApprovedTech(user);
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  const techDiscountAmount = tech ? Math.round((subtotal * techDiscount(env)) / 100) : 0;
  let rewardUsed = 0;
  if (user && body.useReward) {
    const { balance } = await rewardBalance(env, user.id);
    rewardUsed = Math.min(balance, subtotal - techDiscountAmount);
  }
  const total = subtotal - techDiscountAmount - rewardUsed;
  const token = randomToken(18);

  const row = await env.DB.prepare(
    `INSERT INTO orders (view_token, user_id, name, phone, email, delivery, town, transport, notes, items_json,
       subtotal, tech_discount, reward_used, total, earn_rate, channel, consent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17) RETURNING id`
  ).bind(token, user ? user.id : null, name, phone, email || null, delivery, town || null, transport,
    clean(body.notes, 500) || null, JSON.stringify(items), subtotal, techDiscountAmount, rewardUsed, total,
    user ? rewardPercent(env, tech) : 0, channel, body.consent ? 1 : 0).first();
  const number = `NE-${1000 + row.id}`;
  const statements = [env.DB.prepare("UPDATE orders SET number = ?2 WHERE id = ?1").bind(row.id, number)];
  if (rewardUsed) {
    statements.push(env.DB.prepare("INSERT INTO reward_ledger (user_id, order_id, kind, amount) VALUES (?1, ?2, 'spend', ?3)")
      .bind(user.id, row.id, rewardUsed));
  }
  await env.DB.batch(statements);

  const order = { number, subtotal, tech_discount: techDiscountAmount, reward_used: rewardUsed, total, delivery, town, transport, name, phone, notes: clean(body.notes, 500) };
  const viewUrl = `${siteOrigin(env, url)}/order/?n=${number}&k=${token}`;
  later(ctx, () => wa.orderCreated(env, {
    id: row.id, number, view_token: token, name, phone, total, delivery, town, consent: body.consent ? 1 : 0, user_id: user ? user.id : null,
  }, items.reduce((n, i) => n + i.qty, 0)));
  later(ctx, () => routeOrder(env, row.id));
  return json({ ok: true, number, token, total, viewUrl, message: orderMessage(order, items, viewUrl) });
}

function orderPublic(order) {
  return {
    number: order.number, created_at: order.created_at, status: order.status, name: order.name, phone: order.phone,
    email: order.email, delivery: order.delivery, deliveryLabel: DELIVERY[order.delivery], town: order.town,
    transport: order.transport, notes: order.notes, items: JSON.parse(order.items_json), subtotal: order.subtotal,
    tech_discount: order.tech_discount, reward_used: order.reward_used, total: order.total,
    reward_earned: order.reward_earned, channel: order.channel,
  };
}

async function viewOrder(request, env, url) {
  const number = url.searchParams.get("n") || "";
  const order = await env.DB.prepare("SELECT * FROM orders WHERE number = ?1").bind(number).first();
  if (!order) return json({ error: "Order not found." }, 404);
  const tokenOk = url.searchParams.get("k") === order.view_token;
  if (!tokenOk) {
    const user = await currentUser(request, env);
    if (!user || (user.id !== order.user_id && !isAdmin(env, user))) return json({ error: "Order not found." }, 404);
  }
  return json({ order: orderPublic(order) });
}

async function accountSummary(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ signedIn: false });
  const tech = isApprovedTech(user);
  const [{ balance, next }, orders] = await Promise.all([
    rewardBalance(env, user.id),
    env.DB.prepare(
      "SELECT number, view_token, total, status, created_at, reward_earned FROM orders WHERE user_id = ?1 ORDER BY id DESC LIMIT 20"
    ).bind(user.id).all(),
  ]);
  return json({
    signedIn: true, name: user.name, email: user.email, balance, next,
    rewardPercent: rewardPercent(env, tech), technician: tech, techDiscount: tech ? techDiscount(env) : 0,
    orders: orders.results.map((o) => ({ number: o.number, token: o.view_token, total: o.total, status: o.status, created_at: o.created_at, reward_earned: o.reward_earned })),
    stats: {
      bought: sales.buckets(orders.results.filter((o) => o.status !== "cancelled"), { by: "month", n: 6, date: "created_at", value: (o) => o.total }),
      earned: sales.buckets(orders.results, { by: "month", n: 6, date: "created_at", value: (o) => o.reward_earned || 0 }),
    },
  });
}

async function adminWhatsApp(request, env, url) {
  if (request.method === "GET") return json(await wa.adminStatus(env, siteOrigin(env, url)));
  if (!wa.configured(env)) return json({ error: "Add WHATSAPP_TOKEN in Cloudflare first." }, 400);
  const { action, phone, text, template, name } = await request.json();
  try {
    if (action === "reply") {
      const out = await wa.reply(env, String(phone || "").replace(/\D/g, ""), text);
      return out.status === "sent" ? json({ ok: true }) : json({ error: out.error || "Could not send." }, 400);
    }
    if (action === "templates") return json({ ok: true, message: (await wa.submitTemplates(env)).join("\n") });
    if (action === "review") {
      const out = await wa.askForReview(env, phone, name);
      if (out.status === "sent") return json({ ok: true, message: "Google review request sent on WhatsApp." });
      const why = out.skipped === "already sent" ? "This number has already been asked for a review."
        : out.skipped === "bad number" ? "That doesn't look like a Kenyan mobile number." : out.error || out.skipped || "Could not send.";
      return json({ error: why }, 400);
    }
    if (action === "create") return json({ ok: true, message: await wa.createTemplate(env, template || {}) });
    if (action === "profile") { await wa.updateProfile(env); return json({ ok: true, message: "WhatsApp profile updated." }); }
    if (action === "test") {
      const out = await wa.sendTest(env);
      return json(out.status === "sent" ? { ok: true, message: "Test alert sent to your WhatsApp." } : { error: out.error || out.skipped || "Could not send." }, out.status === "sent" ? 200 : 400);
    }
  } catch (error) {
    return json({ error: error.message }, 502);
  }
  return json({ error: "Unknown action." }, 400);
}

// Sign-up -> order -> paid, for the last 7 and 30 days and all time.
async function adminFunnel(env) {
  const periods = [["7", "-7 days"], ["30", "-30 days"], ["all", "-100 years"]];
  const stage = (since) => env.DB.prepare(
    `SELECT
       (SELECT count(*) FROM users WHERE role != 'admin' AND created_at >= datetime('now', ?1)) AS accounts,
       (SELECT count(*) FROM orders WHERE status != 'cancelled' AND created_at >= datetime('now', ?1)) AS orders,
       (SELECT count(*) FROM orders WHERE status != 'cancelled' AND user_id IS NOT NULL AND created_at >= datetime('now', ?1)) AS member_orders,
       (SELECT count(DISTINCT user_id) FROM orders WHERE status != 'cancelled' AND user_id IS NOT NULL AND created_at >= datetime('now', ?1)) AS buyers,
       (SELECT count(*) FROM orders WHERE status IN ('paid', 'delivered') AND created_at >= datetime('now', ?1)) AS paid,
       (SELECT coalesce(sum(total), 0) FROM orders WHERE status IN ('paid', 'delivered') AND created_at >= datetime('now', ?1)) AS revenue,
       (SELECT count(*) FROM orders WHERE status = 'cancelled' AND created_at >= datetime('now', ?1)) AS cancelled`
  ).bind(since).first();
  const rows = await Promise.all(periods.map(([, since]) => stage(since)));
  // Accounts that have never placed an order: the people to follow up with.
  const { results: idle } = await env.DB.prepare(
    `SELECT u.name, u.email, u.created_at FROM users u
     WHERE u.role != 'admin' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)
     ORDER BY u.created_at DESC LIMIT 20`
  ).all();
  return json({ periods: Object.fromEntries(periods.map(([key], i) => [key, rows[i]])), idle });
}

const ORDER_STATUSES = ["new", "confirmed", "paid", "delivered", "cancelled"];

async function adminOrders(request, env, url, admin, ctx) {
  if (request.method === "GET") {
    const status = url.searchParams.get("status");
    const filter = ORDER_STATUSES.includes(status) ? "WHERE o.status = ?1" : "";
    const stmt = env.DB.prepare(
      `SELECT o.*, u.email AS account_email, s.username AS handler FROM orders o LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN staff s ON s.user_id = o.handler_id ${filter} ORDER BY o.id DESC LIMIT 100`
    );
    await team.ensureTables(env);
    const [{ results }, counts] = await Promise.all([
      (filter ? stmt.bind(status) : stmt).all(),
      env.DB.prepare("SELECT status, count(*) AS n FROM orders GROUP BY status").all(),
    ]);
    return json({
      orders: results.map((o) => ({ id: o.id, token: o.view_token, account_email: o.account_email, user_id: o.user_id, earn_rate: o.earn_rate, consent: o.consent,
        handler: o.handler || null, handler_id: o.handler_id, finished_at: o.finished_at, ...orderPublic(o) })),
      counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])),
    });
  }
  const { id, status } = await request.json();
  if (!Number.isInteger(id) || !ORDER_STATUSES.includes(status)) return json({ error: "Bad request." }, 400);
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(id).first();
  if (!order) return json({ error: "Order not found." }, 404);

  const note = await changeOrderStatus(env, order, status, admin, ctx);
  return json({ ok: true, message: `Order ${order.number} is now ${status}.${note}` });
}

// Sets an order's status with everything that goes with it: reward credit,
// the partner's account, the audit log and the customer's WhatsApp update.
// Used by the admin and by staff (delivered, or paid once a collection is confirmed).
async function changeOrderStatus(env, order, status, admin, ctx) {
  const id = order.id;
  const statements = [env.DB.prepare("UPDATE orders SET status = ?2, updated_at = datetime('now') WHERE id = ?1").bind(id, status)];
  let note = "";
  if ((status === "paid" || status === "delivered") && order.user_id && !order.reward_earned && order.earn_rate > 0) {
    const earned = Math.floor((order.total * order.earn_rate) / 100);
    if (earned > 0) {
      statements.push(
        env.DB.prepare("INSERT INTO reward_ledger (user_id, order_id, kind, amount, expires_at) VALUES (?1, ?2, 'earn', ?3, ?4)")
          .bind(order.user_id, id, earned, sqlNow(REWARD_MONTHS)),
        env.DB.prepare("UPDATE orders SET reward_earned = ?2 WHERE id = ?1").bind(id, earned)
      );
      note = ` The customer earned ${kes(earned)} reward credit.`;
    }
  }
  if (order.channel === "partner" && String(order.notes || "").startsWith(PAY_ON_ACCOUNT)) {
    if (status === "confirmed" || status === "paid" || status === "delivered") {
      const put = await accounts.adminAction(env, { action: "charge_order", order_id: id }, admin);
      if (put.ok) note += ` ${kes(order.total)} was added to the partner's account (they chose to pay on account).`;
    }
    if (status === "cancelled") {
      const voided = await accounts.voidOrderCharge(env, order.user_id, order.number);
      if (voided) note += " The amount was taken off the partner's account.";
    }
  }
  if (status === "cancelled") {
    // Give back credit spent on this order and take back credit earned from it.
    statements.push(
      env.DB.prepare("DELETE FROM reward_ledger WHERE order_id = ?1").bind(id),
      env.DB.prepare("UPDATE orders SET reward_earned = 0 WHERE id = ?1").bind(id)
    );
    if (order.reward_used || order.reward_earned) note = " Reward credit for this order was reversed.";
  }
  statements.push(env.DB.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?1, 'order', ?2)")
    .bind(admin.id, `Order ${order.number}: ${order.status} → ${status}`));
  await env.DB.batch(statements);
  if (status !== order.status) {
    later(ctx, async () => {
      let reward = null;
      const earnedNow = (status === "paid" || status === "delivered") && order.user_id && !order.reward_earned
        ? (await env.DB.prepare("SELECT amount, expires_at FROM reward_ledger WHERE order_id = ?1 AND kind = 'earn'").bind(id).first())
        : null;
      if (earnedNow) reward = { earned: earnedNow.amount, expires: earnedNow.expires_at, balance: (await rewardBalance(env, order.user_id)).balance };
      await wa.orderStatusChanged(env, order, status, reward);
    });
  }
  return note;
}

// ---- trade partners -------------------------------------------------------------

// The "Check and confirm" button in the owner's WhatsApp alert opens this:
// one payment with its screenshot and Confirm / Not received buttons.
async function paymentPage(env, id) {
  const p = await accounts.paymentDetail(env, id);
  if (!p) return messagePage(404, "Payment not found", "This payment no longer exists.", [{ href: "/admin/#partners", label: "Open Partners", primary: true }]);
  const e = escapeHtml;
  const done = p.status !== "pending";
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Payment P-${p.id} | NE admin</title><link rel="icon" href="/assets/nashnaal-favicon.png">
<style>*{box-sizing:border-box}body{margin:0;font-family:Inter,-apple-system,Segoe UI,sans-serif;background:#F6F8FA;color:#10202E}
.top{background:#0F2A3D;color:#fff;padding:12px 16px;font-weight:800}.top a{color:#9FD8F2;float:right;font-weight:700;font-size:14px}
main{max-width:560px;margin:0 auto;padding:18px 16px 40px}.card{background:#fff;border:1px solid #E7ECF1;border-radius:16px;padding:18px;margin-bottom:14px}
h1{font-size:22px;margin:0 0 4px}.amt{font-size:32px;font-weight:800;margin:6px 0}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;font-size:14.5px;margin:12px 0 0}
dt{color:#4A5B68}dd{margin:0;font-weight:600}img{width:100%;border-radius:12px;border:1px solid #E7ECF1}
.btns{display:flex;gap:10px}.btns button{flex:1;border:0;border-radius:12px;padding:15px;font:inherit;font-weight:800;font-size:16px;cursor:pointer}
.ok{background:#067647;color:#fff}.no{background:#fff;color:#B42318;border:1.5px solid #F1B5B0 !important}.st{padding:12px 14px;border-radius:12px;font-weight:700}
.st.confirmed{background:#E8F8EE;color:#14532D}.st.rejected,.st.void{background:#FDECEC;color:#7F1D1D}.st.pending{background:#FFF6E5;color:#8A5300}</style></head>
<body><div class="top">NE admin <a href="/admin/#partners">All partners</a></div><main>
<div class="card"><h1>${e(p.company)}</h1><div style="color:#4A5B68">${e(p.code)} · ${e(p.phone)}</div>
<div class="amt">KES ${p.amount.toLocaleString("en-KE")}</div>
<dl><dt>Paid by</dt><dd>${e(p.method || "—")}</dd><dt>Code</dt><dd>${e(p.reference || "none given")}</dd><dt>Date paid</dt><dd>${e(p.paid_on || "")}</dd>
${p.description ? `<dt>Note</dt><dd>${e(p.description)}</dd>` : ""}<dt>Owed before</dt><dd>KES ${Math.max(0, p.balance).toLocaleString("en-KE")}</dd>
<dt>Reference</dt><dd>P-${p.id}</dd></dl></div>
${p.has_proof ? `<div class="card"><img src="/api/partner/proof?id=${p.id}" alt="Payment screenshot"></div>` : `<div class="card">No screenshot was attached.</div>`}
<div id="state" class="st ${p.status}" ${done ? "" : "hidden"}>${{ confirmed: "Confirmed ✓", rejected: "Marked not received", void: "Voided", pending: "" }[p.status] || ""}</div>
<div class="btns" id="btns" ${done ? "hidden" : ""}><button class="ok" data-a="1">Confirm received</button><button class="no" data-a="0">Not received</button></div>
<script>document.querySelectorAll('#btns button').forEach(function(b){b.onclick=function(){var ok=b.dataset.a==='1',note='';
if(!ok){note=prompt('Why? The partner sees this note.','Not found in our account');if(note===null)return;}
b.disabled=true;fetch('/api/admin/partners',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-ne-admin':'1'},
body:JSON.stringify({action:'decide_payment',entry_id:${p.id},accept:ok,note:note})}).then(function(r){return r.json()}).then(function(d){
var s=document.getElementById('state');s.hidden=false;s.className='st '+(d.ok?(ok?'confirmed':'rejected'):'rejected');s.textContent=d.message||d.error;
if(d.ok)document.getElementById('btns').hidden=true;else b.disabled=false;});};});</script>
</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

// Daily (06:00 UTC = 09:00 Nairobi): payment reminders to partners who have them
// switched on (every N days, set per partner), and on the 1st a statement to
// everyone who owes money.
async function creditJobs(env) {
  const today = new Date(Date.now() + 3 * 3600000);   // Nairobi time
  const firstOfMonth = today.getUTCDate() === 1;
  const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
    .toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: "UTC" });
  for (const a of await accounts.owing(env)) {
    await wa.paymentReminder(env, a, false);
    if (firstOfMonth) await wa.monthlyStatement(env, a, lastMonth, a.paid_last_month, false);
  }
}

// Marks a partner order taken on credit; confirming it puts the total on the partner's account.
const PAY_ON_ACCOUNT = "Payment: on my account (credit)";

async function partnerApi(request, env, url, ctx) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Please sign in first." }, 401);
  const catalogue = await priceList(env, url.origin);
  if (request.method === "GET") {
    const out = await partners.portal(env, user, catalogue);
    if (out.partner && out.partner.status === "approved") {
      out.account = await accounts.account(env, user.id);
      // Charts: what they bought each month, and goods taken vs paid on their account.
      const { results } = await env.DB.prepare(
        "SELECT total, created_at FROM orders WHERE user_id = ?1 AND status != 'cancelled' AND created_at > datetime('now', '-7 months')"
      ).bind(user.id).all();
      const ledger = out.account.entries.filter((e) => e.status === "confirmed");
      out.stats = {
        bought: sales.buckets(results, { by: "month", n: 6, date: "created_at", value: (r) => r.total }),
        taken: sales.buckets(ledger.filter((e) => e.kind === "charge"), { by: "month", n: 6, date: "created_at", value: (e) => e.amount }),
        paid: sales.buckets(ledger.filter((e) => e.kind === "payment"), { by: "month", n: 6, date: "created_at", value: (e) => e.amount }),
      };
    }
    return json(out);
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Bad request origin." }, 403);
  const body = await request.json();
  if (body.action === "apply") {
    const out = await partners.apply(env, user, body);
    if (out.ok) later(ctx, async () => wa.partnerApplied(env, await partners.partnerOf(env, user.id)));
    return json(out, out.error ? 400 : 200);
  }
  if (body.action === "payment") {
    const out = await accounts.reportPayment(env, user, body);
    if (out.ok) {
      const partner = await partners.partnerOf(env, user.id);
      const { balance } = await accounts.account(env, user.id);
      later(ctx, () => wa.paymentReported(env, partner, partners.partnerCode(user.id), out.payment, balance));
    }
    return json(out, out.error ? 400 : 200);
  }
  if (body.action === "request_prices") {
    const out = await partners.requestPrices(env, user, body, catalogue);
    if (out.ok) {
      const partner = await partners.partnerOf(env, user.id);
      const first = (body.items || []).find((i) => catalogue[i.slug] && Number(i.requested) > 0);
      const example = first ? `KES ${Math.round(first.requested).toLocaleString("en-KE")} for ${catalogue[first.slug].m}` : "several products";
      later(ctx, () => wa.priceRequested(env, partner.company, out.count, example));
    }
    return json(out, out.error ? 400 : 200);
  }
  if (body.action !== "order") return json({ error: "Unknown action." }, 400);
  const o = await partners.order(env, user, body, catalogue);
  if (o.error) return json(o, 400);
  // Payment: on the partner's account (credit, within their limit) or before collection.
  if (body.payment === "account") {
    const limit = o.partner.credit_limit;
    if (!limit) return json({ error: "Credit is not set up on your account. Choose 'Pay before collection', or ask NE about a credit limit." }, 400);
    const { balance } = await accounts.account(env, user.id);
    if (balance + o.subtotal > limit) {
      return json({ error: `This order (${kes(o.subtotal)}) would bring your account to ${kes(balance + o.subtotal)}, over your credit limit of ${kes(limit)}. ` +
        `Pay part of your balance first, or choose 'Pay before collection'.` }, 400);
    }
  }
  o.notes = [body.payment === "account" ? PAY_ON_ACCOUNT : "Payment: before collection", o.notes].filter(Boolean).join("\n");
  const token = randomToken(18);
  const row = await env.DB.prepare(
    `INSERT INTO orders (view_token, user_id, name, phone, email, delivery, town, notes, items_json,
       subtotal, tech_discount, reward_used, total, earn_rate, channel, consent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, 0, ?10, 0, 'partner', 1) RETURNING id`
  ).bind(token, user.id, o.name, o.phone, o.email, o.delivery, o.town || null, o.notes || null, JSON.stringify(o.items), o.subtotal).first();
  const number = `NE-${1000 + row.id}`;
  await env.DB.prepare("UPDATE orders SET number = ?2 WHERE id = ?1").bind(row.id, number).run();
  later(ctx, () => wa.orderCreated(env, {
    id: row.id, number, view_token: token, name: o.name, phone: o.phone, total: o.subtotal, delivery: o.delivery,
    town: o.town, consent: 1, user_id: user.id, greet: o.partner.contact.split(" ")[0],
  }, o.items.reduce((n, i) => n + i.qty, 0)));
  later(ctx, () => routeOrder(env, row.id));
  const requests = o.items.filter((i) => i.requested).length;
  return json({ ok: true, number, token, total: o.subtotal, requests, viewUrl: `${siteOrigin(env, url)}/order/?n=${number}&k=${token}` });
}

// A payment screenshot: partners see their own, admins see all.
async function partnerProof(request, env, url) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Please sign in first." }, 401);
  const res = await accounts.proof(env, Number(url.searchParams.get("id")), isAdmin(env, user) ? null : user.id);
  return res || json({ error: "Not found." }, 404);
}

async function adminPartners(request, env, url, admin) {
  const catalogue = await priceList(env, url.origin);
  if (request.method === "GET") {
    const id = Number(url.searchParams.get("id"));
    if (id) {
      const detail = await partners.adminDetail(env, id, catalogue);
      if (!detail) return json({ error: "Partner not found." }, 404);
      detail.account = await accounts.account(env, id);
      return json(detail);
    }
    const [list, bal, payments] = await Promise.all([partners.adminList(env, catalogue), accounts.balances(env), accounts.pendingPayments(env)]);
    list.partners.forEach((p) => { p.balance = bal[p.user_id] ? bal[p.user_id].balance : 0; });
    list.payments = payments;
    return json(list);
  }
  const body = await request.json();
  let out;
  if (body.action === "send_statement" || body.action === "send_reminder") {
    const a = { partner: await partners.partnerOf(env, Number(body.id)), ...(await accounts.account(env, Number(body.id))) };
    if (!a.partner) return json({ error: "Partner not found." }, 404);
    if (body.action === "send_reminder" && !((a.terms_days ? a.overdue : a.balance) > 0)) {
      return json({ error: a.terms_days ? "Nothing is overdue for this partner." : "This partner owes nothing." }, 400);
    }
    const period = new Date().toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: "Africa/Nairobi" });
    const paid = a.entries.filter((e) => e.kind === "payment" && e.status === "confirmed" && String(e.paid_on || e.created_at).slice(0, 7) === new Date().toISOString().slice(0, 7))
      .reduce((n, e) => n + e.amount, 0);
    const sent = body.action === "send_reminder" ? await wa.paymentReminder(env, a, true) : await wa.monthlyStatement(env, a, period, paid, true);
    out = sent && sent.status === "sent" ? { ok: true, message: `Sent to ${a.partner.company} on WhatsApp (${a.partner.phone}).` }
      : { error: (sent && (sent.error || sent.skipped)) || "Could not send." };
  } else if (["charge", "charge_order", "payment", "decide_payment", "void_entry"].includes(body.action)) {
    out = await accounts.adminAction(env, body, admin);
    if (out.ok) {
      await env.DB.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?1, 'partner_account', ?2)").bind(admin.id, out.message).run();
    }
  } else if (body.action === "update") {
    out = await partners.adminUpdate(env, Number(body.id), body);
    if (out.ok) {
      await env.DB.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?1, 'partner', ?2)")
        .bind(admin.id, `Partner ${out.partner.company}: ${out.partner.status}, ${out.partner.discount}% default discount`).run();
      out.message = `${out.partner.company} saved (${out.partner.status}).`;
    }
  } else if (body.action === "prices") {
    out = await partners.adminSetPrices(env, Number(body.id), body.prices, catalogue);
    if (out.ok) out.message = `${out.saved} price${out.saved === 1 ? "" : "s"} saved.`;
  } else if (body.action === "decide" && body.request_id) {
    out = await partners.adminDecideStanding(env, Number(body.request_id), Boolean(body.accept), body.price);
    if (out.ok) {
      const model = catalogue[out.slug] ? catalogue[out.slug].m : out.slug;
      out.message = body.accept ? `Agreed ${kes(out.agreed)} for ${model}. It is now this partner's price.` : `Declined the price request for ${model}.`;
    }
  } else if (body.action === "decide") {
    out = await partners.adminDecide(env, Number(body.order_id), String(body.slug || ""), Boolean(body.accept), body.price);
    if (out.ok) {
      out.message = body.accept
        ? `Agreed ${kes(out.item.price)} for ${out.item.model}. It is now this partner's price; ${out.number} total is ${kes(out.total)}.`
        : `Declined the price request for ${out.item.model} on ${out.number}.`;
    }
  } else {
    out = { error: "Unknown action." };
  }
  return json(out, out.error ? 400 : 200);
}

// ---- the NE team (/team) -----------------------------------------------------------

async function teamApi(request, env, url, ctx) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Please sign in first." }, 401);
  const owner = isAdmin(env, user);
  if (request.method === "GET") {
    const out = await team.portal(env, user, owner);
    if (out.can.length) {
      const sells = out.can.includes("orders");
      [out.sales, out.customers, out.documents, out.stats, out.pool] = await Promise.all([
        sales.mine(env, user.id), sales.myCustomers(env, user.id), docs.list(env, "", user.id).then((d) => d.documents.slice(0, 40)),
        sales.stats(env, user.id, out.can), sells ? sales.pool(env) : [],
      ]);
    }
    return json(out);
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Bad request origin." }, 403);
  const body = await request.json();
  if (body.action === "apply") {
    if (owner) return json({ error: "You are the owner: you already have full access." }, 400);
    const out = await team.apply(env, user, body);
    if (out.ok) later(ctx, () => wa.staffApplied(env, out.staff));
    return json(out, out.error ? 400 : 200);
  }
  const staff = await team.staffOf(env, user.id);
  const can = team.permissions(staff, owner);
  if (!can) return json({ error: "Your team account is not approved yet." }, 403);
  const need = { order: "orders", accept: "orders", assign: "dispatch", cancel_job: "dispatch", decide: "confirm" }[body.action];
  if (need && !can.includes(need)) return json({ error: "Your role can't do this. Ask the owner if you need it." }, 403);
  const who = staff ? staff.username : "Owner";
  let out;
  if (body.action === "accept") {
    out = await sales.accept(env, user, staff, body.id);
  } else if (body.action === "release") {
    out = await sales.release(env, user, body.id);
  } else if (body.action === "finish") {
    out = await sales.finish(env, user, body.id);
  } else if (body.action === "claim") {
    out = await sales.claim(env, user, staff, body.id);
  } else if (body.action === "doc") {
    out = await sales.createDoc(env, user, staff, body);
    const { collection } = out;
    if (collection) later(ctx, () => wa.staffCollection(env, collection));
    delete out.collection;
  } else if (body.action === "self_job") {
    // Deliver an order you handle yourself.
    const mineOrder = staff && await env.DB.prepare("SELECT id FROM orders WHERE id = ?1 AND handler_id = ?2").bind(Number(body.order_id), user.id).first();
    if (!mineOrder) out = { error: "You can only deliver orders you handle." };
    else {
      const job = await team.assign(env, user, { order_id: mineOrder.id, staff_id: user.id, address: body.address, map_url: body.map_url, collect: body.collect, notes: body.notes });
      out = job.ok ? { ok: true, message: "Added to My jobs." } : job;
    }
  } else if (body.action === "record") {
    out = await team.record(env, user, body);
    const { collection } = out;
    if (collection) later(ctx, () => wa.staffCollection(env, collection));
    delete out.collection;
  } else if (body.action === "job_status") {
    out = await team.jobStatus(env, user, body);
  } else if (body.action === "deliver") {
    out = await team.delivered(env, user, body);
    if (out.ok) {
      if (!["delivered", "cancelled"].includes(out.order.status)) await changeOrderStatus(env, out.order, "delivered", user, ctx);
      const { collection } = out;
      if (collection) later(ctx, () => wa.staffCollection(env, collection));
      delete out.order;
      delete out.collection;
    }
  } else if (body.action === "order") {
    const token = randomToken(18);
    out = await team.createOrder(env, user, body, await priceList(env, url.origin), token);
    if (out.ok) {
      const o = out.order;
      later(ctx, () => wa.orderCreated(env, { ...o, user_id: null }, o.items.reduce((n, i) => n + i.qty, 0)));
      out.message = `Order ${o.number} saved: ${kes(o.total)}.`;
      if (body.deliver_me && staff) {
        const job = await team.assign(env, user, { order_id: o.id, staff_id: user.id, address: body.address, map_url: body.map_url, notes: body.job_notes });
        out.message += job.ok ? " The delivery is in My jobs." : ` The delivery could not be added: ${job.error}`;
      }
      out.number = o.number;
      out.viewUrl = `${siteOrigin(env, url)}/order/?n=${o.number}&k=${token}`;
      delete out.order;
    }
  } else if (body.action === "assign") {
    const job = await team.assign(env, user, body);
    if (job.ok) later(ctx, () => wa.deliveryJob(env, job));
    out = job.ok ? { ok: true, message: job.message } : job;
  } else if (body.action === "cancel_job") {
    out = await team.cancelJob(env, user, Number(body.id));
  } else if (body.action === "decide") {
    out = await afterCollectionDecided(env, await team.decide(env, user, body, owner), user, who, ctx);
  } else {
    out = { error: "Unknown action." };
  }
  return json(out, out.error ? 400 : 200);
}

// A confirmed collection pays the order (when fully paid) and, for a trade
// partner paying their account, goes on the partner's statement.
async function afterCollectionDecided(env, out, actor, who, ctx) {
  if (!out.ok) return out;
  const { collection: c, paidOrder, accepted } = out;
  delete out.collection; delete out.paidOrder; delete out.accepted;
  if (!accepted) return out;
  if (paidOrder) {
    await changeOrderStatus(env, paidOrder, "paid", actor, ctx);
    out.message += ` ${paidOrder.number} is now paid.`;
  }
  // Only money against the partner's account (no order, or an order on credit) goes on their statement.
  let onAccount = !c.order_id;
  if (c.order_id) {
    const o = await env.DB.prepare("SELECT notes FROM orders WHERE id = ?1").bind(c.order_id).first();
    onAccount = Boolean(o && String(o.notes || "").startsWith(PAY_ON_ACCOUNT));
  }
  if (c.partner_id && onAccount) {
    const put = await accounts.adminAction(env, {
      action: "payment", id: c.partner_id, amount: c.amount, method: c.method, reference: c.reference,
      paid_on: c.created_at.slice(0, 10), note: `Collected by ${who === "Owner" ? "NE" : who} (C-${c.id})`,
    }, { email: actor.email });
    if (put.ok) out.message += " Added to the partner's statement.";
  }
  return out;
}

// One invoice or receipt for /team/doc/?id=N: the person who made it, or the owner.
async function teamDoc(request, env, url) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Please sign in first." }, 401);
  const doc = await docs.get(env, Number(url.searchParams.get("id")));
  if (!doc || (!isAdmin(env, user) && doc.staff_id !== user.id)) return json({ error: "Document not found." }, 404);
  return json({ document: doc });
}

// After a new website or partner order: straight to the customer's own team
// member, or to everyone in the order pool.
async function routeOrder(env, orderId) {
  const r = await sales.route(env, orderId);
  if (r.owner) await wa.orderForYou(env, r.owner, r.order);
  for (const person of r.pool || []) await wa.orderPool(env, person, r.order);
}

async function teamProof(request, env, url) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Please sign in first." }, 401);
  const can = team.permissions(await team.staffOf(env, user.id), isAdmin(env, user));
  if (!can) return json({ error: "Not found." }, 404);
  const res = await team.proof(env, Number(url.searchParams.get("id")), can.includes("confirm") ? null : user.id);
  return res || json({ error: "Not found." }, 404);
}

async function adminTeam(request, env, url, admin, ctx) {
  if (request.method === "GET") {
    const out = await team.adminOverview(env);
    out.claims = await sales.adminClaims(env);
    return json(out);
  }
  const body = await request.json();
  let out;
  if (body.action === "update") out = await team.adminUpdate(env, admin, body);
  else if (body.action === "claim") out = await sales.adminDecideClaim(env, admin, body);
  else if (body.action === "handler") {
    out = await sales.adminSetHandler(env, admin, body);
    const { person, order } = out;
    if (person) later(ctx, () => wa.orderForYou(env, person, order));
    delete out.person; delete out.order;
  }
  else if (body.action === "assign") {
    const job = await team.assign(env, admin, body);
    if (job.ok) later(ctx, () => wa.deliveryJob(env, job));
    out = job.ok ? { ok: true, message: job.message } : job;
  } else if (body.action === "cancel_job") out = await team.cancelJob(env, admin, Number(body.id));
  else if (body.action === "decide") out = await afterCollectionDecided(env, await team.decide(env, admin, body, true), admin, "Owner", ctx);
  else out = { error: "Unknown action." };
  if (out.staff) delete out.staff;
  return json(out, out.error ? 400 : 200);
}

// The "Check and confirm" button in the owner's alert for money a staff member collected.
async function collectionPage(env, id) {
  const c = await team.collectionById(env, id);
  if (!c) return messagePage(404, "Payment not found", "This payment no longer exists.", [{ href: "/admin/#team", label: "Open Team", primary: true }]);
  const e = escapeHtml;
  const done = c.status !== "pending";
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Collection C-${c.id} | NE admin</title><link rel="icon" href="/assets/nashnaal-favicon.png">
<style>*{box-sizing:border-box}body{margin:0;font-family:Inter,-apple-system,Segoe UI,sans-serif;background:#F6F8FA;color:#10202E}
.top{background:#0F2A3D;color:#fff;padding:12px 16px;font-weight:800}.top a{color:#9FD8F2;float:right;font-weight:700;font-size:14px}
main{max-width:560px;margin:0 auto;padding:18px 16px 40px}.card{background:#fff;border:1px solid #E7ECF1;border-radius:16px;padding:18px;margin-bottom:14px}
h1{font-size:22px;margin:0 0 4px}.amt{font-size:32px;font-weight:800;margin:6px 0}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;font-size:14.5px;margin:12px 0 0}
dt{color:#4A5B68}dd{margin:0;font-weight:600}img{width:100%;border-radius:12px;border:1px solid #E7ECF1}
.btns{display:flex;gap:10px}.btns button{flex:1;border:0;border-radius:12px;padding:15px;font:inherit;font-weight:800;font-size:16px;cursor:pointer}
.ok{background:#067647;color:#fff}.no{background:#fff;color:#B42318;border:1.5px solid #F1B5B0 !important}.st{padding:12px 14px;border-radius:12px;font-weight:700}
.st.confirmed{background:#E8F8EE;color:#14532D}.st.rejected{background:#FDECEC;color:#7F1D1D}</style></head>
<body><div class="top">NE admin <a href="/admin/#team">Team</a></div><main>
<div class="card"><h1>${e(c.customer)}</h1><div style="color:#4A5B68">Collected by <b>${e(c.staff)}</b>${c.phone ? ` · ${e(c.phone)}` : ""}</div>
<div class="amt">KES ${c.amount.toLocaleString("en-KE")}</div>
<dl><dt>Paid by</dt><dd>${e(c.method)}${c.method === "Cash" ? " (staff holds it until handed in)" : ""}</dd><dt>Code</dt><dd>${e(c.reference || "none given")}</dd>
${c.order ? `<dt>Order</dt><dd>${e(c.order)}</dd>` : ""}${c.partner ? `<dt>Partner</dt><dd>${e(c.partner)} (goes on their statement)</dd>` : ""}
${c.note ? `<dt>Note</dt><dd>${e(c.note)}</dd>` : ""}<dt>Recorded</dt><dd>${e(c.created_at)} UTC</dd><dt>Reference</dt><dd>C-${c.id}</dd></dl></div>
${c.has_proof ? `<div class="card"><img src="/api/team/proof?id=${c.id}" alt="Payment screenshot"></div>` : ""}
<div id="state" class="st ${c.status}" ${done ? "" : "hidden"}>${{ confirmed: "Confirmed ✓", rejected: "Marked not received" }[c.status] || ""}${c.decided_note ? ` — ${e(c.decided_note)}` : ""}</div>
<div class="btns" id="btns" ${done ? "hidden" : ""}><button class="ok" data-a="1">${c.method === "Cash" ? "Cash handed in" : "Confirm received"}</button><button class="no" data-a="0">Not received</button></div>
<script>document.querySelectorAll('#btns button').forEach(function(b){b.onclick=function(){var ok=b.dataset.a==='1',note='';
if(!ok){note=prompt('Why? The staff member sees this note.','Not found in our account');if(!note)return;}
b.disabled=true;fetch('/api/admin/team',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-ne-admin':'1'},
body:JSON.stringify({action:'decide',id:${c.id},accept:ok,note:note})}).then(function(r){return r.json()}).then(function(d){
var s=document.getElementById('state');s.hidden=false;s.className='st '+(d.ok&&ok?'confirmed':'rejected');s.textContent=d.message||d.error;
if(d.ok)document.getElementById('btns').hidden=true;else b.disabled=false;});};});</script>
</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

// ---- invoices and receipts -------------------------------------------------------

async function adminDocuments(request, env, url, admin) {
  if (request.method === "GET") {
    const id = Number(url.searchParams.get("id"));
    if (id) {
      const doc = await docs.get(env, id);
      return doc ? json({ document: doc }) : json({ error: "Document not found." }, 404);
    }
    return json(await docs.list(env, url.searchParams.get("q")));
  }
  const body = await request.json();
  const out = body.action === "void" ? await docs.setVoid(env, Number(body.id))
    : body.action === "create" ? await docs.create(env, body.document || {}, admin)
    : { error: "Unknown action." };
  if (out.ok && out.document) {
    await env.DB.prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?1, 'document', ?2)")
      .bind(admin.id, `${out.document.number} for ${out.document.customer.name}: ${kes(out.document.total)}`).run();
  }
  return json(out, out.error ? 400 : 200);
}

// ---- customers, credit owed and sales reports (admin) ------------------------

const SOLD = "('paid', 'delivered')";

function dateRange(url) {
  const ok = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : null);
  return { from: ok(url.searchParams.get("from")), to: ok(url.searchParams.get("to")) };
}

// Everyone who has signed in or ordered: signed-in accounts plus guest buyers
// grouped by phone number. "bought" counts paid and delivered orders only
// (within ?from=&to= when given); "pending" is orders not yet paid.
async function adminCustomers(env, url) {
  const { from, to } = dateRange(url);
  const range = `${from ? ` AND created_at >= '${from}'` : ""}${to ? ` AND created_at < date('${to}', '+1 day')` : ""}`;
  const [users, orderStats, guests, ledger] = await Promise.all([
    env.DB.prepare("SELECT id, name, email, role, technician_status, created_at, last_login FROM users ORDER BY id").all(),
    env.DB.prepare(
      `SELECT user_id,
         sum(CASE WHEN status IN ${SOLD}${range} THEN total ELSE 0 END) AS bought,
         sum(CASE WHEN status IN ${SOLD}${range} THEN 1 ELSE 0 END) AS paid_orders,
         sum(CASE WHEN status IN ('new', 'confirmed') THEN total ELSE 0 END) AS pending,
         count(*) AS orders, max(created_at) AS last_order,
         (SELECT phone FROM orders o2 WHERE o2.user_id = orders.user_id ORDER BY id DESC LIMIT 1) AS phone
       FROM orders WHERE user_id IS NOT NULL AND status != 'cancelled' GROUP BY user_id`
    ).all(),
    env.DB.prepare(
      `SELECT phone, max(name) AS name, max(email) AS email,
         sum(CASE WHEN status IN ${SOLD}${range} THEN total ELSE 0 END) AS bought,
         sum(CASE WHEN status IN ${SOLD}${range} THEN 1 ELSE 0 END) AS paid_orders,
         sum(CASE WHEN status IN ('new', 'confirmed') THEN total ELSE 0 END) AS pending,
         count(*) AS orders, max(created_at) AS last_order
       FROM orders WHERE user_id IS NULL AND status != 'cancelled' GROUP BY phone`
    ).all(),
    env.DB.prepare("SELECT user_id, kind, amount, expires_at, created_at FROM reward_ledger ORDER BY user_id, created_at, id").all(),
  ]);

  const byUser = new Map();
  for (const row of ledger.results) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row);
  }
  const stats = new Map(orderStats.results.map((r) => [r.user_id, r]));
  const admins = adminEmails(env);
  const customers = [];
  for (const u of users.results) {
    if (admins.includes(u.email.toLowerCase())) continue;
    const o = stats.get(u.id) || {};
    const credit = replayLedger(byUser.get(u.id) || []);
    customers.push({
      key: `u${u.id}`, user_id: u.id, name: u.name || u.email, email: u.email, phone: o.phone || "",
      type: u.role === "technician" && u.technician_status === "approved" ? "technician" : "customer",
      orders: o.orders || 0, paid_orders: o.paid_orders || 0, bought: o.bought || 0, pending: o.pending || 0,
      last_order: o.last_order || null, joined: u.created_at,
      credit: credit.balance, credit_next: credit.next, credit_earned: credit.earned, credit_spent: credit.spent, credit_expired: credit.expired,
    });
  }
  for (const g of guests.results) {
    customers.push({
      key: `p${g.phone}`, user_id: null, name: g.name, email: g.email || "", phone: g.phone, type: "guest",
      orders: g.orders, paid_orders: g.paid_orders, bought: g.bought, pending: g.pending, last_order: g.last_order,
      joined: null, credit: 0, credit_next: null, credit_earned: 0, credit_spent: 0, credit_expired: 0,
    });
  }
  customers.sort((a, b) => b.bought - a.bought || (b.last_order || "").localeCompare(a.last_order || ""));
  const totals = customers.reduce((t, c) => ({
    customers: t.customers + 1, bought: t.bought + c.bought, pending: t.pending + c.pending,
    credit: t.credit + c.credit, with_credit: t.with_credit + (c.credit > 0 ? 1 : 0),
  }), { customers: 0, bought: 0, pending: 0, credit: 0, with_credit: 0 });
  return json({ customers, totals, from, to, generated: sqlNow() });
}

// One customer's orders and reward history (?user=ID or ?phone= for guests).
async function adminStatement(env, url) {
  const userId = Number(url.searchParams.get("user"));
  const phone = url.searchParams.get("phone");
  let customer;
  let orders;
  let ledger = [];
  if (Number.isInteger(userId) && userId > 0) {
    customer = await env.DB.prepare("SELECT id, name, email, role, technician_status, created_at FROM users WHERE id = ?1").bind(userId).first();
    if (!customer) return json({ error: "Customer not found." }, 404);
    orders = await env.DB.prepare("SELECT * FROM orders WHERE user_id = ?1 ORDER BY id").bind(userId).all();
    ledger = (await env.DB.prepare(
      `SELECT l.kind, l.amount, l.expires_at, l.created_at, o.number FROM reward_ledger l
       LEFT JOIN orders o ON o.id = l.order_id WHERE l.user_id = ?1 ORDER BY l.created_at, l.id`
    ).bind(userId).all()).results;
  } else if (phone) {
    orders = await env.DB.prepare("SELECT * FROM orders WHERE user_id IS NULL AND phone = ?1 ORDER BY id").bind(phone).all();
    if (!orders.results.length) return json({ error: "Customer not found." }, 404);
    const last = orders.results[orders.results.length - 1];
    customer = { name: last.name, email: last.email, phone, role: "guest" };
  } else {
    return json({ error: "Bad request." }, 400);
  }
  const list = orders.results.map((o) => ({ number: o.number, created_at: o.created_at, status: o.status, total: o.total,
    items: JSON.parse(o.items_json).reduce((n, i) => n + i.qty, 0), reward_used: o.reward_used, reward_earned: o.reward_earned, phone: o.phone }));
  const credit = replayLedger(ledger);
  return json({
    customer: { ...customer, phone: customer.phone || (list.length ? list[list.length - 1].phone : "") },
    orders: list,
    ledger: ledger.map((l) => ({ kind: l.kind, amount: l.amount, expires_at: l.expires_at, created_at: l.created_at, number: l.number })),
    credit,
    bought: list.filter((o) => o.status === "paid" || o.status === "delivered").reduce((n, o) => n + o.total, 0),
    generated: sqlNow(),
  });
}
