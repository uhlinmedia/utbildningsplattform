"""Test av "kom ihåg att spara" i admin och av förhandsvisningen (börja om, samma flik).
Kör efter e2e.py (använder utbildningen därifrån)."""
import re, os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")

def step(msg): print("✓", msg, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    a = ctx.new_page()
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

    # --- Kom ihåg att spara ---
    unload = []
    def on_dialog(d):
        if d.type == "beforeunload":
            unload.append(d.type)
        d.dismiss()
    a.on("dialog", on_dialog)
    leave_box = a.locator("dialog.unsaved-dialog")
    bar = a.locator(".unsaved-bar")
    content_link = a.get_by_role("link", name="Innehåll", exact=True)
    def to_settings():
        a.click("text=Inställningar")
        a.wait_for_url(re.compile("flik=installningar"))
    def to_content():
        content_link.click()
        a.wait_for_url(re.compile(r"/admin/utbildningar/[0-9a-f-]+(\?s=.*)?$"))

    # Inga falsklarm: från varje admin-sida ska man kunna lämna utan varning när inget ändrats
    a.goto(BASE + "/admin")
    a.locator("a[href^='/admin/kunder/']").first.click()
    a.wait_for_url(re.compile(r"/admin/kunder/"))
    customer_url = a.url
    for u in [customer_url, course_url, course_url + "?flik=installningar", course_url + "/statistik"]:
        a.goto(u); a.wait_for_load_state("networkidle")
        a.get_by_role("link", name="Kunder & utbildningar").click()
        a.wait_for_url(BASE + "/admin")
    step("inga falsklarm på kund-, innehålls-, inställnings- och statistiksidan")

    # Byte mellan avsnitt: rubrikfältet visar rätt avsnitt och ingen varning (tidigare falsklarm)
    a.goto(course_url); a.wait_for_load_state("networkidle")
    secs = a.locator("a.tree-sec")
    assert secs.count() >= 2, "testet behöver minst två avsnitt"
    for _ in range(2):
        for i in range(secs.count()):
            name = re.sub(r"^\d+\.\d+ ", "", secs.nth(i).inner_text())
            secs.nth(i).click()
            expect(secs.nth(i)).to_have_class(re.compile("active"))
            expect(a.locator("input[aria-label='Avsnittets rubrik']")).to_have_value(name)
            a.wait_for_timeout(300)
            expect(bar).to_have_count(0)
            expect(leave_box).not_to_be_visible()
    step("byte mellan avsnitt: rätt rubrik i fältet, ingen varning")

    # Datum i inställningarna visas och ligger kvar efter sparning (tidigare tomt + falsklarm)
    to_settings()
    a.fill("input[name=closes_at]", "2099-06-30")
    a.click("text=Spara inställningar")
    expect(a.locator("form[data-status=sparat]")).to_have_count(1)
    a.goto(course_url + "?flik=installningar")
    expect(a.locator("input[name=closes_at]")).to_have_value("2099-06-30")
    a.fill("input[name=closes_at]", "")
    a.click("text=Spara inställningar")
    expect(a.locator("form[data-status=sparat]")).to_have_count(1)
    to_content()
    expect(leave_box).not_to_be_visible()
    step("datumfältet visar sparat datum, ingen varning")

    # Inga ändringar: dämpad sparaknapp, ingen list, ingen varning
    to_settings()
    save_btn = a.get_by_role("button", name="Spara inställningar")
    expect(a.locator("form[data-osparad]")).to_have_count(0)
    expect(bar).to_have_count(0)

    # Ändring: fältet markeras, knappen blir orange, listen visar vad som inte är sparat
    field = a.locator("textarea[name=description]")
    original = field.input_value()
    field.fill(original + " ändrad")
    expect(field).to_have_attribute("data-andrad", "")
    expect(a.locator("form[data-osparad]")).to_have_count(1)
    expect(bar).to_contain_text("Inställningar")
    a.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "osparat.png"))

    # Lämna: egen ruta som listar ändringen; Stanna kvar behåller texten
    to_link = content_link
    to_link.click()
    expect(leave_box).to_be_visible()
    expect(leave_box).to_contain_text("Inställningar")
    a.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "lamna.png"))
    leave_box.get_by_role("button", name="Stanna kvar").click()
    expect(leave_box).not_to_be_visible()
    expect(a).to_have_url(re.compile("flik=installningar"))
    expect(field).to_have_value(original + " ändrad")
    step("ändring markeras, rutan listar den, Stanna kvar behåller texten")

    # Ändrar tillbaka: markeringen försvinner och ingen varning
    field.fill(original)
    expect(bar).to_have_count(0)
    to_content()
    expect(leave_box).not_to_be_visible()
    step("ingen varning när ändringen är återställd")

    # Ändrar och sparar: knappen visar Sparat, ingen varning efteråt
    to_settings()
    field = a.locator("textarea[name=description]")
    field.fill(original + " sparad")
    a.click("text=Spara inställningar")
    expect(a.locator("form[data-status=sparat]")).to_have_count(1)
    expect(bar).to_have_count(0)
    expect(field).to_have_value(original + " sparad")
    to_content()
    expect(leave_box).not_to_be_visible()
    step("Sparat visas efter sparning, ingen varning efteråt")

    # Block: ändrat block markeras, listen leder dit
    for i in range(secs.count()):
        if a.locator(".block-card form textarea, .block-card form input[type=text]").count():
            break
        secs.nth(i).click(); a.wait_for_timeout(600)
    blk = a.locator(".block-card form.block-body:has(textarea, input[type=text])").first
    blk.locator("textarea, input[type=text]").first.fill("osparad blocktext")
    expect(a.locator(".block-card:has(form[data-osparad])")).to_have_count(1)
    expect(bar).to_contain_text("-block")
    a.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "block-osparat.png"))

    # Lämna utan att spara: går vidare
    to_settings_link = a.locator("nav >> text=Inställningar")
    to_settings_link.click()
    expect(leave_box).to_be_visible()
    leave_box.get_by_role("button", name="Lämna utan att spara").click()
    a.wait_for_url(re.compile("flik=installningar"))
    expect(bar).to_have_count(0)
    step("Lämna utan att spara lämnar sidan")

    # Omladdning med osparad ändring: webbläsarens egen varning
    a.locator("textarea[name=description]").fill("osparat igen")
    try:
        a.reload(timeout=3000)
    except Exception:
        pass
    assert unload == ["beforeunload"], unload
    step("varning vid omladdning/stängning")

    # --- Förhandsvisning ---
    a2 = ctx.new_page()
    a2.goto(course_url)
    link = a2.get_by_role("link", name="Förhandsvisa som elev")
    assert link.get_attribute("target") == "briondo-forhandsvisning"
    with ctx.expect_page() as pv_info:
        link.click()
    pv = pv_info.value
    pv.wait_for_load_state()
    pv.fill("input[name=name]", "Testare")
    if pv.locator("input[name=email]").count():
        pv.fill("input[name=email]", "test@exempel.se")
    pv.click("text=Starta utbildningen")
    pv.wait_for_url(re.compile("/kurs"))
    # Markera första avsnittet som klart direkt i databasen (snabbare än att klicka igenom)
    import subprocess
    subprocess.run(["psql", os.environ["DATABASE_URL"], "-qc",
        """insert into section_progress (enrollment_id, section_id)
           select e.id, s.id from enrollment e join chapter c on c.course_id = e.course_id
           join section s on s.chapter_id = c.id where e.is_preview
           order by c.position, s.position limit 1 on conflict do nothing"""], check=True)
    pv.reload()
    expect(pv.locator(".progressbar span")).not_to_have_text("0 %")
    pct_before = pv.locator(".progressbar span").inner_text()
    step(f"förhandsvisning startad ({pct_before})")

    # Klick igen i admin: samma flik, börjar om från början
    pages_before = len(ctx.pages)
    link.click()
    pv.wait_for_load_state("networkidle")
    pv.wait_for_url(re.compile("/kurs"))
    assert len(ctx.pages) == pages_before, "ny flik öppnades"
    expect(pv.locator(".progressbar span")).to_have_text("0 %")
    step("Förhandsvisa som elev återanvänder fliken och börjar om (0 %)")

    # Knappen Börja om
    expect(pv.get_by_role("button", name="Börja om")).to_be_visible()
    pv.get_by_role("button", name="Börja om").click()
    pv.wait_for_load_state("networkidle")
    expect(pv.locator(".progressbar span")).to_have_text("0 %")
    step("knappen Börja om finns och nollställer")

    assert not errors, errors
    print("ALLA TESTER GICK IGENOM")
