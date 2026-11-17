"""Test av bildblockens placering och storlek (B50 automatiskt, B51 valt i editorn). Skapar en egen utbildning direkt i databasen (kräver DATABASE_URL,
körs efter e2e.py som skapar kunden). Kontrollerar:
- stående bild + text efter: två kolumner på desktop, hela bilden syns utan att scrolla, texten börjar i höjd med bilden
- bilden står kvar (sticky) när texten scrollas
- stående bild utan text efter men med text före: texten före hamnar bredvid
- liggande bild: som förut (ovanför, full bredd)
- mobil och smal innehållsyta: under varandra, ingen sidledsscroll
- klick förstorar bilden, Esc stänger
- B51: Till höger + Mellan, Ovanför för stående bild, Liten ovanför, förstoring på alla bilder, valen sparas i editorn"""
from konto import login
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

s3 = section(3, "Valda placeringar", [
    ("image", {"media_id": landscape, "alt": "Liggande till höger", "layout": "right", "size": "m"}),
    ("text", {"markdown": "Text till vänster om en liggande bild."}),
    ("image", {"media_id": portrait, "alt": "Stående ovanför", "layout": "above", "size": "s"}),
    ("text", {"markdown": "Text under den lilla stående bilden."}),
    ("image", {"media_id": portrait, "alt": "Stående stor bredvid", "size": "l"}),
    ("text", {"markdown": "Text bredvid en stor stående bild."}),
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
    split.get_by_role("button", name="Skärmens inställningar (visa i full storlek)").click()
    dlg = split.locator("dialog.img-zoom-dialog")
    expect(dlg).to_be_visible()
    big = dlg.locator("img").bounding_box()
    assert big["height"] > ib["height"] - 1 and big["height"] <= 900, big
    e.keyboard.press("Escape")
    expect(dlg).to_be_hidden()
    split.get_by_role("button", name="Skärmens inställningar (visa i full storlek)").click()
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

    # --- B51: valda placeringar och storlekar ---
    e.goto(f"{BASE}/k/{slug}/kurs?s={s3}")
    cw = e.locator(".learn-content").bounding_box()["width"]
    splits = e.locator(".media-split")
    expect(splits).to_have_count(2)
    r = splits.nth(0)
    rf, rt = r.locator("figure").bounding_box(), r.locator(".media-split-text").bounding_box()
    assert rf["x"] > rt["x"] + rt["width"], (rf, rt)                   # bilden till höger
    assert abs(rf["width"] / cw - 0.35) < 0.03, (rf["width"], cw)       # Mellan bredvid text ≈ 35 %
    step(f"liggande bild Till höger + Mellan: bilden till höger, {rf['width'] / cw:.0%} av bredden")
    small = e.locator(".learn-content > figure.size-s")
    expect(small).to_have_count(1)
    sb = small.bounding_box()
    assert abs(sb["width"] / cw - 0.33) < 0.03, (sb, cw)
    assert sb["height"] > sb["width"]
    step(f"stående bild Ovanför + Liten: ovanför texten, {sb['width'] / cw:.0%} av bredden")
    big = splits.nth(1)
    bf = big.locator("figure").bounding_box()
    assert abs(bf["width"] / cw - 0.50) < 0.03, (bf, cw)
    assert big.locator("img").bounding_box()["height"] > 900                # Stor: ingen höjdgräns
    expect(big.locator("figure")).to_have_css("position", "static")         # står inte kvar (kan vara högre än skärmen)
    step("stående bild Stor bredvid text: halva bredden, ingen höjdgräns, inte sticky")
    # Förstoring finns på alla bilder, även liggande ovanför texten
    e.goto(f"{BASE}/k/{slug}/kurs?s={s1}")
    e.get_by_role("button", name="Liggande bild (visa i full storlek)").click()
    expect(e.locator("dialog.img-zoom-dialog[open]")).to_have_count(1)
    e.keyboard.press("Escape")
    expect(e.locator("dialog.img-zoom-dialog[open]")).to_have_count(0)
    step("förstoring finns även på liggande bild ovanför texten")
    e.set_viewport_size({"width": 1440, "height": 900})

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

    # Mobil: valda storlekar blir 50/75/100 %, bilden till höger hamnar ändå ovanför texten
    e.goto(f"{BASE}/k/{slug}/kurs?s={s3}")
    cw = e.locator(".learn-content").bounding_box()["width"]
    r = e.locator(".media-split").nth(0)
    rf, rt = r.locator("figure").bounding_box(), r.locator(".media-split-text").bounding_box()
    assert rt["y"] >= rf["y"] + rf["height"] - 1 and abs(rf["width"] / cw - 0.75) < 0.03, (rf, rt, cw)
    assert abs(e.locator(".learn-content > figure.size-s").bounding_box()["width"] / cw - 0.5) < 0.03
    assert e.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    step("mobil: Mellan 75 %, Liten 50 %, bild alltid ovanför texten")

    # --- Editorn: placering och storlek sparas ---
    a = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    a.on("pageerror", lambda x: errors.append(str(x)))
    login(a, BASE)
    a.goto(f"{BASE}/admin/utbildningar/{course}?s={s1}")
    card = a.locator(".block-card:has(select[name=layout])").first
    expect(card).to_contain_text("Bilden är stående (900×1600 px) och visas bredvid texten")
    expect(card.locator("select[name=layout]")).to_have_value("auto")
    card.locator("select[name=layout]").select_option("right")
    card.locator("select[name=size]").select_option("full")
    expect(a.locator(".unsaved-bar")).to_have_count(1)
    card.get_by_role("button", name="Spara block").click()
    expect(card.locator("form[data-status=sparat]")).to_have_count(1)
    c = json.loads(q(f"select content from block where section_id = '{s1}' and position = 1"))
    assert c.get("layout") == "right" and c.get("size") == "full" and c.get("alt") == "Skärmens inställningar", c
    card.locator("select[name=layout]").select_option("auto")
    card.locator("select[name=size]").select_option("auto")
    card.get_by_role("button", name="Spara block").click()
    a.wait_for_timeout(1500)
    c = json.loads(q(f"select content from block where section_id = '{s1}' and position = 1"))
    assert "layout" not in c and "size" not in c, c
    a.screenshot(path=OUT + "/bild-editor.png")
    step("editorn: Placering och Storlek sparas (Automatiskt sparas som tomt), hjälptext visar bildens format")

    assert not errors, errors
    print("ALLA TESTER FÖR BILDBLOCK GICK IGENOM")
