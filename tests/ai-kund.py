"""AI-uppläsning per kund: superadmin aktiverar och sätter månadskvot, kundens utbildare skapar röster inom kvoten,
förbrukningen registreras, kvoten spärrar, och förbrukningssidor + Excel-export fungerar (kund och superadmin).
Kräver samma uppsättning som ai-rost.py (fake-storage, fake-gemini, MAIL_DIR=tests/out/mail). Kör efter e2e.py."""
import os, re, io, subprocess, time, zipfile
from playwright.sync_api import sync_playwright, expect
from konto import login, finish_setup, latest_mail, link_in

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
DB = os.environ["DATABASE_URL"]
PW = "ett-langt-losenord-2026"
run = str(int(time.time()))[-6:]
UT = f"ai-utbildare{run}@kund.se"
KA = f"ai-kundadmin{run}@kund.se"


def step(msg): print("✓", msg, flush=True)
def q(s): return subprocess.run(["psql", DB, "-tAc", s], check=True, capture_output=True, text=True).stdout.strip()


def invite(sup, cust, email, role, name, b, t0):
    sup.goto(f"{BASE}/admin/kunder/{cust}/anvandare")
    sup.fill("input[name=email]", email); sup.fill("input[name=name]", name)
    sup.locator(f"input[name=role][value={role}]").check()
    sup.get_by_role("button", name="Skicka inbjudan").click()
    expect(sup.get_by_text(f"Inbjudan skickad till {email}")).to_be_visible()
    url = link_in(latest_mail(email, after=t0), r"https?://\S+/admin/inbjudan/\S+")
    p = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
    p.goto(url.replace("http://localhost:3000", BASE))
    p.fill("input[name=name]", name)
    p.fill("input[name=password]", PW); p.fill("input[name=password2]", PW)
    p.get_by_role("button", name="Skapa konto").click()
    p.wait_for_url(re.compile("/admin/tvasteg"))
    finish_setup(p, email)
    p.wait_for_url(re.compile(r"/admin/kunder/"))
    return p


def save_ai(sup, cust, on, minutes):
    sup.goto(f"{BASE}/admin/kunder/{cust}")
    card = sup.locator("section", has=sup.locator("#ai-rubrik"))
    box = card.locator("input[name=ai_voice]")
    box.check() if on else box.uncheck()
    card.locator("input[name=ai_minutes_month]").fill(str(minutes))
    card.get_by_role("button", name="Spara AI-uppläsning").click()
    sup.wait_for_load_state("networkidle")


with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox"])
    t0 = time.time()
    sup = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
    login(sup, BASE)
    sup.goto(BASE + "/admin")
    sup.fill("input[name=name]", f"AI-kund {run}"); sup.click("text=+ Ny kund")
    sup.wait_for_url(re.compile(r"/admin/kunder/[0-9a-f-]+$"))
    sup.fill("input[name=title]", f"AI-kurs {run}"); sup.click("text=+ Ny utbildning")
    sup.wait_for_url(re.compile(r"/admin/utbildningar/"))
    cust = q(f"select id from customer where name = 'AI-kund {run}'")
    course = q(f"select id from course where customer_id = '{cust}'")
    sec = q(f"select s.id from section s join chapter c on c.id = s.chapter_id where c.course_id = '{course}' limit 1")
    ut = invite(sup, cust, UT, "utbildare", "Ulla Utbildare", b, t0)
    ka = invite(sup, cust, KA, "kundadmin", "Kalle Kundadmin", b, t0)
    step("kund med utbildning, utbildare och kundadmin")

    # --- Avstängt: ingen panel, ingen flik, sidorna 404 ---
    ut.goto(f"{BASE}/admin/utbildningar/{course}?s={sec}")
    card = ut.locator(".card", has_text="Speakerröst")
    expect(card).to_be_visible()
    expect(card.locator("details.ai-voice")).to_have_count(0)
    ka.goto(f"{BASE}/admin/kunder/{cust}")
    expect(ka.locator(".admin-nav")).not_to_contain_text("AI-uppläsning")
    expect(ka.locator("#ai-rubrik")).to_have_count(0)
    assert ka.goto(f"{BASE}/admin/kunder/{cust}/ai").status == 404
    assert ka.request.get(f"{BASE}/admin/kunder/{cust}/ai/export?m=2026-01").status == 404
    assert ka.goto(f"{BASE}/admin/ai").status == 404
    step("avstängt för kunden: ingen AI-panel, ingen flik, sidor och export ger 404")

    # --- Superadmin aktiverar med kvot 1 minut ---
    save_ai(sup, cust, True, 1)
    assert q(f"select ai_voice::text || ',' || ai_minutes_month from customer where id = '{cust}'") == "true,1"
    assert q(f"select count(*) from audit_log where action = 'ai_installning' and customer_id = '{cust}'") == "1"
    ka.goto(f"{BASE}/admin/kunder/{cust}")
    expect(ka.locator(".admin-nav")).to_contain_text("AI-uppläsning")
    expect(ka.locator("section", has=ka.locator("#ai-rubrik"))).to_contain_text("av 1 min")
    expect(ka.locator("input[name=ai_voice]")).to_have_count(0)
    step("superadmin aktiverar och sätter kvot; kundadmin ser kortet men kan inte ändra")

    # --- Utbildaren skapar en röst inom kvoten ---
    ut.goto(f"{BASE}/admin/utbildningar/{course}?s={sec}")
    panel = ut.locator(".card", has_text="Speakerröst").locator("details.ai-voice")
    expect(panel).to_be_visible()
    expect(panel.locator(".ai-quota")).to_have_text("Kvar denna månad: 1 av 1 min")
    panel.locator("textarea[name=ai_text]").fill("Hej och välkommen till kursen. Det här är ett test av AI-rösten.")
    panel.get_by_role("button", name="Skapa AI-röst").click()
    expect(ut.locator(".card", has_text="Speakerröst")).to_contain_text("AI-röst (Kore).mp3", timeout=30000)
    row = q(f"select course_title || '|' || section_title || '|' || user_email || '|' || seconds || '|' || voice from ai_usage where customer_id = '{cust}'")
    assert row == f"AI-kurs {run}|Välkommen|{UT}|2|Kore", row
    step("utbildaren skapar AI-röst inom kvoten; förbrukningen registreras på kunden")

    # Text som inte ryms i resten av kvoten
    ut.reload()
    panel = ut.locator(".card", has_text="Speakerröst").locator("details.ai-voice")
    panel.locator("summary").click() if panel.get_attribute("open") is None else None
    panel.locator("textarea[name=ai_text]").fill("Lång mening om säkerhet. " * 60)
    ut.once("dialog", lambda d: d.accept())
    panel.get_by_role("button", name=re.compile("Skapa (ny )?AI-röst")).click()
    expect(ut.locator(".card", has_text="Speakerröst")).to_contain_text("Texten ryms inte i månadens kvot", timeout=15000)
    assert q(f"select count(*) from ai_usage where customer_id = '{cust}'") == "1"
    # Förbrukad kvot: knappen spärras
    q(f"insert into ai_usage (customer_id, chars, seconds) values ('{cust}', 900, 60)")
    ut.reload()
    panel = ut.locator(".card", has_text="Speakerröst").locator("details.ai-voice")
    if panel.get_attribute("open") is None: panel.locator("summary").click()
    expect(panel).to_contain_text("Månadens kvot för AI-uppläsning är förbrukad")
    expect(panel.get_by_role("button", name=re.compile("Skapa (ny )?AI-röst"))).to_be_disabled()
    step("kvoten spärrar för lång text och när den är förbrukad")

    # --- Förbrukningssidor och Excel ---
    month = q("select to_char(now() at time zone 'Europe/Stockholm', 'YYYY-MM')")
    ka.goto(f"{BASE}/admin/kunder/{cust}/ai")
    expect(ka.locator("table.ai-usage")).to_contain_text("2")
    expect(ka.locator("table.ai-usage")).not_to_contain_text("kostnad")
    r = ka.request.get(f"{BASE}/admin/kunder/{cust}/ai/export?m={month}")
    assert r.status == 200 and "spreadsheetml" in r.headers["content-type"], r.status
    x = zipfile.ZipFile(io.BytesIO(r.body())).read("xl/sharedStrings.xml").decode()
    assert "Välkommen" in x and UT in x and "kostnad" not in x, x[:500]
    other = q(f"select id from customer where id <> '{cust}' limit 1")
    assert ka.request.get(f"{BASE}/admin/kunder/{other}/ai/export?m={month}").status == 404
    assert ka.request.get(f"{BASE}/admin/ai/export?m={month}").status == 404
    step("kundadmin ser sin förbrukning och exporterar Excel utan kostnad; inget från andra kunder")

    sup.goto(f"{BASE}/admin/ai")
    expect(sup.locator("table.ai-usage")).to_contain_text(f"AI-kund {run}")
    expect(sup.locator("table.ai-usage")).to_contain_text("kostnad")
    expect(sup.locator(".ai-customers")).to_contain_text(f"AI-kund {run}")
    r = sup.request.get(f"{BASE}/admin/ai/export?m={month}")
    assert r.status == 200
    x = zipfile.ZipFile(io.BytesIO(r.body())).read("xl/sharedStrings.xml").decode()
    assert f"AI-kund {run}" in x and "kostnad" in x
    sup.screenshot(path="tests/out/ai-oversikt.png", full_page=True)
    step("superadmin ser alla kunder med uppskattad kostnad och exporterar Excel")

    # --- Avaktivering stänger panelen igen ---
    save_ai(sup, cust, False, "")
    ut.goto(f"{BASE}/admin/utbildningar/{course}?s={sec}")
    expect(ut.locator(".card", has_text="Speakerröst").locator("details.ai-voice")).to_have_count(0)
    step("avaktivering tar bort AI-panelen för kundens användare")
    print("Alla tester för AI-uppläsning per kund gick igenom.")
