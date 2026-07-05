-- Tracking Software 2.0 — LinkedIn-Erweiterungen auf contacts.
-- ADDITIV: nur neue nullable-Spalten. Keine Typänderung, keine Datenmutation.
-- Alle bestehenden Auswertungen über contacts liefern identische Ergebnisse.

alter table public.contacts
  add column if not exists linkedin_url text,
  add column if not exists appointment_at timestamptz,
  add column if not exists meet_link text,
  add column if not exists target_group text,
  add column if not exists setting_call_id uuid references public.setting_calls (id) on delete set null;

create index if not exists idx_contacts_setting_call on public.contacts (setting_call_id);

-- Optionale, non-destruktive Erweiterung: Follow-Up 0 explizit erlauben (NULL bleibt = FU0).
alter table public.contacts drop constraint if exists contacts_follow_up_number_check;
alter table public.contacts
  add constraint contacts_follow_up_number_check
  check (follow_up_number is null or follow_up_number between 0 and 3);
