-- Stänger Supabase publika data-API för alla tabeller. Appen ansluter som tabellägare och påverkas inte.
alter table admin_user enable row level security;
alter table media enable row level security;
alter table customer enable row level security;
alter table course enable row level security;
alter table chapter enable row level security;
alter table section enable row level security;
alter table block enable row level security;
alter table learner enable row level security;
alter table enrollment enable row level security;
alter table section_progress enable row level security;
alter table answer enable row level security;
alter table video_progress enable row level security;
alter table certificate enable row level security;
alter table schema_migration enable row level security;
