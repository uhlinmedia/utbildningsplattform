"""Test av certifikatdesign: mall, dekorfärg, SVG-logga, märken, underskrifter och förhandsvisning.
Kör efter e2e.py (använder kunden och utbildningen därifrån). Grafiken skapas i testet."""
import re, os
from konto import login
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

def svg(name, body, w=200, h=200):
    path = f"{OUT}/{name}.svg"
    open(path, "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>')
    return path

logo = svg("logo", '<rect x="4" y="10" width="80" height="80" rx="18" fill="#1E40AF"/><path d="M24 70 L44 30 L64 70 Z" fill="#fff"/>'
       '<text x="100" y="62" font-family="sans-serif" font-weight="bold" font-size="34" fill="#1E293B">Testkommunen</text>', 420, 100)
badges = [svg(f"badge-{n}", f'<circle cx="100" cy="100" r="92" fill="#fff" stroke="#0B3D91" stroke-width="8"/>'
          f'<text x="100" y="92" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="30" fill="#0B3D91">ISO</text>'
          f'<text x="100" y="130" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="34" fill="#0B3D91">{n}</text>')
          for n in ("9001", "14001", "45001")]
sign = svg("underskrift", '<path d="M10 60 C 30 10, 50 10, 55 55 S 80 80, 95 30 S 120 20, 130 60 C 140 80, 160 30, 175 45 S 210 70, 230 40" '
       'fill="none" stroke="#1a2a6c" stroke-width="3"/>', 240, 90)

def step(msg): print("✓", msg, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1400, "height": 1000})
    a = ctx.new_page()
    errors = []
    a.on("pageerror", lambda e: errors.append(str(e)))
    login(a, BASE)
    expect(a.get_by_role("heading", name="Kunder")).to_be_visible()
    a.get_by_role("link", name=re.compile("Testkommunen")).first.click()
    expect(a).to_have_url(re.compile("/admin/kunder/"))
    customer_url = a.url.split("?")[0].split("#")[0]

    # SVG-logga i kundprofilen
    a.set_input_files("input[name=logo]", logo)
    a.click("text=Spara kundprofil")
    expect(a.locator("img[alt='Nuvarande logga']")).to_have_attribute("src", re.compile("/media/"))
    step("SVG-logga sparad")

    # Märken
    for path, label in zip(badges, ["ISO 9001", "ISO 14001", "ISO 45001"]):
        a.set_input_files("input[name=badge]", path)
        a.fill("form:has(input[name=badge]) input[name=label]", label)
        a.click("text=+ Lägg till märke")
        expect(a.locator(".badge-list li input[name=label]").last).to_have_value(label)
        a.wait_for_load_state("networkidle")
    a.locator(".badge-list li").nth(2).get_by_role("button", name="Flytta märket uppåt").click()
    a.wait_for_load_state("networkidle")
    expect(a.locator(".badge-list li").nth(1).locator("input[name=label]")).to_have_value("ISO 45001")
    step("tre märken tillagda och omsorterade")

    # Mall och färger
    a.check("input[name=cert_template][value=klassisk]")
    a.fill("input[name=cert_accent]", "#c9a227")
    a.select_option("select[name=cert_logo_size]", "M")
    a.click("text=Spara utseende")
    a.wait_for_load_state("networkidle")
    r = a.request.get(BASE + "/admin/certifikat?kund=" + customer_url.rsplit("/", 1)[1])
    assert r.ok and r.body()[:4] == b"%PDF", r.status
    assert r.headers.get("x-frame-options") == "SAMEORIGIN"
    open(OUT + "/forhandsvisning-kund.pdf", "wb").write(r.body())
    step("förhandsvisning för kund")
    a.screenshot(path=OUT + "/kund-certifikat.png", full_page=True)

    # Utbildningens certifikatinställningar
    a.get_by_role("link", name="Redigera").first.click()
    expect(a).to_have_url(re.compile("/admin/utbildningar/"))
    a.get_by_role("link", name="Inställningar", exact=True).click()
    expect(a).to_have_url(re.compile("flik=installningar"))
    a.fill("input[name=cert_title]", "Kursintyg")
    a.fill("input[name=cert_note]", "Omfattning 4 timmar · Enligt AFS 2023:1")
    a.fill("input[name=cert_signer]", "Karin Lindqvist")
    a.fill("input[name=cert_signer_title]", "Säkerhetschef")
    a.set_input_files("input[name=cert_signature]", sign)
    a.fill("input[name=cert_signer2]", "Johan Ek")
    a.fill("input[name=cert_signer2_title]", "Utbildningsansvarig")
    a.uncheck("label.check:has-text('ISO 14001') input")
    a.click("text=Spara inställningar")
    expect(a.locator("img.sig-img")).to_be_visible()
    expect(a.locator("label.check:has-text('ISO 14001') input")).not_to_be_checked()
    expect(a.locator("iframe.cert-preview")).to_be_visible()
    course_id = a.url.split("/utbildningar/")[1].split("?")[0]
    r = a.request.get(BASE + "/admin/certifikat?utbildning=" + course_id)
    assert r.ok and r.body()[:4] == b"%PDF"
    open(OUT + "/forhandsvisning-utbildning.pdf", "wb").write(r.body())
    step("certifikattexter, underskrift och märkesval sparade")
    a.screenshot(path=OUT + "/utbildning-certifikat.png", full_page=True)

    # Övriga mallar renderas
    for t in ("modern", "minimal"):
        a.goto(customer_url)
        a.check(f"input[name=cert_template][value={t}]")
        a.click("text=Spara utseende")
        a.wait_for_load_state("networkidle")
        r = a.request.get(BASE + "/admin/certifikat?utbildning=" + course_id)
        assert r.ok and r.body()[:4] == b"%PDF"
        open(OUT + f"/forhandsvisning-{t}.pdf", "wb").write(r.body())
    step("mallarna modern och minimal")

    # Förhandsvisningen kräver inloggning
    anon = b.new_context().new_page()
    r = anon.request.get(BASE + "/admin/certifikat?utbildning=" + course_id, max_redirects=0)
    assert r.status in (302, 303, 307, 308, 403), r.status
    step("förhandsvisning skyddad")

    assert not errors, errors
    print("CERTIFIKATTESTER GICK IGENOM")
