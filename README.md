# Nashnaal Electronics (NE) — Website

Static site for NE, an authorized Hikvision national distributor & retailer in
Nairobi. Every page is plain HTML that renders fully without JavaScript, so
search engines, link previews and slow phones see the whole page at once.
`js/site.js` (a few KB) only adds the catalog filter and the WhatsApp forms.

This folder is the repo root — everything in here is pushed to GitHub and deployed as-is.

## Structure

```
/
├── index.html            Home
├── products.html         Full catalog (grid generated from data/products.json)
├── quote.html            Quote builder + ready-made kits (kits generated)
├── contact.html          Contact cards, WhatsApp form, map
├── about.html, services.html, faq.html, blog*.html, solution*.html
├── world.html            Scroll-driven brand story ("Explore NE")
├── category/             9 generated category pages (/category/ip-cameras-nvrs …)
├── product/              196 generated product pages, one per model
├── js/
│   ├── site.js                 Catalog filter/search, WhatsApp form handling
│   └── scroll-world-engine.js  Scroll-world page engine (world.html only)
├── data/products.json    The catalogue's single source of truth
├── tools/                Build scripts (not deployed)
├── images/               Product photos (images/hik/ = imported Hikvision photos)
└── assets/               Logo, partner photos, brochures, scroll-world media
```

Styles are inline per page (no blocking stylesheet request). The header,
footer and their CSS are shared and live in `tools/site_layout.py`.

## Editing the site

- **Header, menu, footer, address, phone, social links:** edit
  `tools/site_layout.py` (and `PHONE` in `tools/catalog.py`), then run
  `python3 tools/apply-layout.py` and `python3 tools/build-catalog.py`.
- **Page content:** edit the page's HTML directly. Keep the
  `<!--layout:…-->` and `<!--catalog:…-->` marker comments; the build
  scripts rewrite what is between them.
- **Products, prices, kits:** edit `data/products.json` (or `PACKAGES` in
  `tools/build-catalog.py` for the bundles shown on the homepage and `/quote`) and run
  `python3 tools/build-catalog.py`.
- **"Recommended for you" on the homepage:** four slots (Turbo HD camera, IP
  camera, any camera, access control/intercom). `PICK_SLOTS` and `PICK_DEFAULTS`
  in `tools/build-catalog.py` set the pools and the no-JavaScript fallback;
  `js/site.js` draws a new set on every visit.

## Product pages

Every product in the catalogue has its own page at `/product/<model-slug>`, e.g.
`/product/ds-2ce16d0t-exipf-3-6mm-o-std`, and every category has one at
`/category/<slug>`. Each one carries `Product` and `BreadcrumbList`
JSON-LD, the price, the datasheet specifications, WhatsApp/call CTAs, and links
to related models in the same category.

They are **generated — never edit `product/*.html` by hand.** Edit
`data/products.json` and re-run:

```
python3 tools/build-catalog.py
```

That one command rewrites the product and category pages, the product grid and
JSON-LD inside `products.html`, the bundles on `index.html` and `quote.html`, and `sitemap.xml`
(with each page's last-changed date from git and the product images). Pages
for products removed from the JSON are deleted on the next run.

### Optional rich fields

Any product in `data/products.json` can also carry these fields. Pages without
them fall back to the single photo and the `features` bullet list.

| Field | Shape | Renders as |
| --- | --- | --- |
| `gallery` | `["images/x-2.webp", ...]` | Extra photos after `image`, with clickable thumbnails (pure CSS, works without JavaScript) |
| `overview` | `"One or two sentences"` | Overview paragraph; also used as the Product schema description |
| `keyFeatures` | `["...", "..."]` | Highlight tiles under the overview (filled by the Hikvision import) |
| `highlights` | `["3-year warranty", ...]` | NE's own selling points, shown before `keyFeatures`; never overwritten by the import |
| `brand` | `""` or a name | Defaults to Hikvision; set `""` for unbranded items to drop Hikvision brand and datasheet lines |
| `specTable` | `[{"group": "Camera", "rows": [["Image sensor", "1/3\" CMOS"], ...]}, ...]` | Grouped specification table |
| `datasheet` | URL or `/assets/...pdf` | "Download datasheet (PDF)" button |
| `hikvisionUrl` | URL | "View on hikvision.com" button |

### Importing photos and specs from hikvision.com

`tools/hikvision/` fills the fields above from Hikvision's own product pages.
hikvision.com sits behind a JavaScript bot check, so the scraper drives a real
browser (Playwright, preinstalled in Claude Code cloud sessions):

```
node tools/hikvision/scrape.js sitemap   # save Hikvision's sitemap
python3 tools/hikvision/make-plan.py     # match catalogue models to pages
node tools/hikvision/scrape.js           # fetch pages (cached, ~1 h for all)
python3 tools/import-hikvision.py        # photos -> images/hik/, fill fields
python3 tools/build-catalog.py           # regenerate product pages
```

The importer picks the exact variant from each family page (for example
`-LIU` rather than `-LIUF/SRB`), so specs and features match the model sold.
Products only matched to a family page get photos and general features but no
spec table. `tools/hikvision/report.json` lists what matched.

The catalog grid and category pages only use the listing fields, so they stay light.

Because product pages live one directory down, their internal links are
root-absolute (`/products`, `/images/001.png`) rather than relative.

## Deploy (Cloudflare Workers, Git integration)

The site is the Worker **ne1**. Cloudflare builds it on every push to the
production branch (`main`):

- **Build command:** `python3 tools/build-catalog.py` (regenerates product,
  category and bundle pages from `data/products.json`, so admin edits show up)
- **Deploy command:** `npx wrangler deploy` (default)

Static files are served directly. `worker/index.js` only runs for `/admin`,
`/auth/*` and `/api/*` (see `run_worker_first` in `wrangler.jsonc`).

## Admin panel and sign-in

- `/admin` &mdash; product editor (list, edit price/name/category/description,
  change photo, add, delete). Only emails in `ADMIN_EMAILS` can open it.
- Sign-in is Google OAuth (`/auth/google/login` &rarr; `/auth/google/callback`).
  Users and sessions live in the D1 database **ne-accounts** (`worker/schema.sql`).
- Saving commits `data/products.json` (and any new photo under
  `images/uploads/`) to `GITHUB_BRANCH` through the GitHub API; the Cloudflare
  build then regenerates the pages, so changes are live in 2&ndash;3 minutes.
- Products used in a bundle can't be deleted from the panel; the build writes
  their models to `data/bundle-models.json`.

Settings: plain values are in `wrangler.jsonc` `vars`. Secrets are set in the
Cloudflare dashboard (**ne1 &rarr; Settings &rarr; Variables and Secrets**), never in git:

| Secret | What |
|---|---|
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client secret |
| `GITHUB_TOKEN` | Fine-grained token, repo `gutale-3/NE1` only, Contents: read and write |

Local test: `npx wrangler dev --var GOOGLE_CLIENT_SECRET:x --var GITHUB_TOKEN:x`
(add `--var GITHUB_API:<url>` to point at a fake GitHub).

## Local preview

```
python3 tools/serve.py 8080
```
Open `http://localhost:8080`. This resolves extensionless URLs (`/products`,
`/product/ds-2ce16d0t-exipf-3-6mm-o-std`) the way Cloudflare Pages does;
`python3 -m http.server` cannot, so internal links 404 under it.

## Notes
- All internal links are relative (`index.html`, `products.html`, etc.) — works at any subpath.
- WhatsApp/tel links point to `+254 737 454 891`.
- This is a trimmed copy of the working project: original source material (raw video, price lists, merged catalog PDFs) lives one level up and was deliberately left out — it isn't referenced by any page and doesn't belong in a public repo.
