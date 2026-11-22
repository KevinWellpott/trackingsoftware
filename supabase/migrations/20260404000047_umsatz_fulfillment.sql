-- 0047 — Kundenspace: Fulfillment und Finanzen (nur Titan)
--
-- 0001–0046 bleiben unberührt (0045 gehört zu den Termin-Mails und wird hier
-- nicht gebraucht). Regeln: docs/kundenspace/LEITFADEN.md.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  ZWEI WELTEN, ZWEI RECHTE
--
--    Fulfillment (alle Titan-Mitglieder)
--      kunden                      Stammdaten, Status, EINE zuständige Person
--      fulfillment_vorlagen        Vorlagen, dazu fulfillment_vorlage_punkte
--      kunden_checklisten          Kopien der Vorlagen je Kunde
--      kunden_bausteine            die Checkboxen
--      kunden_meetings             genau ein geplantes je Kunde + Protokolle
--      kunden_meeting_punkte       die Agenda
--      kunden_aufgaben             offene Aufgaben wir / Kunde
--      kunden_ablage               Dateien und Links
--
--    Finanzen (Titan-Mitglied UND Plattform-Admin)
--      kunden_vertraege            1:1, dazu `version` gegen veraltete Stände
--      kunden_raten                der Plan
--      kunden_zahlungen            Eingänge, vorzeichenbehaftet
--      kunden_vereinbarungen       Zusage, Stundung, Übertrag
--      kosten_positionen/_betraege/_monate
--      intern_einstellungen        Steuerrücklage
--
--    kunden_log                    Verlauf, Leserecht folgt dem Bereich
--
--  ABGELEITET, NIE GESPEICHERT: bezahlt, überfällig, Tage (src/lib/umsatz.ts).
--
--  MEHRSCHRITTIGES ist eine Funktion und damit eine Transaktion. Diese
--  Funktionen laufen als `security invoker`: Die RLS gilt auch in ihnen.
--
--  KEIN workspace_id: Die Tabellen gibt es nur für Titan. Eine Kaskade auf
--  `workspaces` müsste in Löschvorschau und Nutzer-Umzug (0036). Die Titan-ID
--  steht an genau einer Stelle: `intern_workspace_id()`.
--
--  KEINE *_platform_admin-POLICY: Die Rechte hängen an der Titan-Mitgliedschaft.
--
--  GRANTS: Supabase gibt neue Funktionen und Tabellen automatisch für `anon`
--  frei. `revoke … from public` allein genügt NICHT, `anon` wird überall
--  ausdrücklich genannt.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  EINSPIELEN: vor dem Deploy. Nichts markieren, „Run" auf die ganze Datei,
--  danach die Prüfabfrage am Dateiende. Wiederholbar.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── Rechte ─────────────────────────────────────────────────────────────────

create or replace function public.intern_workspace_id()
returns uuid
language sql
immutable
set search_path = ''
as $$ select '9deb7456-e14c-4672-aca1-4701b1829813'::uuid $$;

create or replace function public.is_intern_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = public.intern_workspace_id()
       and wm.user_id = auth.uid()
  );
$$;

create or replace function public.is_intern_finanz()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_intern_member() and public.is_platform_admin();
$$;

-- Zuständig sein kann nur, wer Geld sehen darf (Entscheidung 22.11.2026).
create or replace function public.intern_kann_zustaendig_sein(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.workspace_members wm
      join public.platform_admins pa on pa.user_id = wm.user_id
     where wm.workspace_id = public.intern_workspace_id()
       and wm.user_id = p_user
  );
$$;

create or replace function public.intern_rechte(p_workspace_id uuid)
returns table (kunden boolean, umsatz boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_workspace_id = public.intern_workspace_id(), false) and public.is_intern_member(),
         coalesce(p_workspace_id = public.intern_workspace_id(), false) and public.is_intern_finanz();
$$;

-- Das Team mit der Frage „zuordenbar?". Nur Mitglieder bekommen Zeilen.
create or replace function public.intern_team()
returns table (user_id uuid, username text, zuordenbar boolean)
language sql
stable
security definer
set search_path = public
as $$
  select wm.user_id, p.username, public.intern_kann_zustaendig_sein(wm.user_id)
    from public.workspace_members wm
    join public.profiles p on p.user_id = wm.user_id
   where wm.workspace_id = public.intern_workspace_id()
     and public.is_intern_member()
   order by p.username;
$$;

-- ── Fulfillment ────────────────────────────────────────────────────────────

create table if not exists public.kunden (
  id                   uuid primary key default gen_random_uuid(),
  -- Ein Deal, ein Kunde. Ein gelöschtes Closing nimmt den Kunden nicht mit.
  closing_call_id      uuid unique references public.closing_calls(id) on delete set null,
  name                 text not null check (length(btrim(name)) > 0),
  firma                text,
  email                text,
  telefon              text,
  kunden_workspace_id  uuid references public.workspaces(id) on delete set null,
  status               text not null default 'aktiv'
                       check (status in ('onboarding','aktiv','pausiert','abgeschlossen','gekuendigt','abgesprungen')),
  -- EINE Person für alles: Meetings und Geld.
  betreuer_user_id     uuid references auth.users(id) on delete set null,
  steckbrief           text,
  created_by_user_id   uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.fulfillment_vorlagen (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) > 0),
  beschreibung   text,
  archiviert_at  timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.fulfillment_vorlage_punkte (
  id            uuid primary key default gen_random_uuid(),
  vorlage_id    uuid not null references public.fulfillment_vorlagen(id) on delete cascade,
  titel         text not null check (length(btrim(titel)) > 0),
  beschreibung  text,
  phase         text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists fulfillment_vorlage_punkte_idx on public.fulfillment_vorlage_punkte (vorlage_id, sort_order);

create table if not exists public.kunden_checklisten (
  id          uuid primary key default gen_random_uuid(),
  kunde_id    uuid not null references public.kunden(id) on delete cascade,
  vorlage_id  uuid references public.fulfillment_vorlagen(id) on delete set null,
  titel       text not null check (length(btrim(titel)) > 0),
  created_at  timestamptz not null default now(),
  unique (id, kunde_id)
);
create index if not exists kunden_checklisten_kunde_idx on public.kunden_checklisten (kunde_id);

create table if not exists public.kunden_bausteine (
  id                    uuid primary key default gen_random_uuid(),
  kunde_id              uuid not null references public.kunden(id) on delete cascade,
  checkliste_id         uuid not null,
  titel                 text not null check (length(btrim(titel)) > 0),
  beschreibung          text,
  phase                 text,
  sort_order            integer not null default 0,
  erledigt_am           date,
  erledigt_von_user_id  uuid references auth.users(id) on delete set null,
  notiz                 text,
  -- Keine FK: Eine gelöschte Vorlage fasst die Listen der Kunden nicht an.
  vorlage_punkt_id      uuid,
  created_at            timestamptz not null default now(),
  foreign key (checkliste_id, kunde_id) references public.kunden_checklisten(id, kunde_id) on delete cascade
);
create index if not exists kunden_bausteine_kunde_idx on public.kunden_bausteine (kunde_id, checkliste_id, sort_order);

create table if not exists public.kunden_meetings (
  id                         uuid primary key default gen_random_uuid(),
  kunde_id                   uuid not null references public.kunden(id) on delete cascade,
  status                     text not null default 'geplant' check (status in ('geplant','stattgefunden')),
  -- Geplant darf ohne Termin sein: Die Agenda entsteht oft vor dem Datum.
  termin                     timestamptz,
  durchgefuehrt_von_user_id  uuid references auth.users(id) on delete set null,
  teilnehmer                 text,
  themen                     text,
  ergebnisse                 text,
  aufzeichnung_url           text check (aufzeichnung_url ~* '^https?://'),
  created_by_user_id         uuid references auth.users(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (id, kunde_id),
  check (status = 'geplant' or termin is not null)
);
create unique index if not exists kunden_meetings_ein_geplantes on public.kunden_meetings (kunde_id) where status = 'geplant';
create index if not exists kunden_meetings_kunde_idx on public.kunden_meetings (kunde_id, termin desc);

create table if not exists public.kunden_meeting_punkte (
  id               uuid primary key default gen_random_uuid(),
  kunde_id         uuid not null references public.kunden(id) on delete cascade,
  meeting_id       uuid not null,
  text             text not null check (length(btrim(text)) > 0),
  besprochen       boolean not null default false,
  -- Der Tag des Meetings, aus dem der Punkt zum ersten Mal mitgewandert ist.
  uebernommen_von  date,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default clock_timestamp(),
  foreign key (meeting_id, kunde_id) references public.kunden_meetings(id, kunde_id) on delete cascade
);
create index if not exists kunden_meeting_punkte_idx on public.kunden_meeting_punkte (kunde_id, meeting_id);

create table if not exists public.kunden_aufgaben (
  id                    uuid primary key default gen_random_uuid(),
  kunde_id              uuid not null references public.kunden(id) on delete cascade,
  meeting_id            uuid references public.kunden_meetings(id) on delete set null,
  seite                 text not null check (seite in ('wir','kunde')),
  text                  text not null check (length(btrim(text)) > 0),
  erledigt_am           date,
  erledigt_von_user_id  uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default clock_timestamp()
);
create index if not exists kunden_aufgaben_kunde_idx on public.kunden_aufgaben (kunde_id);

create table if not exists public.kunden_ablage (
  id                  uuid primary key default gen_random_uuid(),
  kunde_id            uuid not null references public.kunden(id) on delete cascade,
  typ                 text not null default 'sonstiges'
                      check (typ in ('vertrag','onboarding','aufzeichnung','material','sonstiges')),
  titel               text not null check (length(btrim(titel)) > 0),
  url                 text check (url ~* '^https?://'),
  storage_path        text unique,
  dateiname           text,
  groesse_bytes       bigint,
  mime                text,
  created_by_user_id  uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  check ((url is null) <> (storage_path is null)),
  check (storage_path is null or storage_path like kunde_id::text || '/%'),
  -- Verträge tragen Preise und liegen in einem eigenen Ordner, den nur Admins lesen.
  check (storage_path is null or (typ = 'vertrag') = (storage_path like kunde_id::text || '/vertrag/%'))
);
create index if not exists kunden_ablage_kunde_idx on public.kunden_ablage (kunde_id, created_at desc);

-- ── Finanzen ───────────────────────────────────────────────────────────────

create table if not exists public.kunden_vertraege (
  kunde_id                uuid primary key references public.kunden(id) on delete cascade,
  -- Zählt bei jeder Geldänderung hoch. Wer auf altem Stand schreibt, wird abgewiesen.
  version                 integer not null default 0,
  vertragswert            numeric(12,2) not null default 0 check (vertragswert >= 0),
  vertragsstart           date,
  laufzeit_monate         integer check (laufzeit_monate between 1 and 120),
  zahlungsart             text not null default 'raten' check (zahlungsart in ('einmal','raten')),
  gekuendigt_am           date,
  kuendigung_wirksam_zum  date,
  kuendigung_grund        text,
  abgebrochen_am          date,
  abbruch_grund           text,
  notiz                   text,
  updated_by_user_id      uuid references auth.users(id) on delete set null,
  updated_at              timestamptz not null default now(),
  check ((gekuendigt_am is null) = (kuendigung_wirksam_zum is null))
);

create table if not exists public.kunden_zahlungen (
  id                   uuid primary key default gen_random_uuid(),
  kunde_id             uuid not null references public.kunden(id) on delete cascade,
  eingang_am           date not null,
  betrag               numeric(12,2) not null,
  art                  text not null default 'zahlung' check (art in ('zahlung','erstattung','ruecklastschrift')),
  zahlungsweg          text,
  notiz                text,
  erfasst_von_user_id  uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  check ((art = 'zahlung' and betrag > 0) or (art <> 'zahlung' and betrag < 0))
);
create index if not exists kunden_zahlungen_kunde_idx on public.kunden_zahlungen (kunde_id, eingang_am);

create table if not exists public.kunden_raten (
  id                        uuid primary key default gen_random_uuid(),
  kunde_id                  uuid not null references public.kunden(id) on delete cascade,
  faellig_am                date not null,
  betrag                    numeric(12,2) not null check (betrag > 0),
  -- Bei einer Stundung das ERSTE Datum.
  urspruenglich_faellig_am  date,
  herkunft_rate_id          uuid references public.kunden_raten(id) on delete set null,
  erlass                    text check (erlass in ('storniert','abgeschrieben')),
  erlass_am                 date,
  erlass_grund              text,
  erlass_zahlung_id         uuid references public.kunden_zahlungen(id) on delete set null,
  notiz                     text,
  created_at                timestamptz not null default now(),
  check ((erlass is null) = (erlass_am is null))
);
create index if not exists kunden_raten_kunde_idx on public.kunden_raten (kunde_id, faellig_am);

create table if not exists public.kunden_vereinbarungen (
  id          uuid primary key default gen_random_uuid(),
  kunde_id    uuid not null references public.kunden(id) on delete cascade,
  rate_id     uuid references public.kunden_raten(id) on delete set null,
  art         text not null check (art in ('zusage','stundung','uebertrag')),
  betrag      numeric(12,2) not null check (betrag > 0),
  von_datum   date not null,
  auf_datum   date not null,
  grund       text not null,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default clock_timestamp()
);
create index if not exists kunden_vereinbarungen_kunde_idx on public.kunden_vereinbarungen (kunde_id);

create table if not exists public.kosten_positionen (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) > 0),
  kategorie    text not null default 'sonstiges'
               check (kategorie in ('marketing','personal','provision','software','buero','steuern','sonstiges')),
  rhythmus     text not null check (rhythmus in ('einmalig','monatlich','quartal','jaehrlich')),
  start_monat  text not null check (start_monat ~ '^20\d\d-(0[1-9]|1[0-2])$'),
  ende_monat   text check (ende_monat ~ '^20\d\d-(0[1-9]|1[0-2])$'),
  created_at   timestamptz not null default now(),
  check (ende_monat is null or ende_monat >= start_monat)
);

create table if not exists public.kosten_betraege (
  position_id  uuid not null references public.kosten_positionen(id) on delete cascade,
  gueltig_ab   text not null check (gueltig_ab ~ '^20\d\d-(0[1-9]|1[0-2])$'),
  betrag       numeric(12,2) not null check (betrag >= 0),
  primary key (position_id, gueltig_ab)
);

create table if not exists public.kosten_monate (
  position_id  uuid not null references public.kosten_positionen(id) on delete cascade,
  monat        text not null check (monat ~ '^20\d\d-(0[1-9]|1[0-2])$'),
  ist          numeric(12,2) check (ist >= 0),
  ausgesetzt   boolean not null default false,
  primary key (position_id, monat)
);

create table if not exists public.intern_einstellungen (
  id                       boolean primary key default true check (id),
  steuerruecklage_prozent  numeric(5,2) not null default 0 check (steuerruecklage_prozent between 0 and 100)
);
insert into public.intern_einstellungen (id) values (true) on conflict (id) do nothing;

create table if not exists public.kunden_log (
  id          uuid primary key default gen_random_uuid(),
  kunde_id    uuid not null references public.kunden(id) on delete cascade,
  bereich     text not null check (bereich in ('finanz','fulfillment')),
  art         text not null,
  text        text not null,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists kunden_log_kunde_idx on public.kunden_log (kunde_id, created_at desc);

-- ── Tabellenrechte und RLS ─────────────────────────────────────────────────

alter table public.kunden enable row level security;
alter table public.fulfillment_vorlagen enable row level security;
alter table public.fulfillment_vorlage_punkte enable row level security;
alter table public.kunden_checklisten enable row level security;
alter table public.kunden_bausteine enable row level security;
alter table public.kunden_meetings enable row level security;
alter table public.kunden_meeting_punkte enable row level security;
alter table public.kunden_aufgaben enable row level security;
alter table public.kunden_ablage enable row level security;
alter table public.kunden_vertraege enable row level security;
alter table public.kunden_zahlungen enable row level security;
alter table public.kunden_raten enable row level security;
alter table public.kunden_vereinbarungen enable row level security;
alter table public.kosten_positionen enable row level security;
alter table public.kosten_betraege enable row level security;
alter table public.kosten_monate enable row level security;
alter table public.intern_einstellungen enable row level security;
alter table public.kunden_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'kunden','fulfillment_vorlagen','fulfillment_vorlage_punkte','kunden_checklisten','kunden_bausteine',
    'kunden_meetings','kunden_meeting_punkte','kunden_aufgaben','kunden_ablage',
    'kunden_vertraege','kunden_zahlungen','kunden_raten','kunden_vereinbarungen',
    'kosten_positionen','kosten_betraege','kosten_monate','intern_einstellungen','kunden_log'
  ] loop
    -- `all` nimmt auch TRUNCATE mit, das an der RLS vorbeiliefe.
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- `closing_call_id` setzt nur die Datenbank, der Verlauf ist unveränderlich.
revoke insert, update on table public.kunden from authenticated;
grant insert (name, firma, email, telefon, status, betreuer_user_id, created_by_user_id)
  on table public.kunden to authenticated;
grant update (name, firma, email, telefon, status, betreuer_user_id, kunden_workspace_id, steckbrief, updated_at)
  on table public.kunden to authenticated;
revoke update, delete on table public.kunden_log from authenticated;

drop policy if exists kunden_select on public.kunden;
create policy kunden_select on public.kunden for select to authenticated
  using ((select public.is_intern_member()));
drop policy if exists kunden_insert on public.kunden;
create policy kunden_insert on public.kunden for insert to authenticated
  with check ((select public.is_intern_member()));
drop policy if exists kunden_update on public.kunden;
create policy kunden_update on public.kunden for update to authenticated
  using ((select public.is_intern_member())) with check ((select public.is_intern_member()));
-- Löschen nimmt Vertrag und Zahlungen mit, deshalb nur mit Finanzrechten.
drop policy if exists kunden_delete on public.kunden;
create policy kunden_delete on public.kunden for delete to authenticated
  using ((select public.is_intern_finanz()));

drop policy if exists fulfillment_vorlagen_intern on public.fulfillment_vorlagen;
create policy fulfillment_vorlagen_intern on public.fulfillment_vorlagen for all to authenticated
  using ((select public.is_intern_member())) with check ((select public.is_intern_member()));
drop policy if exists fulfillment_vorlage_punkte_intern on public.fulfillment_vorlage_punkte;
create policy fulfillment_vorlage_punkte_intern on public.fulfillment_vorlage_punkte for all to authenticated
  using ((select public.is_intern_member())) with check ((select public.is_intern_member()));
drop policy if exists kunden_checklisten_intern on public.kunden_checklisten;
create policy kunden_checklisten_intern on public.kunden_checklisten for all to authenticated
  using ((select public.is_intern_member())) with check ((select public.is_intern_member()));
drop policy if exists kunden_bausteine_intern on public.kunden_bausteine;
create policy kunden_bausteine_intern on public.kunden_bausteine for all to authenticated
  using ((select public.is_intern_member())) with check ((select public.is_intern_member()));
drop policy if exists kunden_meeting_punkte_intern on public.kunden_meeting_punkte;
create policy kunden_meeting_punkte_intern on public.kunden_meeting_punkte for all to authenticated
  using ((select public.is_intern_member())) with check ((select public.is_intern_member()));
drop policy if exists kunden_aufgaben_intern on public.kunden_aufgaben;
create policy kunden_aufgaben_intern on public.kunden_aufgaben for all to authenticated
  using ((select public.is_intern_member())) with check ((select public.is_intern_member()));
drop policy if exists kunden_ablage_intern on public.kunden_ablage;
create policy kunden_ablage_intern on public.kunden_ablage for all to authenticated
  using ((select public.is_intern_member()) and (typ <> 'vertrag' or (select public.is_intern_finanz())))
  with check ((select public.is_intern_member()) and (typ <> 'vertrag' or (select public.is_intern_finanz())));

drop policy if exists kunden_meetings_select on public.kunden_meetings;
create policy kunden_meetings_select on public.kunden_meetings for select to authenticated
  using ((select public.is_intern_member()));
drop policy if exists kunden_meetings_insert on public.kunden_meetings;
create policy kunden_meetings_insert on public.kunden_meetings for insert to authenticated
  with check ((select public.is_intern_member()));
drop policy if exists kunden_meetings_update on public.kunden_meetings;
create policy kunden_meetings_update on public.kunden_meetings for update to authenticated
  using ((select public.is_intern_member())) with check ((select public.is_intern_member()));
-- Das geplante Meeting trägt die Agenda und lässt sich nicht löschen.
drop policy if exists kunden_meetings_delete on public.kunden_meetings;
create policy kunden_meetings_delete on public.kunden_meetings for delete to authenticated
  using ((select public.is_intern_member()) and status = 'stattgefunden');

drop policy if exists kunden_vertraege_finanz on public.kunden_vertraege;
create policy kunden_vertraege_finanz on public.kunden_vertraege for all to authenticated
  using ((select public.is_intern_finanz())) with check ((select public.is_intern_finanz()));
drop policy if exists kunden_raten_finanz on public.kunden_raten;
create policy kunden_raten_finanz on public.kunden_raten for all to authenticated
  using ((select public.is_intern_finanz())) with check ((select public.is_intern_finanz()));
drop policy if exists kunden_zahlungen_finanz on public.kunden_zahlungen;
create policy kunden_zahlungen_finanz on public.kunden_zahlungen for all to authenticated
  using ((select public.is_intern_finanz())) with check ((select public.is_intern_finanz()));
drop policy if exists kunden_vereinbarungen_finanz on public.kunden_vereinbarungen;
create policy kunden_vereinbarungen_finanz on public.kunden_vereinbarungen for all to authenticated
  using ((select public.is_intern_finanz())) with check ((select public.is_intern_finanz()));
drop policy if exists kosten_positionen_finanz on public.kosten_positionen;
create policy kosten_positionen_finanz on public.kosten_positionen for all to authenticated
  using ((select public.is_intern_finanz())) with check ((select public.is_intern_finanz()));
drop policy if exists kosten_betraege_finanz on public.kosten_betraege;
create policy kosten_betraege_finanz on public.kosten_betraege for all to authenticated
  using ((select public.is_intern_finanz())) with check ((select public.is_intern_finanz()));
drop policy if exists kosten_monate_finanz on public.kosten_monate;
create policy kosten_monate_finanz on public.kosten_monate for all to authenticated
  using ((select public.is_intern_finanz())) with check ((select public.is_intern_finanz()));
drop policy if exists intern_einstellungen_finanz on public.intern_einstellungen;
create policy intern_einstellungen_finanz on public.intern_einstellungen for all to authenticated
  using ((select public.is_intern_finanz())) with check ((select public.is_intern_finanz()));

drop policy if exists kunden_log_select on public.kunden_log;
create policy kunden_log_select on public.kunden_log for select to authenticated
  using ((bereich = 'fulfillment' and (select public.is_intern_member()))
         or (select public.is_intern_finanz()));
drop policy if exists kunden_log_insert on public.kunden_log;
create policy kunden_log_insert on public.kunden_log for insert to authenticated
  with check (user_id = (select auth.uid())
              and ((bereich = 'fulfillment' and (select public.is_intern_member()))
                   or (select public.is_intern_finanz())));

-- ── Storage ────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('kunden-ablage', 'kunden-ablage', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Pfad: <kunde>/<datei> bzw. <kunde>/vertrag/<datei>. Verträge nur für Admins.
drop policy if exists kunden_ablage_objects_select on storage.objects;
create policy kunden_ablage_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'kunden-ablage'
         and (select public.is_intern_member())
         and (split_part(name, '/', 2) <> 'vertrag' or (select public.is_intern_finanz())));
drop policy if exists kunden_ablage_objects_insert on storage.objects;
create policy kunden_ablage_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'kunden-ablage'
              and (select public.is_intern_member())
              and (split_part(name, '/', 2) <> 'vertrag' or (select public.is_intern_finanz()))
              and split_part(name, '/', 1) in (select id::text from public.kunden));
drop policy if exists kunden_ablage_objects_delete on storage.objects;
create policy kunden_ablage_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'kunden-ablage'
         and (select public.is_intern_member())
         and (split_part(name, '/', 2) <> 'vertrag' or (select public.is_intern_finanz())));

-- ── Trigger an kunden ──────────────────────────────────────────────────────

-- SECURITY INVOKER ist hier die Pointe: `current_user` ist bei einem direkten
-- Zugriff `authenticated`, innerhalb von kunde_aus_closing() und bei FK-Aktionen
-- dagegen der Eigentümer. Sonst könnte ein Nicht-Admin kein Closing gewinnen, weil die
-- Datenbank dabei eine zuständige Person einträgt.
create or replace function public.kunden_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_betreuer_neu boolean;
  v_org_neu      boolean;
  v_ende_neu     boolean;
begin
  if tg_op = 'INSERT' then
    v_betreuer_neu := new.betreuer_user_id is not null;
    v_org_neu      := new.kunden_workspace_id is not null;
    v_ende_neu     := new.status in ('gekuendigt', 'abgesprungen');
  else
    v_betreuer_neu := new.betreuer_user_id is distinct from old.betreuer_user_id;
    v_org_neu      := new.kunden_workspace_id is distinct from old.kunden_workspace_id;
    v_ende_neu     := new.status is distinct from old.status
                      and (new.status in ('gekuendigt', 'abgesprungen') or old.status in ('gekuendigt', 'abgesprungen'));
  end if;

  -- Kündigung und Abbruch ändern den Zahlungsplan und gehören deshalb zu den Finanzrechten.
  if v_ende_neu and current_user in ('authenticated', 'anon') and not public.is_intern_finanz() then
    raise exception 'Kündigung und Abbruch erfassen nur Admins.';
  end if;

  if (v_betreuer_neu or v_org_neu) and current_user in ('authenticated', 'anon')
     and not public.is_intern_finanz() then
    raise exception 'Zuordnen können nur Admins.';
  end if;
  if v_betreuer_neu and new.betreuer_user_id is not null then
    if not public.intern_kann_zustaendig_sein(new.betreuer_user_id) then
      raise exception 'Zuständig kann nur ein Admin der Titan-Organisation sein.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists kunden_guard on public.kunden;
create trigger kunden_guard
  before insert or update on public.kunden
  for each row execute function public.kunden_guard();

-- Jeder Kunde hat von Anfang an einen Vertrag und ein geplantes Meeting.
create or replace function public.kunden_nach_anlage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.kunden_vertraege (kunde_id) values (new.id) on conflict do nothing;
  insert into public.kunden_meetings (kunde_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists kunden_nach_anlage on public.kunden;
create trigger kunden_nach_anlage
  after insert on public.kunden
  for each row execute function public.kunden_nach_anlage();

-- Ein Agenda-Punkt gehört nur an ein geplantes Meeting. `for share` wartet auf
-- ein gerade laufendes Abschließen, sonst hinge der Punkt am erledigten Meeting.
create or replace function public.kunden_meeting_punkte_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform 1 from public.kunden_meetings where id = new.meeting_id and status = 'geplant' for share;
  if not found then
    raise exception 'MEETING_SCHON_ABGESCHLOSSEN';
  end if;
  return new;
end;
$$;

drop trigger if exists kunden_meeting_punkte_guard on public.kunden_meeting_punkte;
create trigger kunden_meeting_punkte_guard
  before insert on public.kunden_meeting_punkte
  for each row execute function public.kunden_meeting_punkte_guard();

-- ── Kunde aus gewonnenem Deal ──────────────────────────────────────────────

create or replace function public.kunde_aus_closing(p_closing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kunde uuid;
  v_cc    record;
  v_orgs  uuid[];
begin
  select id into v_kunde from public.kunden where closing_call_id = p_closing_id;
  if v_kunde is not null then
    return v_kunde;
  end if;

  select cc.id, cc.workspace_id, cc.lead_name, cc.company, cc.deal_volume, cc.payment_type,
         cc.contract_start, cc.onboarding_at, cc.status,
         coalesce(cc.conducted_by_user_id, cc.assigned_user_id, cc.created_by_user_id) as person,
         sc.phone
    into v_cc
    from public.closing_calls cc
    left join public.setting_calls sc on sc.id = cc.setting_call_id
   where cc.id = p_closing_id;

  if v_cc.id is null
     or v_cc.workspace_id <> public.intern_workspace_id()
     or v_cc.status <> 'gewonnen' then
    return null;
  end if;

  -- Die Kunden-Organisation nur bei genau einem Namenstreffer.
  select array_agg(w.id) into v_orgs
    from public.workspaces w
   where w.id <> public.intern_workspace_id()
     and lower(w.name) in (lower(btrim(v_cc.lead_name)), lower(btrim(v_cc.lead_name)) || ' organisation');

  insert into public.kunden (closing_call_id, name, firma, telefon, kunden_workspace_id, status, betreuer_user_id)
  values (
    p_closing_id,
    coalesce(nullif(btrim(v_cc.lead_name), ''), nullif(btrim(v_cc.company), ''), 'Unbenannter Kunde'),
    nullif(btrim(v_cc.company), ''),
    v_cc.phone,
    case when cardinality(v_orgs) = 1 then v_orgs[1] end,
    'onboarding',
    case when public.intern_kann_zustaendig_sein(v_cc.person) then v_cc.person end
  )
  returning id into v_kunde;

  -- Ein fehlender Vertragsstart bleibt leer, das Closing-Datum ist keiner.
  -- Der Wert wird geklemmt: Ein Tippfehler darf das Closing nicht blockieren.
  update public.kunden_vertraege
     set vertragswert  = least(greatest(coalesce(v_cc.deal_volume, 0), 0), 9999999999),
         vertragsstart = v_cc.contract_start,
         zahlungsart   = case when lower(coalesce(v_cc.payment_type, '')) = 'einmal' then 'einmal' else 'raten' end
   where kunde_id = v_kunde;

  insert into public.kunden_log (kunde_id, bereich, art, text)
  values (v_kunde, 'fulfillment', 'angelegt', 'Kunde aus gewonnenem Closing angelegt.');

  return v_kunde;
end;
$$;

create or replace function public.closing_calls_kunde_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.workspace_id <> public.intern_workspace_id() or new.status <> 'gewonnen' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.kunde_aus_closing(new.id);
  elsif old.status is distinct from 'gewonnen' then
    perform public.kunde_aus_closing(new.id);
  else
    -- Nachziehen, solange niemand den Vertrag bewusst geändert hat.
    if new.deal_volume is distinct from old.deal_volume then
      update public.kunden_vertraege kv
         set vertragswert = least(greatest(coalesce(new.deal_volume, 0), 0), 9999999999),
             version = kv.version + 1,
             updated_at = now()
        from public.kunden k
       where k.closing_call_id = new.id
         and kv.kunde_id = k.id
         and kv.vertragswert = least(greatest(coalesce(old.deal_volume, 0), 0), 9999999999);
      if found then
        insert into public.kunden_log (kunde_id, bereich, art, text, user_id)
        select k.id, 'finanz', 'vertrag',
               'Vertragswert aus dem Closing übernommen: ' || coalesce(old.deal_volume, 0) || ' → ' || coalesce(new.deal_volume, 0) || ' €.',
               auth.uid()
          from public.kunden k where k.closing_call_id = new.id;
      end if;
    end if;
    if new.contract_start is distinct from old.contract_start then
      update public.kunden_vertraege kv
         set vertragsstart = new.contract_start,
             version = kv.version + 1,
             updated_at = now()
        from public.kunden k
       where k.closing_call_id = new.id
         and kv.kunde_id = k.id
         and kv.vertragsstart is not distinct from old.contract_start;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists closing_calls_kunde_sync on public.closing_calls;
create trigger closing_calls_kunde_sync
  after insert or update of status, deal_volume, contract_start on public.closing_calls
  for each row execute function public.closing_calls_kunde_sync();

-- ── Geldänderung: eine Transaktion, ein Stand ──────────────────────────────
-- Gerechnet wird in src/lib/umsatzPlanung.ts, geschrieben hier.

create or replace function public.finanz_anwenden(p_kunde_id uuid, p_version integer, p jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_vertrag public.kunden_vertraege;
  v_rate    public.kunden_raten;
  v_el      jsonb;
begin
  if not public.is_intern_finanz() then
    raise exception 'Nur für Admins der Titan-Organisation.';
  end if;

  select * into v_vertrag from public.kunden_vertraege where kunde_id = p_kunde_id for update;
  if not found then
    raise exception 'Kunde nicht gefunden.';
  end if;
  if v_vertrag.version is distinct from p_version then
    raise exception 'STAND_VERALTET';
  end if;

  insert into public.kunden_zahlungen (id, kunde_id, eingang_am, betrag, art, zahlungsweg, notiz, erfasst_von_user_id)
  select x.id, p_kunde_id, x.eingang_am, x.betrag, x.art, x.zahlungsweg, x.notiz, auth.uid()
    from jsonb_to_recordset(coalesce(p -> 'zahlungenNeu', '[]'))
      as x(id uuid, eingang_am date, betrag numeric, art text, zahlungsweg text, notiz text);

  for v_el in select * from jsonb_array_elements(coalesce(p -> 'ratenAendern', '[]')) loop
    select * into v_rate from public.kunden_raten where id = (v_el ->> 'id')::uuid and kunde_id = p_kunde_id;
    if not found then
      raise exception 'STAND_VERALTET';
    end if;
    v_rate := jsonb_populate_record(v_rate, v_el);
    update public.kunden_raten
       set faellig_am               = v_rate.faellig_am,
           betrag                   = v_rate.betrag,
           urspruenglich_faellig_am = v_rate.urspruenglich_faellig_am,
           erlass                   = v_rate.erlass,
           erlass_am                = v_rate.erlass_am,
           erlass_grund             = v_rate.erlass_grund,
           erlass_zahlung_id        = v_rate.erlass_zahlung_id,
           notiz                    = v_rate.notiz
     where id = (v_el ->> 'id')::uuid and kunde_id = p_kunde_id;
  end loop;

  delete from public.kunden_raten
   where kunde_id = p_kunde_id
     and id in (select value::uuid from jsonb_array_elements_text(coalesce(p -> 'ratenLoeschen', '[]')));

  insert into public.kunden_raten (id, kunde_id, faellig_am, betrag, urspruenglich_faellig_am, herkunft_rate_id,
                                   erlass, erlass_am, erlass_grund, erlass_zahlung_id, notiz)
  select x.id, p_kunde_id, x.faellig_am, x.betrag, x.urspruenglich_faellig_am, x.herkunft_rate_id,
         x.erlass, x.erlass_am, x.erlass_grund, x.erlass_zahlung_id, x.notiz
    from jsonb_to_recordset(coalesce(p -> 'ratenNeu', '[]'))
      as x(id uuid, faellig_am date, betrag numeric, urspruenglich_faellig_am date, herkunft_rate_id uuid,
           erlass text, erlass_am date, erlass_grund text, erlass_zahlung_id uuid, notiz text);

  insert into public.kunden_vereinbarungen (kunde_id, rate_id, art, betrag, von_datum, auf_datum, grund, user_id)
  select p_kunde_id, x.rate_id, x.art, x.betrag, x.von_datum, x.auf_datum, x.grund, auth.uid()
    from jsonb_to_recordset(coalesce(p -> 'vereinbarungen', '[]'))
      as x(rate_id uuid, art text, betrag numeric, von_datum date, auf_datum date, grund text);

  delete from public.kunden_vereinbarungen
   where kunde_id = p_kunde_id
     and art = 'stundung'
     and rate_id in (select value::uuid from jsonb_array_elements_text(coalesce(p -> 'stundungLoeschen', '[]')));

  delete from public.kunden_zahlungen
   where kunde_id = p_kunde_id
     and id in (select value::uuid from jsonb_array_elements_text(coalesce(p -> 'zahlungenLoeschen', '[]')));

  v_vertrag := jsonb_populate_record(v_vertrag, coalesce(p -> 'vertrag', '{}'));
  update public.kunden_vertraege
     set vertragswert           = v_vertrag.vertragswert,
         vertragsstart          = v_vertrag.vertragsstart,
         laufzeit_monate        = v_vertrag.laufzeit_monate,
         zahlungsart            = v_vertrag.zahlungsart,
         notiz                  = v_vertrag.notiz,
         gekuendigt_am          = v_vertrag.gekuendigt_am,
         kuendigung_wirksam_zum = v_vertrag.kuendigung_wirksam_zum,
         kuendigung_grund       = v_vertrag.kuendigung_grund,
         abgebrochen_am         = v_vertrag.abgebrochen_am,
         abbruch_grund          = v_vertrag.abbruch_grund,
         version                = p_version + 1,
         updated_by_user_id     = auth.uid(),
         updated_at             = now()
   where kunde_id = p_kunde_id;

  if p #>> '{status,auf}' is not null then
    update public.kunden
       set status = p #>> '{status,auf}', updated_at = now()
     where id = p_kunde_id
       and (p #>> '{status,nurVon}' is null or status = p #>> '{status,nurVon}');
  end if;

  insert into public.kunden_log (kunde_id, bereich, art, text, user_id)
  values (p_kunde_id, 'finanz', 'finanz', coalesce(nullif(p ->> 'log', ''), 'Finanzen geändert.'), auth.uid());

  return p_version + 1;
end;
$$;

create or replace function public.kosten_anlegen(
  p_name text, p_kategorie text, p_rhythmus text, p_start text, p_betrag numeric
)
returns uuid
language plpgsql
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.kosten_positionen (name, kategorie, rhythmus, start_monat)
  values (btrim(p_name), p_kategorie, p_rhythmus, p_start)
  returning id into v_id;
  insert into public.kosten_betraege (position_id, gueltig_ab, betrag) values (v_id, p_start, p_betrag);
  return v_id;
end;
$$;

-- ── Meeting abschließen ────────────────────────────────────────────────────
-- Protokoll, Aufgaben, Haken und das nächste Meeting samt mitgenommener Punkte
-- in EINER Transaktion. Ein zweiter Klick findet kein geplantes Meeting mehr.

create or replace function public.meeting_abschliessen(p_meeting_id uuid, p jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_m    public.kunden_meetings;
  v_neu  uuid;
  v_tag  date;
begin
  select * into v_m from public.kunden_meetings
   where id = p_meeting_id and status = 'geplant' for update;
  if not found then
    raise exception 'MEETING_SCHON_ABGESCHLOSSEN';
  end if;

  v_tag := ((p ->> 'termin')::timestamptz at time zone 'Europe/Berlin')::date;

  update public.kunden_meetings
     set status                    = 'stattgefunden',
         termin                    = (p ->> 'termin')::timestamptz,
         durchgefuehrt_von_user_id = (p ->> 'person')::uuid,
         teilnehmer                = p ->> 'teilnehmer',
         ergebnisse                = p ->> 'ergebnisse',
         aufzeichnung_url          = p ->> 'aufzeichnung_url',
         updated_at                = now()
   where id = p_meeting_id;

  update public.kunden_meeting_punkte
     set besprochen = id in (select value::uuid from jsonb_array_elements_text(coalesce(p -> 'besprochen', '[]')))
   where meeting_id = p_meeting_id;

  insert into public.kunden_meetings (kunde_id, termin, created_by_user_id)
  values (v_m.kunde_id, (p ->> 'naechster_termin')::timestamptz, auth.uid())
  returning id into v_neu;

  insert into public.kunden_meeting_punkte (kunde_id, meeting_id, text, uebernommen_von, sort_order)
  select v_m.kunde_id, v_neu, mp.text, coalesce(mp.uebernommen_von, v_tag),
         (row_number() over (order by mp.sort_order, mp.created_at))::integer
    from public.kunden_meeting_punkte mp
   where mp.meeting_id = p_meeting_id
     and not mp.besprochen
     -- Mitnehmen ist die Regel, Wegfallen die ausdrückliche Ausnahme: Ein Punkt,
     -- den ein Kollege nach dem Öffnen des Dialogs anlegt, geht so nicht verloren.
     and mp.id not in (select value::uuid from jsonb_array_elements_text(coalesce(p -> 'entfaellt', '[]')));

  insert into public.kunden_meeting_punkte (kunde_id, meeting_id, text, sort_order)
  select v_m.kunde_id, v_neu, btrim(x.value), 1000 + x.ordinality::integer
    from jsonb_array_elements_text(coalesce(p -> 'naechste_agenda', '[]')) with ordinality as x
   where btrim(x.value) <> '';

  insert into public.kunden_aufgaben (kunde_id, meeting_id, seite, text)
  select v_m.kunde_id, p_meeting_id, x.seite, btrim(x.text)
    from jsonb_to_recordset(coalesce(p -> 'aufgaben', '[]')) as x(seite text, text text)
   where btrim(x.text) <> '';

  update public.kunden_bausteine
     set erledigt_am = v_tag,
         erledigt_von_user_id = coalesce((p ->> 'person')::uuid, auth.uid())
   where kunde_id = v_m.kunde_id
     and erledigt_am is null
     and id in (select value::uuid from jsonb_array_elements_text(coalesce(p -> 'erledigte_bausteine', '[]')));

  update public.kunden set updated_at = now() where id = v_m.kunde_id;

  insert into public.kunden_log (kunde_id, bereich, art, text, user_id)
  values (v_m.kunde_id, 'fulfillment', 'meeting',
          'Meeting vom ' || to_char(v_tag, 'DD.MM.YYYY') || ' abgeschlossen.', auth.uid());

  return v_neu;
end;
$$;

-- ── Vorlagen ───────────────────────────────────────────────────────────────

-- Zuweisen kopiert. Mit p_checkliste_id wird nur angehängt, was dort fehlt.
create or replace function public.checkliste_aus_vorlage(
  p_kunde_id uuid, p_vorlage_id uuid, p_punkte uuid[], p_checkliste_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_liste uuid := p_checkliste_id;
  v_name  text;
  v_basis integer := 0;
begin
  select name into v_name from public.fulfillment_vorlagen where id = p_vorlage_id;
  if not found then
    raise exception 'Vorlage nicht gefunden.';
  end if;

  if v_liste is null then
    insert into public.kunden_checklisten (kunde_id, vorlage_id, titel)
    values (p_kunde_id, p_vorlage_id, v_name)
    returning id into v_liste;
  else
    select coalesce(max(sort_order), 0) into v_basis
      from public.kunden_bausteine where checkliste_id = v_liste;
  end if;

  insert into public.kunden_bausteine (kunde_id, checkliste_id, titel, beschreibung, phase, sort_order, vorlage_punkt_id)
  select p_kunde_id, v_liste, vp.titel, vp.beschreibung, vp.phase,
         v_basis + 10 * (row_number() over (order by vp.sort_order, vp.created_at))::integer, vp.id
    from public.fulfillment_vorlage_punkte vp
   where vp.vorlage_id = p_vorlage_id
     and vp.id = any (p_punkte)
     and not exists (select 1 from public.kunden_bausteine b
                      where b.checkliste_id = v_liste and b.vorlage_punkt_id = vp.id);

  insert into public.kunden_log (kunde_id, bereich, art, text, user_id)
  values (p_kunde_id, 'fulfillment', 'checkliste',
          case when p_checkliste_id is null then 'Vorlage zugewiesen: ' else 'Aus Vorlage ergänzt: ' end || v_name,
          auth.uid());

  return v_liste;
end;
$$;

create or replace function public.vorlage_duplizieren(p_vorlage_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare v_neu uuid;
begin
  insert into public.fulfillment_vorlagen (name, beschreibung)
  select name || ' (Kopie)', beschreibung from public.fulfillment_vorlagen where id = p_vorlage_id
  returning id into v_neu;
  if v_neu is null then
    raise exception 'Vorlage nicht gefunden.';
  end if;
  insert into public.fulfillment_vorlage_punkte (vorlage_id, titel, beschreibung, phase, sort_order)
  select v_neu, titel, beschreibung, phase, sort_order
    from public.fulfillment_vorlage_punkte where vorlage_id = p_vorlage_id;
  return v_neu;
end;
$$;

create or replace function public.intern_reihenfolge(p_art text, p_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_art = 'vorlage' then
    update public.fulfillment_vorlage_punkte t set sort_order = (x.n * 10)::integer
      from unnest(p_ids) with ordinality as x(id, n) where t.id = x.id;
  elsif p_art = 'baustein' then
    update public.kunden_bausteine t set sort_order = (x.n * 10)::integer
      from unnest(p_ids) with ordinality as x(id, n) where t.id = x.id;
  elsif p_art = 'agenda' then
    update public.kunden_meeting_punkte t set sort_order = (x.n * 10)::integer
      from unnest(p_ids) with ordinality as x(id, n) where t.id = x.id;
  else
    raise exception 'Unbekannte Liste.';
  end if;
end;
$$;

-- ── Ausführungsrechte ──────────────────────────────────────────────────────

do $$
declare f regprocedure;
begin
  -- Für die App und die Policies.
  foreach f in array array[
    'public.intern_workspace_id()', 'public.is_intern_member()', 'public.is_intern_finanz()',
    'public.intern_kann_zustaendig_sein(uuid)', 'public.intern_rechte(uuid)', 'public.intern_team()',
    'public.finanz_anwenden(uuid,integer,jsonb)', 'public.kosten_anlegen(text,text,text,text,numeric)',
    'public.meeting_abschliessen(uuid,jsonb)', 'public.checkliste_aus_vorlage(uuid,uuid,uuid[],uuid)',
    'public.vorlage_duplizieren(uuid)', 'public.intern_reihenfolge(text,uuid[])'
  ]::regprocedure[] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  -- Nur für die Datenbank selbst.
  foreach f in array array[
    'public.kunde_aus_closing(uuid)', 'public.closing_calls_kunde_sync()',
    'public.kunden_guard()', 'public.kunden_nach_anlage()', 'public.kunden_meeting_punkte_guard()'
  ]::regprocedure[] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── Backfill: alle gewonnenen Titan-Deals ──────────────────────────────────
-- Aktiv, außer Start oder Onboarding liegen noch vor uns. Pläne und Zahlungen
-- kommen über die Schnellerfassung in der App.

do $$
declare
  r       record;
  v       uuid;
  v_heute date := (now() at time zone 'Europe/Berlin')::date;
begin
  for r in
    select cc.id, cc.contract_start, cc.onboarding_at
      from public.closing_calls cc
     where cc.workspace_id = public.intern_workspace_id()
       and cc.status = 'gewonnen'
       and not exists (select 1 from public.kunden k where k.closing_call_id = cc.id)
  loop
    v := public.kunde_aus_closing(r.id);
    if not (coalesce(r.contract_start > v_heute, false) or coalesce(r.onboarding_at > v_heute, false)) then
      update public.kunden set status = 'aktiv' where id = v;
    end if;
  end loop;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  PRÜFUNG — nach dem Einspielen ausführen. Jede Zeile muss `ok = true` zeigen.
-- ═══════════════════════════════════════════════════════════════════════════
/*
select 'A jeder gewonnene Titan-Deal hat einen Kunden' as pruefung,
       not exists (select 1 from closing_calls cc
                    where cc.workspace_id = intern_workspace_id() and cc.status = 'gewonnen'
                      and not exists (select 1 from kunden k where k.closing_call_id = cc.id)) as ok
union all
select 'B jeder Kunde hat Vertrag und genau ein geplantes Meeting',
       not exists (select 1 from kunden k
                    where not exists (select 1 from kunden_vertraege v where v.kunde_id = k.id)
                       or (select count(*) from kunden_meetings m where m.kunde_id = k.id and m.status = 'geplant') <> 1)
union all
select 'C keine Kaskade auf workspaces',
       not exists (select 1 from pg_constraint c
                    where c.confrelid = 'public.workspaces'::regclass and c.confdeltype = 'c'
                      and c.conrelid::regclass::text ~ '(kunden|kosten|fulfillment|intern_)')
union all
select 'D anon darf keine der Funktionen ausführen',
       not exists (select 1 from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname ~ '^(intern_|is_intern_|kunde|finanz_anwenden|kosten_anlegen|meeting_abschliessen|checkliste_aus|vorlage_dupl|closing_calls_kunde_sync)'
                      and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'E anon darf keine der Tabellen lesen',
       not exists (select 1 from pg_class c
                    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
                      and c.relname ~ '^(kunden|kosten_|fulfillment_|intern_einstellungen)'
                      and has_table_privilege('anon', c.oid, 'select'))
union all
select 'F 18 Tabellen, alle mit RLS',
       (select count(*) = 18 and bool_and(c.relrowsecurity) from pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
           and c.relname ~ '^(kunden|kosten_|fulfillment_|intern_einstellungen)')
union all
select 'G zuständig sind nur Admins',
       not exists (select 1 from kunden k
                    where k.betreuer_user_id is not null and not intern_kann_zustaendig_sein(k.betreuer_user_id))
union all
select 'H Bucket privat',
       exists (select 1 from storage.buckets where id = 'kunden-ablage' and not public);
*/
