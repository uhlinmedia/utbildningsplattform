"""End-to-end-test av hela flödet: admin bygger utbildning, elev genomför, certifikat, statistik, export."""
import re, sys, os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

# Liten PNG-logga
import struct, zlib
def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
logo = OUT + "/logo.png"; open(logo, "wb").write(png(240, 80, (30, 64, 175)))
pic = OUT + "/bild.png"; open(pic, "wb").write(png(640, 360, (200, 210, 220)))

def step(msg): print("✓", msg, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    admin = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    a = admin.new_page()
    errors = []
    a.on("pageerror", lambda e: errors.append(str(e)))

    # Inloggning: fel lösenord först
    a.goto(BASE + "/admin")
    expect(a).to_have_url(re.compile("/admin/login"))
    a.fill("input[name=email]", "admin@exempel.se"); a.fill("input[name=password]", "fel-losenord")
    a.click("button[type=submit]")
    expect(a.locator("p[role=alert]")).to_contain_text("Fel e-post")
    a.fill("input[name=email]", os.environ.get("ADMIN_EMAIL", "admin@exempel.se")); a.fill("input[name=password]", os.environ.get("ADMIN_PASSWORD", "testlosenord123"))
    a.click("button[type=submit]")
    expect(a.get_by_role("heading", name="Kunder")).to_be_visible()
    step("inloggning")

    # Ny kund med profil
    a.fill("input[name=name]", "Testkommunen")
    a.click("text=+ Ny kund")
    expect(a.get_by_role("heading", name="Testkommunen")).to_be_visible()
    a.set_input_files("input[name=logo]", logo)
    a.fill("input[name=contact_name]", "Kim Kontakt")
    a.select_option("select[name=retention_months]", "12")
    a.click("text=Spara kundprofil")
    expect(a.locator("img[alt='Nuvarande logga']")).to_be_visible()
    step("kund skapad med logga")

    # Ny utbildning
    a.fill("input[placeholder='Namn på utbildningen']", "Brandskydd – grundkurs")
    a.click("text=+ Ny utbildning")
    expect(a.get_by_role("heading", name=re.compile("Brandskydd"))).to_be_visible()
    course_url = a.url.split("?")[0]
    step("utbildning skapad")

    # Inställningar
    a.click("text=Inställningar")
    a.select_option("select[name=nav_mode]", "linear")
    a.fill("input[name=pass_percent]", "50")
    a.fill("input[name=max_attempts]", "2")
    a.fill("input[name=cert_signer]", "Anna Andersson, utbildningsansvarig")
    a.fill("textarea[name=description]", "En kort grundkurs i brandskydd på arbetsplatsen.")
    a.click("text=Spara inställningar")
    a.wait_for_load_state("networkidle")
    expect(a.locator("input[name=pass_percent]")).to_have_value("50")
    step("inställningar sparade")

    # Innehåll kapitel 1
    a.goto(course_url)
    a.get_by_role("button", name="Text", exact=True).click()
    a.wait_for_selector("textarea[name=markdown]")
    a.fill("textarea[name=markdown]", "## Varför brandskydd?\nDe flesta bränder går att **förebygga**.\n\n- Håll utrymningsvägar fria\n- Känn till släckutrustningen")
    a.locator("form:has(textarea[name=markdown]) >> text=Spara block").click()
    a.wait_for_load_state("networkidle")
    a.get_by_role("button", name="Kontrollfråga", exact=True).click()
    a.wait_for_selector("input[name=question]")
    a.fill("input[name=question]", "Vad ska alltid hållas fritt?")
    a.fill("input[name=opt_text_0]", "Utrymningsvägar")
    a.fill("input[name=opt_text_1]", "Fikarummet")
    a.fill("input[name=opt_text_2]", "Parkeringen")
    a.fill("input[name=explanation]", "Utrymningsvägar måste alltid vara fria.")
    a.locator("form:has(input[name=question]) >> text=Spara block").click()
    a.wait_for_load_state("networkidle")
    expect(a.locator("input[name=opt_text_2]")).to_have_value("Parkeringen")
    step("kapitel 1: text + kontrollfråga")

    # Kapitel 2 med bild och fråga med flera rätt
    a.click("text=+ Kapitel")
    a.wait_for_url(re.compile(r"\?s="))
    a.get_by_role("button", name="Bild", exact=True).click()
    a.wait_for_selector("input[name=image]")
    a.set_input_files("input[name=image]", pic)
    a.fill("input[name=alt]", "Brandsläckare på vägg")
    a.locator("form:has(input[name=image]) >> text=Spara block").click()
    a.wait_for_load_state("networkidle")
    a.get_by_role("button", name="Kontrollfråga", exact=True).click()
    a.wait_for_selector("input[name=question]")
    a.fill("input[name=question]", "Vilka är släckutrustning?")
    a.select_option("select[name=kind]", "multi")
    a.fill("input[name=opt_text_0]", "Brandsläckare")
    a.fill("input[name=opt_text_1]", "Brandfilt")
    a.check("input[name=opt_correct_1]")
    a.fill("input[name=opt_text_2]", "Stege")
    a.locator("form:has(input[name=question]) >> text=Spara block").click()
    a.wait_for_load_state("networkidle")
    a.get_by_role("button", name="Video", exact=True).click()
    a.wait_for_selector("input[name=vimeo]")
    a.fill("input[name=vimeo]", "https://vimeo.com/76979871")
    a.locator("form:has(input[name=vimeo]) >> text=Spara block").click()
    a.wait_for_load_state("networkidle")
    expect(a.locator("input[name=vimeo]")).to_have_value("https://vimeo.com/76979871")
    a.screenshot(path=OUT + "/editor.png", full_page=True)
    step("kapitel 2: bild + flervalsfråga + video")

    # Opublicerad: elev ska inte komma in
    a.click("text=Statistik & dela")
    link = a.locator("input[readonly]").input_value()
    slug = link.rsplit("/", 1)[-1]
    learner = b.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True)
    l = learner.new_page()
    l.on("pageerror", lambda e: errors.append(str(e)))
    l.goto(BASE + "/k/" + slug)
    expect(l.locator("p[role=alert]")).to_contain_text("inte öppen")
    step("utkast är stängt för elever")

    a.goto(course_url)
    a.get_by_role("button", name="Publicera", exact=True).click()
    a.wait_for_load_state("networkidle")
    expect(a.get_by_text("Publicerad").first).to_be_visible()
    step("publicerad")

    # Elev startar (mobil)
    l.goto(BASE + "/k/" + slug)
    l.screenshot(path=OUT + "/elev-start-mobil.png", full_page=True)
    l.fill("input[name=name]", "Eva Elev")
    l.fill("input[name=email]", "inte-en-epost")
    l.click("text=Starta utbildningen")
    # webbläsarens egen validering stoppar ogiltig e-post
    expect(l).to_have_url(re.compile(f"/k/{slug}$"))
    l.fill("input[name=email]", "eva@exempel.se")
    l.click("text=Starta utbildningen")
    expect(l).to_have_url(re.compile("/kurs"))
    step("elev startade")

    # Nästa ska vara spärrad tills frågan besvarats
    expect(l.get_by_role("button", name="Nästa →")).to_be_disabled()
    l.get_by_label("Fikarummet").check()
    l.click("text=Svara")
    expect(l.get_by_text("1 försök kvar")).to_be_visible()
    l.get_by_label("Utrymningsvägar").check()
    l.click("text=Svara")
    expect(l.get_by_text("Rätt svar!")).to_be_visible()
    expect(l.get_by_role("button", name="Nästa →")).to_be_enabled()
    l.wait_for_load_state("networkidle")
    l.screenshot(path=OUT + "/elev-kurs-mobil.png", full_page=True)
    l.get_by_role("button", name="Nästa →").click()
    step("kapitel 1 klart (fel, sedan rätt)")

    # Desktopvy för kapitel 2
    l.set_viewport_size({"width": 1280, "height": 900})
    expect(l.get_by_role("heading", name="Vilka är släckutrustning?")).to_be_visible()
    expect(l.locator("img[alt='Brandsläckare på vägg']")).to_be_visible()
    expect(l.locator("iframe[src*='player.vimeo.com/video/76979871']")).to_have_count(1)
    assert "dnt=1" in l.locator("iframe").get_attribute("src")
    l.get_by_label("Brandsläckare").check()
    l.click("text=Svara")
    expect(l.get_by_text("1 försök kvar")).to_be_visible()
    l.get_by_label("Stege").check()
    l.click("text=Svara")
    expect(l.get_by_text("inga försök kvar")).to_be_visible()
    l.wait_for_load_state("networkidle")
    l.wait_for_timeout(800)
    l.screenshot(path=OUT + "/elev-kurs-desktop.png", full_page=True)
    l.get_by_role("button", name="Avsluta utbildningen →").click()
    expect(l).to_have_url(re.compile("/klar"))
    expect(l.get_by_text("Bra jobbat, Eva Elev!")).to_be_visible()
    expect(l.get_by_text("50 % rätt")).to_be_visible()
    l.screenshot(path=OUT + "/elev-klar.png", full_page=True)
    step("godkänd med 50 % (gräns 50 %)")

    with l.expect_download() as dl:
        l.click("text=Ladda ner certifikat")
    cert_path = OUT + "/certifikat.pdf"
    dl.value.save_as(cert_path)
    assert open(cert_path, "rb").read(4) == b"%PDF"
    cert_id = l.get_by_text("Certifikat-ID:").inner_text().split(":")[1].strip()
    step(f"certifikat nedladdat ({cert_id})")

    # Annan webbläsare får inte ladda ner certifikatet, men kan verifiera
    other = b.new_context().new_page()
    r = other.goto(BASE + "/certifikat/" + cert_id)
    assert r.status == 403, r.status
    other.goto(BASE + "/verifiera/" + cert_id)
    expect(other.get_by_text("äkta och giltigt")).to_be_visible()
    expect(other.get_by_text("Eva Elev")).to_be_visible()
    step("certifikat skyddat, verifiering fungerar")

    # Elevens cookie ska inte ge adminåtkomst
    l.goto(BASE + "/admin")
    expect(l).to_have_url(re.compile("/admin/login"))
    step("elev kommer inte åt admin")

    # Statistik och export
    a.goto(course_url + "/statistik")
    expect(a.locator(".kpi .v").nth(0)).to_have_text("1")
    expect(a.locator(".kpi .v").nth(2)).to_have_text("1")
    expect(a.get_by_role("cell", name="Eva Elev")).to_be_visible()
    a.screenshot(path=OUT + "/statistik.png", full_page=True)
    with a.expect_download() as dl:
        a.click("text=Exportera till Excel")
    xlsx = OUT + "/rapport.xlsx"
    dl.value.save_as(xlsx)
    assert open(xlsx, "rb").read(2) == b"PK"
    step("statistik och Excel-export")

    a.goto(BASE + "/admin")
    a.screenshot(path=OUT + "/admin-kunder.png", full_page=True)

    if errors:
        print("JS-FEL:", errors); sys.exit(1)
    print("ALLA TESTER GICK IGENOM")
    b.close()
