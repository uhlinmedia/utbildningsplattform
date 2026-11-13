"""Test av speakerröst per avsnitt: uppladdning, byte, fel filtyp, elevens spelare, kopiering och borttagning.
Kör efter e2e.py. Kräver tests/fake-storage.mjs igång och servern startad med
SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=sb_secret_test (samt DATABASE_URL för psql)."""
import re, os, json, math, struct, subprocess, urllib.request, wave
from konto import login
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
STORAGE = "http://localhost:54321"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

def step(msg): print("✓", msg, flush=True)
def flog(): return json.load(urllib.request.urlopen(STORAGE + "/__log"))
def q(sql): return subprocess.run(["psql", os.environ["DATABASE_URL"], "-Atc", sql], capture_output=True, text=True, check=True).stdout.strip()

def tone(path, seconds, hz):
    w = wave.open(path, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * hz * i / 8000))) for i in range(8000 * seconds)))
    w.close()

kort = OUT + "/speaker-kort.wav"; tone(kort, 12, 440)
lang = OUT + "/speaker-lang.wav"; tone(lang, 75, 330)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    a = ctx.new_page(); errors = []
    a.on("pageerror", lambda e: errors.append(str(e)))
    login(a, BASE)
    expect(a.get_by_role("heading", name="Kunder")).to_be_visible()

    course_id = q("select id from course order by created_at limit 1")
    sec_id = q(f"select s.id from section s join chapter c on c.id = s.chapter_id where c.course_id = '{course_id}' order by c.position, s.position limit 1")
    q(f"update section set audio = null where id = '{sec_id}'")
    a.goto(f"{BASE}/admin/utbildningar/{course_id}?s={sec_id}")
    card = a.locator(".card", has_text="Speakerröst")
    expect(card.get_by_role("button", name="Ladda upp ljudfil")).to_be_visible()
    card.locator("input[type=file]").set_input_files(kort)
    expect(card).to_contain_text("speaker-kort.wav · 0:12", timeout=15000)
    first = json.loads(q(f"select audio from section where id = '{sec_id}'"))
    assert first["mime"] == "audio/wav" and first["duration_s"] == 12 and first["size"] == os.path.getsize(kort), first
    assert first["path"] in flog()["files"]
    step("ljudfil uppladdad till Storage och kopplad till avsnittet")

    card.locator("input[type=file]").set_input_files(lang)
    expect(card).to_contain_text("speaker-lang.wav · 1:15", timeout=15000)
    second = json.loads(q(f"select audio from section where id = '{sec_id}'"))
    files = flog()["files"]
    assert first["path"] not in files and second["path"] in files, files
    step("byte av ljud tar bort den gamla filen")

    open(OUT + "/fel.txt", "w").write("hej")
    card.locator("input[type=file]").set_input_files(OUT + "/fel.txt")
    expect(card.get_by_role("alert")).to_contain_text("Bara MP3, M4A, AAC eller WAV")
    step("fel filtyp nekas")
    a.screenshot(path=OUT + "/speakerljud-admin.png", full_page=True)

    # Eleven (förhandsvisning från admin)
    slug = q(f"select slug from course where id = '{course_id}'")
    e = ctx.new_page(); e.on("pageerror", lambda x: errors.append(str(x)))
    e.goto(f"{BASE}/k/{slug}?forhandsvisning=1")
    if e.locator("input[name=name]").count():
        e.fill("input[name=name]", "Test Elev")
        if e.locator("input[name=email]").count(): e.fill("input[name=email]", "elev@exempel.se")
        e.get_by_role("button", name="Starta utbildningen").click()
        e.wait_for_url("**/kurs**")
        expect(e.get_by_role("heading", level=1)).to_be_visible()
    if not e.url.endswith(f"s={sec_id}"):
        e.goto(f"{BASE}/k/{slug}/kurs?s={sec_id}")
    player = e.locator(".audio-mini")
    expect(player).to_contain_text("Lyssna på avsnittet · 1:15")
    e.wait_for_function("document.querySelector('.audio-mini audio').readyState >= 1", timeout=10000)
    dur = e.evaluate("document.querySelector('.audio-mini audio').duration")
    assert 74 < dur < 76, dur
    assert e.locator(".audio-mini .speed").count() == 0  # hastigheten väljs i spelarens egen meny
    e.evaluate("document.querySelector('.audio-mini audio').playbackRate = 1.5")
    e.evaluate("(() => { const a = document.querySelector('.audio-mini audio'); a.currentTime = 30; a.dispatchEvent(new Event('pause')); })()")
    e.reload()
    e.wait_for_function("document.querySelector('.audio-mini audio').currentTime > 29", timeout=10000)
    assert e.evaluate("document.querySelector('.audio-mini audio').playbackRate") == 1.5
    step("elevens spelare: längd, hastighet och position sparas")
    e.screenshot(path=OUT + "/speakerljud-elev.png")
    e.evaluate("(() => { const d = document.createElement('div'); d.style.height = '3000px'; document.querySelector('.learn-content').appendChild(d); window.scrollTo(0, 2000); })()")
    r = e.evaluate("(() => { const r = document.querySelector('.audio-mini-btn').getBoundingClientRect(); return [r.left, r.right, r.bottom, innerWidth, innerHeight]; })()")
    assert r[1] <= r[3] and r[1] > r[3] - 120 and r[2] <= r[4] and r[2] > r[4] - 120, r
    step("knappen ligger kvar i nedre högra hörnet vid scroll")
    m = b.new_context(viewport={"width": 390, "height": 844}, storage_state=ctx.storage_state()).new_page()
    m.goto(f"{BASE}/k/{slug}/kurs?s={sec_id}")
    expect(m.locator(".audio-mini-btn")).to_be_visible()
    mid = m.evaluate("(() => { const r = document.querySelector('.audio-mini-btn').getBoundingClientRect(); return (r.left + r.right) / 2; })()")
    assert abs(mid - 195) < 2, mid
    step("mobil: knappen centrerad längst ned")
    m.screenshot(path=OUT + "/speakerljud-mobil.png")

    # Mörk kundfärg: knappen blir vit med ikonen i kundfärgen (annars smälter den ihop med den mörka fliken)
    cust_id = q(f"select customer_id from course where id = '{course_id}'")
    orig_color = q(f"select coalesce(color, '') from customer where id = '{cust_id}'")
    q(f"update customer set color = '#1b2430' where id = '{cust_id}'")
    e.reload()
    expect(e.locator(".audio-mini.is-light")).to_have_count(1)
    assert e.evaluate("getComputedStyle(document.querySelector('.audio-mini-btn')).backgroundColor") == "rgb(255, 255, 255)"
    q(f"update customer set color = '#0e7c74' where id = '{cust_id}'")
    e.reload()
    expect(e.locator(".audio-mini-btn")).to_be_visible()
    expect(e.locator(".audio-mini.is-light")).to_have_count(0)
    q(f"update customer set color = {('NULL' if not orig_color else repr(orig_color))} where id = '{cust_id}'")
    step("mörk kundfärg ger vit ljudknapp, ljus kundfärg behålls")

    # Kopiera utbildningen → ljudfilen kopieras
    cust = q(f"select customer_id from course where id = '{course_id}'")
    a.goto(f"{BASE}/admin/kunder/{cust}")
    a.locator("summary", has_text="Skapa från befintlig utbildning").click()
    a.locator("select[name=id]").select_option(course_id)
    a.get_by_role("button", name="Kopiera hit").click()
    a.wait_for_url(re.compile(r"/admin/utbildningar/(?!" + course_id + ")[0-9a-f-]+"))
    new_id = a.url.split("/admin/utbildningar/")[1].split("?")[0]
    copy_audio = json.loads(q(f"select s.audio from section s join chapter c on c.id = s.chapter_id where c.course_id = '{new_id}' and s.audio is not null"))
    assert copy_audio["path"] != second["path"] and copy_audio["path"] in flog()["files"], copy_audio
    step("kopiering av utbildningen kopierar ljudfilen")

    # Radera avsnittet i kopian → dess fil tas bort, originalets finns kvar
    copy_sec = q(f"select s.id from section s join chapter c on c.id = s.chapter_id where c.course_id = '{new_id}' and s.audio is not null")
    a.goto(f"{BASE}/admin/utbildningar/{new_id}?s={copy_sec}")
    a.get_by_role("button", name="Ta bort avsnittet").click()
    a.wait_for_timeout(2000)
    files = flog()["files"]
    assert copy_audio["path"] not in files and second["path"] in files, files
    step("raderat avsnitt tar bort sin ljudfil")

    # Ta bort ljudet i originalet
    a.goto(f"{BASE}/admin/utbildningar/{course_id}?s={sec_id}")
    a.once("dialog", lambda d: d.accept())
    a.locator(".card", has_text="Speakerröst").get_by_role("button", name="Ta bort").click()
    expect(a.locator(".card", has_text="Speakerröst").get_by_role("button", name="Ladda upp ljudfil")).to_be_visible()
    assert q(f"select audio is null from section where id = '{sec_id}'") == "t"
    assert second["path"] not in flog()["files"]
    e.reload(); expect(e.get_by_role("heading", level=1)).to_be_visible(); expect(e.locator(".audio-mini")).to_have_count(0)
    step("ta bort ljud (eleven ser ingen spelare)")
    assert not errors, errors
    print("ALLA TESTER FÖR SPEAKERLJUD GICK IGENOM")
