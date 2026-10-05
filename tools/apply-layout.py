#!/usr/bin/env python3
"""Refresh the shared header, footer and layout CSS on every static page.

    python3 tools/apply-layout.py

Each page carries the shared markup between marker comments
(<!--layout:css-->, <!--layout:header-->, <!--layout:footer-->). This script
rewrites those regions from tools/site_layout.py, so menu and footer changes
are made in one place. Pages without markers yet get their first <header> and
<footer> replaced. It also normalises internal links: no .html suffixes, and
old ?cat= catalog filters point at the real category pages.

Generated pages (product/, category/) are written by tools/build-catalog.py.
"""
import pathlib
import re
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import site_layout
from catalog import ROOT

SKIP = {"world.html"}  # full-screen scroll story with its own chrome


def active_for(name):
    stem = name[:-5]
    if stem in ("products", "quote"):
        return "/products" if stem == "products" else None
    if stem.startswith("solution"):
        return "/solutions"
    if stem.startswith("blog"):
        return "/blog"
    if stem == "cctv-installation-nairobi":
        return "/services"
    return {"services": "/services", "about": "/about", "contact": "/contact"}.get(stem)


def region(source, name, content, fallback_pattern, where="replace"):
    start, end = f"<!--layout:{name}-->", f"<!--/layout:{name}-->"
    block = f"{start}\n{content}\n{end}"
    if start in source:
        return re.sub(re.escape(start) + r"[\s\S]*?" + re.escape(end), lambda _: block, source, count=1)
    match = re.search(fallback_pattern, source)
    if not match:
        sys.exit(f"{name}: no markers and no fallback match")
    return source[: match.start()] + block + source[match.end():]


def fix_links(source):
    def cat_link(match):
        category = urllib.parse.unquote(match.group(2)).replace("+", " ")
        return f'{match.group(1)}{site_layout.category_url(category)}'

    source = re.sub(r'(href=")/?products(?:\.html)?\?cat=([^"&#]+)', cat_link, source)
    source = re.sub(r'(href=")(?:/?index\.html)(?=")', r"\1/", source)
    source = re.sub(r'(href=")/?((?!https?:)[a-z0-9-]+)\.html(?=["#?])', r"\1/\2", source)
    source = source.replace("instagram.com/nationalelectronicsbbs", "instagram.com/nashnaalelectronics")
    source = source.replace("tiktok.com/@nationalelectronicsbbs", "tiktok.com/@nashnaalelectronics")
    source = source.replace("@nationalelectronicsbbs", "@nashnaalelectronics")
    return source


def apply(path):
    source = path.read_text(encoding="utf-8")
    original = source
    css = site_layout.css_block() + '\n<script src="/js/site.js" defer></script>'
    source = region(source, "css", css, r"(?=</head>)")
    source = region(source, "header", site_layout.header_html(active_for(path.name)), r"<header[\s\S]*?</header>")
    # The old pulsing WhatsApp button is replaced by the one in the footer block.
    source = re.sub(r'\s*<a href="https://wa\.me/\d+" target="_blank" class="wa-pulse-btn"[\s\S]*?</a>', "", source)
    source = region(source, "footer", site_layout.footer_html(), r"<footer[\s\S]*?</footer>")
    source = fix_links(source)
    if source != original:
        path.write_text(source, encoding="utf-8")
        return True
    return False


def main():
    changed = [p.name for p in sorted(ROOT.glob("*.html")) if p.name not in SKIP and apply(p)]
    print(f"layout applied to {len(changed)} pages")


if __name__ == "__main__":
    main()
