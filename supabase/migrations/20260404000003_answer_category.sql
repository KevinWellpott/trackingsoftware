-- Antwort-Kategorien für Kontakte
alter table public.contacts
  add column if not exists answer_category text;
