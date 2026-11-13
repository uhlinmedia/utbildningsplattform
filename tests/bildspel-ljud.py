"""Test av bildspel som följer speakerrösten: tidsmarkering per bild ("Sätt nu" i editorn), varning vid fel
ordning, och att elevens bildspel byter bild när ljudet spelar eller spolas – utan att avbryta egen bläddring.
Kör efter e2e.py med samma förutsättningar som speakerljud.py (tests/fake-storage.mjs och SUPABASE_*)."""
import os, math, struct, subprocess, wave, zlib, json
from konto import login
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

def step(msg): print("✓", msg, flush=True)
def q(sql): return subprocess.run(["psql", os.environ["DATABASE_URL"], "-Atc", sql], capture_output=True, text=True, check=True).stdout.strip()

def tone(path, seconds, hz):
    w = wave.open(path, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * hz * i / 8000))) for i in range(8000 * seconds)))
    w.close()

def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

ljud = OUT + "/bildspel-ljud.wav"; tone(ljud, 20, 440)
bilder = []
for i, rgb in enumerate([(200, 60, 60), (60, 160, 60), (60, 60, 200)], 1):
    f = f"{OUT}/synk-bild{i}.png"; open(f, "wb").write(png(320, 180, rgb)); bilder.append(f)

AUDIO = "document.querySelector('.audio-mini audio')"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    a = ctx.new_page(); errors = []
    a.on("pageerror", lambda e: errors.append(str(e)))
    login(a, BASE)

    course_id = q("select id from course order by created_at limit 1")
    sec = q(f"select s.id from section s join chapter c on c.id = s.chapter_id where c.course_id = '{course_id}' order by c.position, s.position limit 1")
    a.goto(f"{BASE}/admin/utbildningar/{course_id}?s={sec}")
    card = a.locator(".card", has_text="Speakerröst")
    card.locator("input[type=file]").set_input_files(ljud)
    expect(card).to_contain_text("bildspel-ljud.wav", timeout=15000)

    n_sl = a.locator(".block-card:has(.slide-upload)").count()
    a.get_by_role("button", name="Bildspel (PDF/PPT)", exact=True).click()
    expect(a.locator(".block-card:has(.slide-upload)")).to_have_count(n_sl + 1)
    sl = a.locator(".block-card:has(.slide-upload)").last
    with a.expect_file_chooser() as fc:
        sl.get_by_role("button", name="Välj bilder …").click()
    fc.value.set_files(bilder)
    expect(sl).to_contain_text("3 bilder tillagda", timeout=30000)
    expect(sl.locator(".slide-list li")).to_have_count(3)
    expect(sl.locator("input[name=at_1]")).to_be_visible()
    expect(sl).to_contain_text("Följ speakerrösten")
    step("editorn visar Visa vid och Sätt nu när avsnittet har speakerröst")

    # Sätt nu: hämtar tiden från editorns ljudspelare
    a.wait_for_function("document.querySelector('audio[data-avsnittsljud]').readyState >= 1", timeout=10000)
    a.evaluate("document.querySelector('audio[data-avsnittsljud]').currentTime = 4.2")
    a.wait_for_timeout(300)
    sl.locator(".slide-list li").nth(1).get_by_role("button", name="Sätt nu").click()
    expect(sl.locator("input[name=at_1]")).to_have_value("0:04,2")
    sl.locator("input[name=at_2]").fill("0:08")
    sl.get_by_role("button", name="Spara block").click()
    a.wait_for_timeout(1500)
    block_id = q(f"select id from block where section_id = '{sec}' and type = 'slides' order by position desc limit 1")
    ats = [s.get("at") for s in json.loads(q(f"select content->'slides' from block where id = '{block_id}'"))]
    assert ats == [None, 4.2, 8], ats
    step("Sätt nu och inskriven tid sparas (0:04,2 och 0:08)")

    sl = a.locator(".block-card:has(.slide-upload)").last
    sl.locator("input[name=at_2]").fill("0:02")
    sl.get_by_role("button", name="Spara block").click()
    expect(a.locator(".block-card:has(.slide-upload)").last).to_contain_text("Tiderna ska öka", timeout=10000)
    sl = a.locator(".block-card:has(.slide-upload)").last
    sl.locator("input[name=at_2]").fill("8")
    sl.get_by_role("button", name="Spara block").click()
    expect(a.locator(".block-card:has(.slide-upload)").last).not_to_contain_text("Tiderna ska öka", timeout=10000)
    step("varning när tiderna inte ökar i bildernas ordning")
    a.locator(".block-card:has(.slide-upload)").last.screenshot(path=OUT + "/bildspel-ljud-editor.png")

    # Eleven
    q(f"update course set nav_mode = 'free' where id = '{course_id}'")
    slug = q(f"select slug from course where id = '{course_id}'")
    e = ctx.new_page(); e.on("pageerror", lambda x: errors.append(str(x)))
    e.goto(f"{BASE}/k/{slug}?forhandsvisning=1")
    if e.locator("input[name=name]").count():
        e.fill("input[name=name]", "Test Elev")
        if e.locator("input[name=email]").count(): e.fill("input[name=email]", "elev@exempel.se")
        e.get_by_role("button", name="Starta utbildningen").click()
        e.wait_for_url("**/kurs**")
    e.goto(f"{BASE}/k/{slug}/kurs?s={sec}")
    show = e.locator("figure.slides").last
    count = show.locator(".slides-count")
    expect(show).to_contain_text("Bilderna byts i takt med speakerrösten")
    e.wait_for_function(f"{AUDIO}?.readyState >= 1", timeout=10000)
    e.evaluate(f"{AUDIO}.pause()")

    for t, want in [(5, "Bild 2 av 3"), (9, "Bild 3 av 3"), (1, "Bild 1 av 3"), (4.3, "Bild 2 av 3")]:
        e.evaluate(f"{AUDIO}.currentTime = {t}")
        expect(count).to_have_text(want, timeout=5000)
    step("spolning i ljudet visar rätt bild")

    e.evaluate(f"(() => {{ const a = {AUDIO}; a.muted = true; a.currentTime = 3; a.play(); }})()")
    e.wait_for_function(f"{AUDIO}.currentTime > 3.2", timeout=5000)
    expect(count).to_have_text("Bild 1 av 3", timeout=5000)
    expect(count).to_have_text("Bild 2 av 3", timeout=5000)
    step("bildspelet byter bild när ljudet passerar markeringen")

    # Egen bläddring får vara kvar tills nästa markering
    show.get_by_role("button", name="Föregående bild").click()
    expect(count).to_have_text("Bild 1 av 3")
    e.wait_for_timeout(1500)
    assert e.evaluate(f"{AUDIO}.currentTime") < 7.5
    expect(count).to_have_text("Bild 1 av 3")
    expect(count).to_have_text("Bild 3 av 3", timeout=8000)
    step("egen bläddring avbryts inte förrän nästa markering passeras")
    e.evaluate(f"{AUDIO}.pause()")
    e.screenshot(path=OUT + "/bildspel-ljud-elev.png")

    # Utan speakerröst följer bildspelet inget
    q(f"update section set audio = null where id = '{sec}'")
    e.reload()
    expect(e.locator("figure.slides").last).not_to_contain_text("Bilderna byts i takt med speakerrösten")
    a.reload()
    expect(a.locator(".block-card:has(.slide-upload)").last.locator("input[name=at_1]")).to_have_count(0)
    step("utan speakerröst: inga tidsfält i editorn och bildspelet bläddras som vanligt")

    q(f"delete from block where id = '{block_id}'")
    q(f"update course set nav_mode = 'linear' where id = '{course_id}'")
    assert not errors, errors
    print("ALLA TESTER FÖR BILDSPEL MED SPEAKERRÖST GICK IGENOM")
