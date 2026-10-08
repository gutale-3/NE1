"""catalogue/index.html: the printable NE product catalogue (A4, with prices).

Built from data/products.json and the bundle list on every build, so the
catalogue always matches the website. The page is laid out as fixed A4 sheets;
"Download PDF" prints it with the browser. Full-page Hikvision posters open the
main sections (images in assets/catalogue/, QR codes in assets/catalogue/qr/).
"""
import html
import math
import re

import catalog
import site_layout

PER_PAGE = 9   # product cards per sheet (3 x 3)
KITS_PER_PAGE = 3

# Section order for the printed book, and the poster that opens each section.
SECTIONS = [
    ("CCTV-Turbo HD", "turbo-hd-kf0t"),
    ("CCTV-IP", "offices"),
    ("Storage", None),
    ("Networking", "malls"),
    ("Data Communication", None),
    ("Access Control", "smb"),
    ("Video Intercom", "stores"),
    ("PA", "stadiums"),
    ("Interactive Tablet", "signage"),
    ("Accessories", None),
]


def esc(value):
    return html.escape(str(value or ""), quote=True)


def clip(text, limit):
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0].rstrip(" ,;(") + "…"


def bullets(product, count=4):
    lines = product.get("keyFeatures") or catalog.spec_lines(product.get("features"))
    return [clip(line, 48) for line in lines[:count]]


def photo(path):
    """JPEG copy of a photo in assets/catalogue/photos/ (made once with
    tools/catalogue-photos.sh). Chrome keeps JPEGs as they are inside the PDF but
    stores WebP/PNG uncompressed, so the copies keep the PDF small. A photo added
    later through the admin has no copy yet and the original is used."""
    path = path.lstrip("/")
    name = re.sub(r"\.[a-z]+$", "", path).replace("/", "-")
    copy = f"assets/catalogue/photos/{name}.jpg"
    return copy if (catalog.ROOT / copy).exists() else path


def chunks(items, size):
    return [items[i:i + size] for i in range(0, len(items), size)]


class Book:
    def __init__(self):
        self.pages = []      # [(kind, html)] — kind "page" gets header/footer
        self.toc = []        # [(title, page number, qr)]

    @property
    def next_number(self):
        return len(self.pages) + 1

    def add(self, body, section="", cls="", bare=False):
        self.pages.append((body, section, cls, bare))

    def render(self):
        out = []
        for number, (body, section, cls, bare) in enumerate(self.pages, start=1):
            if bare:
                out.append(f'<section class="sheet {cls}">{body}</section>')
                continue
            out.append(f"""<section class="sheet {cls}">
  <header class="run"><span><img src="/assets/nashnaal-logo-header.webp" alt="" width="20" height="20"> NE Product Catalogue</span><span>{esc(section)}</span></header>
  <div class="body">{body}</div>
  <footer class="run"><span>nashnaal.com &middot; Call / WhatsApp {catalog.PHONE_LABEL} &middot; Prices in KES, valid as of <span data-today></span></span><span>{number}</span></footer>
</section>""")
        return "\n".join(out)


def poster(book, image, alt):
    book.add(f'<img class="poster" src="/assets/catalogue/{image}.jpg" alt="{esc(alt)}">', cls="poster-sheet", bare=True)


def product_card(p):
    points = "".join(f"<li>{esc(line)}</li>" for line in bullets(p))
    return f"""<article class="card">
  <div class="shot"><img src="/{esc(p['image'])}" alt=""></div>
  <h3>{esc(clip(p['name'], 56))}</h3>
  <div class="model">{esc(p['model'].strip())}</div>
  <ul>{points}</ul>
  <div class="price">KES {catalog.price_label(p['price'])}</div>
</article>"""


def section_head(name, count):
    slug, title, _ = site_layout.CATEGORIES[name]
    return f"""<div class="sec-head">
  <div><h2>{esc(title)}</h2><p>{esc(catalog.CATEGORY_BLURBS.get(name, ''))} {count} products.</p></div>
  <figure><img src="/assets/catalogue/qr/{slug}.svg" alt=""><figcaption>Order online</figcaption></figure>
</div>"""


def kit_block(kit, by_model, total):
    rows = "".join(
        f"<tr><td>{qty} &times;</td><td>{esc(clip(by_model[m]['name'], 60))}</td>"
        f"<td class=n>{catalog.price_label(by_model[m]['price'] * qty)}</td></tr>"
        for m, qty in kit["items"])
    image = kit.get("image") or by_model[kit["items"][0][0]]["image"]
    flag = '<span class="flag">Most popular</span>' if kit.get("popular") else ""
    return f"""<article class="kit">
  <div class="kit-shot"><img src="/{esc(image)}" alt="">{flag}</div>
  <div class="kit-info">
    <div class="for">{esc(kit['for'])}</div>
    <h3>{esc(kit['name'])}</h3>
    <p>{esc(kit['summary'])}</p>
    <table>{rows}</table>
    <div class="kit-total"><span>Bundle price (equipment)</span><b>KES {catalog.price_label(total)}</b></div>
  </div>
</article>"""


def cover(count):
    return f"""<div class="cover">
  <img class="cover-photo" src="/assets/showroom/showroom-front.webp" alt="">
  <div class="cover-text">
    <img src="/assets/nashnaal-logo-header.webp" alt="NE" width="84" height="84">
    <p class="kicker">Hikvision Authorized National Distributor &middot; Kenya</p>
    <h1>Product Catalogue</h1>
    <p class="lead">CCTV, access control, video intercom, networking and more &mdash; {count} genuine Hikvision products, ready-made kits and professional installation.</p>
    <p class="valid">Prices in Kenya Shillings, valid as of <b data-today></b></p>
    <div class="cover-foot">
      <div><b>Nashnaal Electronics (NE)</b><br>BBS Mall, Shop GFE 61, Eastleigh, Nairobi<br>Call / WhatsApp {catalog.PHONE_LABEL} &middot; nashnaal.com</div>
      <figure><img src="/assets/catalogue/qr/site.svg" alt=""><figcaption>Shop online</figcaption></figure>
    </div>
  </div>
</div>"""


ABOUT = f"""<h2 class="page-title">About NE</h2>
<div class="about">
  <div>
    <p class="big">Nashnaal Electronics (NE) is a <b>Hikvision Authorized National Distributor</b> in Nairobi. We supply installers, businesses and homes across Kenya with genuine Hikvision security and networking equipment, and we install it too.</p>
    <ul class="why">
      <li><b>Genuine stock, official warranty</b> &mdash; straight from Hikvision, not grey imports.</li>
      <li><b>Everything in one shop</b> &mdash; cameras, recorders, hard disks, cable, power, switches, access control and intercoms.</li>
      <li><b>Certified technicians</b> &mdash; Hikvision HCSA certified in CCTV, access control, video intercom and networking.</li>
      <li><b>Free delivery in Nairobi</b> &mdash; outside Nairobi we send by courier or bus (paid by the customer).</li>
      <li><b>Technician prices</b> &mdash; approved installers get 5% off with a free NE account.</li>
      <li><b>Rewards</b> &mdash; order on nashnaal.com while signed in and earn 2% back on every paid order.</li>
    </ul>
    <div class="visit">
      <b>Visit the showroom</b><br>Business Bay Square (BBS Mall), Shop GFE 61<br>General Waruingi Road, Eastleigh, Nairobi<br>
      Mon&ndash;Sat 08:00&ndash;20:00 &middot; Sun 09:00&ndash;18:00<br>Call / WhatsApp {catalog.PHONE_LABEL}
    </div>
  </div>
  <div class="about-pics">
    <figure class="tall"><img src="/assets/partner/storefront-hikvision-visit.webp" alt=""><figcaption>The Hikvision team visiting NE, 2023</figcaption></figure>
    <figure><img src="/assets/showroom/showroom-inside.webp" alt=""><figcaption>Our showroom at BBS Mall</figcaption></figure>
  </div>
</div>
<h3 class="strip-title">Certified and recognised by Hikvision</h3>
<div class="strip">
  <figure><img src="/assets/partner/hikvision-certified-technician.webp" alt=""><figcaption>Authorized National Distributor certificate</figcaption></figure>
  <figure><img src="/assets/awards/hikvision-distributor-plaque.webp" alt=""><figcaption>Authorized National Distributor plaque</figcaption></figure>
  <figure><img src="/assets/partner/best-distribution-partner-award-2025.webp" alt=""><figcaption>Best Distribution Strategic Partner 2025</figcaption></figure>
  <figure><img src="/assets/awards/hikvision-partner-award-2025-plaque.webp" alt=""><figcaption>Hikvision award plaque, 2025</figcaption></figure>
  <figure><img src="/assets/awards/east-africa-somali-awards-2024.webp" alt=""><figcaption>Best Electronics Company of the Year 2024 (East Africa Somali Awards)</figcaption></figure>
</div>"""


SERVICES = f"""<h2 class="page-title">Installation &amp; services</h2>
<div class="services">
  <div class="svc main">
    <h3>CCTV installation</h3>
    <div class="svc-price">KES 1,500 &ndash; 3,000 <small>per camera, in Nairobi</small></div>
    <p>Done by our Hikvision-certified technicians. Outside Nairobi the customer covers transport and accommodation, and we charge by time or by the job. All equipment must be on site before we start.</p>
    <ul class="ticks">
      <li>Mounting cameras indoors and outdoors</li>
      <li>Cabling, trunking and neat cable runs</li>
      <li>Connecting and setting up the DVR / NVR and hard disk</li>
      <li>Mounting the TV / monitor and power supplies</li>
      <li>Viewing on your phone with Hik-Connect, sharing access with family or staff, and removing access</li>
      <li>Access control, video intercom and networking / Wi-Fi</li>
    </ul>
  </div>
  <div class="svc">
    <h3>Recorder password reset</h3>
    <table>
      <tr><td>DVR (any size)</td><td class=n>KES 2,000</td></tr>
      <tr><td>NVR up to 16 channels</td><td class=n>KES 3,000</td></tr>
      <tr><td>NVR above 16 channels</td><td class=n>KES 5,000</td></tr>
      <tr><td>Hik-Connect app password</td><td class=n>Free</td></tr>
    </table>
    <p>Bring the recorder to the showroom, Monday to Saturday. It usually takes 1&ndash;2 hours.</p>
  </div>
  <div class="svc">
    <h3>Delivery</h3>
    <p><b>Free in Nairobi.</b> Outside Nairobi we send by courier or bus, paid by the customer.</p>
    <h3>Technicians &amp; installers</h3>
    <p>Create a free account on nashnaal.com and apply for technician prices: <b>5% off</b> everything, plus rewards.</p>
  </div>
  <figure class="svc qr"><img src="/assets/catalogue/qr/install.svg" alt=""><figcaption>Book an installation</figcaption></figure>
</div>
<div class="certs">
  <figure class="training"><img src="/assets/partner/simon-kinyua-hikvision-training.webp" alt=""><figcaption>Simon leading a Hikvision training session</figcaption></figure>
  <img src="/assets/partner/certificates/simon-kinyua-hcsa-cctv.webp" alt="">
  <img src="/assets/partner/certificates/simon-kinyua-hcsa-access-control.webp" alt="">
  <img src="/assets/partner/certificates/simon-kinyua-hcsa-video-intercom.webp" alt="">
  <img src="/assets/partner/certificates/simon-kinyua-hcsa-networking.webp" alt="">
</div>
<p class="certs-note">Our technician Simon Kinyua is a Hikvision Certified Security Associate (HCSA) in CCTV, access control, video intercom and networking.</p>"""


BACK = f"""<div class="back">
  <img src="/assets/nashnaal-logo-header.webp" alt="NE" width="96" height="96">
  <h2>How to order</h2>
  <ol>
    <li><b>Online:</b> add products or a whole kit to the cart on <b>nashnaal.com</b> and send the order on WhatsApp or straight to NE.</li>
    <li><b>WhatsApp or call:</b> {catalog.PHONE_LABEL} &mdash; send the model numbers from this catalogue.</li>
    <li><b>Visit:</b> BBS Mall, Shop GFE 61, Eastleigh, Nairobi.</li>
  </ol>
  <div class="back-qr">
    <figure><img src="/assets/catalogue/qr/site.svg" alt=""><figcaption>Shop on nashnaal.com</figcaption></figure>
    <figure><img src="/assets/catalogue/qr/whatsapp.svg" alt=""><figcaption>WhatsApp NE</figcaption></figure>
    <figure><img src="/assets/catalogue/qr/review.svg" alt=""><figcaption>Review us on Google</figcaption></figure>
  </div>
  <p class="small">Nashnaal Electronics is a trading name of NE Falcon Apex Commerce Limited (Company No. PVT-9L1Q856P). Prices are in Kenya Shillings and may change; the website always shows the current price. Product photos are for illustration. Hikvision and the Hikvision logo are trademarks of Hangzhou Hikvision Digital Technology Co., Ltd.</p>
</div>"""


def write(products, packages, root):
    by_model = {p["model"]: p for p in products}
    book = Book()
    book.add(cover(len(products)), cls="cover-sheet", bare=True)
    book.add(ABOUT, section="About NE")
    book.add("", section="Contents", cls="toc-sheet")   # filled in below
    toc_index = len(book.pages) - 1

    poster(book, "houses", "Hikvision solutions for homes")
    book.toc.append(("Ready-made kits", book.next_number, "kits"))
    kits = [(k, sum(by_model[m]["price"] * q for m, q in k["items"])) for k in packages]
    for i, group in enumerate(chunks(kits, KITS_PER_PAGE)):
        intro = ('<div class="sec-head"><div><h2>Ready-made kits</h2><p>Everything in the box for a complete system: cameras, '
                 'recorder, storage, power, cable and connectors. Add installation from KES 1,500 per camera in Nairobi.</p></div>'
                 '<figure><img src="/assets/catalogue/qr/kits.svg" alt=""><figcaption>Order online</figcaption></figure></div>') if i == 0 else ""
        book.add(intro + "".join(kit_block(k, by_model, t) for k, t in group), section="Ready-made kits")

    by_category = {}
    for p in products:
        by_category.setdefault(p["category"], []).append(p)
    names = [n for n, _ in SECTIONS] + [n for n in by_category if n not in dict(SECTIONS)]
    posters = dict(SECTIONS)
    for name in names:
        items = by_category.get(name)
        if not items or name not in site_layout.CATEGORIES:
            continue
        if posters.get(name):
            poster(book, posters[name], "")
        label = site_layout.CATEGORIES[name][2]
        book.toc.append((site_layout.CATEGORIES[name][1], book.next_number, site_layout.CATEGORIES[name][0]))
        # The section header takes one row of cards on the first sheet.
        first, rest = items[:PER_PAGE - 3], items[PER_PAGE - 3:]
        book.add(section_head(name, len(items)) + '<div class="grid">' + "".join(map(product_card, first)) + "</div>",
                 section=label[:1].upper() + label[1:])
        for group in chunks(rest, PER_PAGE):
            book.add('<div class="grid">' + "".join(map(product_card, group)) + "</div>", section=label[:1].upper() + label[1:])

    poster(book, "farms", "Hikvision solutions for farms")
    book.toc.append(("Installation & services", book.next_number, "install"))
    book.add(SERVICES, section="Installation & services")
    book.add(BACK, cls="back-sheet", bare=True)

    rows = "".join(f'<li><span>{esc(title)}</span><i></i><b>{page}</b></li>' for title, page, _ in book.toc)
    body, section, cls, bare = book.pages[toc_index]
    book.pages[toc_index] = (f"""<h2 class="page-title">Contents</h2><ol class="toc">{rows}</ol>
<div class="toc-note"><p><b>Order the easy way:</b> scan a QR code in any section to open that range on nashnaal.com, add to cart and send the order on WhatsApp. Signed-in customers earn 2% back on every paid order.</p>
<figure><img src="/assets/catalogue/qr/whatsapp.svg" alt=""><figcaption>WhatsApp NE</figcaption></figure></div>""", section, cls, bare)

    sheets = re.sub(r'src="/([^"]+)"', lambda m: f'src="/{photo(m.group(1))}"', book.render())
    page = TEMPLATE.replace("{{SHEETS}}", sheets).replace("{{COUNT}}", str(len(book.pages)))
    out = root / "catalogue"
    out.mkdir(exist_ok=True)
    (out / "index.html").write_text(page, encoding="utf-8")
    return len(book.pages)


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>NE Product Catalogue (PDF) | Nashnaal Electronics</title>
<meta name="description" content="The NE product catalogue with prices: Hikvision CCTV, kits, access control, intercom and networking from the Hikvision Authorized National Distributor in Nairobi.">
<link rel="icon" type="image/png" href="/assets/nashnaal-favicon.png">
<link rel="stylesheet" href="/catalogue/catalogue.css">
</head>
<body>
<div class="bar">
  <a href="/">&larr; nashnaal.com</a>
  <span>{{COUNT}} A4 pages</span>
  <button type="button" id="pdf-btn">Download PDF</button>
</div>
<p class="tip" id="tip">On a phone: tap Download PDF, then choose <b>Save as PDF</b> as the printer. Paper size A4, margins none.</p>
<main id="book">
{{SHEETS}}
</main>
<script src="/catalogue/catalogue.js" defer></script>
</body>
</html>
"""
