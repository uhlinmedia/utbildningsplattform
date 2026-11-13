"""Test av AI-uppläsning (Gemini TTS) i editorn: förifylld text, röst och stil skickas till Google, lång text delas
upp, MP3 sparas i Storage och kopplas till avsnittet, felmeddelanden, och att eleven får spelaren.
Kör efter e2e.py. Kräver tests/fake-storage.mjs och tests/fake-gemini.mjs igång och servern startad med
SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=sb_secret_test
GEMINI_API_BASE=http://localhost:54322 GEMINI_API_KEY=test-nyckel (samt DATABASE_URL för psql)."""
import os, json, subprocess, urllib.request
from konto import login
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
STORAGE = "http://localhost:54321"
GEMINI = "http://localhost:54322"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

def step(msg): print("✓", msg, flush=True)
def q(sql): return subprocess.run(["psql", os.environ["DATABASE_URL"], "-Atc", sql], capture_output=True, text=True, check=True).stdout.strip()
def glog(): return json.load(urllib.request.urlopen(GEMINI + "/__log"))["log"]
def slog(): return json.load(urllib.request.urlopen(STORAGE + "/__log"))

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    a = ctx.new_page(); errors = []
    a.on("pageerror", lambda e: errors.append(str(e)))
    login(a, BASE)

    course_id = q("select id from course order by created_at limit 1")
    sec = q(f"select s.id from section s join chapter c on c.id = s.chapter_id where c.course_id = '{course_id}' order by c.position, s.position limit 1")
    q(f"update section set audio = null where id = '{sec}'")
    a.goto(f"{BASE}/admin/utbildningar/{course_id}?s={sec}")
    card = a.locator(".card", has_text="Speakerröst")
    panel = card.locator("details.ai-voice")
    expect(panel).to_have_attribute("open", "")
    expect(panel.locator("summary")).to_have_text("Skapa röst från text (AI-uppläsning)")
    prefilled = panel.locator("textarea[name=ai_text]").input_value()
    assert prefilled.strip(), "texten ska vara förifylld med avsnittets text"
    assert "**" not in prefilled and "#" not in prefilled, prefilled
    expect(panel.locator("input[name=ai_style]")).to_have_value("Lugn, tydlig och vänlig utbildningsröst på svenska, i ett behagligt tempo.")
    step("panelen för AI-uppläsning visas med förifylld text och stil")

    n0 = len(glog())
    text = "Hej och välkommen till kursen. Det här är ett test av AI-rösten."
    panel.locator("textarea[name=ai_text]").fill(text)
    panel.locator("select[name=ai_voice]").select_option("Sulafat")
    panel.locator("input[name=ai_style]").fill("Varm och lugn")
    panel.get_by_role("button", name="Skapa AI-röst").click()
    expect(card).to_contain_text("AI-röst (Sulafat).mp3", timeout=30000)
    calls = glog()[n0:]
    assert len(calls) == 1, calls
    c = calls[0]
    assert c["model"] == "gemini-3.8-flash-tts" and c["voice"] == "Sulafat" and c["style"] == "Varm och lugn" and c["key"] == "test-nyckel", c
    assert c["format"]["type"] == "audio", c
    audio = json.loads(q(f"select audio from section where id = '{sec}'"))
    assert audio["mime"] == "audio/mpeg" and audio["path"].endswith(".mp3") and audio["duration_s"] == 2, audio
    assert audio["tts"]["voice"] == "Sulafat" and audio["tts"]["text"] == text and audio["tts"]["model"] == "gemini-3.8-flash-tts", audio
    up = [e for e in slog()["log"] if e[0] == "upload" and e[1] == audio["path"]]
    assert up and up[0][2] == "audio/mpeg" and up[0][3] > 1000, up
    expect(card).to_contain_text("0:02")
    step("rösten skapas med vald röst och stil, sparas som MP3 och kopplas till avsnittet")

    # Lång text delas upp i flera anrop, och den gamla filen tas bort
    a.reload()
    card = a.locator(".card", has_text="Speakerröst")
    panel = card.locator("details.ai-voice")
    expect(panel.locator("summary")).to_have_text("Skapa om med AI-uppläsning")
    panel.locator("summary").click()
    expect(panel.locator("textarea[name=ai_text]")).to_have_value(text)
    expect(panel.locator("select[name=ai_voice]")).to_have_value("Sulafat")
    lang = "\n\n".join(["Det här är ett stycke text som ska läsas upp av rösten i utbildningen. " * 12] * 8)
    panel.locator("textarea[name=ai_text]").fill(lang)
    n0 = len(glog())
    a.once("dialog", lambda d: d.accept())
    panel.get_by_role("button", name="Skapa ny AI-röst").click()
    expect(card).to_contain_text("Skapar AI-röst")
    expect(card).not_to_contain_text("Skapar AI-röst", timeout=60000)
    a.wait_for_timeout(500)
    calls = glog()[n0:]
    assert len(calls) >= 3 and all(x["chars"] <= 3000 for x in calls), [x["chars"] for x in calls]
    audio2 = json.loads(q(f"select audio from section where id = '{sec}'"))
    assert audio2["path"] != audio["path"] and audio2["duration_s"] >= 2 * len(calls), audio2
    assert audio["path"] not in slog()["files"], "den gamla filen ska tas bort"
    step(f"lång text delas i {len(calls)} anrop och ersätter den gamla rösten")

    # Felmeddelanden
    a.reload()
    card = a.locator(".card", has_text="Speakerröst")
    panel = card.locator("details.ai-voice")
    panel.locator("summary").click()
    panel.locator("textarea[name=ai_text]").fill("Det här ger FEL429 från Google.")
    a.once("dialog", lambda d: d.accept())
    panel.get_by_role("button", name="Skapa ny AI-röst").click()
    expect(card.get_by_role("alert")).to_contain_text("gränsen är nådd", timeout=15000)
    assert json.loads(q(f"select audio from section where id = '{sec}'"))["path"] == audio2["path"], "ljudet ska vara kvar vid fel"
    panel.locator("textarea[name=ai_text]").fill("FEL401")
    a.once("dialog", lambda d: d.accept())
    panel.get_by_role("button", name="Skapa ny AI-röst").click()
    expect(card.get_by_role("alert")).to_contain_text("godtar inte API-nyckeln", timeout=15000)
    step("tydliga fel vid slut på kvot och fel nyckel, befintligt ljud orört")

    # Eleven får spelaren med AI-rösten
    slug = q(f"select slug from course where id = '{course_id}'")
    e = ctx.new_page(); e.on("pageerror", lambda x: errors.append(str(x)))
    e.goto(f"{BASE}/k/{slug}?forhandsvisning=1")
    if e.locator("input[name=name]").count():
        e.fill("input[name=name]", "Test Elev")
        if e.locator("input[name=email]").count(): e.fill("input[name=email]", "elev@exempel.se")
        e.get_by_role("button", name="Starta utbildningen").click()
        e.wait_for_url("**/kurs**")
    e.goto(f"{BASE}/k/{slug}/kurs?s={sec}")
    e.wait_for_function("document.querySelector('.audio-mini audio')?.readyState >= 1", timeout=10000)
    assert audio2["path"] in e.evaluate("document.querySelector('.audio-mini audio').src")
    step("eleven får spelaren med AI-rösten")
    a.goto(f"{BASE}/admin/utbildningar/{course_id}?s={sec}")
    a.locator(".card", has_text="Speakerröst").screenshot(path=OUT + "/ai-rost-editor.png")

    q(f"update section set audio = null where id = '{sec}'")
    assert not errors, errors
    print("ALLA TESTER FÖR AI-UPPLÄSNING GICK IGENOM")
