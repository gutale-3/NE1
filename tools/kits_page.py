"""The /kits page: complete Turbo HD and IP camera kits in 4, 8 and 16-camera sizes.

Each family pairs one bullet and one dome (turret) camera with the recorder
that suits them. A kit of N cameras gets N/2 of each, a recorder with N
channels, a hard disk, a power supply, coax-with-power cable, one connector
set per camera and cable clips. IP kits use a PoE NVR instead (no power
supply needed), CAT6 cable and RJ45 plugs. Prices are summed from the catalogue at
build time, so they follow price changes automatically.
"""
import html
import json
import urllib.parse

import catalog
from catalog import PHONE

SIZES = (4, 8, 16)

# Same for every Turbo HD kit, by camera count.
HD_POWER = {4: "DS-2FA1225-C4(UK)(O-STD)", 8: "DS-2FA1205-C8(UK)(O-STD)", 16: "DS-2FA1208-C16(UK)(Africa)"}
HD_CABLE = {4: ("DS-1LH1SCAM592C(O-STD) 90m", 1), 8: ("DS-1LH1SCAM592C(O-STD) 180m", 1), 16: ("DS-1LH1SCAM592C(O-STD) 180m", 2)}
HD_CLIPS = {4: 1, 8: 2, 16: 4}

DVR_1080P = {4: "DS-7104HGHI-M1(STD)(C)", 8: "DS-7108HGHI-M1(STD)(C)", 16: "DS-7116HGHI-M1(STD)(E)"}
DVR_TURBO8 = {4: "DS-7104HGHI-M1/T(STD)", 8: "DS-7108HGHI-M1/T(STD)", 16: "DS-7116HGHI-M1/T(STD)"}
DVR_3K = {4: "iDS-7104HQHI-M1/T(STD)", 8: "iDS-7108HQHI-M1/T(STD)", 16: "iDS-7116HQHI-M1/T(STD)"}
HDD_1080P = {4: "HDD-1TB", 8: "HDD-2TB", 16: "HDD-4TB"}
HDD_3K = {4: "HDD-2TB", 8: "HDD-4TB", 16: "HDD-6TB"}  # 3K footage is larger

HD_FAMILIES = [
    {
        "id": "hd-basic", "name": "1080p IR", "tag": "Lowest price",
        "summary": "Sharp 1080p video by day and clear black-and-white infrared at night, up to 20 m. The most affordable way to cover a home, shop or compound.",
        "points": ["2MP 1080p", "IR night vision 20 m", "Indoor & outdoor"],
        "bullet": "DS-2CE16D0T-EXIPF(3.6mm)(O-STD)", "dome": "DS-2CE76D0T-EXIPF(2.8mm)(O-STD)",
        "dvr": DVR_1080P, "hdd": HDD_1080P,
    },
    {
        "id": "hd-hybrid", "name": "1080p Smart Hybrid Light with audio",
        "summary": "Infrared at night that switches to a white light and colour video when someone moves. A built-in microphone records sound too.",
        "points": ["2MP 1080p", "Colour when motion is seen", "Built-in mic"],
        "bullet": "DS-2CE16D0T-LPFS(3.6mm)(O-STD)", "dome": "DS-2CE76D0T-LPFS(2.8mm)(O-STD)",
        "dvr": DVR_1080P, "hdd": HDD_1080P,
    },
    {
        "id": "hd-colorvu-20", "name": "1080p ColorVu with audio", "tag": "Most popular",
        "summary": "Full-colour video through the night, so you can see clothes, cars and faces in colour. Built-in microphone, 20 m night range.",
        "points": ["2MP 1080p", "Colour at night 20 m", "Built-in mic"],
        "bullet": "DS-2CE10DF0T-LPFS(3.6mm)(O-STD)", "dome": "DS-2CE70DF0T-LPFS(2.8mm)(O-STD)",
        "dvr": DVR_1080P, "hdd": HDD_1080P,
    },
    {
        "id": "hd-colorvu-40", "name": "1080p ColorVu long range",
        "summary": "Colour night vision reaching 40 m for yards, parking and long corridors. Built-in microphone on every camera.",
        "points": ["2MP 1080p", "Colour at night 40 m", "Built-in mic"],
        "bullet": "DS-2CE12DF0T-LFS(3.6mm)(O-STD)", "dome": "DS-2CE72DF0T-LFS(3.6mm)(O-STD)",
        "dvr": DVR_1080P, "hdd": HDD_1080P,
    },
    {
        "id": "hd-twoway", "name": "Turbo HD 8.0 two-way audio",
        "summary": "Talk through the camera: a speaker and microphone let you answer visitors or warn intruders from your phone. Smart hybrid light for colour on motion.",
        "points": ["2MP 1080p", "Talk & listen", "Colour on motion"],
        "bullet": "DS-2CE16D0T-LPTS(3.6mm)(O-STD)", "dome": "DS-2CE78D0T-LTS(2.8mm)(O-STD)",
        "dvr": DVR_TURBO8, "hdd": HDD_1080P,
    },
    {
        "id": "hd-siren", "name": "Turbo HD 8.0 siren deterrence",
        "summary": "Stops trouble before it starts: a loud siren and light go off when a person is detected, and two-way audio lets you speak to them.",
        "points": ["2MP 1080p", "Siren & light alarm", "Talk & listen"],
        "bullet": "DS-2CE16D0T-LPXTS(3.6mm)(O-STD)", "dome": "DS-2CE78D0T-LXTS(2.8mm)(O-STD)",
        "dvr": DVR_TURBO8, "hdd": HDD_1080P,
    },
    {
        "id": "hd-hybrid-3k", "name": "3K Smart Hybrid Light with audio",
        "summary": "Sharper 3K picture for reading number plates and faces further away, with colour on motion at night and a built-in microphone.",
        "points": ["5MP-class 3K", "Colour when motion is seen", "Built-in mic"],
        "bullet": "DS-2CE16K0T-LPFS(3.6mm)(O-STD)", "dome": "DS-2CE76K0T-LPFS(2.8mm)(O-STD)",
        "dvr": DVR_3K, "hdd": HDD_3K,
    },
    {
        "id": "hd-3k-colorvu-20", "name": "3K ColorVu with audio",
        "summary": "Our sharpest Turbo HD picture in full colour all night, 20 m range, with a built-in microphone. Comes with a 3K-ready DVR and bigger hard disk.",
        "points": ["5MP-class 3K", "Colour at night 20 m", "Built-in mic"],
        "bullet": "DS-2CE10KF0T-LPFS(3.6mm)(O-STD)", "dome": "DS-2CE70KF0T-LPFS(2.8mm)(O-STD)",
        "dvr": DVR_3K, "hdd": HDD_3K,
    },
    {
        "id": "hd-3k-colorvu-40", "name": "3K ColorVu long range",
        "summary": "3K detail with colour night vision to 40 m: the choice for large compounds, car parks and warehouses.",
        "points": ["5MP-class 3K", "Colour at night 40 m", "Built-in mic"],
        "bullet": "DS-2CE12KF0T-LFS(3.6mm)(O-STD)", "dome": "DS-2CE72KF0T-LFS(2.8mm)(O-STD)",
        "dvr": DVR_3K, "hdd": HDD_3K,
    },
]

# --- IP (network cameras powered over the network cable by a PoE NVR) ---
IP_CABLE = {4: 1, 8: 2, 16: 3}           # 305 m boxes of CAT6
IP_CLIPS = {4: 1, 8: 2, 16: 4}
NVR_Q = {4: "DS-7104NI-Q1/4P/M(STD)(D)", 8: "DS-7108NI-Q1/8P/M(STD)(D)", 16: "DS-7616NI-Q2/16P(E)(STD)"}  # fine for 2MP
# 4MP and above, and cameras with two-way audio, need a 76-series (or higher) NVR.
# There is no 4-channel 76 model, so 4-camera kits get the 8-channel one (room to add 4 more).
NVR_76 = {4: "DS-7608NXI-K1/8P(STD)(B)", 8: "DS-7608NXI-K1/8P(STD)(B)", 16: "DS-7616NXI-K2/16P(D)(STD)"}
HDD_2MP = {4: "HDD-1TB", 8: "HDD-2TB", 16: "HDD-4TB"}
HDD_4MP = {4: "HDD-2TB", 8: "HDD-4TB", 16: "HDD-6TB"}
HDD_8MP = {4: "HDD-2TB", 8: "HDD-4TB", 16: "HDD-8TB"}

IP_FAMILIES = [
    {
        "id": "ip-2mp-ir", "name": "2MP IP IR", "tag": "Lowest price",
        "summary": "Entry-level network cameras: sharp 1080p by day, infrared at night up to 30 m. One cable per camera carries power and video.",
        "points": ["2MP 1080p", "IR night vision", "PoE, one cable"],
        "bullet": "DS-2CD1021G0-I(4mm)(O-STD)", "dome": "DS-2CD1121G0-I(2.8mm)(O-STD)", "nvr": NVR_Q, "hdd": HDD_2MP,
    },
    {
        "id": "ip-2mp-hybrid", "name": "2MP Smart Hybrid Light",
        "summary": "Infrared at night that switches to white light and colour when someone moves, plus a built-in microphone.",
        "points": ["2MP 1080p", "Colour on motion", "Built-in mic"],
        "bullet": "DS-2CD1023G2-LIU(4mm)(O-STD)", "dome": "DS-2CD1123G2-LIU(2.8mm)(O-STD)", "nvr": NVR_Q, "hdd": HDD_2MP,
    },
    {
        "id": "ip-4mp-hybrid", "name": "4MP Smart Hybrid Light",
        "summary": "Twice the detail of 1080p for faces and number plates, colour on motion at night and a built-in microphone.",
        "points": ["4MP 2K", "Colour on motion", "Built-in mic"],
        "bullet": "DS-2CD1043G2-LIU(4mm)(O-STD)", "dome": "DS-2CD1143G2-LIU(2.8mm)(O-STD)", "nvr": NVR_76, "hdd": HDD_4MP,
    },
    {
        "id": "ip-4mp-colorvu", "name": "4MP ColorVu", "tag": "Most popular",
        "summary": "Full-colour video all night with sharp 4MP detail and a built-in microphone. Our best-selling IP cameras.",
        "points": ["4MP 2K", "Colour at night", "Built-in mic"],
        "bullet": "DS-2CD1047G3-LIU(4mm)(O-STD)", "dome": "DS-2CD1147G3-LIU(2.8mm)(O-STD)", "nvr": NVR_76, "hdd": HDD_4MP,
    },
    {
        "id": "ip-4mp-strobe", "name": "4MP ColorVu with red & blue strobe",
        "summary": "Active deterrence: flashing red and blue lights and an alarm sound when a person or car is detected, with full-colour night video.",
        "points": ["4MP 2K", "Strobe & alarm", "Colour at night"],
        "bullet": "DS-2CD1047G3-LIUF/SRB(4mm)(O-STD)", "dome": "DS-2CD1347G3-LIUF/SRB(2.8mm)(O-STD)", "nvr": NVR_76, "hdd": HDD_4MP,
    },
    {
        "id": "ip-4mp-varifocal", "name": "4MP motorised zoom",
        "summary": "Zoom lenses (2.8 to 12 mm) adjusted from the phone app: frame a gate, till or car park exactly, with colour on motion.",
        "points": ["4MP 2K", "2.8-12 mm zoom", "Colour on motion"],
        "bullet": "DS-2CD1643G2-LIZU(2.8-12mm)(O-STD)", "dome": "DS-2CD1743G2-LIZU(2.8-12mm)(O-STD)", "nvr": NVR_76, "hdd": HDD_4MP,
    },
    {
        "id": "ip-6mp-hybrid", "name": "6MP Smart Hybrid Light",
        "summary": "6MP detail covers wider areas with one camera, colour on motion at night and a built-in microphone.",
        "points": ["6MP 3K", "Colour on motion", "Built-in mic"],
        "bullet": "DS-2CD1063G2-LIU(4mm)(O-STD)", "dome": "DS-2CD1163G2-LIU(2.8mm)(O-STD)", "nvr": NVR_76, "hdd": HDD_8MP,
    },
    {
        "id": "ip-6mp-colorvu", "name": "6MP ColorVu",
        "summary": "Wide, detailed full-colour video day and night for shops, schools and compounds, with a built-in microphone.",
        "points": ["6MP 3K", "Colour at night", "Built-in mic"],
        "bullet": "DS-2CD1067G3-LIU(4mm)(O-STD)", "dome": "DS-2CD1167G3-LIU(2.8mm)(O-STD)", "nvr": NVR_76, "hdd": HDD_8MP,
    },
    {
        "id": "ip-6mp-strobe", "name": "6MP ColorVu with red & blue strobe",
        "summary": "Our sharpest deterrence cameras: 6MP colour at night, flashing strobe lights and an alarm sound to scare intruders off.",
        "points": ["6MP 3K", "Strobe & alarm", "Colour at night"],
        "bullet": "DS-2CD1067G3-LIUF/SRB(4mm)(O-STD)", "dome": "DS-2CD1367G3-LIUF/SRB(2.8mm)(O-STD)", "nvr": NVR_76, "hdd": HDD_8MP,
    },
    {
        "id": "ip-8mp-hybrid", "name": "8MP 4K Smart Hybrid Light",
        "summary": "4K Ultra HD: zoom into recordings to read faces and plates. Colour on motion at night and a built-in microphone.",
        "points": ["8MP 4K", "Colour on motion", "Built-in mic"],
        "bullet": "DS-2CD1083G2-LIU(4mm)(O-STD)", "dome": "DS-2CD1183G2-LIU(2.8mm)(O-STD)", "nvr": NVR_76, "hdd": HDD_8MP,
    },
    {
        "id": "ip-4mp-acusense", "name": "4MP AcuSense ColorVu",
        "summary": "Professional cameras that tell people and vehicles apart from leaves and animals, so alerts are real. Colour at night, built-in mic.",
        "points": ["4MP 2K", "AcuSense alerts", "Colour at night"],
        "bullet": "DS-2CD2047G3-LI2UY(4mm)(O-STD)", "dome": "DS-2CD2147G3-LIS2UY(2.8mm)(O-STD)", "nvr": NVR_76, "hdd": HDD_4MP,
    },
    {
        "id": "ip-8mp-acusense", "name": "8MP 4K AcuSense ColorVu",
        "summary": "Top of the range: 4K colour day and night with AcuSense people and vehicle detection, for banks, warehouses and estates.",
        "points": ["8MP 4K", "AcuSense alerts", "Colour at night"],
        "bullet": "DS-2CD2087G3-LI2UY(4mm)(O-STD)", "dome": "DS-2CD2187G3-LIS2UY(2.8mm)(O-STD)", "nvr": NVR_76, "hdd": HDD_8MP,
    },
]
for _f in HD_FAMILIES:
    _f["kind"] = "hd"
for _f in IP_FAMILIES:
    _f["kind"] = "ip"

SIZE_NOTE = {4: "Homes & small shops", 8: "Businesses & compounds", 16: "Large sites & estates"}


def esc(value):
    return html.escape(str(value), quote=True)


def kit_items(family, size):
    if family["kind"] == "ip":
        return [
            (family["bullet"], size // 2), (family["dome"], size // 2),
            (family["nvr"][size], 1), (family["hdd"][size], 1),
            ("DS-1LN6UZC0(O-STD) orange 305m", IP_CABLE[size]),
            ("DS-1M6UA-15U(O-STD)/100PCS", 1), ("CLIPS-100", IP_CLIPS[size]),
        ]
    cable, rolls = HD_CABLE[size]
    return [
        (family["bullet"], size // 2), (family["dome"], size // 2),
        (family["dvr"][size], 1), (family["hdd"][size], 1),
        (HD_POWER[size], 1), (cable, rolls),
        ("CONN-SET", size), ("CLIPS-100", HD_CLIPS[size]),
    ]


def all_kits():
    """(id, name, items) for every size of every family, for checks and the admin."""
    return [(f"{f['id']}-{n}", f"{f['name']} {n}-camera kit", kit_items(f, n)) for f in HD_FAMILIES + IP_FAMILIES for n in SIZES]


def _wa(message):
    return f"https://wa.me/{PHONE.lstrip('+')}?text={urllib.parse.quote(message)}"


def _panel(family, size, by_model, checked):
    items = kit_items(family, size)
    missing = [m for m, _ in items if m not in by_model]
    if missing:
        raise SystemExit(f"kit {family['id']}-{size}: not in catalogue: {missing}")
    total = sum(by_model[m]["price"] * q for m, q in items)
    rows = "".join(
        f'<li><span>{q} &times; <a href="{esc(by_model[m]["url"])}">{esc(by_model[m]["name"].strip())}</a></span>'
        f'<span>KES {catalog.price_label(by_model[m]["price"] * q)}</span></li>'
        for m, q in items
    )
    kid = f"{family['id']}-{size}"
    name = f"{family['name']} {size}-camera kit"
    ask = _wa(f"Hi NE, I'm interested in the {name} (KES {catalog.price_label(total)}). Please send me an all-in price with installation.")
    cart = json.dumps([[by_model[m]["slug"], q] for m, q in items])
    return (f'<input type="radio" class="ks-r" name="ks-{family["id"]}" id="{kid}-r" value="{size}"{" checked" if checked else ""}>'
            f'<label class="ks-tab" for="{kid}-r">{size} cameras</label>'
            f"""<div class="ks-panel" id="{kid}">
          <div class="ks-for">{esc(SIZE_NOTE[size])}</div>
          <div class="kit-price" data-kes="{total}">KES {catalog.price_label(total)}<small>equipment</small></div>
          <ul>{rows}</ul>
          <button class="kit-add" type="button" data-add-kit="{esc(cart)}" hidden>Add {size}-camera kit to cart</button>
          <a class="kit-cta" href="{esc(ask)}" target="_blank" rel="noopener">Get this kit with installation</a>
        </div>""")


def family_html(family, by_model):
    tag = f'<span class="kit-flag">{esc(family["tag"])}</span>' if family.get("tag") else ""
    points = "".join(f"<li>{esc(p)}</li>" for p in family["points"])
    panels = "".join(_panel(family, n, by_model, n == 4) for n in SIZES)
    lowest = min(sum(by_model[m]["price"] * q for m, q in kit_items(family, n)) for n in SIZES)
    return f"""<article class="kit ks" id="{family['id']}" data-from="{lowest}">
      {tag}<div class="kit-shot kit-photo"><img src="/images/kits/{family['id']}.webp" alt="{esc(family['name'])} camera kit: {ALT[family['kind']]}" loading="lazy" decoding="async" width="400" height="300"></div>
      <div class="kit-for">{KIND[family['kind']]} &middot; bullet + dome</div>
      <h3>{esc(family['name'])}</h3>
      <p>{esc(family['summary'])}</p>
      <ul class="ks-points">{points}</ul>
      <div class="ks-sizes" role="group" aria-label="Kit size">{panels}</div>
    </article>"""


KIND = {"hd": "Turbo HD", "ip": "IP &middot; PoE"}
ALT = {"hd": "bullet and dome cameras, DVR, hard disk, power supply, cable, connectors and clips",
       "ip": "bullet and dome IP cameras, PoE NVR, hard disk, CAT6 cable, RJ45 plugs and clips"}


def kits_html(products, families):
    by_model = {p["model"].strip(): p for p in products}
    return "\n    ".join(family_html(f, by_model) for f in families)


def hd_kits_html(products):
    return kits_html(products, HD_FAMILIES)


def ip_kits_html(products):
    return kits_html(products, IP_FAMILIES)


def models():
    return sorted({m for _, _, items in all_kits() for m, _ in items})
