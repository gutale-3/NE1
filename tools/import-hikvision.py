#!/usr/bin/env python3
"""Merge scraped Hikvision product data into data/products.json.

    node tools/hikvision/scrape.mjs      # fetch pages into tools/hikvision/cache/
    python3 tools/import-hikvision.py    # download photos, fill product fields
    python3 tools/build-catalog.py       # regenerate the product pages

For every product whose exact model appears on a Hikvision product page this
fills `gallery`, `keyFeatures`, `specTable`, `datasheet` and `hikvisionUrl`.
Products only matched at family level get photos and the family's general
features, but no spec table, since another variant's specs would be wrong.
A report of what matched is written to tools/hikvision/report.json.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import catalog
from catalog import ROOT

HIK = ROOT / "tools/hikvision"
CACHE = HIK / "cache"
PLAN = HIK / "plan.json"
IMAGE_DIR = ROOT / "images/hik"
MAX_GALLERY = 6
# Family pages that are a different hardware version from the model we sell,
# so their photos could show the wrong product.
SKIP_FAMILY_PAGES = ("ds-d5b65rb-d", "ds-d5b75rb-d", "ds-3wr12c-e", "ds-3wr15x-h",
                     "ds-3e0505-e", "ds-3e0508-e-b-", "ds-k7p03a")
VIEW_ORDER = ["main_mainview", "outline_leftside45view", "outline_rightside45view", "outline_drawingview"]


def norm(model):
    """DS-2CD1047G3-LIU(4mm)(O-STD) -> DS-2CD1047G3-LIU, keeping colour suffixes."""
    model = model.upper().replace("/OVERSEAS", "")
    model = re.sub(r"\((?!BLACK|WHITE)[^)]*\)", "", model)
    return re.sub(r"\s+", "", model.split(" ")[0]).strip(",")


FULLWIDTH = str.maketrans({"、": ", ", "：": ": ", "，": ", ", "；": "; ", "（": " (", "）": ")"})


def tidy(text):
    """Hikvision copy sometimes carries Chinese punctuation; normalise it."""
    return re.sub(r"\s+", " ", text.translate(FULLWIDTH)).replace(" ,", ",").strip()


def cached(url):
    path = CACHE / (hashlib.md5(url.encode()).hexdigest() + ".json")
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def find_match(product, urls):
    """Return (page, sub_id, quality) for the best Hikvision page."""
    target = norm(product["model"])
    first = None
    for url in urls:
        page = cached(url)
        if not page:
            continue
        first = first or page
        for sub in page["subs"]:
            if norm(sub["name"]) == target:
                return page, sub["id"], "exact"
        if not page["subs"] and norm(page["title"]) == target:
            return page, next(iter(page["specs"]), None), "exact"
    return (first, None, "family") if first else (None, None, None)


def variant_line_applies(line, model):
    """Hikvision lists variant-only features as '-SL/-SRB: ...' or '-F: ...'."""
    match = re.match(r"^((?:-[A-Z0-9]+/?)+)\s*:\s*(.+)$", line)
    if not match:
        return True, line
    tokens = re.findall(r"-([A-Z0-9]+)", match.group(1))
    segments = re.split(r"[-/]", norm(model))
    applies = any(seg.endswith(token) and seg != segments[0] for token in tokens for seg in segments[1:])
    return applies, match.group(2)


def gallery_sources(page, sub_id):
    family, dims = [], []
    for url in page["images"]:
        folder = url.split("/image/")[1].split("/")[0].upper()
        if "dimension" in url.lower() or "structure_" in url:
            if sub_id and folder == sub_id.upper():
                dims.append(url)
            continue
        if folder.startswith("M"):
            family.append(url)

    def rank(url):
        view = url.split("/image/")[1].split("/")
        name = view[1] if len(view) > 2 else ""
        return VIEW_ORDER.index(name) if name in VIEW_ORDER else len(VIEW_ORDER)

    family.sort(key=rank)
    return family, dims[:1]


def fetch_image(url, dest):
    if dest.exists():
        return True
    parts = urllib.parse.urlsplit(url)
    quoted = urllib.parse.urlunsplit(parts._replace(path=urllib.parse.quote(parts.path, safe="/%")))
    request = urllib.request.Request(quoted, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.hikvision.com/"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, tempfile.NamedTemporaryFile() as tmp:
            tmp.write(response.read())
            tmp.flush()
            dest.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                ["convert", tmp.name, "-background", "white", "-flatten", "-resize", "1000x1000>",
                 "-strip", "-quality", "82", str(dest)],
                check=True,
            )
        time.sleep(0.3)
        return True
    except Exception as error:  # noqa: BLE001 - report and carry on
        print(f"  image failed: {url} ({error})")
        return False


def local_image(url, family_id):
    stem = urllib.parse.unquote(url.rsplit("/", 1)[1]).rsplit(".", 1)[0]
    digest = hashlib.md5(url.encode()).hexdigest()[:8]
    safe = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")[:40] or "view"
    return IMAGE_DIR / family_id.lower() / f"{safe}-{digest}.webp"


def main():
    plan = {entry["slug"]: entry["urls"] for entry in json.loads(PLAN.read_text(encoding="utf-8"))}
    products = json.loads(catalog.DATA.read_text(encoding="utf-8"))
    report = {"exact": [], "family": [], "none": []}

    for product in products:
        slug = catalog.slugify(product["model"]) if "slug" not in product else product["slug"]
        page, sub_id, quality = find_match(product, plan.get(slug, []))
        if quality == "family" and page["url"].rstrip("/").rsplit("/", 1)[1] in SKIP_FAMILY_PAGES:
            page = None
        for key in ("gallery", "keyFeatures", "specTable", "datasheet", "hikvisionUrl"):
            product.pop(key, None)
        if not page:
            report["none"].append(product["model"])
            continue
        report[quality].append({"model": product["model"], "page": page["url"]})

        family_id = page.get("family") or "misc"
        # Single-model pages keep drawings and datasheets in the family folder.
        doc_id = sub_id if page["subs"] else family_id
        family, dims = gallery_sources(page, doc_id)
        # The first family shot is the main view, which our own catalogue photo already covers.
        sources = (family[1:] + dims)[:MAX_GALLERY]
        gallery = []
        for url in sources:
            dest = local_image(url, family_id)
            if fetch_image(url, dest):
                gallery.append(dest.relative_to(ROOT).as_posix())
        if gallery:
            product["gallery"] = gallery

        features = []
        for line in page["features"]:
            applies, text = variant_line_applies(line, product["model"])
            if quality == "family" and text != line:
                continue
            text = tidy(text)
            if applies and text not in features:
                features.append(text)
        if features:
            product["keyFeatures"] = features

        if quality == "exact":
            specs = page["specs"].get(sub_id) if sub_id else None
            if specs:
                # Hikvision fills non-applicable rows with "/"; drop them and any emptied group.
                groups = [
                    {"group": tidy(g["group"]), "rows": [[tidy(k), tidy(v)] for k, v in g["rows"] if v and v.strip() not in ("/", "-")]}
                    for g in specs
                ]
                product["specTable"] = [g for g in groups if g["rows"]]
            sheets = [d for d in page["docs"] if doc_id and f"/{doc_id.lower()}/" in d.lower() and "datasheet" in d.lower()]
            if sheets:
                product["datasheet"] = sheets[0]
            product["hikvisionUrl"] = page["url"] + (
                f"?subName={urllib.parse.quote(next(s['name'] for s in page['subs'] if s['id'] == sub_id))}"
                if page["subs"] else ""
            )
        else:
            product["hikvisionUrl"] = page["url"]

    catalog.DATA.write_text(json.dumps(products, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (HIK / "report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"exact: {len(report['exact'])}  family only: {len(report['family'])}  not found: {len(report['none'])}")


if __name__ == "__main__":
    main()
