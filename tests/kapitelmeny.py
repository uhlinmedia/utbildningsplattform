"""Kapitelmenyn i editorn: pilen fäller ihop/ut kapitlets avsnitt (sparas i webbläsaren), klick på namnet visar
kapitlets inställningar. Kör efter e2e.py (behöver minst två kapitel)."""
import re, os
from konto import login
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
def step(msg): print("✓", msg, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    a = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
    errors = []
    a.on("pageerror", lambda e: errors.append(str(e)))
    login(a, BASE)
    a.locator("a[href^='/admin/kunder/']").first.click()
    a.locator("a[href^='/admin/utbildningar/']").first.click()
    a.wait_for_url(re.compile(r"/admin/utbildningar/"))
    course_url = a.url.split("?")[0]

    chs = a.locator(".editor-tree .tree-chapter")
    assert chs.count() >= 2, "testet behöver minst två kapitel"
    first_sec = chs.nth(0).locator("a.tree-sec").first
    first_sec.click(); a.wait_for_url(re.compile(r"\?s="))
    ch2 = chs.nth(1)
    n2 = ch2.locator("a.tree-sec").count()

    # Inställningarna är dolda tills man klickar på namnet
    expect(ch2.locator(".tree-ch-settings")).to_be_hidden()
    expect(ch2.locator("a.tree-sec").first).to_be_visible()

    # Pilen fäller ihop kapitel 2: avsnitten döljs, antalet visas
    toggle = ch2.locator(".tree-toggle")
    expect(toggle).to_have_attribute("aria-expanded", "true")
    toggle.click()
    expect(toggle).to_have_attribute("aria-expanded", "false")
    expect(ch2.locator("a.tree-sec").first).to_be_hidden()
    expect(ch2.locator(".tree-count")).to_have_text(f" ({n2})")
    expect(ch2.locator(".tree-ch-settings")).to_be_hidden()
    step("pilen fäller ihop kapitlet; antal avsnitt visas")

    # Ihopfällt kapitel är kvar efter omladdning
    a.reload(); a.wait_for_load_state("networkidle")
    expect(chs.nth(1).locator(".tree-toggle")).to_have_attribute("aria-expanded", "false")
    expect(chs.nth(1).locator("a.tree-sec").first).to_be_hidden()
    step("ihopfällt kapitel kommer webbläsaren ihåg")

    # Klick på namnet visar inställningarna (utan att fälla ut avsnitten)
    ch2 = chs.nth(1)
    ch2.locator(".tree-ch-name").click()
    expect(ch2.locator(".tree-ch-settings")).to_be_visible()
    expect(ch2.locator(".tree-ch-settings input[aria-label='Kapitlets namn']")).to_be_visible()
    expect(ch2.locator("a.tree-sec").first).to_be_hidden()
    ch2.locator(".tree-ch-name").click()
    expect(ch2.locator(".tree-ch-settings")).to_be_hidden()
    step("klick på kapitelnamnet visar och döljer kapitlets inställningar")

    # Kapitlet med det öppna avsnittet visas alltid utfällt
    sec_href = None
    ch2.locator(".tree-toggle").click()
    sec_href = ch2.locator("a.tree-sec").first.get_attribute("href")
    ch2.locator(".tree-toggle").click()
    a.goto(BASE + sec_href); a.wait_for_load_state("networkidle")
    expect(chs.nth(1).locator(".tree-toggle")).to_have_attribute("aria-expanded", "true")
    expect(chs.nth(1).locator("a.tree-sec").first).to_be_visible()
    step("kapitlet med det öppna avsnittet visas utfällt")

    # Återställ: fäll ut alla
    a.evaluate("() => Object.keys(localStorage).filter(k => k.startsWith('briondo-ihopfallda-kapitel-')).forEach(k => localStorage.removeItem(k))")
    assert not errors, errors
    b.close()
    print("Alla tester för kapitelmenyn gick igenom.")
