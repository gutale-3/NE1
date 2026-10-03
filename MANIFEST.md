# Deployment Manifest

- **Type:** Static site (no build step at deploy time)
- **Framework preset:** None
- **Build command:** (none — generated files are committed; see below)
- **Output directory:** `/`
- **Entry point:** `index.html`
- **Pages:** index, products, quote, contact, about, services, faq, blog + 9 articles, solutions + 10 solution pages, world, 404, 9 generated pages under `category/` and 196 under `product/`
- **Runtime deps:** none. Every page is plain HTML; `js/site.js` adds the catalog filter and WhatsApp forms, `js/scroll-world-engine.js` runs world.html.
- **Regenerating:** `python3 tools/build-catalog.py` after editing `data/products.json`; `python3 tools/apply-layout.py` after editing the header/footer in `tools/site_layout.py`. Python 3 stdlib only.
- **Not deployed:** `tools/` (build scripts) — excluded via `.assetsignore`
- **Target host:** Cloudflare Workers static assets (`wrangler.jsonc`), with `_headers` for security headers
