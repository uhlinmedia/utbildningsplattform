"""Gallringen får inte radera bilder som används i bildspel (B55), och saknade bilder visas i admin.
Kör efter bildspel.py (behöver ett bildspel med minst två bilder). Kräver DATABASE_URL för psql och att servern
startats med CRON_SECRET (samma värde i miljön här, standard "x")."""
import json, os, re, subprocess, urllib.request, uuid
from konto import login
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
SECRET = os.environ.get("CRON_SECRET", "x")
def q(sql): return subprocess.run(["psql", os.environ["DATABASE_URL"], "-Atc", sql], capture_output=True, text=True, check=True).stdout.strip()
def step(msg): print("✓", msg, flush=True)

block = q("select id from block where type = 'slides' and jsonb_array_length(coalesce(content->'slides','[]')) >= 2 order by id limit 1")
assert block, "testet behöver ett bildspel med minst två bilder (kör bildspel.py först)"
slide_ids = q(f"select string_agg(sl->>'media_id', ',') from block b, jsonb_array_elements(b.content->'slides') sl where b.id = '{block}'").split(",")
image_ids = [x for x in q("select string_agg(content->>'media_id', ',') from block where type = 'image' and content ? 'media_id'").split(",") if x]

# Alla bilder görs "gamla" (över ett dygn) och en oanvänd gammal bild läggs till
ids_sql = ",".join(f"'{x}'" for x in slide_ids + image_ids)
q(f"update media set created_at = now() - interval '2 days' where id in ({ids_sql})")
orphan = str(uuid.uuid4())
q(f"insert into media (id, filename, mime, data, created_at) values ('{orphan}', 'gammal.png', 'image/png', '\\x00'::bytea, now() - interval '2 days')")

req = urllib.request.Request(BASE + "/api/cron/gallring", headers={"Authorization": f"Bearer {SECRET}"})
with urllib.request.urlopen(req) as r:
    assert r.status == 200, r.status
assert q(f"select count(*) from media where id in ({ids_sql})") == str(len(slide_ids) + len(image_ids)), "gallringen raderade bilder som används"
assert q(f"select count(*) from media where id = '{orphan}'") == "0", "oanvänd gammal bild ska raderas"
step(f"gallringen behåller {len(slide_ids)} bildspelsbilder och {len(image_ids)} bildblocksbilder, raderar oanvänd bild")

# Saknad bild: peka första bilden i bildspelet på en bild som inte finns
original = q(f"select content::text from block where id = '{block}'")
ghost = str(uuid.uuid4())
q(f"update block set content = jsonb_set(content, '{{slides,0,media_id}}', to_jsonb('{ghost}'::text)) where id = '{block}'")
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        a = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
        errors = []
        a.on("pageerror", lambda e: errors.append(str(e)))
        login(a, BASE)
        card = a.locator(".media-missing-card")
        expect(card).to_contain_text("1 bild saknas")
        card.locator("a").first.click()
        a.wait_for_url(re.compile(r"\?s="))
        sl = a.locator(f".block-card:has(.slide-upload)").filter(has=a.locator(".slide-missing"))
        expect(sl).to_have_count(1)
        expect(sl.locator(".media-missing-note")).to_contain_text("1 bild saknas")
        expect(sl.locator(".slide-list li").first).to_have_class(re.compile("slide-missing"))
        expect(sl.locator(".slide-list li").first).to_contain_text("Bilden saknas")
        expect(sl.locator(".slide-list li").nth(1).locator("img")).to_be_visible()
        step("saknad bild: listas på startsidan med länk, markeras i editorn med Byt bild-hänvisning")

        q(f"update block set content = $${original}$$::jsonb where id = '{block}'")
        a.goto(BASE + "/admin"); a.wait_for_load_state("networkidle")
        expect(a.locator(".media-missing-card")).to_have_count(0)
        step("när bilden finns igen försvinner varningen")
        assert not errors, errors
        b.close()
finally:
    q(f"update block set content = $${original}$$::jsonb where id = '{block}'")
print("Alla tester för gallring av bilder gick igenom.")
