-- Nytt blocktyp: bildspel (flera bilder med pilar, t.ex. sidor från PDF eller PowerPoint).
alter table block drop constraint if exists block_type_check;
alter table block add constraint block_type_check check (type in ('text', 'image', 'video', 'quiz', 'tip', 'slides'));
