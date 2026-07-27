"""Shared catalogue helpers.

data/products.json is the single source of truth. Everything downstream —
js/products.js, the per-product pages, the sitemap and the catalog JSON-LD —
is generated from it by tools/build-catalog.py.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data/products.json"

SITE = "https://nashnaal.com"
PHONE = "+254798131085"
PHONE_LABEL = "0798 131085"

# Short, human labels for the category names used in the price list.
CATEGORY_BLURBS = {
    "CCTV-Turbo HD": "Turbo HD analogue cameras — coax cabling, ColorVu and smart hybrid light options.",
    "CCTV-IP": "Network cameras and NVRs — PoE, AcuSense analytics and up to 4K resolution.",
    "Access Control": "Door controllers, terminals, locks and exit hardware.",
    "Video Intercom": "Villa and apartment intercom kits, indoor stations and door stations.",
    "PA": "Public address amplifiers, speakers and audio controllers.",
    "Interactive Tablet": "Interactive flat panels for classrooms and meeting rooms.",
    "Accessories": "Power supplies, brackets, cabling and UPS units.",
    "Data Communication": "Access points, routers and wireless data links.",
    "Networking": "Switches, PoE injectors, bridges and structured cabling.",
}


def slugify(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def load():
    """Return the catalogue with derived id/slug/url fields filled in."""
    products = json.loads(DATA.read_text(encoding="utf-8"))
    for index, product in enumerate(products, start=1):
        product.setdefault("id", index)
        product.setdefault("slug", slugify(product["model"]))
        product["url"] = f"/product/{product['slug']}"
    return products


def save(products):
    DATA.write_text(
        json.dumps(products, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def categories(products):
    seen = []
    for product in products:
        if product["category"] not in seen:
            seen.append(product["category"])
    return seen


def spec_lines(features):
    """Split a price-list feature blob into readable bullet points.

    The source text mixes ASCII and full-width commas, CRLF line breaks and
    middle-dot bullets depending on which supplier sheet the row came from.
    """
    # Split on line breaks and bullets, then on commas — but not on a comma
    # inside brackets, nor on the thousands separator in a figure like "20,000".
    parts = re.split(
        r"[\r\n·•]+|(?<!\d)[,，、](?![^()（]*[)）])|(?<=\d)[,，](?!\d)", features or ""
    )
    lines = []
    for part in parts:
        text = part.strip(" ;.，,、")
        if len(text) < 2:
            continue
        # "…restaurants, bars, and lounges" splits into a dangling tail; re-join it.
        if lines and re.match(r"^(and|or)\b", text, re.I):
            lines[-1] += ", " + text
            continue
        if text.lower() in {line.lower() for line in lines}:
            continue
        lines.append(text)
    return lines


def summary(features, limit=155):
    """One-line description for meta tags."""
    text = re.sub(r"\s+", " ", (features or "").replace("\r", " ")).strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(" ,;") + "…"


def price_label(value):
    return f"{value:,}"
