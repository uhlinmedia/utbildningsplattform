-- Förhandsvisningslänk för kund: hemlig länk per utbildning som låter kunden gå igenom
-- utbildningen som förhandsvisning (även som utkast). Byts eller stängs av i admin.
alter table course add column if not exists preview_token text unique;

-- Vilken länk en förhandsvisning startades med. Stängs länken av eller byts den ut
-- slutar förhandsvisningen fungera (gäller inte superadmins egna förhandsvisningar).
alter table enrollment add column if not exists review_token text;

-- Certifikat från förhandsvisningar är testcertifikat: märks i PDF:en och vid verifiering.
alter table certificate add column if not exists is_test boolean not null default false;
update certificate set is_test = true
  where enrollment_id in (select id from enrollment where is_preview);
