-- 0049 — Nachfass-Eingang: das Kontakt-Protokoll
--
-- 0001–0048 sind eingespielt bzw. geschrieben; keine Zeile dieser Datei ändert
-- eine davon. Rein additiv: eine neue Tabelle, ihre Indizes und RLS.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WARUM (docs/nachfassen-umbau/PLAN-nachfass-eingang.md, Entscheidung N3)
--
--  `/nachfassen` wird der eine Eingang für Termine ohne nächsten Schritt,
--  Telefon-Rückrufe und fällige Recycling-Leads. Jeder Kontakt dort wird mit
--  Ergebnis festgehalten: eine Zeile je Klick. Daraus entstehen „Versuch 4",
--  der Vorschlag „aufgeben?" und eine Auswertung, die heute nicht möglich ist
--  — der Stempel aus 0041 hält nur den LETZTEN Kontakt.
--
--  Das ist NICHT die alte Kaskade: keine Stufen, keine Texte, keine
--  Kanal-Regel. Das System erzeugt nichts; eine Zeile entsteht nur, wenn ein
--  Mensch klickt. Rückrufe protokollieren weiter in phone_call_attempts —
--  `quelle` kennt deshalb keinen Wert `rueckruf`.
--
--  ENTWURF
--  · Kein `workspace_id` (Muster termin_mails, 0045): Die Zeile folgt ihrem
--    Vorgang über den Fremdschlüssel. Nutzer-Umzug und Löschvorschau müssen
--    sie deshalb nicht kennen, und die §8-Invariante „jede Kaskade auf
--    workspaces steht in der Löschvorschau" bleibt grün.
--  · Genau EIN Bezug, echte FKs mit `on delete cascade` statt polymorpher ID.
--  · RLS über den Eltern-Vorgang: lesen und schreiben darf, wer die
--    Elternzeile sehen darf (Unterabfrage unter der RLS des Aufrufers).
--    Kein update/delete für `authenticated` — „Rückgängig" läuft über eine
--    Server Action mit Besitzprüfung und dem Service-Schlüssel.
--  · `created_by_user_id` ist AUDIT (wer hat geklickt), nie die Datensicht.
--  · Kein Backfill: leer heißt „gab es damals noch nicht".
--
--  EINSPIELEN: VOR dem Deploy des Eingangs (er liest die Tabelle). Zu früh ist
--  folgenlos. Ganze Datei, nichts markieren, danach den Verifikationsblock.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.nachfass_kontakte (
  id                   uuid primary key default gen_random_uuid(),
  setting_call_id      uuid references public.setting_calls(id) on delete cascade,
  closing_call_id      uuid references public.closing_calls(id) on delete cascade,
  contact_id           uuid references public.contacts(id)      on delete cascade,
  phone_lead_id        uuid references public.phone_leads(id)   on delete cascade,
  quelle               text not null check (quelle in ('termin', 'recycling')),
  ergebnis             text not null check (ergebnis in ('nicht_erreicht', 'erreicht')),
  folge                text not null default 'naechster_kontakt'
                       check (folge in ('naechster_kontakt', 'termin', 'aufgegeben', 'gesperrt', 'ergebnis')),
  kanal                text check (kanal in ('anruf', 'whatsapp', 'mail', 'linkedin', 'sms', 'sonstiges')),
  notiz                text,
  -- Snapshot: was beim Klick als nächster Kontakt gesetzt wurde.
  naechster_kontakt_am date,
  created_by_user_id   uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint nachfass_kontakte_ein_bezug
    check (num_nonnulls(setting_call_id, closing_call_id, contact_id, phone_lead_id) = 1)
);

comment on table public.nachfass_kontakte is
  'Kontakt-Protokoll des Nachfass-Eingangs (0049): eine Zeile je Klick, genau ein Bezug. Kein workspace_id — folgt dem Eltern-Vorgang.';

create index if not exists nachfass_kontakte_setting_idx on public.nachfass_kontakte (setting_call_id, created_at desc);
create index if not exists nachfass_kontakte_closing_idx on public.nachfass_kontakte (closing_call_id, created_at desc);
create index if not exists nachfass_kontakte_contact_idx on public.nachfass_kontakte (contact_id, created_at desc);
create index if not exists nachfass_kontakte_lead_idx    on public.nachfass_kontakte (phone_lead_id, created_at desc);
create index if not exists nachfass_kontakte_user_idx    on public.nachfass_kontakte (created_by_user_id, created_at desc);

alter table public.nachfass_kontakte enable row level security;

-- Sichtbar ist, was zu einem sichtbaren Vorgang gehört. Die Unterabfragen
-- laufen unter der RLS des Aufrufers — damit gelten Mandantengrenze,
-- data_scope und Plattform-Admin genau wie an der Elternzeile.
drop policy if exists nachfass_kontakte_select on public.nachfass_kontakte;
create policy nachfass_kontakte_select on public.nachfass_kontakte
  for select to authenticated
  using (
       (setting_call_id is not null and exists (select 1 from public.setting_calls p where p.id = setting_call_id))
    or (closing_call_id is not null and exists (select 1 from public.closing_calls p where p.id = closing_call_id))
    or (contact_id      is not null and exists (select 1 from public.contacts p      where p.id = contact_id))
    or (phone_lead_id   is not null and exists (select 1 from public.phone_leads p   where p.id = phone_lead_id))
  );

drop policy if exists nachfass_kontakte_insert on public.nachfass_kontakte;
create policy nachfass_kontakte_insert on public.nachfass_kontakte
  for insert to authenticated
  with check (
    created_by_user_id = (select auth.uid())
    and (
         (setting_call_id is not null and exists (select 1 from public.setting_calls p where p.id = setting_call_id))
      or (closing_call_id is not null and exists (select 1 from public.closing_calls p where p.id = closing_call_id))
      or (contact_id      is not null and exists (select 1 from public.contacts p      where p.id = contact_id))
      or (phone_lead_id   is not null and exists (select 1 from public.phone_leads p   where p.id = phone_lead_id))
    )
  );

grant select, insert on public.nachfass_kontakte to authenticated;
grant all on public.nachfass_kontakte to service_role;
revoke all on public.nachfass_kontakte from anon;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFIKATION
-- ═══════════════════════════════════════════════════════════════════════════
-- V1 Tabelle, RLS, zwei Policies. Erwartet: 1 Zeile, rls = true, policies = 2.
-- select c.relname, c.relrowsecurity as rls,
--        (select count(*) from pg_policies p where p.tablename = 'nachfass_kontakte') as policies
--   from pg_class c where c.relname = 'nachfass_kontakte' and c.relnamespace = 'public'::regnamespace;
--
-- V2 Der CHECK „genau ein Bezug" greift. In einer Transaktion, die zurückrollt;
--    das INSERT MUSS mit 23514 scheitern.
-- begin;
--   insert into public.nachfass_kontakte (quelle, ergebnis) values ('termin', 'erreicht') returning id;
-- rollback;
--
-- V3 Kein neuer Fremdschlüssel auf workspaces. Erwartet: leere Menge.
-- select conname from pg_constraint
--  where conrelid = 'public.nachfass_kontakte'::regclass and confrelid = 'public.workspaces'::regclass;
--
-- V4 Ein INSERT als fremdes Mitglied scheitert: mit gesetzten JWT-Claims einer
--    Person aus einer ANDEREN Organisation (Muster 0037) muss das INSERT auf
--    eine setting_call_id dieser Organisation mit 42501 scheitern.
