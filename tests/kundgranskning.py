"""Test av förhandsvisningslänk för kund: skapa, kunden går igenom ett utkast, testcertifikat,
räknas inte i statistiken, byt länk och stäng av. Kör efter e2e.py (behöver DATABASE_URL)."""
import re, os, io, subprocess
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
DB = os.environ["DATABASE_URL"]

def step(msg): print("✓", msg, flush=True)
def q(sql): return subprocess.run(["psql", DB, "-Atqc", sql], check=True, capture_output=True, text=True).stdout.strip()

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    admin = b.new_context(viewport={"width": 1280, "height": 900})
    a = admin.new_page()
    errors = []
    a.on("pageerror", lambda e: errors.append(str(e)))
    a.goto(BASE + "/admin/login")
    a.fill("input[name=email]", os.environ.get("ADMIN_EMAIL", "admin@exempel.se"))
    a.fill("input[name=password]", os.environ.get("ADMIN_PASSWORD", "testlosenord123"))
    a.click("button[type=submit]")
    expect(a.get_by_role("heading", name="Kunder")).to_be_visible()
    a.locator("a[href^='/admin/kunder/']").first.click()
    a.wait_for_url(re.compile(r"/admin/kunder/"))
    a.locator("a[href^='/admin/utbildningar/']").first.click()
    a.wait_for_url(re.compile(r"/admin/utbildningar/[0-9a-f-]+"))
    course_url = a.url.split("?")[0]
    course_id = course_url.rsplit("/", 1)[-1]

    # Utbildningen som utkast
    if a.get_by_role("button", name="Avpublicera").count():
        a.get_by_role("button", name="Avpublicera").click()
        expect(a.get_by_role("button", name="Publicera", exact=True)).to_be_visible()
    real_before = q(f"select count(*) from enrollment where course_id = '{course_id}' and not is_preview")

    # Skapa länk
    a.goto(course_url + "/statistik")
    a.get_by_role("button", name="Skapa förhandsvisningslänk").click()
    field = a.get_by_label("Länk till kunden")
    expect(field).to_be_visible()
    link = field.input_value()
    assert "?granska=" in link, link
    link = BASE + "/k/" + link.split("/k/", 1)[1]
    step("förhandsvisningslänk skapad")

    # Vanliga elevlänken är stängd för utkast
    kund = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    k = kund.new_page()
    k.on("pageerror", lambda e: errors.append(str(e)))
    k.goto(link.split("?")[0])
    expect(k.locator("p[role=alert]")).to_contain_text("inte öppen")

    # Kunden öppnar förhandsvisningslänken
    k.goto(link)
    expect(k.locator(".notice")).to_contain_text("Förhandsvisning")
    k.fill("input[name=name]", "Kund Granskare")
    if k.locator("input[name=email]").count():
        k.fill("input[name=email]", "kund@exempel.se")
    k.click("text=Starta utbildningen")
    k.wait_for_url(re.compile("/kurs"))
    expect(k.locator(".learn-top")).to_contain_text("(förhandsvisning)")
    expect(k.get_by_role("button", name="Börja om")).to_be_visible()
    step("kunden går igenom utkastet som förhandsvisning")

    # Felaktigt namn skickar tillbaka till länken med granska kvar
    k2 = b.new_context().new_page()  # egen webbläsarsession utan påbörjad förhandsvisning
    k2.goto(link)
    k2.evaluate("document.querySelectorAll('input').forEach(i => i.removeAttribute('required'))")
    k2.click("text=Starta utbildningen")
    k2.wait_for_url(re.compile("fel=namn"))
    assert "granska=" in k2.url, k2.url
    k2.close()

    # Slutför allt direkt i databasen och hämta testcertifikat
    enr = q(f"select e.id from enrollment e join course c on c.id = e.course_id where c.id = '{course_id}' and e.review_token = c.preview_token")
    q(f"""insert into section_progress (enrollment_id, section_id)
          select '{enr}', s.id from section s join chapter c on c.id = s.chapter_id where c.course_id = '{course_id}'
          on conflict do nothing""")
    q(f"""insert into answer (enrollment_id, block_id, attempt, selected, correct)
          select '{enr}', bl.id, 1, '[]'::jsonb, true from block bl join section s on s.id = bl.section_id
          join chapter c on c.id = s.chapter_id where c.course_id = '{course_id}' and bl.type = 'quiz'""")
    k.goto(link.split("?")[0] + "/klar")
    btn = k.get_by_role("link", name="Ladda ner testcertifikat (PDF)")
    expect(btn).to_be_visible()
    with k.expect_download() as dl:
        btn.click()
    pdf = PdfReader(dl.value.path())
    text = "".join(pg.extract_text() for pg in pdf.pages)
    assert "TESTCERTIFIKAT" in text, text[:300]
    cert_id = q(f"select id from certificate where enrollment_id = '{enr}'")
    assert q(f"select is_test from certificate where id = '{cert_id}'") == "t"
    k.goto(BASE + "/verifiera/" + cert_id)
    expect(k.get_by_role("status")).to_contain_text("testcertifikat")
    step("testcertifikat märkt i PDF och vid verifiering")

    assert q(f"select count(*) from enrollment where course_id = '{course_id}' and not is_preview") == real_before
    step("räknas inte i statistiken")

    # Byt länk: gamla slutar fungera, även för den som redan startat
    a.goto(course_url + "/statistik")
    a.get_by_role("button", name="Byt länk").click()
    expect(a.get_by_label("Länk till kunden")).not_to_have_value(re.compile(re.escape(link.split("granska=")[1])))
    new_link = BASE + "/k/" + a.get_by_label("Länk till kunden").input_value().split("/k/", 1)[1]
    k.goto(link.split("?")[0] + "/kurs")
    expect(k).to_have_url(re.compile(r"/k/[^/]+$"))
    k.goto(link)
    expect(k.locator("p[role=alert]")).to_contain_text("inte längre aktiv")
    k.goto(new_link)
    expect(k.locator("input[name=name]")).to_be_visible()
    step("byt länk: gamla länken slutar fungera, nya fungerar")

    # Stäng av
    a.get_by_role("button", name="Stäng av").click()
    expect(a.get_by_role("button", name="Skapa förhandsvisningslänk")).to_be_visible()
    k.goto(new_link)
    expect(k.locator("p[role=alert]")).to_contain_text("inte längre aktiv")
    step("stäng av")

    # Återställ: publicera igen
    a.goto(course_url)
    a.get_by_role("button", name="Publicera", exact=True).click()
    expect(a.get_by_role("button", name="Avpublicera")).to_be_visible()

    assert not errors, errors
    print("ALLA TESTER GICK IGENOM")
