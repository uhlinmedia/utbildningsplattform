"""Videokrav med Vimeo: videon ska fortsätta spela när kravet uppnås och sidan laddas om (tidigare
försvann den). Vimeo-spelaren ersätts av en låtsasspelare som skickar samma meddelanden som Vimeo.
Kör efter e2e.py. Kräver DATABASE_URL."""
import re, os, subprocess
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
def step(msg): print("✓", msg, flush=True)

# Låtsas-Vimeo: svarar "ready" och skickar timeupdate var 100:e ms (0,5 s per steg, 20 s lång video).
FAKE = """<!doctype html><body style="background:#123;color:#fff">fake vimeo<script>
let t = 0, timer = null;
const send = (m) => parent.postMessage(JSON.stringify(m), '*');
window.sent = 0;
addEventListener('message', (e) => {
  let d = e.data; try { d = JSON.parse(d); } catch {}
  if (d && d.method === 'addEventListener' && d.value === 'timeupdate' && !timer) {
    timer = setInterval(() => { t = Math.min(20, t + 0.5); window.sent++; document.title = 'sent ' + window.sent;
      send({ event: 'timeupdate', data: { seconds: t, duration: 20, percent: t / 20 } }); }, 100);
  } else if (d && d.method) { send({ method: d.method, value: null }); }
});
send({ event: 'ready', player_id: null });
</script></body>"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    ctx.route(re.compile(r"https://player\.vimeo\.com/.*"), lambda r: r.fulfill(status=200, content_type="text/html", body=FAKE))
    a = ctx.new_page()
    a.goto(BASE + "/admin/login")
    a.fill("input[name=email]", os.environ.get("ADMIN_EMAIL", "admin@exempel.se"))
    a.fill("input[name=password]", os.environ.get("ADMIN_PASSWORD", "testlosenord123"))
    a.click("button[type=submit]")
    expect(a.get_by_role("heading", name="Kunder")).to_be_visible()
    a.locator("a[href^='/admin/kunder/']").first.click()
    a.wait_for_url(re.compile(r"/admin/kunder/"))
    a.locator("a[href^='/admin/utbildningar/']").first.click()
    a.wait_for_url(re.compile(r"/admin/utbildningar/[0-9a-f-]+"))

    # Ett Vimeo-block med krav 10 % i första avsnittet
    n = a.locator(".block-card:has(input[name=vimeo])").count()
    a.get_by_role("button", name="Video", exact=True).click()
    expect(a.locator(".block-card:has(input[name=vimeo])")).to_have_count(n + 1)
    vid = a.locator(".block-card:has(input[name=vimeo])").last
    vid.locator("input[name=vimeo]").fill("https://vimeo.com/111222333")
    vid.locator("input[name=required_percent]").fill("10")
    vid.get_by_role("button", name="Spara block").click()
    expect(vid.locator("form.block-body[data-status=sparat]")).to_have_count(1)
    block_id = vid.locator("input[name=block_id]").get_attribute("value")

    with ctx.expect_page() as pv_info:
        a.get_by_role("link", name="Förhandsvisa som elev").click()
    pv = pv_info.value
    pv.wait_for_load_state()
    pv.fill("input[name=name]", "Testare")
    if pv.locator("input[name=email]").count():
        pv.fill("input[name=email]", "test@exempel.se")
    pv.click("text=Starta utbildningen")
    pv.wait_for_url(re.compile("/kurs"))
    refreshes = []
    pv.on("request", lambda r: r.headers.get("rsc") == "1" and "/kurs" in r.url and refreshes.append(r.url))

    iframe = pv.locator(f"iframe[src*='player.vimeo.com/video/111222333']")
    expect(iframe).to_have_count(1)
    iframe.evaluate("el => { el.dataset.markerad = 'ja'; }")
    expect(pv.get_by_text("Se minst 10 % av videon")).to_be_visible()
    expect(pv.get_by_text("Videon är sedd – du kan gå vidare.")).to_be_visible(timeout=15000)
    pv.wait_for_timeout(1500)
    assert refreshes, "sidan laddades inte om när kravet uppnåddes"
    # Samma iframe finns kvar och spelaren fortsätter skicka tid
    expect(pv.locator("iframe[data-markerad=ja]")).to_have_count(1)
    vimeo = lambda: [f for f in pv.frames if "111222333" in f.url][0].evaluate("window.sent")
    sent1 = vimeo()
    pv.wait_for_timeout(1000)
    sent2 = vimeo()
    assert sent2 > sent1, (sent1, sent2)
    step(f"Vimeo: kravet 10 % uppnått, sidan laddades om ({len(refreshes)} gång), videon finns kvar och spelar vidare")
    assert len(refreshes) == 1, refreshes

    r = subprocess.run(["psql", os.environ["DATABASE_URL"], "-tAc",
        f"select max(max_percent) from video_progress where block_id = '{block_id}'"], check=True, capture_output=True, text=True)
    assert int(r.stdout.strip()) >= 10, r.stdout
    step(f"sedd andel sparad ({r.stdout.strip()} %)")

    # Städa: ta bort testblocket
    a.reload()
    a.locator(f".block-card:has(input[name=block_id][value='{block_id}'])").get_by_role("button", name="Ta bort blocket").click()
    expect(a.locator(f"input[name=block_id][value='{block_id}']")).to_have_count(0)
    print("ALLA TESTER GICK IGENOM")
    b.close()
