#!/usr/bin/env python3
"""Regenerate everything derived from data/products.json.

    python3 tools/build-catalog.py

Writes js/products.js, one static page per product under product/, the
catalog JSON-LD block inside products.html, and the sitemap. Edit
data/products.json (never the generated files) and re-run.
"""
import html
import json
import pathlib
import re
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import catalog
from catalog import PHONE, PHONE_LABEL, ROOT, SITE

PAGE_DIR = ROOT / "product"
RELATED_COUNT = 5

NAV = [
    ("/", "Home"),
    ("/world", "Explore"),
    ("/products", "Products"),
    ("/solutions", "Solutions"),
    ("/services", "Services"),
    ("/faq", "FAQ"),
    ("/about", "About"),
    ("/contact", "Contact"),
]

STYLE = """
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #F6F8FA; color: #10202E; }
img { max-width: 100%; }
a { color: #086E9E; text-decoration: none; }
h1, h2, h3 { letter-spacing: -0.01em; }
.wrap { max-width: 1240px; margin: 0 auto; padding: 0 24px; }
.navtoggle-cb { display: none; }
.hamburger-btn { display: none; cursor: pointer; font-size: 24px; color: #10202E; line-height: 1; padding: 12px; margin: -12px; }
.hamburger-icon-close { display: none; }
.mobile-nav-panel { display: none; flex-direction: column; padding: 6px 24px 22px; border-top: 1px solid #E7ECF1; background: #fff; }
.mobile-nav-panel a { padding: 15px 4px; font-size: 16px; font-weight: 600; color: #10202E; border-bottom: 1px solid #F0F3F5; }
.navtoggle-cb:checked ~ div .hamburger-icon-open { display: none; }
.navtoggle-cb:checked ~ div .hamburger-icon-close { display: inline; }
.navtoggle-cb:checked ~ .mobile-nav-panel { display: flex !important; }
.nav-links { display: flex; align-items: center; gap: 32px; flex: 1; justify-content: center; }
.nav-links a { font-size: 15px; font-weight: 600; color: #10202E; }
.nav-links a.on { font-weight: 700; color: #086E9E; }
.call-btn { flex-shrink: 0; display: flex; align-items: center; gap: 8px; background: #086E9E; color: #fff; padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 700; white-space: nowrap; }

.crumbs { font-size: 13px; color: #4A5B68; padding: 16px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.crumbs a { color: #4A5B68; }
.crumbs a:hover { color: #086E9E; }
.crumbs span[aria-current] { color: #10202E; font-weight: 600; }

.detail { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; align-items: start; padding-bottom: 8px; }
.shot { background: #fff; border: 1px solid #E7ECF1; border-radius: 16px; padding: 32px; display: flex; align-items: center; justify-content: center; min-height: 420px; }
.shot img { max-height: 400px; object-fit: contain; }
.eyebrow { display: inline-block; font-size: 11.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #086E9E; background: #EAF6FC; border-radius: 999px; padding: 6px 12px; margin-bottom: 14px; }
.detail h1 { font-size: clamp(1.5rem, 2.4vw + 0.9rem, 2.1rem); font-weight: 800; margin: 0 0 10px; line-height: 1.2; }
.sku { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13.5px; color: #4A5B68; margin-bottom: 20px; word-break: break-word; }
.pricebox { background: #fff; border: 1px solid #E7ECF1; border-radius: 14px; padding: 20px 22px; margin-bottom: 18px; }
.price { font-size: 30px; font-weight: 800; line-height: 1.1; }
.price small { font-size: 15px; font-weight: 700; color: #4A5B68; }
.stock { font-size: 13px; font-weight: 600; color: #1B8A4B; margin-top: 8px; }
.note { font-size: 12.5px; color: #4A5B68; margin-top: 10px; line-height: 1.6; }
.ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 22px; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 14px 24px; border-radius: 10px; font-size: 14.5px; font-weight: 700; }
.btn-wa { background: #22C35E; color: #fff; }
.btn-wa:hover { background: #1CAD52; color: #fff; }
.btn-call { background: #086E9E; color: #fff; }
.btn-call:hover { background: #0B7EB5; color: #fff; }
.btn-ghost { background: #fff; color: #086E9E; border: 1.5px solid #0B8FCB; }
.btn-ghost:hover { background: #EAF6FC; }
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: #E7ECF1; border: 1px solid #E7ECF1; border-radius: 12px; overflow: hidden; }
.facts div { background: #fff; padding: 14px 16px; }
.facts dt { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #4A5B68; margin-bottom: 5px; }
.facts dd { margin: 0; font-size: 14px; font-weight: 600; word-break: break-word; }

section.block { padding: 44px 0 0; }
.block h2 { font-size: clamp(1.2rem, 2.2vw + 0.6rem, 1.5rem); font-weight: 800; margin: 0 0 18px; }
.specs { background: #fff; border: 1px solid #E7ECF1; border-radius: 16px; padding: 10px 26px; columns: 2; column-gap: 40px; }
.specs li { break-inside: avoid; font-size: 14px; line-height: 1.65; color: #10202E; margin: 12px 0; }
.specs ul { margin: 0; padding-left: 20px; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 20px; }
.card { background: #fff; border: 1px solid #E7ECF1; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; transition: box-shadow 0.2s, transform 0.2s; }
.card:hover { box-shadow: 0 12px 28px rgba(16,32,46,0.1); transform: translateY(-4px); }
.card-shot { background: #F8FAFB; height: 150px; display: flex; align-items: center; justify-content: center; padding: 16px; border-bottom: 1px solid #F0F3F5; }
.card-shot img { max-height: 100%; object-fit: contain; }
.card-body { padding: 14px 16px 16px; display: flex; flex-direction: column; flex: 1; }
.card-name { font-size: 14.5px; font-weight: 700; line-height: 1.35; color: #10202E; margin-bottom: 4px; }
.card-sku { font-size: 11.5px; color: #4A5B68; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-bottom: 10px; word-break: break-word; }
.card-price { margin-top: auto; padding-top: 10px; border-top: 1px dashed #EDF1F4; font-size: 16px; font-weight: 800; }

.pager { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 36px 0 0; font-size: 14px; font-weight: 600; }
.band { margin: 48px 0 0; background: linear-gradient(135deg,#0B7EB5 0%,#0B8FCB 100%); border-radius: 16px; padding: 34px; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.band h2 { color: #fff; margin: 0 0 6px; font-size: 1.25rem; font-weight: 800; }
.band p { color: rgba(255,255,255,0.88); margin: 0; font-size: 14.5px; }
.band a { background: #fff; color: #0B7EB5; padding: 13px 24px; border-radius: 9px; font-weight: 700; font-size: 14px; white-space: nowrap; }

footer { background: #0F2C3D; padding: 40px 24px; margin-top: 56px; }
.foot { max-width: 1240px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
.foot p { font-size: 13.5px; color: rgba(255,255,255,0.55); margin: 0; }
.foot nav { display: flex; gap: 22px; flex-wrap: wrap; }
.foot a { font-size: 13.5px; color: rgba(255,255,255,0.75); }

@keyframes pulseRing { 0% { transform: scale(1); opacity: 0.55; } 100% { transform: scale(1.6); opacity: 0; } }
.wa-float { position: fixed; bottom: 26px; right: 26px; width: 58px; height: 58px; border-radius: 50%; background: #22C35E; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 20px rgba(0,0,0,0.2); z-index: 60; font-size: 26px; line-height: 1; }
.wa-float::before { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(11,143,203,0.55); animation: pulseRing 2.2s ease-out infinite; pointer-events: none; }

@media (max-width: 860px) {
  .nav-links, .call-btn { display: none !important; }
  .hamburger-btn { display: flex !important; align-items: center; justify-content: center; }
  .detail { grid-template-columns: 1fr; gap: 24px; }
  .shot { min-height: 280px; padding: 22px; }
  .specs { columns: 1; }
}
""".strip()


def esc(value):
    return html.escape(str(value), quote=True)


def wa_link(message):
    return f"https://wa.me/{PHONE.lstrip('+')}?text={urllib.parse.quote(message)}"


def header_html():
    desktop = "\n        ".join(
        '<a href="{}"{}>{}</a>'.format(
            href, ' class="on"' if href == "/products" else "", label
        )
        for href, label in NAV
    )
    mobile = "\n      ".join(
        f'<a href="{href}">{label}</a>' for href, label in NAV
    )
    return f"""<header style="position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid #E7ECF1">
    <input type="checkbox" id="navtoggle" class="navtoggle-cb">
    <div class="wrap" style="display:flex;align-items:center;justify-content:space-between;padding-top:10px;padding-bottom:10px;gap:16px">
      <a href="/" style="display:flex;align-items:center;flex-shrink:0">
        <img src="/assets/nashnaal-logo-header.webp" alt="NE — Nashnaal Electronics" width="52" height="52" style="height:52px;width:auto;display:block">
      </a>
      <nav class="nav-links">
        {desktop}
      </nav>
      <a href="tel:{PHONE}" class="call-btn">Call {PHONE_LABEL}</a>
      <label for="navtoggle" class="hamburger-btn" aria-label="Open menu">
        <span class="hamburger-icon-open">&#9776;</span>
        <span class="hamburger-icon-close">&#10005;</span>
      </label>
    </div>
    <nav class="mobile-nav-panel">
      {mobile}
      <a href="tel:{PHONE}" style="margin-top:12px;text-align:center;background:#086E9E;color:#fff;padding:15px;border-radius:8px;font-weight:700;font-size:16px;border:0">Call {PHONE_LABEL}</a>
    </nav>
  </header>"""


FOOTER = f"""<footer>
    <div class="foot">
      <p>&copy; 2026 NE &mdash; Nashnaal Electronics. Authorized Hikvision distributor &amp; retailer.</p>
      <nav>
        <a href="/">Home</a>
        <a href="/products">Products</a>
        <a href="/solutions">Solutions</a>
        <a href="/faq">FAQ</a>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
      </nav>
    </div>
  </footer>

  <a href="https://wa.me/{PHONE.lstrip('+')}" target="_blank" rel="noopener" class="wa-float" aria-label="Chat with NE on WhatsApp"><span aria-hidden="true">&#128172;</span></a>"""


def card_html(product):
    return f"""<a class="card" href="{esc(product['url'])}">
          <div class="card-shot"><img src="/{esc(product['image'])}" alt="{esc(product['name'])}" loading="lazy" decoding="async"></div>
          <div class="card-body">
            <div class="card-name">{esc(product['name'])}</div>
            <div class="card-sku">{esc(product['model'])}</div>
            <div class="card-price">KES {catalog.price_label(product['price'])}</div>
          </div>
        </a>"""


def json_ld(product, category_url):
    page_url = SITE + product["url"]
    product_ld = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": product["name"],
        "sku": product["model"],
        "mpn": product["model"],
        "category": product["category"],
        "description": product["features"],
        "image": f"{SITE}/{product['image']}",
        "brand": {"@type": "Brand", "name": "Hikvision"},
        "offers": {
            "@type": "Offer",
            "price": product["price"],
            "priceCurrency": "KES",
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/NewCondition",
            "url": page_url,
            "seller": {"@type": "Organization", "name": "Nashnaal Electronics (NE)"},
        },
    }
    crumbs_ld = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Products", "item": SITE + "/products"},
            {"@type": "ListItem", "position": 3, "name": product["category"], "item": SITE + category_url},
            {"@type": "ListItem", "position": 4, "name": product["name"], "item": page_url},
        ],
    }
    dump = lambda obj: json.dumps(obj, indent=1, ensure_ascii=False)
    return (
        f'<script type="application/ld+json">\n{dump(product_ld)}\n</script>\n'
        f'<script type="application/ld+json">\n{dump(crumbs_ld)}\n</script>'
    )


def render(product, siblings, index):
    page_url = SITE + product["url"]
    category_url = "/products?cat=" + urllib.parse.quote(product["category"])
    title = f"{product['name']} — {product['model']} | NE Kenya"
    description = (
        f"{product['name']} ({product['model']}) from KES "
        f"{catalog.price_label(product['price'])}. "
        f"{catalog.summary(product['features'], 105)}"
    )
    enquiry = wa_link(
        f"Hi NE, I would like to enquire about: {product['name']} ({product['model']})"
    )
    quote = wa_link(
        f"Hi NE, please send me a quote for {product['model']} — including installation."
    )

    specs = "\n            ".join(
        f"<li>{esc(line)}</li>" for line in catalog.spec_lines(product["features"])
    )
    related = [p for p in siblings if p["id"] != product["id"]][:RELATED_COUNT]
    related_html = "\n        ".join(card_html(p) for p in related)

    previous_product = siblings[index - 1] if index > 0 else None
    next_product = siblings[index + 1] if index + 1 < len(siblings) else None
    prev_link = (
        f'<a href="{esc(previous_product["url"])}">&larr; {esc(previous_product["name"])}</a>'
        if previous_product
        else "<span></span>"
    )
    next_link = (
        f'<a href="{esc(next_product["url"])}">{esc(next_product["name"])} &rarr;</a>'
        if next_product
        else "<span></span>"
    )

    blurb = catalog.CATEGORY_BLURBS.get(product["category"], "")
    related_block = (
        f"""<section class="block">
      <h2>More in {esc(product['category'])}</h2>
      <div class="cards">
        {related_html}
      </div>
      <p style="margin:20px 0 0;font-size:14px"><a href="{esc(category_url)}">See all {len(siblings)} {esc(product['category'])} products &rarr;</a></p>
    </section>"""
        if related
        else ""
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(page_url)}">
<link rel="icon" type="image/png" href="/assets/nashnaal-favicon.png">
<link rel="apple-touch-icon" href="/assets/nashnaal-favicon.png">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Nashnaal Electronics (NE)">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(page_url)}">
<meta property="og:image" content="{esc(SITE + '/' + product['image'])}">
<meta property="og:locale" content="en_KE">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{esc(SITE + '/' + product['image'])}">
{json_ld(product, category_url)}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"></noscript>
<style>
{STYLE}
</style>
</head>
<body>
  {header_html()}

  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">Home</a> <span aria-hidden="true">/</span>
      <a href="/products">Products</a> <span aria-hidden="true">/</span>
      <a href="{esc(category_url)}">{esc(product['category'])}</a> <span aria-hidden="true">/</span>
      <span aria-current="page">{esc(product['name'])}</span>
    </nav>

    <div class="detail">
      <div class="shot">
        <img src="/{esc(product['image'])}" alt="{esc(product['name'])} — {esc(product['model'])}" fetchpriority="high" decoding="async">
      </div>

      <div>
        <span class="eyebrow">{esc(product['category'])}</span>
        <h1>{esc(product['name'])}</h1>
        <div class="sku">{esc(product['model'])}</div>

        <div class="pricebox">
          <div class="price">KES {catalog.price_label(product['price'])} <small>per unit</small></div>
          <div class="stock">&#10003; Genuine Hikvision stock &mdash; manufacturer warranty support</div>
          <p class="note">Talk to us for project and volume pricing, or for a quote that includes cabling, installation and configuration.</p>
        </div>

        <div class="ctas">
          <a class="btn btn-wa" href="{esc(enquiry)}" target="_blank" rel="noopener">Enquire on WhatsApp</a>
          <a class="btn btn-call" href="tel:{PHONE}">Call {PHONE_LABEL}</a>
          <a class="btn btn-ghost" href="{esc(quote)}" target="_blank" rel="noopener">Request a quote</a>
        </div>

        <dl class="facts">
          <div><dt>Brand</dt><dd>Hikvision</dd></div>
          <div><dt>Model</dt><dd>{esc(product['model'])}</dd></div>
          <div><dt>Category</dt><dd>{esc(product['category'])}</dd></div>
          <div><dt>Units per carton</dt><dd>{esc(product['pcsCtn'])}</dd></div>
        </dl>
      </div>
    </div>

    <section class="block">
      <h2>Specifications</h2>
      <div class="specs">
        <ul>
            {specs}
        </ul>
      </div>
      <p class="note" style="max-width:70ch">Specifications come from Hikvision's published datasheet for {esc(product['model'])} and may be revised by the manufacturer. Confirm the exact variant with us before ordering.</p>
    </section>

    {related_block}

    <nav class="pager" aria-label="More products in this category">
      {prev_link}
      {next_link}
    </nav>

    <section class="band">
      <div>
        <h2>Need this supplied and installed?</h2>
        <p>{esc(blurb) if blurb else 'NE supplies, installs and supports Hikvision systems across Kenya.'}</p>
      </div>
      <a href="/contact">Get in touch &rarr;</a>
    </section>
  </div>

  {FOOTER}
</body>
</html>
"""


def write_products_js(products):
    payload = json.dumps(products, indent=2, ensure_ascii=False)
    (ROOT / "js/products.js").write_text(
        "// Generated by tools/build-catalog.py from data/products.json — do not edit by hand.\n"
        f"export const PRODUCTS = {payload};\n\n"
        "export const CATEGORIES = [...new Set(PRODUCTS.map(p => p.category))];\n",
        encoding="utf-8",
    )


def write_catalog_json_ld(products):
    """Swap the fat inline ItemList in products.html for a list of page links.

    Each product now carries its own Product schema on its own page, so the
    catalog page only needs to point at them.
    """
    path = ROOT / "products.html"
    source = path.read_text(encoding="utf-8")
    items = [
        {
            "@type": "ListItem",
            "position": index,
            "name": product["name"],
            "url": SITE + product["url"],
        }
        for index, product in enumerate(products, start=1)
    ]
    block = json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": "NE Hikvision Product Catalog",
            "numberOfItems": len(products),
            "itemListElement": items,
        },
        indent=1,
        ensure_ascii=False,
    )
    pattern = re.compile(
        r'<script type="application/ld\+json">\s*\{\s*"@context"[^\0]*?"@type": "ItemList"[^\0]*?\n</script>'
    )
    if not pattern.search(source):
        sys.exit("products.html: could not find the ItemList JSON-LD block to replace")
    replacement = f'<script type="application/ld+json">\n{block}\n</script>'
    path.write_text(pattern.sub(lambda _: replacement, source, count=1), encoding="utf-8")


def write_sitemap(products):
    path = ROOT / "sitemap.xml"
    source = path.read_text(encoding="utf-8")
    source = re.sub(
        r"\n  <!-- products -->.*?(?=</urlset>)", "\n", source, flags=re.S
    )
    lastmod = re.search(r"<lastmod>([\d-]+)</lastmod>", source).group(1)
    entries = "".join(
        f"  <url>\n"
        f"    <loc>{SITE}{product['url']}</loc>\n"
        f"    <lastmod>{lastmod}</lastmod>\n"
        f"    <changefreq>monthly</changefreq>\n"
        f"    <priority>0.6</priority>\n"
        f"  </url>\n"
        for product in products
    )
    source = source.replace(
        "</urlset>", f"  <!-- products -->\n{entries}</urlset>"
    )
    path.write_text(source, encoding="utf-8")


def main():
    products = catalog.load()
    catalog.save(products)

    by_category = {}
    for product in products:
        by_category.setdefault(product["category"], []).append(product)

    PAGE_DIR.mkdir(exist_ok=True)
    expected = set()
    for siblings in by_category.values():
        for index, product in enumerate(siblings):
            path = PAGE_DIR / f"{product['slug']}.html"
            path.write_text(render(product, siblings, index), encoding="utf-8")
            expected.add(path.name)

    stale = [p for p in PAGE_DIR.glob("*.html") if p.name not in expected]
    for path in stale:
        path.unlink()

    write_products_js(products)
    write_catalog_json_ld(products)
    write_sitemap(products)

    print(f"{len(products)} product pages written to product/")
    if stale:
        print(f"{len(stale)} stale pages removed")
    print("js/products.js, products.html JSON-LD and sitemap.xml updated")


if __name__ == "__main__":
    main()
