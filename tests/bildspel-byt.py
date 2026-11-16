"""Test av "Byt bild" i bildspelsblocket: en bild ersätts på samma plats med en ny bild eller en sida ur en PDF,
beskrivning och tidsmarkering behålls, övriga bilder orörda, ingen osparad-varning, och ändrad ordning i en
annan flik ger ett tydligt fel i stället för att fel bild byts. Kör efter bildspel.py (behöver DATABASE_URL)."""
import json, os, re, subprocess
from konto import login
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

def step(msg): print("✓", msg, flush=True)
def q(sql): return subprocess.run(["psql", os.environ["DATABASE_URL"], "-Atc", sql], capture_output=True, text=True, check=True).stdout.strip()
def slides(bid): return json.loads(q(f"select content->'slides' from block where id = '{bid}'"))

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    pdf = OUT + "/presentation.pdf"   # 3 sidor, skapas av bildspel.py
    img = OUT + "/Bild2.png"
    assert os.path.exists(pdf) and os.path.exists(img), "kör bildspel.py först"

    bid = q("select id from block where type = 'slides' and jsonb_array_length(content->'slides') >= 3 order by id limit 1")
    course = q(f"""select ch.course_id from block bl join section s on s.id = bl.section_id
                   join chapter ch on ch.id = s.chapter_id where bl.id = '{bid}'""")
    sec = q(f"select section_id from block where id = '{bid}'")
    # Bild 2 får beskrivning och tidsmarkering som ska behållas
    q(f"""update block set content = jsonb_set(jsonb_set(content, '{{slides,1,alt}}', '"Lösenordsbild"'), '{{slides,1,at}}', '12.5')
          where id = '{bid}'""")
    before = slides(bid)

    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    a = ctx.new_page(); errors = []
    a.on("pageerror", lambda e: errors.append(str(e)))
    login(a, BASE)
    a.goto(f"{BASE}/admin/utbildningar/{course}?s={sec}")
    card = a.locator(f".block-card:has(.slide-upload)").filter(has=a.locator(f"button[aria-label='Byt bild 2']")).first
    li = lambda i: card.locator(".slide-list li").nth(i)
    expect(li(1).get_by_role("button", name="Byt bild 2")).to_be_visible()

    # --- Byt mot en bildfil ---
    with a.expect_file_chooser() as fc:
        li(1).get_by_role("button", name="Byt bild 2").click()
    fc.value.set_files(img)
    expect(li(1).locator("img")).not_to_have_attribute("src", f"/media/{before[1]['media_id']}", timeout=15000)
    after = slides(bid)
    assert len(after) == len(before)
    assert after[1]["media_id"] != before[1]["media_id"]
    assert after[1].get("alt") == "Lösenordsbild" and after[1].get("at") == 12.5, after[1]
    assert [x["media_id"] for i, x in enumerate(after) if i != 1] == [x["media_id"] for i, x in enumerate(before) if i != 1]
    assert q(f"select mime from media where id = '{after[1]['media_id']}'") == "image/png"
    expect(a.locator(".unsaved-bar")).to_have_count(0)
    step("bild 2 byttes mot en PNG; beskrivning och tidsmarkering kvar, övriga bilder orörda, ingen osparad-varning")

    # --- Byt mot sida 3 i en PDF (frågan om sida besvaras) ---
    asked = []
    def answer(d):
        asked.append(d.message); d.accept("3")
    a.once("dialog", answer)
    prev = slides(bid)[0]["media_id"]
    with a.expect_file_chooser() as fc:
        li(0).get_by_role("button", name="Byt bild 1").click()
    fc.value.set_files(pdf)
    expect(li(0).locator("img")).not_to_have_attribute("src", f"/media/{prev}", timeout=30000)
    assert asked and "3 sidor" in asked[0], asked
    now = slides(bid)
    assert now[0]["media_id"] != prev and q(f"select mime from media where id = '{now[0]['media_id']}'") == "image/jpeg"
    step("bild 1 byttes mot sida 3 ur en PDF (frågan om sida visas)")

    # Avbryt vid frågan om sida: inget ändras
    a.once("dialog", lambda d: d.dismiss())
    with a.expect_file_chooser() as fc:
        li(2).get_by_role("button", name="Byt bild 3").click()
    fc.value.set_files(pdf)
    a.wait_for_timeout(2000)
    assert slides(bid)[2]["media_id"] == now[2]["media_id"]
    step("avbruten fråga om sida lämnar bilden orörd")

    # --- Ordningen ändrad i en annan flik: tydligt fel, fel bild byts inte ---
    cur = slides(bid); cur[0], cur[1] = cur[1], cur[0]
    q(f"update block set content = jsonb_set(content, '{{slides}}', '{json.dumps(cur)}'::jsonb) where id = '{bid}'")
    swapped = slides(bid)
    with a.expect_file_chooser() as fc:
        li(1).get_by_role("button", name="Byt bild 2").click()
    fc.value.set_files(img)
    expect(li(1).get_by_role("alert")).to_contain_text("Bildspelet har ändrats", timeout=15000)
    assert slides(bid) == swapped
    step("ändrad ordning i annan flik ger felmeddelande och byter ingenting")

    a.reload()
    card.screenshot(path=OUT + "/bildspel-byt.png")
    assert not errors, errors
    print("ALLA TESTER FÖR BYT BILD GICK IGENOM")
