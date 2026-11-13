# Utbildningsplattform

Webbaserad plattform för att bygga och leverera utbildningar till kunder: kapitel och avsnitt med text, bild, video (Vimeo eller YouTube), bildspel (PDF/PowerPoint som bilder med pilar), kontrollfrågor och speakerröst per avsnitt, certifikat med QR-verifiering, statistik med Excel-export och automatisk GDPR-gallring.

## Innehåll
| Del | Adress |
|---|---|
| Superadmin | `/admin` |
| Elevens startsida | `/k/<utbildningens-kortnamn>` |
| Certifikat (PDF) | `/certifikat/<ID>` |
| Verifiering | `/verifiera/<ID>` |
| Förhandsvisning av certifikat | `/admin/certifikat?kund=<id>` eller `?utbildning=<id>` |
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

## Certifikat
- **Per kund** (Kunder → kund → Certifikatets utseende): mall (Klassisk, Modern, Minimal), dekorfärg, loggans storlek, sigill av/på, "Utfärdat via Briondo" av/på samt märken och extra grafik (t.ex. ISO-certifieringar). Logga och märken får vara SVG, PNG, JPG eller WebP.
- **Per utbildning** (Inställningar → Certifikat): rubrik, texter, extra rad, upp till två undertecknare med titel och inskannad namnteckning, och vilka av kundens märken som visas.
- PDF:en ritas med pdf-lib; bilder konverteras med sharp. Typsnitten Cormorant Garamond och Outfit (OFL) ligger i `lib/fonts`.

## Databasmigreringar
Nya filer i `db/migrations` körs automatiskt när servern startar (`instrumentation.ts`), med ett databaslås så att bara en instans migrerar. `npm run migrate` fungerar fortfarande för manuell körning.

## Test
Testet går igenom hela flödet: inloggning, kund, utbildning, innehåll, publicering, elev som genomför med fel och rätt svar, certifikat, verifiering, behörighet, statistik och Excel-export.

```bash
pip install playwright && playwright install chromium
npm run build && npm start      # i ett annat fönster
python3 tests/e2e.py
python3 tests/certifikat.py   # certifikatdesign, körs efter e2e.py
python3 tests/forhandsvisning.py   # varning vid osparade ändringar + förhandsvisning, körs efter e2e.py (behöver DATABASE_URL)
python3 tests/kundgranskning.py    # förhandsvisningslänk för kund, körs efter e2e.py (behöver DATABASE_URL och pypdf)
python3 tests/kundkonton.py        # konton, roller, avskild data, personregister, elevinloggning (kräver MAIL_DIR=tests/out/mail på servern)
python3 tests/bildspel.py          # YouTube, bildspel från PDF/bilder, bredare innehållsyta, körs efter e2e.py (behöver DATABASE_URL)
python3 tests/speakerljud.py       # speakerröst per avsnitt, körs efter e2e.py (kräver node tests/fake-storage.mjs, se filen)
python3 tests/speakerljud-autostart.py  # automatisk start av speakerrösten, samma förutsättningar
python3 tests/bildspel-ljud.py     # bildspel som följer speakerrösten, samma förutsättningar
python3 tests/ai-rost.py          # AI-uppläsning (kräver även node tests/fake-gemini.mjs, se filen)
```

## Bildspel
Blocket *Bildspel (PDF/PPT)* visar flera bilder i samma yta med pilar, tangentbord, svep och helskärm. En PDF görs om till en bild per sida **i adminens webbläsare** (pdf.js, 1920 px breda JPG), och varje sida laddas upp för sig så att storleksgränsen för serveranrop aldrig nås. PowerPoint sparas först som PDF. Valfritt krav: eleven måste bläddra igenom alla bilder (sparas i `video_progress` som 100 %).

## Speakerröst
Varje avsnitt kan ha en inspelad speakerröst (MP3, M4A, AAC eller WAV, högst 50 MB) som spelas överst i avsnittet och följer med när eleven scrollar (hastighet väljs i spelarens egen meny; position och hastighet sparas i webbläsaren). Inget lyssningskrav. Filerna ligger i **Supabase Storage**, den publika bucketen `avsnittsljud` med slumpade filnamn, inte i databasen: Vercel stoppar svar över ca 4,5 MB och Safari spelar bara ljud från servrar som stöder delvisa hämtningar. Adminens webbläsare laddar upp direkt till Storage via en tillfällig länk (`lib/audio.ts`).
- Kräver `SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` (se `.env.example`). Utan dem fungerar allt annat och editorn visar en upplysning.
- Migreringen `008_section_audio.sql` lägger till `section.audio` och skapar bucketen. Går det inte att skapa bucketen skapas den för hand under Storage i Supabase (namn `avsnittsljud`, Public).
- **Starta speakerrösten automatiskt** (utbildningens inställningar, av som standard, migrering `009_audio_autoplay.sql`): ljudet startar när eleven öppnar ett avsnitt, om eleven inte redan lyssnat klart i den webbläsaren. Webbläsare spärrar ljud tills eleven har tryckt någonstans; då visas knappen *Tryck för att lyssna*. En enda ljudspelare används för hela besöket och låses upp av elevens första tryck, så att även iPhone kan starta följande avsnitt av sig själv.
- **AI-uppläsning** (`lib/tts.ts`): superadmin kan skapa speakerrösten från text med Google Gemini TTS (`gemini-3.8-flash-tts`, Interactions API). Texten förifylls med avsnittets text, röst (30 st) och stil väljs; lång text delas i delar (högst 3 000 tecken, tre åt gången), ljudet kodas till MP3 (24 kHz mono, 64 kbit/s) och sparas i Storage som en uppladdad fil. Kräver `GEMINI_API_KEY` (betalnivå, så att texten inte används av Google för träning).
- Byts eller tas ljudet bort, eller raderas avsnittet, kapitlet eller utbildningen, tas filen bort i Storage. Kopieras en utbildning kopieras ljudfilerna.

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

## Kundkonton och personregister (steg A)
- **Användare:** superadmin (Briondo) eller kundanvändare med roll *Kundadmin*, *Utbildningsansvarig* eller *Läsbehörighet*. Inbjudan via e-post, lösenord minst 12 tecken, **tvåstegsverifiering krävs för alla** (TOTP-app + 10 reservkoder). Fem felaktiga försök spärrar kontot i 15 minuter.
- **Behörighet** kontrolleras på servern i varje sida och åtgärd (`lib/access.ts`). En kundanvändare ser bara sin egen kund – andra kunders sidor ger 404.
- **Ändringslogg** per kund (`audit_log`).
- **Personregister** per kund: namn, e-post, anställningsnummer, grupp. Import från Excel/CSV (känner igen personer på anställningsnummer eller e-post), export till Excel.
- **Åtkomstläge "Bara personer i personregistret":** eleven skriver sin e-post och får en inloggningslänk (30 min, engångs, löses in med en knapp så att e-postskannrar inte förbrukar den), eller använder sin personliga länk `/p/<nyckel>`. `/mina` visar personens utbildningar och certifikat.
- **E-post** via SMTP (se `.env.example`). Utan SMTP visas inbjudningslänkar i admin för att skickas manuellt.
