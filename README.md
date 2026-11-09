# Utbildningsplattform

Webbaserad plattform för att bygga och leverera utbildningar till kunder: kapitel och avsnitt med text, bild, Vimeo-video och kontrollfrågor, certifikat med QR-verifiering, statistik med Excel-export och automatisk GDPR-gallring.

## Innehåll
| Del | Adress |
|---|---|
| Superadmin | `/admin` |
| Elevens startsida | `/k/<utbildningens-kortnamn>` |
| Certifikat (PDF) | `/certifikat/<ID>` |
| Verifiering | `/verifiera/<ID>` |
| Gallring (daglig) | `/api/cron/gallring` |

## Köra lokalt
Kräver Node 20+ och PostgreSQL 16.

```bash
npm install
cp .env.example .env.local      # fyll i värdena
npm run migrate                 # skapar tabellerna
npm run create-admin -- du@exempel.se "ett-langt-losenord"
npm run dev                     # http://localhost:3000
```

## Test
Testet går igenom hela flödet: inloggning, kund, utbildning, innehåll, publicering, elev som genomför med fel och rätt svar, certifikat, verifiering, behörighet, statistik och Excel-export.

```bash
pip install playwright && playwright install chromium
npm run build && npm start      # i ett annat fönster
python3 tests/e2e.py
```

## Driftsättning (Supabase + Vercel)

### 1. Databas – Supabase
1. Skapa ett konto på supabase.com och ett nytt projekt. Välj region **Frankfurt (eu-central-1)** eller **Stockholm (eu-north-1)**.
2. Gå till *Project Settings → Database → Connection string* och kopiera adressen för **Transaction pooler**. Byt `[YOUR-PASSWORD]` mot databaslösenordet.
3. Kör migreringarna och skapa ditt adminkonto från din dator:
   ```bash
   DATABASE_URL="<adressen>" npm run migrate
   DATABASE_URL="<adressen>" npm run create-admin -- du@exempel.se "ett-langt-losenord"
   ```

### 2. Webbapp – Vercel
1. Skapa ett konto på vercel.com och välj *Add New → Project*. Importera GitHub-repot.
2. Lägg in miljövariablerna från `.env.example` under *Environment Variables*.
3. Klicka *Deploy*. Funktionerna körs i Frankfurt (`vercel.json`). Gallringen körs varje natt kl. 03:17 UTC.
4. Koppla egen domän under *Settings → Domains* och uppdatera `APP_URL`.

### 3. Vimeo
Under videons inställningar i Vimeo: sätt *Privacy → Where can this be embedded?* till din domän. Plattformen bäddar in med spårning avstängd (`dnt=1`).

## Säkerhet och dataskydd
- Superadmin loggar in med e-post och lösenord (bcrypt) och får en signerad sessionscookie som gäller i 12 timmar.
- Elever identifieras med en slumpad token i en httpOnly-cookie per utbildning.
- Certifikat kan bara laddas ner av eleven själv eller av superadmin; verifieringssidan visar namn, utbildning och datum.
- Elevdata raderas automatiskt efter kundens gallringstid (12/24/36 månader). Certifikat-ID och datum sparas utan namn.
- All text i textblock tolkas som enkel markdown; HTML körs aldrig.

## Kodstruktur
```
app/admin/        superadmin: kunder, editor, statistik, export
app/k/[slug]/     elevflödet: start, kurs, klar
app/certifikat/   certifikat-PDF
app/verifiera/    verifiering
app/api/cron/     gallring
lib/              databas, inloggning, framsteg, certifikat, statistik
db/migrations/    SQL-schema
scripts/          migrering och skapa admin
tests/            end-to-end-test
```
