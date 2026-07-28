-- Zeitzonen-Korrektur der Termin-Spalten.
--
-- Bisher wurde der rohe <input type="datetime-local">-Wert ("2026-07-27T10:00")
-- direkt in timestamptz-Spalten geschrieben. Postgres interpretiert ihn in der
-- DB-Zeitzone (UTC) — die Berlin-Wandzeit landete also unveraendert als UTC in
-- der Spalte. Angezeigt wird ueberall explizit Europe/Berlin, wodurch Termine
-- um den UTC-Offset (Sommer 2 h, Winter 1 h) zu spaet erschienen.
--
-- Die doppelte Konvertierung
--     (spalte at time zone 'UTC')      -> naive timestamp (die gespeicherte Wandzeit)
--     (<naive>  at time zone 'Europe/Berlin') -> timestamptz (dieselbe Wandzeit als Berlin)
-- korrigiert das pro Zeile DST-genau. Ein pauschales "- interval '2 hours'"
-- waere fuer Wintertermine falsch.
--
-- NICHT betroffen: closing_calls.call_at — dort konvertiert der ClosingCallEditor
-- bereits clientseitig (localInputToIso -> toISOString()), da steht echtes UTC.
-- setting_calls.closing_at hat keinen Schreibpfad in der App und ist praktisch
-- immer NULL; die Zeile bleibt defensiv trotzdem drin.
--
-- Ab dieser Migration schreibt die App ueber src/lib/apptTime.ts durchgaengig
-- echtes UTC.

-- ── Sicherung: macht den Schritt umkehrbar ───────────────────────────────────
create table if not exists public._appt_tz_backup_20260727 as
  select 'setting_calls.appointment_at' as col, id, appointment_at as before_value
    from public.setting_calls where appointment_at is not null
  union all
  select 'setting_calls.closing_at', id, closing_at
    from public.setting_calls where closing_at is not null
  union all
  select 'contacts.appointment_at', id, appointment_at
    from public.contacts where appointment_at is not null
  union all
  select 'phone_leads.appointment_at', id, appointment_at
    from public.phone_leads where appointment_at is not null
  union all
  select 'phone_leads.callback_at', id, callback_at
    from public.phone_leads where callback_at is not null;

-- Sicherungstabelle enthaelt Kundendaten -> nicht ueber die API erreichbar machen.
alter table public._appt_tz_backup_20260727 enable row level security;

-- ── Korrektur ────────────────────────────────────────────────────────────────
update public.setting_calls
   set appointment_at = ((appointment_at at time zone 'UTC') at time zone 'Europe/Berlin')
 where appointment_at is not null;

update public.setting_calls
   set closing_at = ((closing_at at time zone 'UTC') at time zone 'Europe/Berlin')
 where closing_at is not null;

update public.contacts
   set appointment_at = ((appointment_at at time zone 'UTC') at time zone 'Europe/Berlin')
 where appointment_at is not null;

update public.phone_leads
   set appointment_at = ((appointment_at at time zone 'UTC') at time zone 'Europe/Berlin')
 where appointment_at is not null;

update public.phone_leads
   set callback_at = ((callback_at at time zone 'UTC') at time zone 'Europe/Berlin')
 where callback_at is not null;

-- Rueckbau nach ein paar Tagen produktivem Betrieb:
--   drop table public._appt_tz_backup_20260727;
