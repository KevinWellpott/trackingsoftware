-- Telefonakquise: Begründungsfelder für den vertikalen Call-Flow
-- (Gatekeeper → warum nicht durchgestellt? · Entscheider → warum kein Pitch? ·
--  Termin → warum kein Termin?). Rein additiv.

alter table public.phone_leads
  add column if not exists no_transfer_reason text;

alter table public.phone_leads
  add column if not exists no_pitch_reason text;

alter table public.phone_leads
  add column if not exists no_appointment_reason text;
