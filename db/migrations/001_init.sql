-- Utbildningsplattform – grundschema
create extension if not exists pgcrypto;

create table admin_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table media (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

create table customer (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#0E6B66',
  logo_media_id uuid references media(id) on delete set null,
  contact_name text,
  contact_email text,
  retention_months int not null default 24 check (retention_months in (12, 24, 36)),
  created_at timestamptz not null default now()
);

create table course (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete cascade,
  title text not null,
  slug text not null unique,
  description text not null default '',
  access_mode text not null default 'name_email' check (access_mode in ('name', 'name_email')),
  nav_mode text not null default 'linear' check (nav_mode in ('free', 'linear', 'sweep')),
  pass_percent int not null default 80 check (pass_percent between 0 and 100),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  show_answers boolean not null default true,
  certificate_enabled boolean not null default true,
  cert_signer text not null default '',
  cert_valid_months int,
  status text not null default 'draft' check (status in ('draft', 'published')),
  closes_at date,
  created_at timestamptz not null default now()
);

create table chapter (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references course(id) on delete cascade,
  position int not null,
  title text not null
);

create table section (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapter(id) on delete cascade,
  position int not null,
  title text not null
);

create table block (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references section(id) on delete cascade,
  position int not null,
  type text not null check (type in ('text', 'image', 'video', 'quiz', 'tip')),
  content jsonb not null default '{}'
);

create table learner (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete cascade,
  name text not null,
  email text,
  created_at timestamptz not null default now()
);

create table enrollment (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references learner(id) on delete cascade,
  course_id uuid not null references course(id) on delete cascade,
  token text not null unique,
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  completed_at timestamptz,
  passed boolean not null default false,
  score_percent int
);

create table section_progress (
  enrollment_id uuid not null references enrollment(id) on delete cascade,
  section_id uuid not null references section(id) on delete cascade,
  completed_at timestamptz not null default now(),
  seconds int not null default 0,
  primary key (enrollment_id, section_id)
);

create table answer (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollment(id) on delete cascade,
  block_id uuid not null references block(id) on delete cascade,
  attempt int not null,
  selected jsonb not null,
  correct boolean not null,
  created_at timestamptz not null default now()
);

create table video_progress (
  enrollment_id uuid not null references enrollment(id) on delete cascade,
  block_id uuid not null references block(id) on delete cascade,
  max_percent int not null default 0,
  primary key (enrollment_id, block_id)
);

-- Certifikat överlever gallring: namnet nollställs, ID, utbildning och datum behålls.
create table certificate (
  id text primary key,
  enrollment_id uuid references enrollment(id) on delete set null,
  course_id uuid not null references course(id) on delete cascade,
  learner_name text,
  issued_at timestamptz not null default now(),
  valid_until date
);

create index on chapter (course_id, position);
create index on section (chapter_id, position);
create index on block (section_id, position);
create index on enrollment (course_id);
create index on answer (enrollment_id, block_id);
