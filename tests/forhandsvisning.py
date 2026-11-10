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
    # Inga falsklarm: från varje admin-sida ska man kunna lämna utan varning när inget ändrats
    customer_url = None
    false_alarms = []
    mode = {"v": "falsklarm"}
    unload = []
    def on_dialog(d):
        if d.type == "beforeunload":
            unload.append(d.type); d.dismiss(); return
        if mode["v"] == "falsklarm":
            false_alarms.append(a.url); d.dismiss(); return
        dialogs.append(d.message)
        d.accept() if mode["v"] == "accept" else d.dismiss()
    dialogs = []
    a.on("dialog", on_dialog)
    a.goto(BASE + "/admin")
    a.locator("a[href^='/admin/kunder/']").first.click()
    a.wait_for_url(re.compile(r"/admin/kunder/"))
    customer_url = a.url
    for u in [customer_url, course_url, course_url + "?flik=installningar", course_url + "/statistik"]:
        a.goto(u); a.wait_for_load_state("networkidle")
        a.get_by_role("link", name="Kunder & utbildningar").click()
        a.wait_for_url(BASE + "/admin")
    assert not false_alarms, false_alarms
    step("inga falsklarm på kund-, innehålls-, inställnings- och statistiksidan")
    mode["v"] = "accept"
    a.goto(course_url)
    a.click("text=Inställningar")
    a.wait_for_url(re.compile("flik=installningar"))

    # Inga ändringar: ingen varning
    mode["v"] = "accept"
    a.get_by_role("link", name="Innehåll", exact=True).click()
    a.wait_for_url(re.compile(r"/admin/utbildningar/[0-9a-f-]+(\?s=.*)?$"))
    assert not dialogs, dialogs
    step("ingen varning utan ändringar")

    a.click("text=Inställningar")
    a.wait_for_url(re.compile("flik=installningar"))
    field = a.locator("textarea[name=description]")
    original = field.input_value()
    field.fill(original + " ändrad")

    # Avbryt: stannar kvar, texten finns kvar
    mode["v"] = "dismiss"
    a.get_by_role("link", name="Innehåll", exact=True).click()
    a.wait_for_timeout(500)
    assert len(dialogs) == 1 and "osparade" in dialogs[0], dialogs
    expect(a).to_have_url(re.compile("flik=installningar"))
    expect(field).to_have_value(original + " ändrad")
    step("varning vid osparad ändring, Avbryt stannar kvar")

    # Ändrar tillbaka: ingen varning
    field.fill(original)
    mode["v"] = "accept"
    a.get_by_role("link", name="Innehåll", exact=True).click()
    a.wait_for_url(re.compile(r"/admin/utbildningar/[0-9a-f-]+(\?s=.*)?$"))
    assert len(dialogs) == 1, dialogs
    step("ingen varning när ändringen är återställd")

    # Ändrar och sparar: ingen varning efteråt
    a.click("text=Inställningar")
    a.wait_for_url(re.compile("flik=installningar"))
    field = a.locator("textarea[name=description]")
    field.fill(original + " sparad")
    a.click("text=Spara inställningar")
    a.wait_for_load_state("networkidle")
    expect(field).to_have_value(original + " sparad")
    mode["v"] = "accept"
    a.get_by_role("link", name="Innehåll", exact=True).click()
    a.wait_for_url(re.compile(r"/admin/utbildningar/[0-9a-f-]+(\?s=.*)?$"))
    assert len(dialogs) == 1, dialogs
    step("ingen varning efter sparat")

    # OK i varningen: lämnar sidan
    a.click("text=Inställningar")
    a.wait_for_url(re.compile("flik=installningar"))
    a.locator("textarea[name=description]").fill("osparat")
    mode["v"] = "accept"
    a.get_by_role("link", name="Innehåll", exact=True).click()
    a.wait_for_url(re.compile(r"/admin/utbildningar/[0-9a-f-]+(\?s=.*)?$"))
    assert len(dialogs) == 2, dialogs
    step("OK i varningen lämnar sidan")

    # Omladdning med osparad ändring: webbläsarens egen varning
    a.click("text=Inställningar")
    a.wait_for_url(re.compile("flik=installningar"))
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
