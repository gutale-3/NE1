# Nashnaal Electronics (NE) — Website

Static, dependency-free site for NE, an authorized Hikvision distributor & retailer. Scroll-reveal animations, parallax, and counters are hand-built (no framework, no build step).

This folder is the repo root — everything in here is meant to be pushed to GitHub and deployed as-is.

## Structure

```
/
├── index.html          Home
├── products.html        Product catalog
├── services.html        Services + milestone timeline
├── about.html            About NE
├── contact.html          Contact
├── world.html            Scroll-driven brand story
├── product/              196 generated product pages, one per model
├── js/
│   ├── support.js              Runtime (renders the pages)
│   ├── revealFx.js             IntersectionObserver reveal/parallax/counter helpers
│   ├── products.js             Product + category data (generated)
│   └── scroll-world-engine.js  Scroll-world page engine
├── data/
│   └── products.json     Source data — the catalogue's single source of truth
├── tools/                 Build + preview scripts (not deployed)
├── images/                Product photos + category posters
├── assets/                Logo, hero posters, and scroll-world media
└── css/                   (see note below — styles are inline)
```

No CSS files: all styling is inline per element by design, so pages paint immediately with no blocking stylesheet request. `css/` is kept as a placeholder if you later extract shared rules. The generated product pages are the one exception — they share enough structure that they carry a small inline `<style>` block in `<head>` instead.

## Product pages

Every product in the catalogue has its own page at `/product/<model-slug>`, e.g.
`/product/ds-2ce16d0t-exipf-3-6mm-o-std`. Unlike the rest of the site these are
plain static HTML with no JavaScript, so they render instantly and are fully
readable by search crawlers. Each one carries `Product` and `BreadcrumbList`
JSON-LD, the price, the datasheet specifications, WhatsApp/call CTAs, and links
to related models in the same category.

They are **generated — never edit `product/*.html` by hand.** Edit
`data/products.json` and re-run:

```
python3 tools/build-catalog.py
```

That one command rewrites the product pages, `js/products.js`, the catalog
JSON-LD inside `products.html`, and the product entries in `sitemap.xml`. Pages
for products removed from the JSON are deleted on the next run.

Because product pages live one directory down, their internal links are
root-absolute (`/products`, `/images/001.png`) rather than relative.

## Deploy to Cloudflare Pages

**Option A — Git integration (recommended)**
1. Push this folder's contents to a GitHub repo (this folder = repo root).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave blank)*
   - Build output directory: `/`
4. Deploy. No environment variables or extra config needed.

**Option B — Direct upload**
1. Workers & Pages → Create → Pages → **Upload assets**.
2. Drag in the contents of this folder (or a zip of it).
3. Deploy.

## Local preview

```
python3 tools/serve.py 8080
```
Open `http://localhost:8080`. This resolves extensionless URLs (`/products`,
`/product/ds-2ce16d0t-exipf-3-6mm-o-std`) the way Cloudflare Pages does;
`python3 -m http.server` cannot, so internal links 404 under it.

## Notes
- All internal links are relative (`index.html`, `products.html`, etc.) — works at any subpath.
- WhatsApp/tel links point to `+254 798 131 085`.
- This is a trimmed copy of the working project: original source material (raw video, price lists, merged catalog PDFs) lives one level up and was deliberately left out — it isn't referenced by any page and doesn't belong in a public repo.
