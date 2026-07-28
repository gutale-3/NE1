# Deployment Manifest

- **Type:** Static site (no build step at deploy time)
- **Framework preset:** None
- **Build command:** (none — generated files are committed; see below)
- **Output directory:** `/`
- **Entry point:** `index.html`
- **Pages:** index.html, products.html, solutions.html + 10 solution-*.html, services.html, faq.html, about.html, contact.html, world.html, and 196 generated pages under `product/`
- **Runtime deps:** React + ReactDOM loaded via CDN inside `js/support.js`'s host page; no npm install required. The `product/` pages are plain HTML and need no JavaScript at all.
- **Regenerating the catalogue:** `python3 tools/build-catalog.py` after editing `data/products.json`. Rewrites `product/*.html`, `js/products.js`, the ItemList JSON-LD in `products.html`, and the product URLs in `sitemap.xml`. Python 3 stdlib only.
- **Not deployed:** `tools/` (build + preview scripts) — excluded via `.assetsignore`
- **Target host:** Cloudflare Pages (Git integration or direct upload) — see README.md
