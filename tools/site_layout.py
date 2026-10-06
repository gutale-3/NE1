"""Shared header, footer and their CSS for every page on the site.

The static pages carry this markup between marker comments, e.g.

    <!--layout:header-->...<!--/layout:header-->

and `python3 tools/apply-layout.py` rewrites those regions from here, so a
menu or footer change is made once. tools/build-catalog.py uses the same
functions for the generated product and category pages.
"""
import html

from catalog import PHONE, PHONE_LABEL, slugify

ADDRESS = "Business Bay Square (BBS Mall), Shop GFE 61, General Waruingi Road, Eastleigh, Nairobi"
MAPS_URL = "https://www.google.com/maps/place/?q=place_id:ChIJL1wsUKARLxgRTEebeopQdiI"
INSTAGRAM = "https://www.instagram.com/nashnaalelectronics"
TIKTOK = "https://www.tiktok.com/@nashnaalelectronics"
HIKVISION_DIRECTORY = "https://www.hikvision.com/en/Partners/channel-partners/find-a-distributor/"

NAV = [
    ("/products", "Products"),
    ("/solutions", "Solutions"),
    ("/services", "Services"),
    ("/blog", "Blog"),
    ("/about", "About"),
    ("/contact", "Contact"),
]

# Category name in the price list -> (URL slug, page heading, short label)
CATEGORIES = {
    "CCTV-IP": ("ip-cameras-nvrs", "Hikvision IP Cameras & NVRs", "IP cameras & NVRs"),
    "CCTV-Turbo HD": ("turbo-hd-cameras-dvrs", "Hikvision Turbo HD Cameras & DVRs", "Turbo HD cameras & DVRs"),
    "Storage": ("hard-disks", "CCTV Hard Disks", "Hard disks"),
    "Access Control": ("access-control", "Hikvision Access Control", "Access control"),
    "Video Intercom": ("video-intercom", "Hikvision Video Intercom", "Video intercom"),
    "Networking": ("networking", "Hikvision Networking & PoE Switches", "Networking & switches"),
    "Data Communication": ("wireless-wifi", "Hikvision Wi-Fi & Wireless", "Wi-Fi & wireless"),
    "PA": ("public-address", "Hikvision Public Address Systems", "Public address"),
    "Interactive Tablet": ("interactive-panels", "Hikvision Interactive Flat Panels", "Interactive panels"),
    "Accessories": ("accessories", "Hikvision Accessories, Cables & UPS", "Accessories & UPS"),
}


def category_url(category):
    slug = CATEGORIES.get(category, (slugify(category),))[0]
    return f"/category/{slug}"


CSS = """
.site-header { position: sticky; top: 0; z-index: 50; background: #fff; border-bottom: 1px solid #E7ECF1; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
.site-header .bar { max-width: 1240px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 24px; }
.site-header .logo { display: flex; align-items: center; flex-shrink: 0; }
.site-header .logo img { height: 52px; width: auto; display: block; }
.site-nav { display: flex; align-items: center; gap: 30px; flex: 1; justify-content: center; }
.site-nav a { font-size: 15px; font-weight: 600; color: #10202E; text-decoration: none; }
.site-nav a:hover, .site-nav a.on { color: #086E9E; }
.site-nav a.on { font-weight: 700; }
.site-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.site-actions a { display: inline-flex; align-items: center; gap: 7px; padding: 10px 16px; border-radius: 8px; font-size: 14px; font-weight: 700; white-space: nowrap; text-decoration: none; }
.site-actions .call { color: #086E9E; border: 1.5px solid #CFE6F2; }
.site-actions .call:hover { border-color: #086E9E; color: #086E9E; }
.site-actions .quote { background: #086E9E; color: #fff; }
.site-actions .quote:hover { background: #0B7EB5; color: #fff; }
.acct { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 8px 10px; border-radius: 8px; font-size: 14px; font-weight: 700; color: #10202E; text-decoration: none; white-space: nowrap; }
.acct:hover { color: #086E9E; background: #F6F8FA; }
.cart-link { position: relative; display: inline-flex; align-items: center; padding: 8px; color: #10202E; flex-shrink: 0; }
.cart-link:hover { color: #086E9E; }
.cart-count { position: absolute; top: 0; right: -2px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: #22C35E; color: #fff; font-size: 11px; font-weight: 800; line-height: 18px; text-align: center; }
.btn-cart { background: #10202E; color: #fff; border: 0; cursor: pointer; font-family: inherit; }
.btn-cart:hover { background: #0F2A3D; color: #fff; }
.pc-add { position: relative; z-index: 2; margin-top: 10px; width: 100%; padding: 9px 10px; border: 1.5px solid #CFE6F2; border-radius: 9px; background: #fff; color: #086E9E; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
.pc-add:hover { border-color: #086E9E; }
.kit-add { display: block; width: 100%; margin: 0 0 8px; padding: 11px; border: 1.5px solid #CFE6F2; border-radius: 10px; background: #fff; color: #086E9E; font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
.kit-add:hover { border-color: #086E9E; }
.added { background: #E8F8EE !important; border-color: #B7E4C7 !important; color: #14532D !important; }
.navtoggle-cb { display: none; }
.hamburger-btn { display: none; cursor: pointer; font-size: 24px; color: #10202E; line-height: 1; padding: 12px; margin: -12px; }
.hamburger-icon-close { display: none; }
.mobile-nav-panel { display: none; flex-direction: column; padding: 6px 24px 22px; border-top: 1px solid #E7ECF1; background: #fff; }
.mobile-nav-panel a { padding: 15px 4px; font-size: 16px; font-weight: 600; color: #10202E; border-bottom: 1px solid #F0F3F5; text-decoration: none; }
.mobile-nav-panel a.on { color: #086E9E; }
.mobile-nav-panel .m-cta { margin-top: 12px; text-align: center; border-radius: 8px; font-weight: 700; padding: 15px; border: 0; }
.mobile-nav-panel .m-quote { background: #086E9E; color: #fff; }
.mobile-nav-panel .m-call { background: #EAF6FC; color: #086E9E; margin-top: 8px; }
.navtoggle-cb:checked ~ .bar .hamburger-icon-open { display: none; }
.navtoggle-cb:checked ~ .bar .hamburger-icon-close { display: inline; }
.navtoggle-cb:checked ~ .mobile-nav-panel { display: flex; }
@media (max-width: 1020px) { .site-actions .call { display: none; } }
@media (max-width: 860px) {
  .site-nav, .site-actions { display: none; }
  .hamburger-btn { display: flex; align-items: center; justify-content: center; }
}

.site-footer { background: #0F2C3D; color: rgba(255,255,255,0.72); font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; line-height: 1.6; }
.site-footer a { color: rgba(255,255,255,0.78); text-decoration: none; }
.site-footer a:hover { color: #fff; }
.site-footer .cols { max-width: 1240px; margin: 0 auto; padding: 56px 24px 36px; display: grid; grid-template-columns: 1.4fr 1fr 1fr 1.3fr; gap: 36px; }
.site-footer h2 { font-size: 13px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #fff; margin: 0 0 14px; }
.site-footer ul { list-style: none; margin: 0; padding: 0; }
.site-footer li { margin: 0 0 9px; }
.site-footer .brand img { height: 44px; width: auto; display: block; margin-bottom: 14px; background: #fff; border-radius: 8px; padding: 4px; }
.site-footer .brand p { margin: 0 0 16px; max-width: 34ch; }
.site-footer .badge { display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(79,195,236,0.35); color: #4FC3EC; border-radius: 999px; padding: 6px 12px; font-size: 12.5px; font-weight: 700; }
.site-footer .badge:hover { color: #7ED4F1; border-color: #7ED4F1; }
.site-footer .visit p { margin: 0 0 10px; }
.site-footer .hours { display: grid; grid-template-columns: auto auto; gap: 2px 14px; margin: 0 0 14px; }
.site-footer .hours dt { color: rgba(255,255,255,0.6); }
.site-footer .hours dd { margin: 0; color: #fff; font-weight: 600; }
.site-footer .social { display: flex; gap: 10px; margin-top: 14px; }
.site-footer .social a { width: 38px; height: 38px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); display: flex; align-items: center; justify-content: center; }
.site-footer .social a:hover { border-color: #4FC3EC; }
.site-footer .legal { border-top: 1px solid rgba(255,255,255,0.1); }
.site-footer .legal div { max-width: 1240px; margin: 0 auto; padding: 18px 24px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; font-size: 13px; color: rgba(255,255,255,0.5); }
@media (max-width: 960px) { .site-footer .cols { grid-template-columns: 1fr 1fr; } }
@media (max-width: 560px) { .site-footer .cols { grid-template-columns: 1fr; gap: 28px; padding-top: 44px; } }

.wa-float { position: fixed; bottom: 22px; right: 22px; width: 56px; height: 56px; border-radius: 50%; background: #22C35E; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 20px rgba(0,0,0,0.2); z-index: 60; }
.wa-float:hover { background: #1CAD52; }
""".strip()

ICON_WHATSAPP = '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="#fff"><path d="M12 2.2A9.7 9.7 0 0 0 3.6 16.8L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2Zm0 17.7a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9Zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.7-1.2.2-.6.2-1 .1-1.2l-.4-.2Z"/></svg>'
ICON_INSTAGRAM = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>'
ICON_TIKTOK = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M16.6 3c.3 2.1 1.6 3.6 3.9 3.8v3a7 7 0 0 1-3.9-1.2v6.3a5.9 5.9 0 1 1-5.9-5.9h.6v3.1a2.9 2.9 0 1 0 2.3 2.8V3h3Z"/></svg>'
ICON_SHIELD = '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8 4.5 6v6c0 4.6 3.2 7.7 7.5 9.2 4.3-1.5 7.5-4.6 7.5-9.2V6z"/><path d="m8.8 11.8 2.3 2.3 4.1-4.6"/></svg>'


def esc(value):
    return html.escape(str(value), quote=True)


def header_html(active=None):
    def link(href, label, cls=""):
        on = href == active
        classes = " ".join(c for c in (cls, "on" if on else "") if c)
        attrs = f' class="{classes}"' if classes else ""
        current = ' aria-current="page"' if on else ""
        return f'<a href="{href}"{attrs}{current}>{label}</a>'

    desktop = "\n        ".join(link(h, l) for h, l in NAV)
    mobile = "\n      ".join(link(h, l) for h, l in NAV)
    return f"""<header class="site-header">
    <input type="checkbox" id="navtoggle" class="navtoggle-cb">
    <div class="bar">
      <a href="/" class="logo" aria-label="NE Nashnaal Electronics home">
        <img src="/assets/nashnaal-logo-header.webp" alt="NE — Nashnaal Electronics" width="52" height="52">
      </a>
      <nav class="site-nav" aria-label="Main">
        {desktop}
      </nav>
      <div class="site-actions">
        <a href="tel:{PHONE}" class="call">Call {PHONE_LABEL}</a>
        <a href="/quote" class="quote">Get a quote</a>
      </div>
      <a href="/cart" class="cart-link" aria-label="Cart"><svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg><span class="cart-count" data-cart-count hidden></span></a>
      <a href="/auth/google/login?next=/account" class="acct" data-acct><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>Sign in</span></a>
      <label for="navtoggle" class="hamburger-btn" aria-label="Open menu">
        <span class="hamburger-icon-open">&#9776;</span>
        <span class="hamburger-icon-close">&#10005;</span>
      </label>
    </div>
    <nav class="mobile-nav-panel" aria-label="Mobile">
      {mobile}
      <a href="/quote" class="m-cta m-quote">Get a quote</a>
      <a href="tel:{PHONE}" class="m-cta m-call">Call {PHONE_LABEL}</a>
    </nav>
  </header>"""


def footer_html():
    categories = "\n          ".join(
        f'<li><a href="{category_url(name)}">{esc(label)}</a></li>'
        for name, (_, _, label) in CATEGORIES.items()
    )
    wa = PHONE.lstrip("+")
    return f"""<footer class="site-footer">
    <div class="cols">
      <div class="brand">
        <img src="/assets/nashnaal-logo-header.webp" alt="NE — Nashnaal Electronics" width="44" height="44" loading="lazy">
        <p>Genuine Hikvision CCTV, access control, intercom and networking &mdash; supplied, installed and supported from Nairobi.</p>
        <a class="badge" href="{HIKVISION_DIRECTORY}" target="_blank" rel="noopener">{ICON_SHIELD} Authorized Hikvision National Distributor</a>
      </div>
      <nav aria-label="Product categories">
        <h2>Products</h2>
        <ul>
          {categories}
        </ul>
      </nav>
      <nav aria-label="Company">
        <h2>Company</h2>
        <ul>
          <li><a href="/about">About NE</a></li>
          <li><a href="/services">Installation &amp; services</a></li>
          <li><a href="/cctv-installation-nairobi">CCTV installation prices</a></li>
          <li><a href="/solutions">Solutions by industry</a></li>
          <li><a href="/quote">Get a quote</a></li>
          <li><a href="/catalogue/">Product catalogue (PDF)</a></li>
          <li><a href="/downloads">Hikvision brochures</a></li>
          <li><a href="/privacy">Privacy policy</a></li>
          <li><a href="/blog">Guides &amp; blog</a></li>
          <li><a href="/faq">FAQ</a></li>
          <li><a href="/world">Explore NE</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </nav>
      <div class="visit">
        <h2>Visit the showroom</h2>
        <p><a href="{MAPS_URL}" target="_blank" rel="noopener">{esc(ADDRESS)}</a></p>
        <dl class="hours">
          <dt>Mon&ndash;Sat</dt><dd>08:00 &ndash; 20:00</dd>
          <dt>Sunday</dt><dd>09:00 &ndash; 18:00</dd>
        </dl>
        <p><a href="tel:{PHONE}">Call {PHONE_LABEL}</a> &middot; <a href="https://wa.me/{wa}" target="_blank" rel="noopener">WhatsApp</a></p>
        <div class="social">
          <a href="{INSTAGRAM}" target="_blank" rel="noopener" aria-label="NE on Instagram">{ICON_INSTAGRAM}</a>
          <a href="{TIKTOK}" target="_blank" rel="noopener" aria-label="NE on TikTok">{ICON_TIKTOK}</a>
        </div>
      </div>
    </div>
    <div class="legal"><div>
      <span>&copy; 2026 NE &mdash; Nashnaal Electronics. All rights reserved.</span>
      <span>Hikvision is a trademark of Hangzhou Hikvision Digital Technology Co., Ltd.</span>
    </div></div>
  </footer>
  <a href="https://wa.me/{wa}" target="_blank" rel="noopener" class="wa-float" aria-label="Chat with NE on WhatsApp">{ICON_WHATSAPP}</a>"""


def css_block():
    return f'<style id="layout-css">\n{CSS}\n</style>'
