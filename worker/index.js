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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/auth/google/login") return await googleLogin(env, url);
      if (path === "/auth/google/callback") return await googleCallback(request, env, url);
      if (path === "/auth/logout") return await logout(request, env);
      if (path === "/api/me") return await me(request, env);
      if (path === "/admin" || path.startsWith("/admin/")) return await adminPage(request, env, url);
      if (path.startsWith("/api/admin/")) return await adminApi(request, env, url);
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

function siteOrigin(env, url) {
  return env.SITE_ORIGIN || url.origin;
}

function adminEmails(env) {
  return (env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function isAdmin(env, user) {
  return Boolean(user && adminEmails(env).includes(user.email.toLowerCase()));
}

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
    return new Response("Sign-in is not configured yet.", { status: 503 });
  }
  return googleLoginRedirect(env, url);
}

async function googleCallback(request, env, url) {
  const saved = JSON.parse(getCookie(request, OAUTH_COOKIE) || "null");
  const code = url.searchParams.get("code");
  if (!saved || !code || url.searchParams.get("state") !== saved.state) {
    return new Response("Sign-in expired. Please try again.", { status: 400 });
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
    return new Response("Google sign-in failed. Please try again.", { status: 400 });
  }
  const { id_token: idToken } = await tokenResponse.json();
  // The ID token came straight from Google's token endpoint over TLS, so its
  // claims can be read without verifying the signature; we still check them.
  const claims = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issuerOk || claims.aud !== env.GOOGLE_CLIENT_ID || !claims.email_verified || claims.exp * 1000 < Date.now()) {
    return new Response("Google sign-in could not be verified.", { status: 400 });
  }

  const email = String(claims.email).toLowerCase();
  const role = adminEmails(env).includes(email) ? "admin" : "customer";
  const user = await env.DB.prepare(
    `INSERT INTO users (google_sub, email, name, picture, role, last_login)
     VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
     ON CONFLICT(google_sub) DO UPDATE SET email = ?2, name = ?3, picture = ?4,
       role = CASE WHEN ?5 = 'admin' THEN 'admin' WHEN users.role = 'admin' THEN 'customer' ELSE users.role END,
       last_login = datetime('now')
     RETURNING id`
  ).bind(claims.sub, email, claims.name || "", claims.picture || "", role).first();

  const sessionId = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(await sha256(sessionId), user.id, Date.now() + SESSION_DAYS * 86400 * 1000)
    .run();

  const headers = new Headers({ location: safeNext(saved.next), "cache-control": "no-store" });
  headers.append("set-cookie", cookie(SESSION_COOKIE, sessionId, SESSION_DAYS * 86400));
  headers.append("set-cookie", cookie(OAUTH_COOKIE, "", 0));
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
  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": cookie(SESSION_COOKIE, "", 0), "cache-control": "no-store" },
  });
}

async function me(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ signedIn: false });
  return json({ signedIn: true, name: user.name, email: user.email, picture: user.picture, role: user.role, admin: isAdmin(env, user) });
}

// ---- admin -----------------------------------------------------------------

async function adminPage(request, env, url) {
  const user = await currentUser(request, env);
  if (!user) {
    return Response.redirect(`${url.origin}/auth/google/login?next=${encodeURIComponent(url.pathname)}`, 302);
  }
  if (!isAdmin(env, user)) {
    return new Response(`Signed in as ${user.email}, which is not an admin account.`, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const assetPath = url.pathname === "/admin" ? "/admin/" : url.pathname;
  const asset = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin), request));
  const response = new Response(asset.body, asset);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-robots-tag", "noindex");
  return response;
}

async function adminApi(request, env, url) {
  const user = await currentUser(request, env);
  if (!isAdmin(env, user)) return json({ error: "Not signed in as an admin." }, 401);
  if (request.method !== "GET") {
    // Cross-site request protection on top of SameSite cookies.
    const origin = request.headers.get("origin");
    if (origin !== url.origin || request.headers.get("x-ne-admin") !== "1") return json({ error: "Bad request origin." }, 403);
  }
  if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN is not set in Cloudflare." }, 503);

  if (url.pathname === "/api/admin/products" && request.method === "GET") {
    const { products } = await loadProducts(env);
    return json({ products: products.map(summary), user: { name: user.name, email: user.email } });
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
      throw error;
    }
  }
  return json({ error: "Someone else saved at the same time. Please try again." }, 409);
}
