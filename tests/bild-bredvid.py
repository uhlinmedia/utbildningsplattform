"""Test av stående bild bredvid texten (B50). Skapar en egen utbildning direkt i databasen (kräver DATABASE_URL,
körs efter e2e.py som skapar kunden). Kontrollerar:
- stående bild + text efter: två kolumner på desktop, hela bilden syns utan att scrolla, texten börjar i höjd med bilden
- bilden står kvar (sticky) när texten scrollas
- stående bild utan text efter men med text före: texten före hamnar bredvid
- liggande bild: som förut (ovanför, full bredd)
- mobil och smal innehållsyta: under varandra, ingen sidledsscroll
- klick förstorar bilden, Esc stänger"""
import json, os, struct, subprocess, uuid, zlib
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

def step(msg): print("✓", msg, flush=True)
def q(sql): return subprocess.run(["psql", os.environ["DATABASE_URL"], "-qAtc", sql], capture_output=True, text=True, check=True).stdout.strip()

def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

def media(w, h, rgb):
    return q(f"insert into media (filename, mime, data) values ('bild.png', 'image/png', decode('{png(w, h, rgb).hex()}', 'hex')) returning id")

def lit(x): return "'" + json.dumps(x).replace("'", "''") + "'::jsonb"

LONG = "\n\n".join(f"Stycke {i}. Skärminställningen gäller den här spelaren. Här kan man ändra namn och plats, välja ort för väder och lägga ett schema som visar en annan slinga vissa dagar eller tider." for i in range(1, 16))

customer = q("select id from customer order by created_at limit 1")
assert customer, "kör e2e.py först"
slug = "bild-bredvid-" + uuid.uuid4().hex[:6]
course = q(f"""insert into course (customer_id, title, slug, access_mode, nav_mode, status, certificate_enabled)
               values ('{customer}', 'Bild bredvid', '{slug}', 'name', 'free', 'published', false) returning id""")
ch = q(f"insert into chapter (course_id, position, title) values ('{course}', 1, 'Skärmar') returning id")
portrait, square, landscape = media(900, 1600, (14, 124, 116)), media(1000, 1000, (245, 158, 11)), media(1600, 900, (60, 60, 180))

def section(pos, title, blocks):
    sid = q(f"insert into section (chapter_id, position, title) values ('{ch}', {pos}, '{title}') returning id")
    for i, (t, c) in enumerate(blocks):
        q(f"insert into block (section_id, position, type, content) values ('{sid}', {i + 1}, '{t}', {lit(c)})")
    return sid

s1 = section(1, "Inställningar", [
    ("image", {"media_id": portrait, "alt": "Skärmens inställningar", "caption": "Inställningar för en skärm"}),
    ("text", {"markdown": "**Skärminställning** Här kan man ändra namn och plats.\n\n" + LONG}),
    ("tip", {"text": "Tips: stäng av mejl för skärmar som stängs av på natten."}),
    ("image", {"media_id": landscape, "alt": "Liggande bild"}),
    ("text", {"markdown": "Text efter den liggande bilden."}),
])
s2 = section(2, "Text före bilden", [
    ("text", {"markdown": "Texten står före bilden i redigeraren."}),
    ("image", {"media_id": square, "alt": "Kvadratisk bild"}),
])

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    errors = []
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    e = ctx.new_page(); e.on("pageerror", lambda x: errors.append(str(x)))
    e.goto(f"{BASE}/k/{slug}")
    e.fill("input[name=name]", "Bo Bild")
    e.click("text=Starta utbildningen")
    e.wait_for_url("**/kurs**")

    split = e.locator(".media-split")
    expect(split).to_have_count(1)
    fig, text = split.locator("figure"), split.locator(".media-split-text")
    expect(text).to_contain_text("Skärminställning")
    expect(text.locator(".tip")).to_have_count(1)
    fb, tb = fig.bounding_box(), text.bounding_box()
    ib = fig.locator("img").bounding_box()
    assert tb["x"] > fb["x"] + fb["width"], (fb, tb)                # texten till höger
    assert abs(tb["y"] - fb["y"]) < 4, (fb, tb)                       # börjar i samma höjd
    assert ib["y"] + ib["height"] <= 900, ib                          # hela bilden ryms … (sidan scrollad till toppen)
    assert abs(ib["width"] / ib["height"] - 900 / 1600) < 0.01, ib     # … utan att förvrängas
    e.screenshot(path=OUT + "/bild-bredvid-desktop.png")
    step(f"stående bild till vänster ({ib['width']:.0f}×{ib['height']:.0f}), text och tips till höger")

    # Den liggande bilden: ovanför sin text, inte i en split
    land = e.locator(f".learn-content > figure img[src='/media/{landscape}']")
    expect(land).to_have_count(1)
    assert land.bounding_box()["width"] > 900
    step("liggande bild visas som förut (full bredd, ovanför texten)")

    # Sticky: scrolla ner i texten – bilden står kvar högst upp
    e.mouse.wheel(0, 900); e.wait_for_timeout(300)
    after = fig.bounding_box()
    assert 0 <= after["y"] <= 40, after
    step("bilden står kvar när texten scrollas")

    # Förstora
    e.mouse.wheel(0, -2000); e.wait_for_timeout(200)
    split.get_by_role("button", name="Visa bilden i full storlek: Skärmens inställningar").click()
    dlg = e.locator("dialog.img-zoom-dialog")
    expect(dlg).to_be_visible()
    big = dlg.locator("img").bounding_box()
    assert big["height"] > ib["height"] - 1 and big["height"] <= 900, big
    e.keyboard.press("Escape")
    expect(dlg).to_be_hidden()
    split.get_by_role("button", name="Visa bilden i full storlek: Skärmens inställningar").click()
    dlg.get_by_role("button", name="Stäng").click()
    expect(dlg).to_be_hidden()
    step("klick förstorar bilden; Esc och Stäng stänger")

    # Text före bilden
    e.goto(f"{BASE}/k/{slug}/kurs?s={s2}")
    split2 = e.locator(".media-split")
    expect(split2).to_have_count(1)
    expect(split2.locator(".media-split-text")).to_contain_text("Texten står före bilden")
    assert split2.locator(".media-split-text").bounding_box()["x"] > split2.locator("figure").bounding_box()["x"] + 100
    expect(e.locator(".learn-content > .prose")).to_have_count(0)
    step("kvadratisk bild utan text efter: texten före hamnar bredvid")

    # Smal innehållsyta (surfplatta på höjden) och mobil: under varandra, ingen sidledsscroll
    for w, h, name in [(820, 1180, "surfplatta"), (390, 844, "mobil")]:
        e.set_viewport_size({"width": w, "height": h})
        e.goto(f"{BASE}/k/{slug}/kurs?s={s1}")
        fig, text = e.locator(".media-split figure"), e.locator(".media-split-text")
        fb, tb = fig.bounding_box(), text.bounding_box()
        assert tb["y"] >= fb["y"] + fb["height"] - 1, (name, fb, tb)
        assert e.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), name
        ih = fig.locator("img").bounding_box()["height"]
        assert ih <= h * 0.85 + 1, (name, ih)
        e.screenshot(path=OUT + f"/bild-bredvid-{name}.png")
        step(f"{name}: bild ovanför texten, högst 85 % av skärmhöjden, ingen sidledsscroll")

    assert not errors, errors
    print("ALLA TESTER FÖR BILD BREDVID TEXT GICK IGENOM")
