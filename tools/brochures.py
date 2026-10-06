#!/usr/bin/env python3
"""Maintain data/brochures.json: the Hikvision marketing library on /downloads.

    python3 tools/brochures.py add <dir> <list.json>   # import downloaded PDFs
    python3 tools/brochures.py existing                # register files already in assets/brochures/
    python3 tools/brochures.py covers                  # (re)make missing covers

<list.json> holds [{"title", "cat", "href", "file"}] where "cat" is the
section name on hikvision.com/africa/support/download/marketing-materials/,
"href" the documents.hikvision.com page and "file" a PDF in <dir>.
Needs poppler-utils (pdfinfo, pdftoppm) and ImageMagick; the site build only
reads the JSON, so Workers Builds needs neither.
"""
import json
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from catalog import ROOT  # noqa: E402

DATA = ROOT / "data/brochures.json"
FILES = ROOT / "assets/brochures"
COVERS = FILES / "covers"
MAX_BYTES = 20 * 1024 * 1024   # Workers static assets stop at 25 MiB a file

# hikvision.com section -> our group (see GROUPS in build-catalog.py)
SECTION_GROUP = {
    "Turbo HD products": "turbo-hd",
    "Network products": "ip",
    "Access control products": "access",
    "Video Intercom products": "intercom",
    "Audio and Sensing": "audio",
    "Hik-Connect": "apps",
    "Solutions by Small & Medium Business": "solutions",
}
TYPES = ["Brochure", "Poster", "Flyer", "Leaflet", "Infographic", "Rollup", "Catalogue"]


def load():
    return json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else []


def save(items):
    DATA.write_text(json.dumps(items, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def split_title(raw):
    """'Brochure - Smart Hybrid Light Cameras' -> ('Brochure', 'Smart Hybrid Light Cameras')."""
    m = re.match(r"\s*(Brochures?|Posters?|Flyers?|Leaflets?|Infographic|Roll-?up)\s*-?\s*(.+)", raw, re.I)
    if not m:
        return "Brochure", raw.strip()
    kind = m.group(1).rstrip("s").replace("-", "").capitalize()
    kind = "Rollup" if kind.lower() == "rollup" else kind
    return kind, re.sub(r"\s+", " ", m.group(2)).strip(" -")


def group_for(section, title):
    if re.search(r"Hot-selling|Project-Oriented|Catalog", title, re.I):
        return "catalogues"
    if section == "Transmission and display products":
        return "display" if re.search(r"Flat Panel|Display|Monitor", title, re.I) else "network"
    if re.search(r"Wireless Bridge|Switch", title, re.I):
        return "network"
    return SECTION_GROUP.get(section, "solutions")


def pdf_info(path):
    if pathlib.Path(path).suffix.lower() != ".pdf":
        w, h = subprocess.run(["identify", "-format", "%w %h", f"{path}[0]"], capture_output=True, text=True).stdout.split()
        return 1, float(w), float(h)
    out = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True).stdout
    pages = int(re.search(r"Pages:\s+(\d+)", out).group(1))
    w, h = map(float, re.search(r"Page size:\s+([\d.]+) x ([\d.]+)", out).groups())
    return pages, w, h


def make_cover(item, src=None):
    src = pathlib.Path(src) if src else ROOT / item["file"]
    out = COVERS / (item["id"] + ".jpg")
    if not out.exists():
        COVERS.mkdir(parents=True, exist_ok=True)
        if src.suffix.lower() == ".pdf":
            tmp = COVERS / (item["id"] + "-page1")
            subprocess.run(["pdftoppm", "-r", "60", "-png", "-f", "1", "-l", "1", "-singlefile", str(src), str(tmp)], check=True)
            image = COVERS / (item["id"] + "-page1.png")
        else:
            image = src
        # Very tall infographics: keep the top, so the card shows the headline.
        subprocess.run(["convert", str(image), "-resize", "480x>", "-gravity", "north", "-crop", "480x900+0+0", "+repage",
                        "-background", "white", "-alpha", "remove", "-quality", "78", str(out)], check=True)
        if image != src:
            image.unlink()
    item["cover"] = out.relative_to(ROOT).as_posix()


def add(directory, listing):
    items = load()
    known = {i.get("source") for i in items} | {i["file"] for i in items}
    directory = pathlib.Path(directory)
    added = skipped = 0
    for row in json.loads(pathlib.Path(listing).read_text(encoding="utf-8")):
        src = directory / row["file"]
        if row["href"] in known or not src.exists() or src.suffix.lower() not in {".pdf", ".jpg", ".jpeg", ".png"}:
            continue
        if re.match(rb"\s*<(!doctype|html)", src.read_bytes()[:64], re.I):
            print(f"skipped (got a web page, not the file): {row['title']}")
            continue
        if src.stat().st_size > MAX_BYTES:
            # Too big to host: link to Hikvision's own online copy instead.
            dest = None
        else:
            dest = FILES / row["file"]
            dest.write_bytes(src.read_bytes())
        kind, title = split_title(row["title"])
        pages, w, h = pdf_info(src)
        item = {
            "id": pathlib.Path(row["file"]).stem,
            "title": title,
            "type": kind,
            "group": group_for(row["cat"], title),
            "file": dest.relative_to(ROOT).as_posix() if dest else None,
            "url": None if dest else row["href"],
            "pages": pages,
            "bytes": src.stat().st_size if dest else None,
            "portrait": h >= w,
            "source": row["href"],
        }
        make_cover(item, src)
        skipped += 0 if dest else 1
        items.append(item)
        added += 1
    save(items)
    print(f"{added} added ({skipped} too large to host, linked to hikvision.com); {len(items)} in data/brochures.json")


def existing():
    """Register the solution brochures already in assets/brochures/ (linked from the solution pages)."""
    items = load()
    known = {i["file"] for i in items}
    small = {"and", "for", "of", "the", "in", "to", "with", "a"}
    for path in sorted(FILES.glob("*.*")):
        rel = path.relative_to(ROOT).as_posix()
        if rel in known or path.suffix.lower() not in {".pdf", ".jpg", ".png"}:
            continue
        stem = re.sub(r"-?(preview|20\d{6}|infor?-20\d\d|20\d\d)(?=-|$)", "", path.stem)
        m = re.match(r"(?:building-sbf-|education-)?(brochure|leaflet|poster|flyer|infographic|inforgraphic|rollup)-(.*)", stem)
        kind, rest = (m.group(1), m.group(2)) if m else ("brochure", stem)
        kind = {"inforgraphic": "Infographic"}.get(kind, kind.capitalize())
        words = [w for w in rest.replace("inforgraphic-", "").split("-") if w]
        title = " ".join(w if w.isupper() else (w if i and w in small else w.capitalize()) for i, w in enumerate(words))
        title = re.sub(r"\b(Smb|Ai|Hikvision Hikvision)\b", lambda x: {"Smb": "SMB", "Ai": "AI"}.get(x.group(0), "Hikvision"), title)
        title = re.sub(r"\s+0?(\d)$", r" (\1)", title)
        pdf = path.suffix.lower() == ".pdf"
        pages, w, h = pdf_info(path) if pdf else (1, 1, 2)
        item = {"id": path.stem, "title": title, "type": kind, "group": "solutions", "file": rel, "url": None,
                "pages": pages, "bytes": path.stat().st_size, "portrait": h >= w, "source": None}
        make_cover(item)
        items.append(item)
    save(items)
    print(f"{len(items)} in data/brochures.json")


def covers():
    items = load()
    for item in items:
        if item.get("file"):
            make_cover(item)
    save(items)


if __name__ == "__main__":
    if sys.argv[1:2] == ["add"] and len(sys.argv) == 4:
        add(sys.argv[2], sys.argv[3])
    elif sys.argv[1:2] == ["existing"]:
        existing()
    elif sys.argv[1:2] == ["covers"]:
        covers()
    else:
        sys.exit(__doc__)
