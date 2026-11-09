-- Förhandsvisningar från superadmin räknas inte i statistiken.
alter table enrollment add column is_preview boolean not null default false;
