#!/usr/bin/env python3
"""Match each catalogue model to candidate Hikvision product pages.

Reads tools/hikvision/sitemap.xml (fetched by scrape.js) and writes
tools/hikvision/plan.json: for every product, up to four product-page URLs
whose slug starts with the model number. Variants such as -LIUF/SRB live on
a shared family page, so the model is trimmed until a page matches.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import catalog

HERE = pathlib.Path(__file__).resolve().parent


def core(model):
    model = model.upper().replace("/OVERSEAS", "")
    model = re.sub(r"\((?!BLACK|WHITE)[^)]*\)", "", model)
    return model.split()[0].strip(",")


def main():
    sitemap = (HERE / "sitemap.xml").read_text(encoding="utf-8")
    urls = [u for u in re.findall(r"<loc>([^<]+)</loc>", sitemap) if "/products/" in u and u.count("/") >= 8]
    pages = {}
    for url in urls:
        pages.setdefault(url.rstrip("/").split("/")[-1].lower(), url)

    plan, unmatched = [], []
    for product in catalog.load():
        target = catalog.slugify(core(product["model"]))
        match = re.match(r"([a-z]+-?[0-9a-z]*?\d[0-9a-z]*)", target)
        root = match.group(1) if match else target
        candidates, trimmed = [], target
        while len(trimmed) >= len(root) and not candidates:
            candidates = [
                slug for slug in pages
                if slug == trimmed or slug.startswith(trimmed + "-") or (trimmed != target and slug.startswith(trimmed))
            ]
            trimmed = trimmed[:-1]
        candidates = sorted(candidates, key=len)[:4]
        if not candidates:
            unmatched.append(product["model"])
        plan.append({"slug": product["slug"], "model": product["model"], "urls": [pages[s] for s in candidates]})

    (HERE / "plan.json").write_text(json.dumps(plan, indent=1) + "\n", encoding="utf-8")
    print(f"{len(plan) - len(unmatched)} of {len(plan)} products have candidate pages")
    for model in unmatched:
        print("  no page:", model)


if __name__ == "__main__":
    main()
