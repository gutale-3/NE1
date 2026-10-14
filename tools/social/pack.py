"""Weekly social media pack for NE (Instagram, Facebook, TikTok, YouTube Shorts).

    python3 tools/social/pack.py 2026-10-19 /tmp/pack

The date is the Monday of the week the posts are for. Each week rotates to the
next kit, products, tip and "why NE" message, so packs don't repeat for months.
Prices come from the live catalogue (data/products.json), so they are current.

Output (in the folder given):
    1-kit.jpg, 2-product.jpg, 3-tip.jpg, 4-why-ne.jpg   1080x1350 feed posts
    reel-1-kit.mp4, reel-2-products.mp4                 1080x1920 vertical videos
    captions.txt                                        captions, hashtags, when to post
Needs node with Playwright (tools/social/render.js) and ffmpeg.
"""
import datetime as dt
import html
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import catalog  # noqa: E402
import kits_page  # noqa: E402

START = dt.date(2026, 10, 19)          # week 0
WHATSAPP = "0737 454 891"
SITE = "nashnaal.com"
TAGS = "#Hikvision #CCTVKenya #Nairobi #SecurityCameras #Eastleigh #NashnaalElectronics"

TIPS = [
    ("Where to put your cameras", ["Cover every entrance first: gate, front door, back door.", "Mount at 2.5 to 3 m: high enough to stop tampering, low enough to see faces.", "Don't point cameras straight at the sun or bright lights."]),
    ("How much hard disk do you need?", ["4 cameras at 1080p: about 10 to 14 days on 1 TB.", "8 cameras at 1080p: about 10 to 14 days on 2 TB.", "Higher resolution (3K, 4MP+) needs more space. Ask us to size it."]),
    ("ColorVu vs infrared", ["Infrared: clear black-and-white at night.", "ColorVu: full colour at night with a soft warm light.", "Colour helps identify clothes, cars and faces."]),
    ("Watch your cameras on your phone", ["Install Hik-Connect on Android or iPhone.", "Scan the QR code on your recorder.", "See live video and playback from anywhere."]),
    ("Turbo HD or IP cameras?", ["Turbo HD: coax cable, lowest cost, great for homes and shops.", "IP: network cable with PoE, sharper images, smart features.", "Not sure? Send us your site details on WhatsApp."]),
    ("Protect your recorder", ["Keep the DVR/NVR in a locked, ventilated place.", "Use a UPS so power cuts don't stop recording.", "Change the default password on day one."]),
    ("Why audio cameras help", ["Hear what happens, not just see it.", "Useful for shops, counters and gates.", "Our audio kits record sound with the video."]),
    ("Night coverage, explained", ["IR range tells you how far the camera sees in the dark.", "20 m suits homes and shops; 40 m suits compounds and car parks.", "Strobe and siren cameras scare intruders away."]),
    ("Avoid fake Hikvision", ["Buy from an authorized distributor.", "Check the serial number on hikvision.com.", "Genuine stock comes with the manufacturer warranty."]),
    ("Power and cable tips", ["Use pure copper coax for long runs.", "One good power supply beats many small adapters.", "PoE switches power IP cameras over the network cable."]),
    ("Smart detection", ["AcuSense cameras tell people and vehicles apart.", "Fewer false alarms from leaves, rain and animals.", "Get alerts on your phone only when it matters."]),
    ("Check your system monthly", ["Look at each camera: clean lenses, right angle.", "Play back a recording to confirm it saves.", "Check the hard disk status on the recorder."]),
]

WHY = [
    ("Hikvision Authorized National Distributor", "Genuine Hikvision stock with the manufacturer warranty, straight from the source.", "assets/partner/authorized-national-distributor-certificate.webp"),
    ("Visit our showroom", "BBS Mall, Shop GFE 61, General Waruingi Street, Eastleigh. See cameras working before you buy.", "assets/showroom/showroom-inside.webp"),
    ("Best Distribution Partner 2025", "Recognised by Hikvision for distribution across Kenya.", "assets/partner/best-distribution-partner-award-2025.webp"),
    ("Certified technicians", "Hikvision-certified installers for homes, shops, schools and businesses.", "assets/partner/hikvision-certified-technician.webp"),
    ("Delivery across Kenya", "Free delivery in Nairobi. Fast courier or bus to every town.", "assets/showroom/storefront-gfe61.webp"),
    ("Trade partner prices", "Installers and resellers: apply at nashnaal.com/partners for agreed trade prices.", "assets/showroom/showroom-front.webp"),
]

# Products worth a spotlight: cameras, recorders and intercoms with photos.
SPOT_CATS = ("CCTV-IP", "CCTV-Turbo HD", "Video Intercom", "Access Control")


def money(n):
    return f"KES {round(n):,}"


def e(text):
    return html.escape(str(text))


def file_url(rel):
    return (ROOT / rel).resolve().as_uri()


CSS = """
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap');
*{box-sizing:border-box;margin:0}
body{width:W;height:H;font-family:Inter,Arial,sans-serif;color:#10202E;background:#F6F8FA;overflow:hidden}
.top{display:flex;align-items:center;gap:18px;padding:44px 56px 0}
.top img{width:84px;height:84px;border-radius:18px;background:#fff;padding:6px}
.top b{font-size:34px;font-weight:900;letter-spacing:-.5px}.top small{display:block;font-size:22px;color:#4A5B68;font-weight:600}
.tag{display:inline-block;background:#EB6834;color:#fff;font-weight:900;font-size:26px;letter-spacing:2px;text-transform:uppercase;padding:10px 22px;border-radius:999px}
h1{font-size:76px;line-height:1.02;font-weight:900;letter-spacing:-2px}
.price{font-size:88px;font-weight:900;color:#086E9E;letter-spacing:-2px;white-space:nowrap}
.foot{position:absolute;left:0;right:0;bottom:0;background:#0F2A3D;color:#fff;padding:30px 56px;display:flex;justify-content:space-between;align-items:center;font-size:30px;font-weight:800}
.foot span{color:#22C35E}
ul{list-style:none;padding:0}li{font-size:34px;font-weight:700;padding:12px 0 12px 54px;position:relative;line-height:1.25}
li:before{content:'';position:absolute;left:0;top:18px;width:30px;height:30px;border-radius:50%;background:#1baf7a}
"""


def page(w, h, body):
    return f"<!doctype html><html><head><meta charset=utf-8><style>{CSS.replace('W', f'{w}px').replace('H', f'{h}px')}</style></head><body>{body}</body></html>"


def header():
    return (f'<div class="top"><img src="{file_url("assets/nashnaal-logo-header.webp")}"><div><b>Nashnaal Electronics</b>'
            '<small>Hikvision Authorized National Distributor</small></div></div>')


def footer():
    return f'<div class="foot"><div>WhatsApp <span>{WHATSAPP}</span></div><div>{SITE}</div></div>'


def kit_of_week(i, by_model):
    fams = kits_page.HD_FAMILIES + kits_page.IP_FAMILIES
    fam = fams[i % len(fams)]
    sizes = fam.get("sizes", kits_page.SIZES)
    size = sizes[(i // len(fams)) % len(sizes)] if len(sizes) > 1 else sizes[0]
    items = kits_page.kit_items(fam, size)
    total = sum(by_model[m]["price"] * q for m, q in items)
    img = f"images/kits/{fam['id']}.webp"
    if not (ROOT / img).exists():
        img = "images/kits/" + ("ip-starter.webp" if fam["kind"] == "ip" else "hd-basic.webp")
    return {"fam": fam, "size": size, "total": total, "img": img,
            # A non-breaking hyphen keeps "4-camera" together on one line.
            "name": f"{fam['name']} {size}\u2011camera kit", "kind": "IP / PoE" if fam["kind"] == "ip" else "Turbo HD"}


def spotlights(i, products):
    pool = sorted((p for p in products if p["category"] in SPOT_CATS and p.get("image") and p["price"] > 0), key=lambda p: p["slug"])
    step = len(pool) // 7 or 1
    return [pool[(i * 3 + k * step) % len(pool)] for k in range(3)]


def build(monday, out):
    out.mkdir(parents=True, exist_ok=True)
    i = max(0, (monday - START).days // 7)
    products = catalog.load()
    by_model = {p["model"]: p for p in products}
    kit = kit_of_week(i, by_model)
    spots = spotlights(i, products)
    tip = TIPS[i % len(TIPS)]
    why = WHY[i % len(WHY)]
    slides = {}

    # 1. Kit of the week
    points = "".join(f"<li>{e(p)}</li>" for p in kit["fam"]["points"])
    slides["1-kit"] = (1080, 1350, page(1080, 1350, header() + f"""
<div style="padding:30px 56px 0"><span class="tag">Kit of the week</span>
<h1 style="margin-top:22px">{e(kit['name'])}</h1>
<div style="font-size:30px;color:#4A5B68;font-weight:700;margin-top:8px">{e(kit['kind'])} · everything included</div></div>
<img src="{file_url(kit['img'])}" style="display:block;width:968px;height:500px;object-fit:contain;margin:16px auto 0">
<div style="padding:0 56px;display:flex;justify-content:space-between;align-items:flex-end;gap:30px">
<ul>{points}</ul><div style="text-align:right"><div style="font-size:26px;font-weight:800;color:#4A5B68">Complete kit</div><div class="price">{money(kit['total'])}</div></div></div>
""" + footer()))

    # 2. Product spotlight (the first of this week's three)
    p = spots[0]
    feats = [f.strip() for f in str(p.get("features") or "").replace(";", ",").split(",") if f.strip()][:3]
    slides["2-product"] = (1080, 1350, page(1080, 1350, header() + f"""
<div style="padding:30px 56px 0"><span class="tag" style="background:#086E9E">Product spotlight</span>
<h1 style="margin-top:22px;font-size:64px">{e(p['name'].strip())}</h1>
<div style="font-size:28px;color:#4A5B68;font-weight:700;margin-top:8px">{e(p['model'])}</div></div>
<img src="{file_url(p['image'])}" style="display:block;width:760px;height:560px;object-fit:contain;margin:20px auto 0">
<div style="padding:0 56px;display:flex;justify-content:space-between;align-items:flex-end;gap:30px">
<ul>{''.join(f'<li>{e(f)}</li>' for f in feats)}</ul><div class="price">{money(p['price'])}</div></div>
""" + footer()))

    # 3. Tip
    slides["3-tip"] = (1080, 1350, page(1080, 1350, header() + f"""
<div style="position:absolute;top:150px;bottom:110px;left:56px;right:56px;display:flex;flex-direction:column;justify-content:center"><div><span class="tag" style="background:#1baf7a">Security tip</span></div>
<h1 style="margin-top:30px;font-size:86px">{e(tip[0])}</h1>
<ul style="margin-top:50px">{''.join(f'<li style="font-size:40px;padding-bottom:26px">{e(t)}</li>' for t in tip[1])}</ul>
<div style="margin-top:40px;font-size:34px;font-weight:800;color:#086E9E">Questions? WhatsApp us, we reply fast.</div></div>
""" + footer()))

    # 4. Why NE
    slides["4-why-ne"] = (1080, 1350, page(1080, 1350, f"""
<img src="{file_url(why[2])}" style="position:absolute;inset:0;width:1080px;height:1350px;object-fit:cover">
<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,42,61,.15) 30%,rgba(15,42,61,.95) 72%)"></div>
<div style="position:absolute;left:56px;right:56px;bottom:150px;color:#fff">
<span class="tag" style="background:#eda100;color:#10202E">Why NE</span>
<h1 style="margin-top:24px;font-size:80px">{e(why[0])}</h1>
<div style="font-size:38px;font-weight:600;margin-top:20px;line-height:1.35;color:#E8F2F8">{e(why[1])}</div></div>
""" + footer()))

    # Vertical video slides (1080x1920)
    def vslide(inner):
        return (1080, 1920, page(1080, 1920, header() + inner + footer()))

    slides["v1-a"] = vslide(f"""<div style="padding:260px 70px 0;text-align:center"><span class="tag">Kit of the week</span>
<h1 style="margin-top:40px;font-size:110px">Complete CCTV.<br>One price.</h1>
<div style="font-size:46px;font-weight:700;color:#4A5B68;margin-top:40px">Cameras, recorder, storage,<br>cable and fittings.</div></div>""")
    slides["v1-b"] = vslide(f"""<div style="padding:80px 56px 0;text-align:center"><h1 style="font-size:84px">{e(kit['name'])}</h1>
<img src="{file_url(kit['img'])}" style="display:block;width:1000px;height:820px;object-fit:contain;margin:40px auto 0">
<div class="price" style="font-size:120px">{money(kit['total'])}</div>
<div style="font-size:38px;font-weight:700;color:#4A5B68">{e(' · '.join(kit['fam']['points']))}</div></div>""")
    slides["v1-c"] = vslide(f"""<div style="padding:420px 70px 0;text-align:center"><h1 style="font-size:100px">Order on WhatsApp</h1>
<div class="price" style="font-size:110px;color:#22C35E;margin-top:40px">{WHATSAPP}</div>
<div style="font-size:48px;font-weight:800;margin-top:40px">{SITE}/kits</div>
<div style="font-size:38px;font-weight:600;color:#4A5B68;margin-top:30px">Free delivery in Nairobi</div></div>""")
    for k, sp in enumerate(spots):
        slides[f"v2-{k}"] = vslide(f"""<div style="padding:90px 56px 0;text-align:center"><span class="tag" style="background:#086E9E">{k + 1} of 3</span>
<h1 style="margin-top:30px;font-size:72px">{e(sp['name'].strip())}</h1>
<div style="font-size:34px;color:#4A5B68;font-weight:700;margin-top:14px">{e(sp['model'])}</div>
<img src="{file_url(sp['image'])}" style="display:block;width:900px;height:860px;object-fit:contain;margin:30px auto 0">
<div class="price" style="font-size:120px">{money(sp['price'])}</div></div>""")
    slides["v2-c"] = slides["v1-c"]

    for name, (w, h, doc) in slides.items():
        (out / f"{name}.html").write_text(doc, encoding="utf-8")
    subprocess.run(["node", str(ROOT / "tools/social/render.js"), str(out)] + [f"{n}:{w}x{h}" for n, (w, h, _) in slides.items()], check=True)
    reel(out, ["v1-a", "v1-b", "v1-c"], out / "reel-1-kit.mp4")
    reel(out, ["v2-0", "v2-1", "v2-2", "v2-c"], out / "reel-2-products.mp4")
    for f in out.glob("v*.jpg"):
        f.unlink()
    for f in out.glob("*.html"):
        f.unlink()

    week = monday.strftime("%-d %B %Y")
    spot_lines = "\n".join(f"  {k + 1}. {sp['name'].strip()} ({sp['model']}): {money(sp['price'])}" for k, sp in enumerate(spots))
    (out / "captions.txt").write_text(f"""NE social media pack: week of {week}
Post the feed images on Instagram and Facebook (Meta Business Suite), and the reels on Instagram Reels, Facebook Reels, TikTok and YouTube Shorts.
Suggested times: 7:00 pm (Mon, Wed, Fri, Sat). Prices are this week's website prices.

1-kit.jpg  (Monday)
Kit of the week: {kit['name']}, {money(kit['total'])} complete.
{kit['fam']['summary']}
Cameras, recorder{'' if not kit['fam'].get('hdd') else ', hard disk'}, power, cable and fittings, all in one price. Installation available.
Order on WhatsApp {WHATSAPP} or see every kit at {SITE}/kits
{TAGS} #CCTVKits

2-product.jpg  (Wednesday)
Product spotlight: {spots[0]['name'].strip()} ({spots[0]['model']}), {money(spots[0]['price'])}.
Genuine Hikvision with the manufacturer warranty, from the Authorized National Distributor.
Order on WhatsApp {WHATSAPP} or at {SITE}
{TAGS}

3-tip.jpg  (Friday)
Security tip: {tip[0]}
{chr(10).join('- ' + t for t in tip[1])}
Save this post, and WhatsApp {WHATSAPP} if you want advice for your home or business.
{TAGS} #SecurityTips

4-why-ne.jpg  (Saturday)
{why[0]}. {why[1]}
Nashnaal Electronics, BBS Mall Shop GFE 61, Eastleigh, Nairobi. WhatsApp {WHATSAPP}.
{TAGS}

reel-1-kit.mp4  (Tuesday)
Title / caption: Complete CCTV kit, one price: {kit['name']} {money(kit['total'])}. WhatsApp {WHATSAPP} #Hikvision #CCTV #Kenya #Nairobi
Tip: add a trending sound in the app before posting.

reel-2-products.mp4  (Thursday)
Title / caption: 3 Hikvision picks this week, prices included. WhatsApp {WHATSAPP} #Hikvision #CCTV #Kenya
{spot_lines}
""", encoding="utf-8")
    return out


def reel(out, names, dest, seconds=3.5, fade=0.5):
    """Slides -> a vertical H.264 video with crossfades (no sound; add a trending sound in the app)."""
    inputs, filters = [], []
    for k, n in enumerate(names):
        inputs += ["-loop", "1", "-t", str(seconds), "-i", str(out / f"{n}.jpg")]
        filters.append(f"[{k}:v]scale=1080:1920,fps=30,setsar=1,format=yuv420p[s{k}]")
    chain, last = [], "s0"
    for k in range(1, len(names)):
        offset = k * (seconds - fade)
        chain.append(f"[{last}][s{k}]xfade=transition=fade:duration={fade}:offset={offset:.2f}[x{k}]")
        last = f"x{k}"
    graph = ";".join(filters + chain)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", f"[{last}]",
                    "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "24", "-movflags", "+faststart", str(dest)], check=True)


if __name__ == "__main__":
    monday = dt.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else dt.date.today() + dt.timedelta(days=7 - dt.date.today().weekday())
    folder = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else f"/tmp/ne-social-{monday}")
    print(build(monday, folder))
