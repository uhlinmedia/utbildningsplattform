-- AI-uppläsning per kund: superadmin aktiverar funktionen och kan sätta en månadskvot (minuter tal, null = obegränsat).
-- Varje skapad AI-röst sparas i ai_usage så att förbrukningen kan visas per kund och månad (och faktureras).
alter table customer add column if not exists ai_voice boolean not null default false;
alter table customer add column if not exists ai_minutes_month integer;

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete cascade,
  section_id uuid references section(id) on delete set null,
  course_title text not null default '',
  section_title text not null default '',
  user_id uuid references admin_user(id) on delete set null,
  user_email text,
  chars integer not null,
  seconds integer not null,
  voice text not null default '',
  model text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_customer_time on ai_usage (customer_id, created_at);
alter table ai_usage enable row level security;

-- AI-röster som skapats innan tabellen fanns (bara superadmin): hämtas ur ändringsloggen, längden uppskattas (ca 900 tecken/minut).
insert into ai_usage (customer_id, section_id, course_title, section_title, user_id, user_email, chars, seconds, voice, model, created_at)
select a.customer_id, s.id, coalesce(co.title, ''), coalesce(s.title, ''), a.user_id, a.user_email,
       (a.detail->>'chars')::int, greatest(1, round((a.detail->>'chars')::numeric / 15))::int,
       coalesce(a.detail->>'voice', ''), 'gemini-3.8-flash-tts', a.at
from audit_log a
left join section s on s.id::text = a.detail->>'section_id'
left join chapter ch on ch.id = s.chapter_id
left join course co on co.id = ch.course_id
where a.action = 'avsnittsljud_ai_skapat' and a.customer_id is not null and (a.detail->>'chars') ~ '^[0-9]+$'
  and not exists (select 1 from ai_usage);
