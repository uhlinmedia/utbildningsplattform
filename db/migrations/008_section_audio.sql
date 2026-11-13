-- Speakerröst per avsnitt. Ljudfilen ligger i Supabase Storage (bucketen avsnittsljud);
-- här sparas sökvägen, filnamnet, typen, storleken och längden. Tål att köras flera gånger.
alter table section add column if not exists audio jsonb;

-- Skapar bucketen när databasen är Supabase. En vanlig PostgreSQL (lokal utveckling) saknar schemat storage.
-- Ett fel här (t.ex. saknad behörighet) får inte stoppa migreringen; bucketen kan då skapas under Storage i Supabase.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avsnittsljud', 'avsnittsljud', true, 52428800,
      array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave'])
    on conflict (id) do nothing;
  end if;
exception when others then
  raise notice 'Kunde inte skapa bucketen avsnittsljud: %', sqlerrm;
end $$;
