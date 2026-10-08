#!/usr/bin/env python3
"""Regenerate everything derived from data/products.json.

    python3 tools/build-catalog.py

Writes one static page per product under product/, one page per category
under category/, the product grid and ItemList JSON-LD inside products.html,
and sitemap.xml. Edit
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
import site_layout
import brochure_pages
import print_catalogue
import kits_page
from catalog import PHONE, PHONE_LABEL, ROOT, SITE
from site_layout import category_url as category_page_url

PAGE_DIR = ROOT / "product"
RELATED_COUNT = 5

STYLE = """
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #F6F8FA; color: #10202E; }
img { max-width: 100%; }
a { color: #086E9E; text-decoration: none; }
h1, h2, h3 { letter-spacing: -0.01em; }
.wrap { max-width: 1240px; margin: 0 auto; padding: 0 24px; }

.crumbs { font-size: 13px; color: #4A5B68; padding: 16px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.crumbs a { color: #4A5B68; }
.crumbs a:hover { color: #086E9E; }
.crumbs span[aria-current] { color: #10202E; font-weight: 600; }

.detail { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; align-items: start; padding-bottom: 8px; }
.shot { background: #fff; border: 1px solid #E7ECF1; border-radius: 16px; padding: 32px; display: flex; align-items: center; justify-content: center; min-height: 420px; }
.shot img { max-height: 400px; object-fit: contain; }
.gallery > input { position: absolute; opacity: 0; pointer-events: none; }
.gallery .shot { position: relative; }
.gallery .slide { display: none; width: 100%; height: 400px; align-items: center; justify-content: center; }
.gallery .slide img { max-height: 100%; }
.thumbs { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.thumbs label { width: 72px; height: 72px; background: #fff; border: 1.5px solid #E7ECF1; border-radius: 10px; padding: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.thumbs label:hover { border-color: #0B8FCB; }
.thumbs img { max-height: 100%; object-fit: contain; }
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
.facts div:last-child:nth-child(odd) { grid-column: 1 / -1; }

section.block { padding: 44px 0 0; }
.site-footer { margin-top: 56px; }
.block h2 { font-size: clamp(1.2rem, 2.2vw + 0.6rem, 1.5rem); font-weight: 800; margin: 0 0 18px; }
.specs { background: #fff; border: 1px solid #E7ECF1; border-radius: 16px; padding: 10px 26px; columns: 2; column-gap: 40px; }
.specs li { break-inside: avoid; font-size: 14px; line-height: 1.65; color: #10202E; margin: 12px 0; }
.specs ul { margin: 0; padding-left: 20px; }
.overview { font-size: 16px; line-height: 1.75; color: #3D4F5C; max-width: 75ch; margin: 0 0 18px; }
.highlights { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
.highlights li { background: #fff; border: 1px solid #E7ECF1; border-radius: 12px; padding: 14px 16px 14px 40px; font-size: 14px; line-height: 1.55; position: relative; }
.highlights li::before { content: "\\2713"; position: absolute; left: 16px; top: 14px; color: #086E9E; font-weight: 800; }
.spec-table { background: #fff; border: 1px solid #E7ECF1; border-radius: 16px; overflow: hidden; }
.spec-table table { width: 100%; border-collapse: collapse; font-size: 14px; }
.spec-group + .spec-group { border-top: 1px solid #E7ECF1; }
.spec-group summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #F3F7FA; color: #086E9E; font-size: 12.5px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; padding: 13px 20px; }
.spec-group summary::-webkit-details-marker { display: none; }
.spec-group summary span { margin-left: auto; font-size: 11px; font-weight: 700; color: #4A5B68; letter-spacing: 0; }
.spec-group summary::after { content: "+"; font-size: 18px; line-height: 1; color: #086E9E; }
.spec-group[open] summary::after { content: "\\2212"; }
.spec-group summary:hover { background: #EAF6FC; }
.spec-table th[scope=row] { text-align: left; font-weight: 600; color: #4A5B68; width: 34%; padding: 11px 20px; vertical-align: top; }
.spec-table td { padding: 11px 20px; color: #10202E; line-height: 1.55; word-break: break-word; }
.spec-table tr + tr th, .spec-table tr + tr td { border-top: 1px solid #F0F3F5; }
.spec-table tr:first-child th, .spec-table tr:first-child td { border-top: 1px solid #E7ECF1; }
.doc-links { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }

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



@media (max-width: 860px) {
  .detail { grid-template-columns: 1fr; gap: 24px; }
  .shot { min-height: 280px; padding: 22px; }
  .specs { columns: 1; }
  .gallery .slide { height: 260px; }
  .thumbs { gap: 8px; }
  .thumbs label { width: 58px; height: 58px; padding: 5px; }
  .spec-table th[scope=row] { width: 42%; padding: 10px 14px; }
  .spec-group summary { padding: 13px 14px; }
  .spec-table td { padding: 10px 14px; }
}
""".strip()


def esc(value):
    return html.escape(str(value), quote=True)


def wa_link(message):
    return f"https://wa.me/{PHONE.lstrip('+')}?text={urllib.parse.quote(message)}"


def card_html(product):
    return f"""<a class="card" href="{esc(product['url'])}">
          <div class="card-shot"><img src="/{esc(product['image'])}" alt="{esc(product['name'])}" loading="lazy" decoding="async"></div>
          <div class="card-body">
            <div class="card-name">{esc(product['name'])}</div>
            <div class="card-sku">{esc(product['model'])}</div>
            <div class="card-price" data-kes="{product['price']}">KES {catalog.price_label(product['price'])}</div>
          </div>
        </a>"""


def images_of(product):
    """Main image first, then any extra gallery shots, without duplicates."""
    seen = []
    for path in [product["image"], *product.get("gallery", [])]:
        if path and path not in seen:
            seen.append(path)
    return seen


def clip(text, limit=155):
    """Cut at a word boundary so Google shows the whole snippet."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0].rstrip(" ,;:.-—") + "…"


# Packaging/market tags that do not tell two products apart.
NOISE_TAGS = re.compile(r"\((?:O-STD|STD|O-NEU|UK|Africa|EU)\)|/(?:Overseas|UK|EU)\b|/\d+PCS\b", re.I)
WEAK_ENDINGS = {"with", "and", "&", "for", "of", "the", "a", "-", "—", "in", "to"}


def core_model(model):
    """DS-2CD1047G3-LIU(4mm)(O-STD) -> DS-2CD1047G3-LIU(4mm); keeps tags that distinguish variants."""
    model = NOISE_TAGS.sub("", model.split(" ")[0].strip(",")).replace("((", "(")
    return model.strip("/") or model


def page_title(product, limit=62):
    suffix = " | NE Kenya"
    core = core_model(product["model"])
    name = re.sub(r"\s+", " ", product["name"]).strip()
    base = f"{core} {name}"
    room = limit - len(suffix)
    if len(base) > room:
        words = base[:room + 1].split(" ")[:-1] or [base[:room]]
        while len(words) > 1 and (words[-1].lower() in WEAK_ENDINGS or words[-1].count("(") > words[-1].count(")")):
            words.pop()
        base = " ".join(words).rstrip(" ,-—&")
        if base.count("(") > base.count(")"):  # never end on an unfinished "(…"
            base = base[: base.rindex("(")].rstrip(" ,-—&")
    return base + suffix


def brand_of(product):
    """Catalogue items are Hikvision unless they say otherwise ("brand": "" for unbranded)."""
    return product.get("brand", "Hikvision")


def share_image(product):
    """Link previews (WhatsApp, Facebook) still prefer PNG/JPEG over WebP."""
    image = product["image"]
    if image.endswith(".webp"):
        for ext in (".png", ".jpg"):
            if (ROOT / (image[:-5] + ext)).exists():
                return image[:-5] + ext
    return image


def gallery_html(product):
    images = images_of(product)
    alt = f"{product['name']} — {product['model']}"
    if len(images) == 1:
        return f"""<div class="shot">
        <img src="/{esc(images[0])}" alt="{esc(alt)}" fetchpriority="high" decoding="async">
      </div>"""
    radios = "\n        ".join(
        f'<input type="radio" name="gallery" id="g{i}"{" checked" if i == 1 else ""} aria-label="Photo {i} of {len(images)}">'
        for i in range(1, len(images) + 1)
    )
    slides = "\n          ".join(
        f'<div class="slide s{i}"><img src="/{esc(path)}" alt="{esc(alt)} — view {i}"'
        + (' fetchpriority="high"' if i == 1 else ' loading="lazy"')
        + ' decoding="async"></div>'
        for i, path in enumerate(images, start=1)
    )
    thumbs = "\n          ".join(
        f'<label for="g{i}"><img src="/{esc(path)}" alt="" loading="lazy" decoding="async"></label>'
        for i, path in enumerate(images, start=1)
    )
    rules = " ".join(
        f".gallery #g{i}:checked ~ .shot .s{i} {{ display: flex; }} "
        f".gallery #g{i}:checked ~ .thumbs label[for=g{i}] {{ border-color: #086E9E; box-shadow: 0 0 0 2px #EAF6FC; }} "
        f".gallery #g{i}:focus-visible ~ .thumbs label[for=g{i}] {{ outline: 2px solid #086E9E; outline-offset: 2px; }}"
        for i in range(1, len(images) + 1)
    )
    return f"""<style>{rules}</style>
      <div class="gallery">
        {radios}
        <div class="shot">
          {slides}
        </div>
        <div class="thumbs">
          {thumbs}
        </div>
      </div>"""


def details_html(product):
    """Overview, highlights and the grouped spec table, when the data has them."""
    parts = []
    # "highlights" are NE's own selling points (warranty, bundling); they lead the
    # Hikvision key features and survive re-running the Hikvision import.
    features = list(product.get("highlights", [])) + [
        f for f in product.get("keyFeatures", []) if f not in product.get("highlights", [])
    ]
    if product.get("overview") or features:
        overview = (
            f'<p class="overview">{esc(product["overview"])}</p>' if product.get("overview") else ""
        )
        highlights = "".join(f"<li>{esc(item)}</li>" for item in features)
        heading = "Overview" if product.get("overview") else "Key features"
        parts.append(f"""<section class="block">
      <h2>{heading}</h2>
      {overview}
      {f'<ul class="highlights">{highlights}</ul>' if highlights else ""}
    </section>""")
    return "\n\n    ".join(parts)


def specs_html(product):
    groups = product.get("specTable")
    if groups:
        sections = "".join(
            f'<details class="spec-group"{" open" if index < 2 else ""}>'
            f'<summary>{esc(group["group"])}<span>{len(group["rows"])}</span></summary><table>'
            + "".join(
                f'<tr><th scope="row">{esc(label)}</th><td>{esc(value)}</td></tr>'
                for label, value in group["rows"]
            )
            + "</table></details>"
            for index, group in enumerate(groups)
        )
        table = f'<div class="spec-table">{sections}</div>'
        if len(groups) > 2:
            table += '<p class="note" style="margin-top:10px">Tap a section to expand it.</p>'
    else:
        lines = "\n            ".join(
            f"<li>{esc(line)}</li>" for line in catalog.spec_lines(product["features"])
        )
        table = f"""<div class="specs">
        <ul>
            {lines}
        </ul>
      </div>"""
    links = []
    if product.get("datasheet"):
        links.append(
            f'<a class="btn btn-ghost" href="{esc(product["datasheet"])}" target="_blank" rel="noopener">Download datasheet (PDF)</a>'
        )
    if product.get("hikvisionUrl"):
        links.append(
            f'<a class="btn btn-ghost" href="{esc(product["hikvisionUrl"])}" target="_blank" rel="noopener">View on hikvision.com</a>'
        )
    doc_links = f'<div class="doc-links">{"".join(links)}</div>' if links else ""
    return f"""<section class="block">
      <h2>Specifications</h2>
      {table}
      {doc_links}
      {f'<p class="note" style="max-width:70ch">Specifications come from Hikvision&rsquo;s published datasheet for {esc(product["model"])} and may be revised by the manufacturer. Confirm the exact variant with us before ordering.</p>' if brand_of(product) == "Hikvision" else ""}
    </section>"""


def json_ld(product, category_url):
    page_url = SITE + product["url"]
    product_ld = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": product["name"],
        "sku": product["model"],
        "mpn": product["model"],
        "category": product["category"],
        "description": product.get("overview") or product["features"],
        "image": [f"{SITE}/{path}" for path in images_of(product)],
        **({"brand": {"@type": "Brand", "name": brand_of(product)}} if brand_of(product) else {}),
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
    category_url = category_page_url(product["category"])
    title = page_title(product)
    description = clip(
        f"{core_model(product['model'])} {product['name']}, KES {catalog.price_label(product['price'])} at NE Nairobi. "
        f"{catalog.summary(product['features'], 150)}"
    )
    enquiry = wa_link(
        f"Hi NE, I would like to enquire about: {product['name']} ({product['model']})"
    )
    quote = wa_link(
        f"Hi NE, please send me a quote for {product['model']} — including installation."
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
<meta property="og:image" content="{esc(SITE + '/' + share_image(product))}">
<meta property="og:locale" content="en_KE">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{esc(SITE + '/' + share_image(product))}">
{json_ld(product, category_url)}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"></noscript>
<style>
{STYLE}
</style>
{site_layout.css_block()}
<script src="/js/site.js" defer></script>
</head>
<body>
  {site_layout.header_html("/products")}

  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">Home</a> <span aria-hidden="true">/</span>
      <a href="/products">Products</a> <span aria-hidden="true">/</span>
      <a href="{esc(category_url)}">{esc(product['category'])}</a> <span aria-hidden="true">/</span>
      <span aria-current="page">{esc(product['name'])}</span>
    </nav>

    <div class="detail">
      {gallery_html(product)}

      <div>
        <span class="eyebrow">{esc(product['category'])}</span>
        <h1>{esc(product['name'])}</h1>
        <div class="sku">{esc(product['model'])}</div>

        <div class="pricebox">
          <div class="price" data-kes="{product['price']}">KES {catalog.price_label(product['price'])} <small>per unit</small></div>
          <div class="stock">&#10003; {"Genuine Hikvision stock &mdash; manufacturer warranty support" if brand_of(product) == "Hikvision" else "In stock at our Nairobi showroom"}</div>
          <p class="note">Talk to us for project and volume pricing, or for a quote that includes cabling, installation and configuration.</p>
        </div>

        <div class="ctas">
          <button class="btn btn-cart" type="button" data-add-cart="{esc(product['slug'])}" hidden>Add to cart</button>
          <a class="btn btn-wa" href="{esc(enquiry)}" target="_blank" rel="noopener">Enquire on WhatsApp</a>
          <a class="btn btn-call" href="tel:{PHONE}">Call {PHONE_LABEL}</a>
          <a class="btn btn-ghost" href="{esc(quote)}" target="_blank" rel="noopener">Request a quote</a>
        </div>

        <dl class="facts">
          {f"<div><dt>Brand</dt><dd>{esc(brand_of(product))}</dd></div>" if brand_of(product) else ""}
          <div><dt>Model</dt><dd>{esc(product['model'])}</dd></div>
          <div><dt>Category</dt><dd>{esc(product['category'])}</dd></div>
          {f"<div><dt>Units per carton</dt><dd>{esc(product['pcsCtn'])}</dd></div>" if str(product.get('pcsCtn', '')).strip() else ""}
        </dl>
      </div>
    </div>

    {details_html(product)}

    {specs_html(product)}

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

  {site_layout.footer_html()}
</body>
</html>
"""


CATALOG_CSS = (ROOT / "tools/catalog.css").read_text(encoding="utf-8").strip()
PAGE_SIZE = 24


def catalog_card_html(product):
    photos = 1 + len(product.get("gallery", []))
    badge = f'<span class="pc-photos">{photos} photos</span>' if photos > 1 else ""
    search = f"{product['name']} {product['model']}".lower()
    enquiry = wa_link(f"Hi NE, I would like to enquire about: {product['name']} ({product['model']})")
    return f"""<div class="pc" data-cat="{esc(product['category'])}" data-q="{esc(search)}">
  <a class="pc-link" href="{esc(product['url'])}" aria-label="{esc(product['name'])}"></a>{badge}
  <div class="pc-shot"><img src="/{esc(product['image'])}" alt="{esc(product['name'])}" loading="lazy" decoding="async" width="200" height="144"></div>
  <div class="pc-body">
    <div class="pc-cat">{esc(product['category'])}</div>
    <h3 class="pc-name">{esc(product['name'])}</h3>
    <div class="pc-sku">{esc(product['model'])}</div>
    <div class="pc-foot">
      <div class="pc-price" data-kes="{product['price']}">KES {catalog.price_label(product['price'])}</div>
      <div class="pc-links"><span>View details &rarr;</span><a class="pc-wa" href="{esc(enquiry)}" target="_blank" rel="noopener">Enquire &rarr;</a></div>
      <button class="pc-add" type="button" data-add-cart="{esc(product['slug'])}" hidden>+ Add to cart</button>
    </div>
  </div>
</div>"""


def controls_html(products, active=None):
    counts = {}
    for product in products:
        counts[product["category"]] = counts.get(product["category"], 0) + 1
    tabs = [f'<a class="ptab{" on" if active is None else ""}" href="/products" data-cat="All">All ({len(products)})</a>']
    for name in site_layout.CATEGORIES:
        if name in counts:
            on = " on" if name == active else ""
            tabs.append(
                f'<a class="ptab{on}" href="{category_page_url(name)}" data-cat="{esc(name)}">{esc(site_layout.CATEGORIES[name][2])} ({counts[name]})</a>'
            )
    return (
        '<div class="ptabs">\n        ' + "\n        ".join(tabs) + "\n      </div>\n"
        '      <input type="search" id="catalog-search" class="psearch" placeholder="Search model or product name…" aria-label="Search products">'
    )


def fill(source, name, content):
    start, end = f"<!--catalog:{name}-->", f"<!--/catalog:{name}-->"
    if start not in source:
        sys.exit(f"missing <!--catalog:{name}--> marker")
    return re.sub(re.escape(start) + r"[\s\S]*?" + re.escape(end), lambda _: f"{start}\n{content}\n{end}", source, count=1)


def write_catalog_page(products):
    path = ROOT / "products.html"
    source = path.read_text(encoding="utf-8")
    source = fill(source, "controls", controls_html(products))
    order = list(site_layout.CATEGORIES)
    grouped = sorted(products, key=lambda p: order.index(p["category"]) if p["category"] in order else len(order))
    parts, current = [], None
    for product in grouped:
        if product["category"] != current:
            current = product["category"]
            count = sum(1 for p in products if p["category"] == current)
            label = site_layout.CATEGORIES.get(current, (None, None, current))[2]
            parts.append(
                f'<h2 class="pgroup" data-group="{esc(current)}">'
                f'<a href="{category_page_url(current)}">{esc(label)}</a> <span>{count} products</span></h2>'
            )
        parts.append(catalog_card_html(product))
    source = fill(source, "grid", "\n".join(parts))
    source = re.sub(r'<style id="catalog-css">[\s\S]*?</style>', lambda _: f'<style id="catalog-css">\n{CATALOG_CSS}\n</style>', source, count=1)
    source = re.sub(r"\d+ genuine Hikvision products across \d+ categories",
                    f"{len(products)} genuine Hikvision products across {len(catalog.categories(products))} categories", source)
    path.write_text(source, encoding="utf-8")


def render_category(name, items, products):
    slug, heading, _ = site_layout.CATEGORIES[name]
    page_url = SITE + category_page_url(name)
    blurb = catalog.CATEGORY_BLURBS.get(name, "")
    title = f"{heading} in Kenya | NE"
    description = clip(f"{len(items)} genuine {heading} models in stock at NE, Nairobi, "
                       f"from KES {catalog.price_label(min(p['price'] for p in items))}. {blurb}")
    item_list = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": heading,
        "url": page_url,
        "mainEntity": {
            "@type": "ItemList",
            "numberOfItems": len(items),
            "itemListElement": [
                {"@type": "ListItem", "position": i, "url": SITE + p["url"], "name": p["name"]}
                for i, p in enumerate(items, start=1)
            ],
        },
    }
    crumbs = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Products", "item": SITE + "/products"},
            {"@type": "ListItem", "position": 3, "name": heading, "item": page_url},
        ],
    }
    dump = lambda obj: json.dumps(obj, indent=1, ensure_ascii=False)
    image = SITE + "/" + share_image(items[0])
    # AI-made scene banner around a real product photo (assets/banners/<slug>.webp), if there is one.
    banner = (ROOT / f"assets/banners/{slug}.webp").exists()
    if banner:
        image = f"{SITE}/assets/banners/{slug}.webp"
    banner_css = (
        f".cat-hero {{ background: linear-gradient(90deg, rgba(9,40,61,.94) 0%, rgba(9,40,61,.82) 38%, rgba(9,40,61,.15) 75%, rgba(9,40,61,0) 100%), "
        f"url('/assets/banners/{slug}.webp') center right / cover no-repeat; min-height: 360px; display: flex; align-items: center; }}\n"
        f".cat-hero .wrap {{ width: 100%; }} .cat-hero p {{ max-width: 52ch; }}\n"
        f"@media (max-width: 760px) {{ .cat-hero {{ background: linear-gradient(180deg, rgba(9,40,61,0) 0, rgba(9,40,61,0) 42vw, #09283D 57vw), "
        f"url('/assets/banners/{slug}-800.webp') top center / 100% auto no-repeat, #09283D; min-height: 0; padding-top: calc(50vw + 8px); }} }}"
    ) if banner else ""
    cards = "\n".join(catalog_card_html(p) for p in items)
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
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nashnaal Electronics (NE)">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(page_url)}">
<meta property="og:image" content="{esc(image)}">
<meta property="og:locale" content="en_KE">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{dump(item_list)}
</script>
<script type="application/ld+json">
{dump(crumbs)}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"></noscript>
<style>
{STYLE}
.cat-hero {{ background: linear-gradient(135deg,#0B7EB5 0%,#0B8FCB 100%); padding: 48px 24px; color: #fff; }}
.cat-hero .wrap {{ padding: 0; }}
.cat-hero h1 {{ font-size: clamp(1.6rem, 3.6vw + 0.9rem, 2.3rem); font-weight: 800; margin: 0 0 10px; }}
.cat-hero p {{ margin: 0; font-size: 16px; color: rgba(255,255,255,0.9); max-width: 70ch; line-height: 1.6; }}
.cat-hero .crumbs, .cat-hero .crumbs a, .cat-hero .crumbs span[aria-current] {{ color: rgba(255,255,255,0.85); padding-top: 0; }}
.cat-controls {{ display: flex; gap: 16px; flex-wrap: wrap; align-items: center; justify-content: space-between; margin: 28px 0; }}
{banner_css}
</style>
<style id="catalog-css">
{CATALOG_CSS}
</style>
{site_layout.css_block()}
<script src="/js/site.js" defer></script>
</head>
<body>
  {site_layout.header_html("/products")}

  <section class="cat-hero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a> <span aria-hidden="true">/</span>
        <a href="/products">Products</a> <span aria-hidden="true">/</span>
        <span aria-current="page">{esc(heading)}</span>
      </nav>
      <h1>{esc(heading)} in Kenya</h1>
      <p>{esc(blurb)} {len(items)} genuine models in stock at our Nairobi showroom, supplied with manufacturer warranty and installed by NE&rsquo;s Hikvision-certified technicians.</p>
    </div>
  </section>

  <div class="wrap">
    <div class="cat-controls">
      {controls_html(products, active=name)}
    </div>
    <div id="catalog-grid" class="pgrid" data-scope="{esc(name)}">
{cards}
    </div>
    <p id="catalog-empty" class="pempty" hidden>No products match that search.</p>
    <div class="pmore"><button type="button" id="catalog-more" hidden>Show more products</button></div>

    {brochure_pages.strip_html(name)}

    <section class="band">
      <div>
        <h2>Not sure which model fits?</h2>
        <p>Tell us about your site and we&rsquo;ll recommend the right {esc(site_layout.CATEGORIES[name][2].lower())} and quote with installation.</p>
      </div>
      <a href="/quote">Get a quote &rarr;</a>
    </section>
  </div>

  {site_layout.footer_html()}
</body>
</html>
"""


# Ready-made bundles for the homepage and /quote. Prices are summed from the
# catalogue at build time; installation is quoted after a site survey.
PACKAGES = [
    # --- Turbo HD (analogue over coax) ---
    {
        "id": "hd-home", "group": "hd", "image": "images/kits/hd-home.webp",
        "name": "HD home starter",
        "for": "Homes and small compounds",
        "summary": "Four 1080p cameras with 20 m night vision, a 4-channel eDVR with built-in 512 GB SSD, power, cabling, clips and connectors.",
        "items": [("DS-2CE16D0T-EXIPF(3.6mm)(O-STD)", 2), ("DS-2CE76D0T-EXIPF(2.8mm)(O-STD)", 2),
                  ("DS-E04HGHI-D", 1), ("DS-2FA1225-C4(UK)(O-STD)", 1), ("DS-1LH1SCAM592C(O-STD) 90m", 1),
                  ("CONN-SET", 4), ("CLIPS-100", 1)],
    },
    {
        "id": "hd-colorvu", "group": "hd", "popular": True, "image": "images/kits/hd-colorvu.webp",
        "name": "HD ColorVu shop & office",
        "for": "Shops, offices and small businesses",
        "summary": "Eight full-colour night vision cameras with audio, an 8-channel eDVR with built-in 1 TB SSD, power, cabling, clips and connectors.",
        "items": [("DS-2CE10DF0T-LPFS(3.6mm)(O-STD)", 4), ("DS-2CE70DF0T-LPFS(2.8mm)(O-STD)", 4),
                  ("DS-E08HGHI-D", 1), ("DS-2FA1205-C8(UK)(O-STD)", 1), ("DS-1LH1SCAM592C(O-STD) 180m", 1),
                  ("CONN-SET", 8), ("CLIPS-100", 2)],
    },
    {
        "id": "hd-3k", "group": "hd", "image": "images/kits/hd-3k.webp",
        "name": "HD 3K ColorVu premium",
        "for": "Larger homes and businesses",
        "summary": "Eight sharper 3K full-colour cameras with audio, a 3K-ready 8-channel DVR, 4 TB hard disk, power, cabling, clips and connectors.",
        "items": [("DS-2CE10KF0T-LPFS(3.6mm)(O-STD)", 4), ("DS-2CE70KF0T-LPFS(2.8mm)(O-STD)", 4),
                  ("iDS-7108HQHI-M1/T(STD)", 1), ("HDD-4TB", 1), ("DS-2FA1205-C8(UK)(O-STD)", 1), ("DS-1LH1SCAM592C(O-STD) 180m", 1),
                  ("CONN-SET", 8), ("CLIPS-100", 2)],
    },
    # --- IP (network cameras over PoE) ---
    {
        "id": "ip-starter", "group": "ip", "image": "images/kits/ip-starter.webp",
        "name": "IP starter",
        "for": "Homes moving to IP",
        "summary": "Four 2MP smart hybrid light IP cameras on a 4-port PoE NVR with 1 TB hard disk — one cable per camera, no separate power.",
        "items": [("DS-2CD1023G2-LIU(4mm)(O-STD)", 2), ("DS-2CD1123G2-LIU(2.8mm)(O-STD)", 2),
                  ("DS-7104NI-Q1/4P/M(STD)(D)", 1), ("HDD-1TB", 1), ("DS-1LN6UZC0(O-STD) orange 305m", 1), ("CONN-SET", 4),
                  ("CLIPS-100", 1)],
    },
    {
        "id": "ip-colorvu", "group": "ip", "popular": True, "image": "images/kits/ip-colorvu.webp",
        "name": "IP 4MP ColorVu",
        "for": "Premium homes and shops",
        "summary": "Four 4MP ColorVu cameras with built-in mics on a 4-port PoE NVR with 2 TB hard disk, plus solid-copper CAT6 and connectors.",
        "items": [("DS-2CD1047G3-LIU(4mm)(O-STD)", 2), ("DS-2CD1147G3-LIU(2.8mm)(O-STD)", 2),
                  ("DS-7104NI-Q1/4P/M(STD)(D)", 1), ("HDD-2TB", 1), ("DS-1LN6UZC0(O-STD) orange 305m", 1), ("CONN-SET", 4),
                  ("CLIPS-100", 1)],
    },
    {
        "id": "ip-business", "group": "ip", "image": "images/kits/ip-business.webp",
        "name": "IP 4MP ColorVu business",
        "for": "Offices, warehouses and estates",
        "summary": "Eight 4MP ColorVu cameras on a professional 8-port PoE NVR with 4 TB hard disk, two boxes of CAT6 and connectors.",
        "items": [("DS-2CD1047G3-LIU(4mm)(O-STD)", 4), ("DS-2CD1147G3-LIU(2.8mm)(O-STD)", 4),
                  ("DS-7608NXI-K1/8P(STD)(B)", 1), ("HDD-4TB", 1), ("DS-1LN6UZC0(O-STD) orange 305m", 2), ("CONN-SET", 8),
                  ("CLIPS-100", 2)],
    },
    # --- Access control, video intercom, networking ---
    {
        "id": "access-face", "group": "more", "image": "images/kits/access-face.webp",
        "name": "Face access door kit",
        "for": "Offices, staff doors and gates",
        "summary": "Face, card and PIN entry for one door: terminal, magnetic lock with bracket, exit button and 10 cards.",
        "items": [("DS-K1T323MBFWX-E1(O-STD)", 1), ("DS-K4H255S(O-STD)", 1), ("DS-K4H255-LZ(O-STD)", 1),
                  ("DS-K7P01(O-NEU)", 1), ("DS-K7M102-M(O-STD)", 10)],
    },
    {
        "id": "intercom-villa", "group": "more", "image": "images/kits/intercom-villa.webp",
        "name": "IP villa intercom",
        "for": "Homes and compounds with a gate",
        "summary": "See, talk to and open for visitors at the gate — from the indoor screen or your phone.",
        "items": [("DS-KV6113-WPE1(C)(O-STD)", 1), ("DS-KH6320-WTE1(O-STD)", 1), ("DS-3E0505P-E/M(O-STD)(B)", 1)],
    },
    {
        "id": "network-office", "group": "more", "image": "images/kits/network-office.webp",
        "name": "Office Wi-Fi network",
        "for": "Offices, shops and clinics",
        "summary": "Fast Wi-Fi across the building: all-in-one PoE router, two ceiling access points, a switch and cabling.",
        "items": [("DS-3WG105GP-SI(O-STD)", 1), ("DS-3WAP522-SI(O-STD)", 2), ("DS-3E0508-O(O-STD)", 1),
                  ("DS-1LN6UZC0(O-STD) orange 305m", 1), ("DS-1M6UA-15U(O-STD)/100PCS", 1)],
    },
]
PACKAGE_GROUPS = [
    ("hd", "Turbo HD camera kits", "Budget-friendly cameras over coax cable"),
    ("ip", "IP camera kits", "Sharper network cameras — one cable for power and video"),
    ("more", "Access, intercom & networking", "Doors, gates and Wi-Fi for the whole building"),
]


def package_rows(kit, by_model):
    missing = [model for model, _ in kit["items"] if model not in by_model]
    if missing:
        sys.exit(f"package {kit['name']!r}: not in catalogue: {missing}")
    total = sum(by_model[model]["price"] * qty for model, qty in kit["items"])
    return total


def kit_card_html(kit, by_model, compact=False):
    total = package_rows(kit, by_model)
    ask = wa_link(f"Hi NE, I'm interested in the {kit['name']} bundle (KES {catalog.price_label(total)}). "
                  "Please send me an all-in price with installation.")
    rows = "".join(
        f'<li><span>{qty} &times; <a href="{esc(by_model[model]["url"])}">{esc(by_model[model]["name"])}</a></span>'
        f'<span>KES {catalog.price_label(by_model[model]["price"] * qty)}</span></li>'
        for model, qty in kit["items"]
    )
    flag = '<span class="kit-flag">Most popular</span>' if kit.get("popular") else ""
    # A kit photo shows everything in the box; without one the homepage card
    # falls back to the first item's product photo.
    if kit.get("image"):
        image = (f'<div class="kit-shot kit-photo"><img src="/{esc(kit["image"])}" alt="{esc(kit["name"])} bundle contents" '
                 f'loading="lazy" decoding="async" width="320" height="240"></div>')
    elif compact:
        first = by_model[kit["items"][0][0]]
        image = f'<div class="kit-shot"><img src="/{esc(first["image"])}" alt="{esc(kit["name"])}" loading="lazy" decoding="async" width="160" height="120"></div>'
    else:
        image = ""
    more = f'<a class="kit-more" href="/quote#{kit["id"]}">See what&rsquo;s included</a>' if compact else f'<ul>{rows}</ul>'
    return f"""<article class="kit{' kit-pop' if kit.get('popular') else ''}" id="{'home-' if compact else ''}{kit['id']}">
      {flag}{image}<div class="kit-for">{esc(kit['for'])}</div>
      <h3>{esc(kit['name'])}</h3>
      <p>{esc(kit['summary'])}</p>
      <div class="kit-price" data-kes="{total}"><small>from</small> KES {catalog.price_label(total)}<small>equipment</small></div>
      {more}
      <button class="kit-add" type="button" data-add-kit="{esc(json.dumps([[by_model[m]["slug"], q] for m, q in kit["items"]]))}" hidden>Add bundle to cart</button>
      <a class="kit-cta" href="{esc(ask)}" target="_blank" rel="noopener">Get this bundle</a>
    </article>"""


def packages_html(products, compact=False, only=None):
    by_model = {p["model"]: p for p in products}
    groups = []
    for key, title, sub in PACKAGE_GROUPS:
        if only and key not in only:
            continue
        cards = "\n    ".join(kit_card_html(k, by_model, compact) for k in PACKAGES if k["group"] == key)
        groups.append(f"""<div class="kit-group">
    <div class="kit-group-head"><h3>{esc(title)}</h3><p>{esc(sub)}</p></div>
    <div class="kits">
    {cards}
    </div>
  </div>""")
    return "\n  ".join(groups)


# "Recommended for you" on the homepage: four slots, each drawn from a pool.
# The page ships the first product of each pool; js/site.js re-draws at random
# on every visit. Cameras fill three of the four slots.
CAMERA = re.compile(r"^DS-2(?:CE|CD|DE|SE|CF)")
PICK_SLOTS = [
    ("Turbo HD camera", lambda p: p["category"] == "CCTV-Turbo HD" and CAMERA.match(p["model"].strip())),
    ("IP camera", lambda p: p["category"] == "CCTV-IP" and CAMERA.match(p["model"].strip())),
    ("Camera", lambda p: CAMERA.match(p["model"].strip())),
    ("Access & intercom", lambda p: re.match(r"^DS-K(?:1T|IS)", p["model"].strip())),
]
# What a visitor without JavaScript (and Google) sees.
PICK_DEFAULTS = ["DS-2CE10DF0T-LPFS", "DS-2CD1047G3-LIU", "DS-2CFSP8-D/4G", "DS-K1T342MFX-E1"]


def pick_card(product, slot):
    return f"""<a class="pick" href="{esc(product["url"])}" data-slot="{slot}">
        <div class="pick-shot"><img src="/{esc(product['image'])}" alt="{esc(product['name'])}" loading="lazy" decoding="async" width="240" height="180"></div>
        <div class="pick-body">
          <div class="pick-cat">{esc(product['category'])}</div>
          <div class="pick-name">{esc(product['name'])}</div>
          <div class="pick-foot"><span data-kes="{product['price']}">KES {catalog.price_label(product['price'])}</span><span>View &rarr;</span></div>
        </div>
      </a>"""


def picks_html(products):
    pools = []
    for _, test in PICK_SLOTS:
        pool = [p for p in products if p.get("price") and p.get("image") and test(p)]
        if not pool:
            sys.exit("picks: empty pool")
        pools.append(pool)
    chosen = []
    for default, pool in zip(PICK_DEFAULTS, pools):
        match = next((p for p in pool if p["model"].strip().startswith(default) and p not in chosen), None)
        chosen.append(match or next(p for p in pool if p not in chosen))
    cards = "\n      ".join(pick_card(p, i) for i, p in enumerate(chosen))
    data = [[{"u": p["url"], "i": "/" + p["image"], "n": p["name"], "c": p["category"],
              "p": catalog.price_label(p["price"]), "k": p["price"], "m": p["model"].strip()} for p in pool] for pool in (pools[0], pools[1], pools[3])]
    # site.js draws the third slot from the HD and IP pools combined.
    assert len(pools[2]) == len(pools[0]) + len(pools[1]), "a camera outside the HD/IP pools"
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return f"""  <section class="home-picks" aria-labelledby="picks-title">
    <div class="hp-in">
      <div class="hp-head">
        <h2 id="picks-title">Recommended for you</h2>
        <a href="/products">See all products &rarr;</a>
      </div>
      <div class="picks">
      {cards}
      </div>
    </div>
    <script type="application/json" id="picks-data">{payload}</script>
  </section>"""


def write_price_list(products):
    """data/prices.json: what the cart and the order API need, without the 1 MB catalogue."""
    prices = {p["slug"]: {"n": p["name"], "m": p["model"].strip(), "p": p["price"], "i": p["image"],
                          "c": p["category"], "u": p["url"]} for p in products}
    (ROOT / "data/prices.json").write_text(json.dumps(prices, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def write_quote_page(products):
    # The admin panel refuses to delete these, since the bundles would break.
    models = sorted({model for kit in PACKAGES for model, _ in kit["items"]} | set(kits_page.models()))
    (ROOT / "data/bundle-models.json").write_text(json.dumps(models, indent=1) + "\n", encoding="utf-8")
    path = ROOT / "quote.html"
    path.write_text(fill(path.read_text(encoding="utf-8"), "packages", packages_html(products)), encoding="utf-8")
    home = ROOT / "index.html"
    html = fill(home.read_text(encoding="utf-8"), "bundles", packages_html(products, compact=True))
    home.write_text(fill(html, "picks", picks_html(products)), encoding="utf-8")


def write_kits_page(products):
    path = ROOT / "kits.html"
    html = fill(path.read_text(encoding="utf-8"), "hd-kits", kits_page.hd_kits_html(products))
    html = fill(html, "ip-kits", kits_page.ip_kits_html(products))
    path.write_text(fill(html, "more-kits", packages_html(products, only=("more",))), encoding="utf-8")


def write_downloads_page():
    path = ROOT / "downloads.html"
    body, count = brochure_pages.library_html()
    source = fill(path.read_text(encoding="utf-8"), "brochures", body)
    source = re.sub(r'<style id="bro-css">[\s\S]*?</style>', lambda _: f'<style id="bro-css">{brochure_pages.CSS}</style>', source, count=1)
    path.write_text(source, encoding="utf-8")
    return count


def write_category_pages(products):
    directory = ROOT / "category"
    directory.mkdir(exist_ok=True)
    expected = set()
    for name in site_layout.CATEGORIES:
        items = [p for p in products if p["category"] == name]
        if not items:
            continue
        path = directory / f"{site_layout.CATEGORIES[name][0]}.html"
        path.write_text(render_category(name, items, products), encoding="utf-8")
        expected.add(path.name)
    for path in directory.glob("*.html"):
        if path.name not in expected:
            path.unlink()
    return len(expected)


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


def last_modified(paths):
    """Date each file last changed: today if it differs from git HEAD, else its last commit."""
    import datetime
    import subprocess

    today = datetime.date.today().isoformat()
    changed = set()
    status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"],
                            cwd=ROOT, capture_output=True, text=True).stdout
    for line in status.splitlines():
        changed.add(line[3:].strip().strip('"'))
    dates = {}
    for path in paths:
        rel = path.relative_to(ROOT).as_posix()
        if rel in changed:
            dates[rel] = today
            continue
        log = subprocess.run(["git", "log", "-1", "--format=%cs", "--", rel],
                             cwd=ROOT, capture_output=True, text=True).stdout.strip()
        dates[rel] = log or today
    return dates


def write_sitemap(products):
    # Pages marked noindex (404, cart) stay out of the sitemap.
    pages = [p for p in sorted(ROOT.glob("*.html")) if 'name="robots" content="noindex' not in p.read_text(encoding="utf-8")]
    pages = [ROOT / "index.html"] + [p for p in pages if p.name != "index.html"]
    pages += sorted((ROOT / "category").glob("*.html"))
    product_pages = {p["slug"]: p for p in products}
    pages += [PAGE_DIR / f"{slug}.html" for slug in product_pages]
    dates = last_modified(pages)

    entries = []
    for path in pages:
        rel = path.relative_to(ROOT).as_posix()
        loc = SITE + ("/" if rel == "index.html" else "/" + rel[:-5])
        images = ""
        if rel.startswith("product/"):
            product = product_pages[path.stem]
            images = "".join(
                f"\n    <image:image><image:loc>{html.escape(SITE + '/' + img)}</image:loc></image:image>"
                for img in images_of(product)
            )
        entries.append(f"  <url>\n    <loc>{html.escape(loc)}</loc>\n    <lastmod>{dates[rel]}</lastmod>{images}\n  </url>\n")
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n'
        + "".join(entries) + "</urlset>\n",
        encoding="utf-8",
    )
    return len(entries)


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

    write_catalog_page(products)
    write_catalog_json_ld(products)
    categories = write_category_pages(products)
    write_quote_page(products)
    write_kits_page(products)
    write_price_list(products)
    sheets = print_catalogue.write(products, PACKAGES, ROOT)
    brochures = write_downloads_page()
    urls = write_sitemap(products)

    print(f"{len(products)} product pages written to product/")
    if stale:
        print(f"{len(stale)} stale pages removed")
    print(f"{categories} category pages written to category/")
    print(f"products.html grid and JSON-LD updated; sitemap.xml lists {urls} URLs")
    print(f"catalogue/index.html: {sheets} A4 pages; downloads.html: {brochures} brochures")


if __name__ == "__main__":
    main()
