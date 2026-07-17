# Deployment Manifest

- **Type:** Static site (no build step)
- **Framework preset:** None
- **Build command:** (none)
- **Output directory:** `/`
- **Entry point:** `index.html`
- **Pages:** index.html, products.html, services.html, about.html, contact.html, world.html
- **Runtime deps:** React + ReactDOM loaded via CDN inside `js/support.js`'s host page; no npm install required
- **Target host:** Cloudflare Pages (Git integration or direct upload) — see README.md
