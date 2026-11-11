-- Kundkonton (steg A): användare med roll per kund, tvåstegsverifiering, engångslänkar,
-- ändringslogg, personregister och inloggning för elever. Bara tillägg – äldre kod fungerar fortfarande.

-- Användare: superadmin (ingen kund) eller kundanvändare med roll.
alter table admin_user add column if not exists name text not null default '';
alter table admin_user add column if not exists role text not null default 'superadmin';
alter table admin_user add column if not exists customer_id uuid references customer(id) on delete cascade;
alter table admin_user alter column password_hash drop not null;              -- inbjuden men inte aktiverad
alter table admin_user add column if not exists totp_secret text;             -- krypterad med SESSION_SECRET
alter table admin_user add column if not exists totp_enabled boolean not null default false;
alter table admin_user add column if not exists recovery_codes text[] not null default '{}'; -- sha256-hashar
alter table admin_user add column if not exists session_version int not null default 1;
alter table admin_user add column if not exists failed_logins int not null default 0;
alter table admin_user add column if not exists locked_until timestamptz;
alter table admin_user add column if not exists disabled boolean not null default false;
alter table admin_user add column if not exists last_login_at timestamptz;
alter table admin_user add column if not exists invited_by uuid references admin_user(id) on delete set null;

alter table admin_user drop constraint if exists admin_user_role_check;
alter table admin_user add constraint admin_user_role_check
  check (role in ('superadmin', 'kundadmin', 'utbildare', 'granskare'));
alter table admin_user drop constraint if exists admin_user_role_customer_check;
alter table admin_user add constraint admin_user_role_customer_check
  check ((role = 'superadmin') = (customer_id is null));
create index if not exists admin_user_customer on admin_user (customer_id);

-- Engångslänkar för användare (inbjudan, nytt lösenord). Bara hash av nyckeln sparas.
create table if not exists user_token (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references admin_user(id) on delete cascade,
  kind text not null check (kind in ('invite', 'reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table user_token enable row level security;

-- Ändringslogg: vem gjorde vad.
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references admin_user(id) on delete set null,
  user_email text,
  customer_id uuid references customer(id) on delete cascade,
  action text not null,
  detail jsonb not null default '{}'
);
create index if not exists audit_log_customer on audit_log (customer_id, at desc);
alter table audit_log enable row level security;

-- Personregister per kund.
create table if not exists person (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete cascade,
  name text not null,
  email text,                          -- gemener
  employee_no text,
  group_name text not null default '',
  access_key text unique,              -- personlig länk (/p/<nyckel>), null = ingen
  session_version int not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists person_email on person (customer_id, email) where email is not null;
create unique index if not exists person_employee_no on person (customer_id, employee_no) where employee_no is not null;
create index if not exists person_customer on person (customer_id, name);
alter table person enable row level security;

-- Inloggningslänk via e-post för personer (engångs, kort giltighet).
create table if not exists person_token (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id) on delete cascade,
  token_hash text not null unique,
  next_path text not null default '/mina',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table person_token enable row level security;

-- En elevpost per person och kund kopplas till personen, så att alla utbildningar hamnar på samma person.
alter table learner add column if not exists person_id uuid references person(id) on delete set null;
create unique index if not exists learner_person on learner (person_id) where person_id is not null;

-- Nytt åtkomstläge: bara personer i registret (inloggningslänk via e-post eller personlig länk).
alter table course drop constraint if exists course_access_mode_check;
alter table course add constraint course_access_mode_check check (access_mode in ('name', 'name_email', 'register'));
