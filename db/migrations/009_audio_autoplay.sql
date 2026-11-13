-- Starta speakerrösten automatiskt när eleven öppnar ett avsnitt (val per utbildning, av som standard).
alter table course add column if not exists audio_autoplay boolean not null default false;
