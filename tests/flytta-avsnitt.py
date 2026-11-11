"""Test av att flytta avsnitt mellan kapitel i editorn. Kör efter e2e.py (behöver minst två kapitel)."""
import re, os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
def step(msg): print("✓", msg, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    a = b.new_page(viewport={"width": 1280, "height": 900})
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

    tree = a.locator(".editor-tree")
    def tree_text(): return re.sub(r"\s+", " ", tree.inner_text())
    chapters = a.locator(".editor-tree summary.tree-ch")
    assert chapters.count() >= 2, "testet behöver minst två kapitel"
    secs = a.locator("a.tree-sec")
    first_name = re.sub(r"^\d+\.\d+ ", "", secs.first.inner_text())
    blocks_before = None

    # Välj första avsnittet och flytta det till kapitel 2 med rullistan
    secs.first.click(); a.wait_for_url(re.compile(r"\?s="))
    sec_id = a.url.split("s=")[1]
    blocks_before = a.locator(".block-card").count()
    sel = a.locator("select[name=chapter_id]")
    expect(sel.locator("option:checked")).to_contain_text("(nu)")
    sel.select_option(index=1)
    expect(a.locator(".unsaved-bar")).to_contain_text("Flytta avsnitt")
    a.get_by_role("button", name="Flytta", exact=True).click()
    expect(a.locator("span.small.muted", has_text="Kapitel:")).to_contain_text(chapters.nth(1).inner_text().split(". ", 1)[1])
    # Avsnittet ligger nu sist i kapitel 2, med samma id och alla block kvar
    ch2 = a.locator(".editor-tree > div").nth(1)
    expect(ch2.locator("a.tree-sec").last).to_contain_text(first_name)
    expect(ch2.locator("a.tree-sec").last).to_have_attribute("href", re.compile(sec_id))
    assert a.locator(".block-card").count() == blocks_before
    expect(a.locator(".unsaved-bar")).to_have_count(0)
    step("avsnitt flyttat till annat kapitel med rullistan, block kvar")

    # ↑ överst i kapitlet flyttar till föregående kapitel (sist), ↓ nederst till nästa kapitel (först)
    while not ch2.locator("a.tree-sec").first.get_attribute("href").endswith(sec_id):
        a.get_by_role("button", name="Flytta avsnittet uppåt").click()
        a.wait_for_timeout(500)
    a.get_by_role("button", name="Flytta avsnittet uppåt").click()
    ch1 = a.locator(".editor-tree > div").nth(0)
    expect(ch1.locator("a.tree-sec").last).to_have_attribute("href", re.compile(sec_id))
    step("↑ överst i kapitel 2 → sist i kapitel 1")
    a.get_by_role("button", name="Flytta avsnittet nedåt").click()
    expect(ch2.locator("a.tree-sec").first).to_have_attribute("href", re.compile(sec_id))
    step("↓ nederst i kapitel 1 → först i kapitel 2")

    # Tillbaka till ursprungsläget: först i kapitel 1
    a.get_by_role("button", name="Flytta avsnittet uppåt").click()
    expect(ch1.locator("a.tree-sec").last).to_have_attribute("href", re.compile(sec_id))
    while not ch1.locator("a.tree-sec").first.get_attribute("href").endswith(sec_id):
        a.get_by_role("button", name="Flytta avsnittet uppåt").click()
        a.wait_for_timeout(500)
    a.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "flytta-avsnitt.png"))
    assert not errors, errors
    print("ALLA TESTER GICK IGENOM")
    b.close()
