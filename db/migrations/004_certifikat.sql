-- Certifikatdesign per kund och certifikattexter, underskrifter och märken per utbildning.

-- Kundens certifikatprofil
alter table customer add column if not exists cert_template text not null default 'klassisk'
  check (cert_template in ('klassisk', 'modern', 'minimal'));
alter table customer add column if not exists cert_accent text not null default '#B08D57';
alter table customer add column if not exists cert_logo_size text not null default 'M'
  check (cert_logo_size in ('S', 'M', 'L'));
alter table customer add column if not exists cert_seal boolean not null default true;
alter table customer add column if not exists cert_show_briondo boolean not null default true;

-- Extra grafik på certifikatet, t.ex. ISO-certifieringar, branschmärken eller partnerloggor
create table if not exists cert_badge (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete cascade,
  media_id uuid not null references media(id) on delete cascade,
  label text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cert_badge_customer on cert_badge (customer_id, position);
alter table cert_badge enable row level security;

-- Utbildningens certifikattexter och underskrifter
alter table course add column if not exists cert_title text not null default 'Certifikat';
alter table course add column if not exists cert_intro text not null default 'Härmed intygas att';
alter table course add column if not exists cert_body text not null default 'har genomfört och godkänts i utbildningen';
alter table course add column if not exists cert_note text not null default '';
alter table course add column if not exists cert_signer_title text not null default '';
alter table course add column if not exists cert_signature_media_id uuid references media(id) on delete set null;
alter table course add column if not exists cert_signer2 text not null default '';
alter table course add column if not exists cert_signer2_title text not null default '';
alter table course add column if not exists cert_signature2_media_id uuid references media(id) on delete set null;
-- Märken som inte ska visas på just denna utbildnings certifikat (alla visas som standard)
alter table course add column if not exists cert_hidden_badges uuid[] not null default '{}';
