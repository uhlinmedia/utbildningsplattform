"""Kundkonton (steg A): inbjudan, tvåstegsverifiering, roller, avskild data per kund, spärr, reservkod,
glömt lösenord, avstängning, personregister (manuellt, import, export), elevinloggning via e-postlänk och
personlig länk, Mina utbildningar, delad dator och ändringslogg.
Kräver att servern körs med MAIL_DIR=tests/out/mail och DATABASE_URL satt. Kör efter e2e.py."""
import os, re, subprocess, time
from playwright.sync_api import sync_playwright, expect
from konto import login, finish_setup, latest_mail, link_in, totp, secret_for, OUT

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
DB = os.environ["DATABASE_URL"]
PW = "ett-langt-losenord-2026"
run = str(int(time.time()))[-6:]
KA, UT, GR = f"kundadmin{run}@flyg.se", f"utbildare{run}@flyg.se", f"granskare{run}@flyg.se"


def step(msg): print("✓", msg, flush=True)
def q(sqltext): return subprocess.run(["psql", DB, "-tAc", sqltext], check=True, capture_output=True, text=True).stdout.strip()


def accept_invite(ctx, email, name):
    mail = latest_mail(email, after=t0)
    url = link_in(mail, r"https?://\S+/admin/inbjudan/\S+")
    p = ctx.new_page()
    p.goto(url.replace("http://localhost:3000", BASE))
    expect(p.get_by_role("heading", name="Välkommen till Briondo")).to_be_visible()
    p.fill("input[name=name]", name)
    p.fill("input[name=password]", PW); p.fill("input[name=password2]", PW)
    p.get_by_role("button", name="Skapa konto").click()
    p.wait_for_url(re.compile("/admin/tvasteg"))
    codes = finish_setup(p, email)
    p.wait_for_url(re.compile(r"/admin/kunder/"))
    return p, codes


with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox"])
    t0 = time.time()
    sup = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
    login(sup, BASE)

    # Två kunder: Flygplatsen (testas) och en annan kund med en utbildning som inte får läcka
    for name in [f"Flygplatsen {run}", f"Annan kund {run}"]:
        sup.goto(BASE + "/admin")
        sup.fill("input[name=name]", name); sup.click("text=+ Ny kund")
        sup.wait_for_url(re.compile(r"/admin/kunder/[0-9a-f-]+$"))
        sup.fill("input[name=title]", f"Kurs hos {name}"); sup.click("text=+ Ny utbildning")
        sup.wait_for_url(re.compile(r"/admin/utbildningar/"))
    other_customer = q(f"select id from customer where name = 'Annan kund {run}'")
    other_course = q(f"select id from course where customer_id = '{other_customer}'")
    cust = q(f"select id from customer where name = 'Flygplatsen {run}'")
    course = q(f"select id from course where customer_id = '{cust}'")
    step("två kunder med varsin utbildning")

    # --- Superadmin bjuder in kundadmin ---
    sup.goto(f"{BASE}/admin/kunder/{cust}/anvandare")
    sup.fill("input[name=email]", KA); sup.fill("input[name=name]", "Karin Kundadmin")
    sup.locator("input[name=role][value=kundadmin]").check()
    sup.get_by_role("button", name="Skicka inbjudan").click()
    expect(sup.get_by_text(f"Inbjudan skickad till {KA}")).to_be_visible()
    expect(sup.locator("tr", has_text=KA)).to_contain_text("Inbjuden")
    ka_ctx = b.new_context(viewport={"width": 1280, "height": 900})
    ka, ka_codes = accept_invite(ka_ctx, KA, "Karin Kundadmin")
    expect(ka.locator(".admin-nav")).to_contain_text(f"Flygplatsen {run}")
    expect(ka.locator(".admin-nav")).not_to_contain_text("Kunder & utbildningar")
    expect(ka.locator(".admin-nav")).to_contain_text("Kundadmin")
    step("inbjudan via e-post → lösenord → tvåstegsverifiering → kundens sida")

    # --- Avskild data: kundadmin kommer inte åt annan kund ---
    ka.goto(BASE + "/admin"); expect(ka).to_have_url(re.compile(f"/admin/kunder/{cust}"))
    for path in [f"/admin/kunder/{other_customer}", f"/admin/utbildningar/{other_course}",
                 f"/admin/utbildningar/{other_course}/statistik", f"/admin/kunder/{other_customer}/personer",
                 f"/admin/kunder/{other_customer}/anvandare", "/admin/anvandare"]:
        r = ka.goto(BASE + path)
        assert r.status == 404, (path, r.status)
    for path in [f"/admin/utbildningar/{other_course}/export", f"/admin/certifikat?utbildning={other_course}",
                 f"/admin/certifikat?kund={other_customer}", f"/admin/kunder/{other_customer}/personer/export"]:
        r = ka.request.get(BASE + path)
        assert r.status in (403, 404), (path, r.status)
    # Förfalskat formulär: egna inställningssidan men annan kunds utbildning
    before = q(f"select title from course where id = '{other_course}'")
    ka.goto(f"{BASE}/admin/utbildningar/{course}?flik=installningar")
    ka.evaluate(f"document.querySelector('form[data-namn=Inställningar] input[name=id]').value = '{other_course}'")
    ka.fill("input[name=title]", "KAPAD")
    ka.click("text=Spara inställningar")
    ka.wait_for_timeout(1500)
    assert q(f"select title from course where id = '{other_course}'") == before
    step("kundadmin kommer inte åt annan kunds sidor, export, certifikat eller (via förfalskat formulär) data")

    # --- Kundadmin bjuder in utbildare och granskare ---
    t0 = time.time()
    for email, role, name in [(UT, "utbildare", "Ulf Utbildare"), (GR, "granskare", "Greta Granskare")]:
        ka.goto(f"{BASE}/admin/kunder/{cust}/anvandare")
        ka.fill("input[name=email]", email); ka.fill("input[name=name]", name)
        ka.locator(f"input[name=role][value={role}]").check()
        ka.get_by_role("button", name="Skicka inbjudan").click()
        expect(ka.get_by_text(f"Inbjudan skickad till {email}")).to_be_visible()
    # Samma e-post igen ger fel
    ka.fill("input[name=email]", UT); ka.get_by_role("button", name="Skicka inbjudan").click()
    expect(ka.get_by_text("Det finns redan ett konto")).to_be_visible()
    ut_ctx = b.new_context(viewport={"width": 1280, "height": 900}); ut, _ = accept_invite(ut_ctx, UT, "Ulf Utbildare")
    gr_ctx = b.new_context(viewport={"width": 1280, "height": 900}); gr, _ = accept_invite(gr_ctx, GR, "Greta Granskare")
    step("kundadmin bjuder in utbildare och granskare; dubblett nekas")

    # Utbildare: redigera ja, användare/logg nej, radera utbildning nej
    expect(ut.locator(".tabs")).not_to_contain_text("Användare")
    assert ut.goto(f"{BASE}/admin/kunder/{cust}/anvandare").status == 404
    assert ut.goto(f"{BASE}/admin/kunder/{cust}/logg").status == 404
    ut.goto(f"{BASE}/admin/utbildningar/{course}?flik=installningar")
    expect(ut.get_by_text("Bara kundadmin kan radera utbildningar")).to_be_visible()
    ut.fill("textarea[name=description]", "Ändrad av utbildaren")
    ut.click("text=Spara inställningar")
    expect(ut.locator("form[data-status=sparat]")).to_have_count(1)
    assert q(f"select description from course where id = '{course}'") == "Ändrad av utbildaren"
    expect(ut.locator("#certifikat")).to_have_count(0)  # kundens certifikatutseende är kundadmins
    step("utbildare: redigerar utbildning, ser inte användare/logg, kan inte radera")

    # Granskare: bara läsa
    gr.goto(f"{BASE}/admin/kunder/{cust}")
    expect(gr.get_by_role("button", name="+ Ny utbildning")).to_have_count(0)
    expect(gr.get_by_role("link", name="Redigera")).to_have_count(0)
    gr.goto(f"{BASE}/admin/utbildningar/{course}")
    expect(gr).to_have_url(re.compile("/statistik"))
    expect(gr.get_by_role("button", name="Skapa förhandsvisningslänk")).to_have_count(0)
    r = gr.request.get(f"{BASE}/admin/utbildningar/{course}/export"); assert r.status == 200
    gr.goto(f"{BASE}/admin/kunder/{cust}/personer")
    expect(gr.get_by_role("heading", name="Lägg till person")).to_have_count(0)
    step("granskare: bara statistik, export och register – inga ändringar")

    # --- Personregister ---
    ka.goto(f"{BASE}/admin/kunder/{cust}/personer")
    ka.fill("input[name=name]", "Anna Svensson"); ka.fill("input[name=email]", f"anna{run}@flyg.se")
    ka.fill("input[name=employee_no]", "1001"); ka.fill("input[name=group_name]", "Ramp")
    ka.get_by_role("button", name="Lägg till", exact=True).click()
    expect(ka.get_by_text("Anna Svensson är tillagd")).to_be_visible()
    ka.fill("input[name=name]", "Dubblett"); ka.fill("input[name=email]", f"ANNA{run}@flyg.se")
    ka.get_by_role("button", name="Lägg till", exact=True).click()
    expect(ka.get_by_text("Det finns redan en person med den e-postadressen")).to_be_visible()
    csv = os.path.join(OUT, f"import-{run}.csv")
    with open(csv, "w", encoding="cp1252") as f:  # som Excel på svenska sparar CSV
        f.write("Namn;E-post;Anställningsnummer;Avdelning\n")
        f.write(f"Bo Ek;bo{run}@flyg.se;1002;Säkerhet\n")
        f.write(f"Åsa Öberg;asa{run}@flyg.se;1003;Ramp\n")
        f.write(f"Anna Svensson-Lind;anna{run}@flyg.se;1001;Ramp\n")  # uppdaterar Anna (samma anst.nr)
        f.write(";ingen@flyg.se;1004;Ramp\n")  # saknar namn
    ka.set_input_files("input[name=file]", csv)
    ka.get_by_role("button", name="Importera").click()
    expect(ka.get_by_text("Import klar: 2 nya, 1 uppdaterade, 0 oförändrade, 1 rader hoppades över")).to_be_visible()
    expect(ka.get_by_text("Rad 5: Namn saknas")).to_be_visible()
    ka.reload()
    expect(ka.locator("table")).to_contain_text("Åsa Öberg")
    expect(ka.locator("table")).to_contain_text("Säkerhet")
    expect(ka.locator("table")).to_contain_text("Anna Svensson-Lind")
    ka.select_option("select[name=grupp]", "Ramp"); ka.get_by_role("button", name="Visa").click()
    expect(ka.locator("tbody tr")).to_have_count(2)
    with ka.expect_download() as dl:
        ka.get_by_role("link", name="Exportera till Excel").click()
    assert dl.value.suggested_filename.endswith(".xlsx")
    step("personregister: lägg till, dubblett nekas, import (cp1252-CSV, uppdatering, fel per rad), filter, export")

    # --- Utbildning för personregistret ---
    ka.goto(f"{BASE}/admin/utbildningar/{course}?flik=installningar")
    ka.select_option("select[name=access_mode]", "register")
    ka.click("text=Spara inställningar"); expect(ka.locator("form[data-status=sparat]")).to_have_count(1)
    ka.goto(f"{BASE}/admin/utbildningar/{course}")
    ka.get_by_role("button", name="Publicera").click(); ka.wait_for_timeout(800)
    slug = q(f"select slug from course where id = '{course}'")

    # Elev: e-post → mejl → knapp → kursen
    el_ctx = b.new_context(viewport={"width": 390, "height": 844})
    el = el_ctx.new_page()
    el.goto(f"{BASE}/k/{slug}")
    el.fill("input[name=email]", "okand@flyg.se"); el.get_by_role("button", name="Skicka inloggningslänk").click()
    expect(el.get_by_text("Om adressen finns i registret")).to_be_visible()  # samma svar för okänd adress
    t1 = time.time()
    el.goto(f"{BASE}/k/{slug}")
    el.fill("input[name=email]", f"Bo{run}@flyg.se"); el.get_by_role("button", name="Skicka inloggningslänk").click()
    expect(el.get_by_text("Om adressen finns i registret")).to_be_visible()
    url = link_in(latest_mail(f"bo{run}@flyg.se", after=t1), r"https?://\S+/in/\S+")
    el.goto(url)  # som en länkskanner: GET förbrukar inte länken
    el.goto(url)
    el.get_by_role("button", name="Logga in").click()
    el.wait_for_url(re.compile(f"/k/{slug}$"))
    expect(el.get_by_text("Inloggad som Bo Ek")).to_be_visible()
    el.get_by_role("button", name="Starta utbildningen").click()
    el.wait_for_url(re.compile("/kurs"))
    assert q(f"select count(*) from enrollment e join learner l on l.id = e.learner_id join person p on p.id = l.person_id where p.email = 'bo{run}@flyg.se'") == "1"
    el.goto(url); el.get_by_role("button", name="Logga in").click()
    expect(el.get_by_text("Länken fungerar inte längre")).to_be_visible()
    step("elev: inloggningslänk via e-post (okänd adress avslöjas inte, länkskanner förbrukar inte länken, engångs) → kursen kopplad till personen")

    # Mina utbildningar och delad dator
    el.goto(BASE + "/mina")
    expect(el.get_by_text("Inloggad som Bo Ek")).to_be_visible()
    expect(el.locator(".mina-list")).to_contain_text(f"Kurs hos Flygplatsen {run}")
    expect(el.locator(".mina-list")).to_contain_text("Påbörjad")
    el.get_by_role("button", name="Logga ut").click()
    expect(el.get_by_text("Inloggad som")).to_have_count(0)
    el.goto(f"{BASE}/k/{slug}/kurs")
    expect(el).to_have_url(re.compile(f"/k/{slug}$"))  # kakan för kursen gäller inte utan inloggning
    step("Mina utbildningar visar kursen; efter utloggning kommer nästa person inte åt kursen")

    # Personlig länk
    asa = q(f"select id from person where email = 'asa{run}@flyg.se'")
    ka.goto(f"{BASE}/admin/kunder/{cust}/personer/{asa}")
    ka.get_by_role("button", name="Skapa personlig länk").click()
    plink = ka.locator("input[readonly]").input_value()
    el.goto(plink)
    expect(el).to_have_url(re.compile("/mina$"))
    expect(el.get_by_text("Inloggad som Åsa Öberg")).to_be_visible()
    ka.get_by_role("button", name="Byt personlig länk").click()
    el.goto(BASE + "/mina")
    expect(el.get_by_role("heading", name="Mina utbildningar")).to_be_visible()
    expect(el.get_by_text("Inloggad som")).to_have_count(0)  # utloggad när länken byttes
    el.goto(plink); expect(el.get_by_text("Den personliga länken fungerar inte längre")).to_be_visible()
    step("personlig länk loggar in; byte av länk loggar ut och gamla länken slutar fungera")

    # Personsidan visar historiken
    bo = q(f"select id from person where email = 'bo{run}@flyg.se'")
    ka.goto(f"{BASE}/admin/kunder/{cust}/personer/{bo}")
    expect(ka.locator("table")).to_contain_text(f"Kurs hos Flygplatsen {run}")
    expect(ka.locator("table")).to_contain_text("Pågår")
    step("personsidan visar utbildningshistorik")

    # --- Säkerhet för konton ---
    # Spärr efter fem felaktiga lösenord
    x = b.new_context().new_page()
    for _ in range(5):
        x.goto(BASE + "/admin/login"); x.fill("input[name=email]", GR); x.fill("input[name=password]", "fel"); x.click("button[type=submit]")
    x.goto(BASE + "/admin/login"); x.fill("input[name=email]", GR); x.fill("input[name=password]", PW); x.click("button[type=submit]")
    expect(x.get_by_text("Kontot är spärrat i 15 minuter")).to_be_visible()
    q(f"update admin_user set locked_until = null where email = '{GR}'")
    step("fem felaktiga lösenord spärrar kontot")

    # Reservkod fungerar en gång
    x.goto(BASE + "/admin/login"); x.fill("input[name=email]", KA); x.fill("input[name=password]", PW); x.click("button[type=submit]")
    x.wait_for_url(re.compile("/login/kod"))
    x.fill("input[name=code]", ka_codes[0].lower()); x.get_by_role("button", name="Fortsätt").click()
    x.wait_for_url(re.compile("/admin/konto"))
    expect(x.get_by_text("Du har 9 kvar")).to_be_visible()
    y = b.new_context().new_page()
    y.goto(BASE + "/admin/login"); y.fill("input[name=email]", KA); y.fill("input[name=password]", PW); y.click("button[type=submit]")
    y.fill("input[name=code]", ka_codes[0]); y.get_by_role("button", name="Fortsätt").click()
    expect(y.get_by_text("Koden stämmer inte")).to_be_visible()
    step("reservkod loggar in en gång")

    # Glömt lösenord
    t2 = time.time()
    y.goto(BASE + "/admin/losenord"); y.fill("input[name=email]", UT); y.get_by_role("button", name="Skicka länk").click()
    expect(y.get_by_text("Om adressen har ett konto")).to_be_visible()
    url = link_in(latest_mail(UT, after=t2), r"https?://\S+/admin/losenord/\S+")
    y.goto(url)
    NEW = "ett-annat-langt-losenord"
    y.fill("input[name=password]", NEW); y.fill("input[name=password2]", NEW)
    y.get_by_role("button", name="Spara nytt lösenord").click()
    y.wait_for_url(re.compile("/admin/login\\?nytt=1"))
    ut.goto(f"{BASE}/admin/kunder/{cust}"); expect(ut).to_have_url(re.compile("/admin/login"))  # gamla sessionen gäller inte
    login(y, BASE, UT, NEW)
    step("glömt lösenord: länk via e-post, nytt lösenord, andra sessioner utloggade, tvåsteg krävs fortfarande")

    # Kundadmin nollställer granskarens tvåsteg och stänger av utbildaren
    ka.goto(f"{BASE}/admin/kunder/{cust}/anvandare")
    row = ka.locator("tr", has_text=GR); row.locator("summary").click()
    row.get_by_role("button", name="Nollställ tvåstegsverifiering").click()
    expect(ka.get_by_text(f"Tvåstegsverifieringen för {GR} är nollställd")).to_be_visible()
    gr.goto(f"{BASE}/admin/kunder/{cust}"); expect(gr).to_have_url(re.compile("/admin/login"))
    z = b.new_context().new_page()
    z.goto(BASE + "/admin/login"); z.fill("input[name=email]", GR); z.fill("input[name=password]", PW); z.click("button[type=submit]")
    z.wait_for_url(re.compile("/admin/tvasteg"))
    row = ka.locator("tr", has_text=UT); row.locator("summary").click()
    row.get_by_role("button", name="Stäng av kontot").click()
    expect(ka.locator("tr", has_text=UT)).to_contain_text("Avstängd")
    y.goto(f"{BASE}/admin/kunder/{cust}"); expect(y).to_have_url(re.compile("/admin/login"))
    step("nollställd tvåsteg kräver ny aktivering; avstängt konto loggas ut direkt")

    # Ändringslogg
    ka.goto(f"{BASE}/admin/kunder/{cust}/logg")
    for t in ["Bjöd in användare", "Importerade personer", "Nollställde tvåstegsverifiering", "Stängde av användare", "Loggade in med reservkod"]:
        expect(ka.locator("table")).to_contain_text(t)
    step("ändringsloggen visar händelserna")

    # Personradering (GDPR)
    ka.goto(f"{BASE}/admin/kunder/{cust}/personer/{bo}")
    ka.locator("summary", has_text="Radera personen").click()
    ka.fill("input[name=confirm]", "RADERA"); ka.get_by_role("button", name="Radera", exact=True).click()
    expect(ka.get_by_text("Personen är raderad")).to_be_visible()
    assert q(f"select count(*) from person where id = '{bo}'") == "0"
    assert q(f"select count(*) from learner where person_id = '{bo}'") == "0"
    step("radering av person tar bort person, elevposter och framsteg")

    print("ALLA TESTER GICK IGENOM")
    b.close()
