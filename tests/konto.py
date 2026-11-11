"""Gemensam inloggning för testerna: lösenord + tvåstegsverifiering (TOTP).
Första inloggningen aktiverar tvåstegsverifiering och sparar nyckeln i tests/out/totp.json."""
import base64, hashlib, hmac, json, os, re, struct, time
from playwright.sync_api import expect

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
STORE = os.path.join(OUT, "totp.json")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@exempel.se")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "testlosenord123")


def totp(secret, at=None):
    key = base64.b32decode(secret.replace(" ", "").upper() + "=" * (-len(secret.replace(" ", "")) % 8))
    step = int((at or time.time()) // 30)
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 15
    return str((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000).zfill(6)


def _load():
    try:
        return json.load(open(STORE))
    except Exception:
        return {}


def secret_for(email):
    return _load().get(email.lower())


def _save(email, secret):
    os.makedirs(OUT, exist_ok=True)
    d = _load(); d[email.lower()] = secret
    json.dump(d, open(STORE, "w"))


def finish_setup(page, email):
    """På sidan Aktivera tvåstegsverifiering: läs nyckeln, skriv koden, returnera reservkoderna."""
    secret = page.locator("code.secret").inner_text().replace(" ", "")
    _save(email, secret)
    page.fill("input[name=code]", totp(secret))
    page.get_by_role("button", name="Aktivera").click()
    codes = page.locator("ul.recovery li")
    expect(codes).to_have_count(10)
    recovery = codes.all_inner_texts()
    page.get_by_role("link", name=re.compile("Jag har sparat koderna")).click()
    return recovery


def login(page, base, email=ADMIN_EMAIL, password=ADMIN_PASSWORD):
    page.goto(base + "/admin/login")
    page.fill("input[name=email]", email)
    page.fill("input[name=password]", password)
    page.click("button[type=submit]")
    page.wait_for_url(re.compile(r"/admin/(tvasteg|login/kod)"))
    if "/tvasteg" in page.url:
        finish_setup(page, email)
    else:
        page.fill("input[name=code]", totp(secret_for(email)))
        page.get_by_role("button", name="Fortsätt").click()
    page.wait_for_url(lambda u: "/admin/login" not in u and "/tvasteg" not in u)
    # Ladda sidan på nytt så att testerna börjar på ett nytt dokument (networkidle m.m.).
    page.goto(page.url)


def latest_mail(to, after=0.0, timeout=10):
    """Senaste mejlet till adressen (MAIL_DIR=tests/out/mail)."""
    d = os.path.join(OUT, "mail")
    end = time.time() + timeout
    while time.time() < end:
        files = sorted(f for f in os.listdir(d) if f.endswith(".json")) if os.path.isdir(d) else []
        for f in reversed(files):
            p = os.path.join(d, f)
            if os.path.getmtime(p) < after:
                continue
            m = json.load(open(p))
            if m["to"].lower() == to.lower():
                return m
        time.sleep(0.2)
    raise AssertionError(f"inget mejl till {to}")


def link_in(mail, pattern):
    m = re.search(pattern, mail["text"])
    assert m, mail["text"]
    return m.group(0)
