"""The /downloads brochure library and the brochure strips on category pages.

Reads data/brochures.json (kept by tools/brochures.py). Pure Python, so it runs
in Workers Builds.
"""
import html
import json
import urllib.parse

from catalog import PHONE, ROOT

# key, chip label, the site categories whose pages show this group's strip
GROUPS = [
    ("catalogues", "Catalogues", []),
    ("turbo-hd", "Turbo HD cameras & DVRs", ["CCTV-Turbo HD"]),
    ("ip", "IP cameras & NVRs", ["CCTV-IP", "Storage"]),
    ("access", "Access control", ["Access Control"]),
    ("intercom", "Video intercom", ["Video Intercom"]),
    ("network", "Networking & Wi-Fi", ["Networking", "Data Communication"]),
    ("display", "Displays & flat panels", ["Interactive Tablet"]),
    ("audio", "Audio & PA", ["PA"]),
    ("apps", "Hik-Connect app", []),
    ("solutions", "Solutions by industry", []),
]
TYPE_ORDER = {"Catalogue": 0, "Brochure": 1, "Poster": 2, "Flyer": 3, "Leaflet": 4, "Infographic": 5, "Rollup": 6}


def esc(value):
    return html.escape(str(value or ""), quote=True)


def load():
    path = ROOT / "data/brochures.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def size_label(n):
    return f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{max(1, round(n / 1024))} KB"


def card_html(item, lazy=True):
    href = "/" + item["file"] if item.get("file") else item["url"]
    ext = (item.get("file") or ".pdf").rsplit(".", 1)[-1].upper()
    meta = [ext, f"{item['pages']} pages" if item["pages"] > 1 else "1 page"]
    if item.get("bytes"):
        meta.append(size_label(item["bytes"]))
    ask = f"https://wa.me/{PHONE.lstrip('+')}?text=" + urllib.parse.quote(
        f"Hi NE, I saw the Hikvision \"{item['title']}\" {item['type'].lower()} on your website. Please send me prices and availability.")
    shape = "" if item.get("portrait", True) else " wide"
    return f"""<article class="bro{shape}" data-group="{esc(item['group'])}" data-type="{esc(item['type'])}">
  <a class="bro-cover" href="{esc(href)}" target="_blank" rel="noopener"><img src="/{esc(item['cover'])}" alt="{esc(item['title'])} {esc(item['type'].lower())} cover" {'loading="lazy" ' if lazy else ''}decoding="async"></a>
  <div class="bro-body">
    <span class="bro-type">{esc(item['type'])}</span>
    <h3>{esc(item['title'])}</h3>
    <p class="bro-meta">{esc(' · '.join(meta))}</p>
    <div class="bro-actions"><a class="bro-dl" href="{esc(href)}" target="_blank" rel="noopener"{' download' if item.get('file') else ''}>{'Download' if item.get('file') else 'View online'}</a><a class="bro-wa" href="{esc(ask)}" target="_blank" rel="noopener">Ask NE</a></div>
  </div>
</article>"""


def ordered(items):
    rank = {key: i for i, (key, _, _) in enumerate(GROUPS)}
    return sorted(items, key=lambda i: (rank.get(i["group"], 99), TYPE_ORDER.get(i["type"], 9), i["title"].lower()))


CSS = """
.bro-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 16px; }
.bro { background: #fff; border: 1px solid #E7ECF1; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }
.bro:hover { border-color: #086E9E; box-shadow: 0 6px 18px rgba(15,42,61,0.08); }
.bro-cover { display: block; aspect-ratio: 3 / 4; background: #EEF2F5; overflow: hidden; }
.bro.wide .bro-cover { aspect-ratio: 3 / 4; display: flex; align-items: center; }
.bro-cover img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.bro.wide .bro-cover img { height: auto; object-fit: contain; }
.bro-body { padding: 12px 14px 14px; display: flex; flex-direction: column; flex: 1; }
.bro-type { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #086E9E; }
.bro h3 { font-size: 14.5px; line-height: 1.35; margin: 4px 0 6px; color: #10202E; }
.bro-meta { font-size: 12px; color: #4A5B68; margin: 0 0 12px; }
.bro-actions { margin-top: auto; display: flex; gap: 8px; }
.bro-actions a { flex: 1; text-align: center; white-space: nowrap; padding: 9px 6px; border-radius: 9px; font-size: 13.5px; font-weight: 700; text-decoration: none; }
.bro-dl { background: #086E9E; color: #fff !important; }
.bro-wa { background: #E8F8EE; color: #14532D !important; }
.bro-strip { margin: 40px 0 8px; }
.bro-strip-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.bro-strip-head h2 { font-size: 22px; margin: 0; }
.bro-strip-head a { font-weight: 700; }
.bro-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(190px, 210px); gap: 14px; overflow-x: auto; padding-bottom: 8px; scroll-snap-type: x mandatory; }
.bro-row .bro { scroll-snap-align: start; }
"""


def strip_html(category):
    """'Brochures & posters' row for a category page; empty when there are none."""
    keys = [key for key, _, cats in GROUPS if category in cats]
    items = [i for i in ordered(load()) if i["group"] in keys]
    if not items:
        return ""
    label = next(label for key, label, _ in GROUPS if key == keys[0])
    cards = "\n".join(card_html(i) for i in items[:10])
    return f"""<section class="bro-strip" aria-labelledby="bro-title">
      <div class="bro-strip-head"><h2 id="bro-title">Hikvision brochures &amp; posters</h2><a href="/downloads#{keys[0]}">See all {len(items)} &middot; {esc(label)} &rarr;</a></div>
      <div class="bro-row">
{cards}
      </div>
    </section>
<style>{CSS}</style>"""


def library_html():
    items = ordered(load())
    counts = {key: sum(1 for i in items if i["group"] == key) for key, _, _ in GROUPS}
    chips = [f'<button type="button" class="chip on" data-filter="">All <span>{len(items)}</span></button>']
    chips += [f'<button type="button" class="chip" data-filter="{key}">{esc(label)} <span>{counts[key]}</span></button>'
              for key, label, _ in GROUPS if counts[key]]
    sections = []
    for key, label, _ in GROUPS:
        group = [i for i in items if i["group"] == key]
        if not group:
            continue
        cards = "\n".join(card_html(i, lazy=n > 5 or bool(sections)) for n, i in enumerate(group))
        sections.append(f"""<section class="bro-sec" id="{key}" data-sec="{key}">
  <h2>{esc(label)} <span>{len(group)}</span></h2>
  <div class="bro-grid">
{cards}
  </div>
</section>""")
    return "<div class=\"chips\" id=\"bro-chips\">" + "".join(chips) + "</div>\n" + "\n".join(sections), len(items)
