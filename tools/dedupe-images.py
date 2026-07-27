#!/usr/bin/env python3
"""One-off cleanup: drop unreferenced media and collapse byte-identical product photos.

Many catalogue photos were saved once per row while the price list was being
transcribed, so the same Hikvision stock shot exists under several numbers.
This keeps the lowest-numbered copy of each group and repoints data/products.json
at it. Run from the repo root; re-running is a no-op.
"""
import hashlib
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Files no page or data record references — leftovers from building the catalogue.
UNREFERENCED = [
    "assets/Poster-Preview_KF0T-Series (1).jpg",  # the .webp next to it is the one in use
    "assets/logo-1783951773161.png",
    "assets/nashnaal-logo.jpg",
    "images/placeholder-accessories.png",
    "images/placeholder-data-communication.png",
    "images/placeholder-interactive-tablet.png",
    "images/placeholder-networking.png",
]


def digest(path):
    return hashlib.md5(path.read_bytes()).hexdigest()


def main():
    freed = 0

    for rel in UNREFERENCED:
        path = ROOT / rel
        if path.exists():
            freed += path.stat().st_size
            path.unlink()
            print(f"removed unreferenced  {rel}")

    products = json.loads((ROOT / "data/products.json").read_text(encoding="utf-8"))

    # Group product images by content, keeping the first-referenced one as canonical.
    canonical = {}
    remap = {}
    for product in products:
        rel = product["image"]
        path = ROOT / rel
        if not path.exists():
            sys.exit(f"missing image referenced by {product['model']}: {rel}")
        key = digest(path)
        if key not in canonical:
            canonical[key] = rel
        elif canonical[key] != rel:
            remap[rel] = canonical[key]

    for product in products:
        if product["image"] in remap:
            product["image"] = remap[product["image"]]

    for rel in sorted(remap):
        path = ROOT / rel
        if path.exists():
            freed += path.stat().st_size
            path.unlink()
            print(f"deduped               {rel} -> {remap[rel]}")

    (ROOT / "data/products.json").write_text(
        json.dumps(products, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    print(f"\n{len(remap)} duplicate photos collapsed, {freed / 1e6:.1f} MB freed")


if __name__ == "__main__":
    main()
