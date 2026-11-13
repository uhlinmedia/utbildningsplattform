"""Test av "Starta speakerrösten automatiskt": spärrat ljud ger knappen Tryck för att lyssna, efter ett tryck
startar nästa avsnitt av sig självt, och ett avsnitt som redan lyssnats klart startar inte igen.
Kör efter e2e.py med samma förutsättningar som speakerljud.py (tests/fake-storage.mjs och SUPABASE_*)."""
import os, math, struct, subprocess, wave
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

ljud1 = OUT + "/autostart-1.wav"; tone(ljud1, 20, 440)
ljud2 = OUT + "/autostart-2.wav"; tone(ljud2, 20, 550)
PLAYING = "(() => { const a = document.querySelector('.audio-mini audio'); return !!a && !a.paused && a.currentTime > 0; })()"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    a = ctx.new_page(); errors = []
    a.on("pageerror", lambda e: errors.append(str(e)))
    login(a, BASE)

    course_id = q("select id from course order by created_at limit 1")
    secs = q(f"select s.id from section s join chapter c on c.id = s.chapter_id where c.course_id = '{course_id}' order by c.position, s.position limit 2").split("\n")
    assert len(secs) == 2, secs
    for sid, f in zip(secs, [ljud1, ljud2]):
        a.goto(f"{BASE}/admin/utbildningar/{course_id}?s={sid}")
        card = a.locator(".card", has_text="Speakerröst")
        card.locator("input[type=file]").set_input_files(f)
        expect(card).to_contain_text(os.path.basename(f), timeout=15000)

    a.goto(f"{BASE}/admin/utbildningar/{course_id}?flik=installningar")
    box = a.locator("input[name=audio_autoplay]")
    expect(box).not_to_be_checked()
    box.check()
    a.get_by_role("button", name="Spara inställningar").click()
    a.wait_for_timeout(1500)
    assert q(f"select audio_autoplay from course where id = '{course_id}'") == "t"
    a.reload(); expect(a.locator("input[name=audio_autoplay]")).to_be_checked()
    step("inställningen Starta speakerrösten automatiskt sparas")
    q(f"update course set nav_mode = 'free' where id = '{course_id}'")

    slug = q(f"select slug from course where id = '{course_id}'")
    e = ctx.new_page(); e.on("pageerror", lambda x: errors.append(str(x)))
    e.goto(f"{BASE}/k/{slug}?forhandsvisning=1")
    if e.locator("input[name=name]").count():
        e.fill("input[name=name]", "Test Elev")
        if e.locator("input[name=email]").count(): e.fill("input[name=email]", "elev@exempel.se")
        e.get_by_role("button", name="Starta utbildningen").click()
        e.wait_for_url("**/kurs**")
        expect(e.get_by_role("heading", level=1)).to_be_visible()
    # Ny flik i en ny webbläsarsession (samma inloggning) utan något tryck: webbläsaren spärrar ljudet → knappen visas.
    # (Annars räknas klicket på Starta utbildningen, och då får ljudet starta direkt.)
    ectx = b.new_context(viewport={"width": 1280, "height": 900}, storage_state=ctx.storage_state())
    # Headless Chromium spärrar inte ljud, så spärren som riktiga webbläsare har (inget ljud innan eleven
    # tryckt någon gång på sidan) efterliknas här.
    ectx.add_init_script("""(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (!navigator.userActivation.hasBeenActive) return Promise.reject(new DOMException('spärrat', 'NotAllowedError'));
        return play.call(this);
      };
    })()""")
    e = ectx.new_page()
    e.on("pageerror", lambda x: errors.append(str(x)))
    e.goto(f"{BASE}/k/{slug}/kurs?s={secs[0]}")
    tap = e.get_by_role("button", name="Tryck för att lyssna")
    # Vänta utan att röra sidan: Playwrights sökningar räknas som en användargest och skulle låsa upp ljudet.
    e.wait_for_timeout(3000)
    expect(tap).to_be_visible(timeout=10000)
    step("spärrat ljud visar Tryck för att lyssna")
    tap.click(force=True)  # pratbubblan gungar (animation), så Playwright väntar annars förgäves på att den ska stå still
    e.wait_for_function(PLAYING, timeout=10000)
    expect(tap).to_have_count(0)
    step("trycket startar ljudet")

    # Till nästa avsnitt via menyn: startar av sig självt
    e.locator(f".nav-desktop a[href*='s={secs[1]}']").click()
    e.wait_for_url(f"**s={secs[1]}")
    e.wait_for_function(PLAYING, timeout=10000)
    assert secs[1] != secs[0]
    src = e.evaluate("document.querySelector('.audio-mini audio').src")
    assert q(f"select audio->>'path' from section where id = '{secs[1]}'") in src, src
    expect(e.get_by_role("button", name="Tryck för att lyssna")).to_have_count(0)
    step("nästa avsnitt startar automatiskt")

    # Avsnitt 1 markerat som lyssnat klart → startar inte igen
    e.evaluate(f"localStorage.setItem('briondo-ljud-klar-{secs[0]}', '1')")
    e.locator(f".nav-desktop a[href*='s={secs[0]}']").click()
    e.wait_for_url(f"**s={secs[0]}")
    e.wait_for_function("document.querySelector('.audio-mini audio')?.readyState >= 1", timeout=10000)
    e.wait_for_timeout(800)
    assert e.evaluate("document.querySelector('.audio-mini audio').paused") is True
    step("redan lyssnat avsnitt startar inte igen")

    # Avstängt: inget startar av sig självt
    q(f"update course set audio_autoplay = false where id = '{course_id}'")
    e.locator(f".nav-desktop a[href*='s={secs[1]}']").click()
    e.wait_for_url(f"**s={secs[1]}")
    e.wait_for_function("document.querySelector('.audio-mini audio')?.readyState >= 1", timeout=10000)
    e.wait_for_timeout(800)
    assert e.evaluate("document.querySelector('.audio-mini audio').paused") is True
    step("utan inställningen startar inget automatiskt")

    # Städa: ta bort testljuden och återställ
    for sid in secs:
        q(f"update section set audio = null where id = '{sid}'")
    q(f"update course set nav_mode = 'linear' where id = '{course_id}'")
    assert not errors, errors
    print("ALLA TESTER FÖR AUTOSTART GICK IGENOM")
