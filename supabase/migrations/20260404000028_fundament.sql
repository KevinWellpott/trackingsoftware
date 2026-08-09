-- ═══════════════════════════════════════════════════════════════════════════
-- 0028 · Fundament: Personen-Zuordnung, Anruf-Log, Semantik-Fixes
-- ---------------------------------------------------------------------------
-- Voraussetzung: 0027 eingespielt. Läuft NICHT automatisch (docs §7) —
-- im Supabase-SQL-Editor ausführen.
--
-- VOR DEM AUSFÜHREN prüfen (Mehrfachzuweisungen kollabieren im Backfill auf
-- EINE Person, das ist Datenverlust):
--   select entity_type, entity_id, count(*) from call_assignees
--   group by 1,2 having count(*) > 1;              -- erwartet: 0 Zeilen
--
-- Und die RLS-Policies sichern (§5 ersetzt sie destruktiv):
--   select * from pg_policies where tablename in ('setting_calls','closing_calls');
--
-- Additiv bis auf die Policies in §5 und die vier ersetzten RPCs
-- (create or replace mit unveränderten Signaturen → Grants bleiben bestehen).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Zuweisungs-Spalte: genau EINE Person je Termin
-- ---------------------------------------------------------------------------
-- Ersetzt call_assignees als Lesequelle. Warum eine Spalte statt eines
-- Unique-Constraints auf call_assignees: die Tabelle ist polymorph
-- (entity_type/entity_id) und hat deshalb keinen Fremdschlüssel, den
-- PostgREST einbetten könnte — jeder Analyse-Tab bräuchte einen zweiten
-- Volldurchlauf plus JS-Join, und die Head-Counts im Dashboard müssten auf
-- Row-Fetches umgebaut werden.
--
-- on delete SET NULL (nicht cascade wie call_assignees.user_id): Wird ein
-- Nutzer gelöscht, muss der Termin bestehen bleiben und auf
-- created_by_user_id zurückfallen — nicht still verschwinden.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.setting_calls
  add column if not exists assigned_user_id uuid references auth.users (id) on delete set null;

alter table public.closing_calls
  add column if not exists assigned_user_id uuid references auth.users (id) on delete set null;

create index if not exists idx_setting_calls_ws_assigned
  on public.setting_calls (workspace_id, assigned_user_id);

create index if not exists idx_closing_calls_ws_assigned
  on public.closing_calls (workspace_id, assigned_user_id);

-- created_at wird neu zum Filterkriterium ("Termine gelegt", §9).
create index if not exists idx_setting_calls_ws_created_at
  on public.setting_calls (workspace_id, created_at);

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Helfer: owner_name -> user_id INNERHALB einer Organisation
-- ---------------------------------------------------------------------------
-- Umkehrung von list_owned_by_user() (0015). Der workspace-Filter ist Pflicht:
-- Benutzernamen sind global eindeutig, aber ein owner_name kann nach einem
-- Org-Umzug auf einen Nutzer zeigen, der nicht mehr in dieser Org ist.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.user_id_for_owner_name (
  p_workspace_id uuid,
  p_owner_name text
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select wm.user_id
  from public.workspace_members wm
  join public.profiles p on p.user_id = wm.user_id
  where wm.workspace_id = p_workspace_id
    and p_owner_name is not null
    and p.username = p_owner_name
  limit 1;
$$;

grant execute on function public.user_id_for_owner_name (uuid, text) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Backfill setting_calls.assigned_user_id
-- ---------------------------------------------------------------------------
-- Auflösungsreihenfolge — identisch zu src/lib/personResolution.ts und den
-- drei Anlegepfaden in src/app/actions/appointments.ts:
--   1. bestehende Zuweisung aus call_assignees (älteste gewinnt)
--   2. owner_name der Quellliste (lists / phone_lists)   ← Vorrang, wie überall
--   3. created_by_user_id der Quellliste
--   4. created_by_user_id des Termins
-- ───────────────────────────────────────────────────────────────────────────

with resolved as (
  select sc.id,
         coalesce(
           (select ca.user_id
              from public.call_assignees ca
             where ca.entity_type = 'setting_call'
               and ca.entity_id = sc.id
             order by ca.created_at asc, ca.id asc
             limit 1),
           case sc.source_type
             when 'linkedin' then public.user_id_for_owner_name(sc.workspace_id, li.owner_name)
             when 'telefon'  then public.user_id_for_owner_name(sc.workspace_id, ph.owner_name)
           end,
           case sc.source_type
             when 'linkedin' then li.created_by_user_id
             when 'telefon'  then ph.created_by_user_id
           end,
           sc.created_by_user_id
         ) as uid
    from public.setting_calls sc
    left join public.contacts    c  on c.id  = sc.source_contact_id
    left join public.lists       li on li.id = c.list_id
    left join public.phone_leads pl on pl.id = sc.source_phone_lead_id
    left join public.phone_lists ph on ph.id = pl.list_id
   where sc.assigned_user_id is null
)
update public.setting_calls sc
   set assigned_user_id = r.uid
  from resolved r
 where r.id = sc.id
   and r.uid is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) Backfill closing_calls.assigned_user_id
-- ---------------------------------------------------------------------------
-- Das Closing erbt vom Setting — ab jetzt auch im Schreibpfad
-- (createClosingFromSetting). Ohne Setting-Bezug: eigene Zuweisung, sonst
-- Ersteller.
-- ───────────────────────────────────────────────────────────────────────────

with resolved as (
  select cc.id,
         coalesce(
           (select ca.user_id
              from public.call_assignees ca
             where ca.entity_type = 'closing_call'
               and ca.entity_id = cc.id
             order by ca.created_at asc, ca.id asc
             limit 1),
           sc.assigned_user_id,
           cc.created_by_user_id
         ) as uid
    from public.closing_calls cc
    left join public.setting_calls sc on sc.id = cc.setting_call_id
   where cc.assigned_user_id is null
)
update public.closing_calls cc
   set assigned_user_id = r.uid
  from resolved r
 where r.id = cc.id
   and r.uid is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- 5) RLS: die Zuweisung muss sichtbar machen
-- ---------------------------------------------------------------------------
-- DESTRUKTIVER TEIL DIESER MIGRATION. Ohne den Zuweisungs-Zweig verschwindet
-- ein Termin, den ein Admin FÜR ein Mitglied mit data_scope='own' anlegt
-- (created_by = Admin, assigned = Mitglied), aus dessen Sicht komplett.
-- Bisher war das durch den effective_user_id-Schreibpfad verdeckt, der mit
-- diesem Umbau wegfällt.
-- Die Plattform-Admin-Policies aus 0025 bleiben unberührt (permissive, OR).
-- ───────────────────────────────────────────────────────────────────────────

drop policy if exists "setting_calls_scoped_member" on public.setting_calls;
create policy "setting_calls_scoped_member" on public.setting_calls
  for all using (
        public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.created_by_user_id)
     or public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.assigned_user_id)
  )
  with check (
        public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.created_by_user_id)
     or public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.assigned_user_id)
  );

drop policy if exists "closing_calls_scoped_member" on public.closing_calls;
create policy "closing_calls_scoped_member" on public.closing_calls
  for all using (
        public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.created_by_user_id)
     or public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.assigned_user_id)
  )
  with check (
        public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.created_by_user_id)
     or public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.assigned_user_id)
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 6) phone_leads.pitch_delivered — "gepitcht" ist nicht "erreicht"
-- ---------------------------------------------------------------------------
-- Der Call-Modus beschriftet den Schalter "Entscheider gepitcht?", speichert
-- ihn aber als decider_reached; die RPCs zählen decider_reached als
-- "Entscheider erreicht". Beide Kennzahlen waren dadurch identisch.
-- Bestandsdaten bedeuten faktisch "gepitcht" und werden dorthin kopiert;
-- decider_reached bleibt stehen (gepitcht ⊆ erreicht → konservativ).
-- ───────────────────────────────────────────────────────────────────────────

alter table public.phone_leads
  add column if not exists pitch_delivered boolean;

update public.phone_leads
   set pitch_delivered = decider_reached
 where pitch_delivered is null
   and decider_reached is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- 7) closing_calls.show_status nachziehen
-- ---------------------------------------------------------------------------
-- setClosingOutcome schreibt nur status, nie show_status — die Show-Quote war
-- deshalb Erfassungsdisziplin statt Kennzahl. Ein Ergebnis setzt voraus, dass
-- das Gespräch stattgefunden hat. Analog zu Migration 0018 §3 für
-- setting_calls. 'offen' bleibt bewusst NULL.
-- ACHTUNG: Echte Closing-No-Shows der Vergangenheit sind nicht
-- rekonstruierbar — die Show-Quote springt dadurch auf ~100 % und sinkt erst
-- mit neuen Daten. Gehört als Fußnote in den Closing-Tab.
-- ───────────────────────────────────────────────────────────────────────────

update public.closing_calls
   set show_status = 'show'
 where show_status is null
   and status in ('gewonnen', 'verloren', 'nachfassen');

-- ───────────────────────────────────────────────────────────────────────────
-- 8) Anruf-Ereignis-Log
-- ---------------------------------------------------------------------------
-- Bisher gab es kein Anruf-Ereignis: "Anwahlen" zählte Leads mit Erstkontakt,
-- und call_attempt wurde im Call-Modus von Hand gesetzt. Damit war die Frage
-- "lohnt Nachfassen oder lieber neue Leads scrapen" strukturell nicht
-- beantwortbar. Das Log startet leer — siehe source-Spalte.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.phone_call_attempts (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,
  lead_id            uuid not null references public.phone_leads (id) on delete cascade,

  -- Snapshot der Liste ZUM ZEITPUNKT des Anrufs: Der Lead wandert bei
  -- Rückruf/Nicht-erreicht physisch in eine Routing-Liste. Ein Join über die
  -- aktuelle Liste würde die Historie rückwirkend umschreiben.
  list_id            uuid references public.phone_lists (id) on delete set null,
  owner_name         text,

  called_at          timestamptz not null default now(),
  attempt_no         smallint not null check (attempt_no >= 1),

  -- Topf — beantwortet "lohnt Nachfassen oder neu scrapen?"
  kind               text not null default 'erstanruf'
    check (kind in ('erstanruf', 'folgeanruf', 'rueckruf')),

  -- Ergebnis: 1:1 die vier Outcome-Buttons im Call-Modus.
  outcome            text not null
    check (outcome in ('termin', 'rueckruf', 'nicht_erreicht', 'dead', 'kein_ergebnis')),

  -- Snapshots der Flow-Antworten im Moment des Anrufs.
  mailbox            boolean not null default false,
  gatekeeper_reached text check (gatekeeper_reached is null or gatekeeper_reached in ('ja', 'nein', 'direkt')),
  decider_reached    boolean,
  pitch_delivered    boolean,

  -- 'backfill' hält die Tür für nachträglich synthetisierte Ereignisse offen,
  -- ohne dass sie je mit echten vermischt werden. Bewusst KEIN Backfill aus
  -- first_call_at/call_attempt: first_call_at ist ein Datum ohne Uhrzeit und
  -- kennt nur den ersten Anruf, call_attempt ist manuell gesetzt und
  -- unzuverlässig — erfundene Ereignisse wären später nicht mehr von echten
  -- zu trennen.
  source             text not null default 'app' check (source in ('app', 'backfill')),

  notes              text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_pca_lead       on public.phone_call_attempts (lead_id, attempt_no);
create index if not exists idx_pca_ws_called  on public.phone_call_attempts (workspace_id, called_at);
create index if not exists idx_pca_ws_owner   on public.phone_call_attempts (workspace_id, owner_name);
create index if not exists idx_pca_ws_creator on public.phone_call_attempts (workspace_id, created_by_user_id);

drop trigger if exists phone_call_attempts_bi on public.phone_call_attempts;
create trigger phone_call_attempts_bi
before insert on public.phone_call_attempts
for each row execute function public.set_workspace_and_creator ();

alter table public.phone_call_attempts enable row level security;

-- Sichtbarkeit folgt der Telefonliste (Muster: phone_leads_scoped_member, 0008).
drop policy if exists "phone_call_attempts_scoped_member" on public.phone_call_attempts;
create policy "phone_call_attempts_scoped_member" on public.phone_call_attempts
  for all using (
        public.can_access_owned_workspace_row(phone_call_attempts.workspace_id, phone_call_attempts.created_by_user_id)
     or (phone_call_attempts.list_id is not null and public.can_access_phone_list(phone_call_attempts.list_id))
  )
  with check (
        public.can_access_owned_workspace_row(phone_call_attempts.workspace_id, phone_call_attempts.created_by_user_id)
     or (phone_call_attempts.list_id is not null and public.can_access_phone_list(phone_call_attempts.list_id))
  );

-- Plattform-Admin-Policy nach dem Muster aus 0025 (permissive, InitPlan).
drop policy if exists "phone_call_attempts_platform_admin" on public.phone_call_attempts;
create policy "phone_call_attempts_platform_admin" on public.phone_call_attempts
  for all using ((select public.is_platform_admin ()))
          with check ((select public.is_platform_admin ()));

-- ───────────────────────────────────────────────────────────────────────────
-- 9) Neue RPC: "Termine GELEGT" je Person und Berlin-Tag
-- ---------------------------------------------------------------------------
-- EINE Definition von "gelegt" für persönliches Dashboard, Team-Dashboard und
-- Analyse. created_at ist der Buchungszeitpunkt und überlebt Umterminierungen
-- (rescheduleSetting fasst nur appointment_at an).
-- Tageszuordnung über den Berlin-Kalendertag (docs §6) — sonst rutscht ein
-- Abendtermin in den Vortag.
-- Abzugrenzen von: "absolut" (settingEffDate = wann der Termin STATTFINDET)
-- und der Pitch-Kohorte in rpc_owner_day_metrics.appts (wie viele der in
-- diesem Zeitraum GEPITCHTEN Kontakte irgendwann einen Termin bekamen).
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_appointments_booked (
  p_workspace_id uuid,
  p_from date,
  p_to date,
  p_effective_user_id uuid default null
)
returns table (
  user_id uuid,
  day date,
  cnt bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eff uuid;
begin
  v_eff := public.rpc_effective_user (p_workspace_id, p_effective_user_id);
  return query
    select coalesce(sc.assigned_user_id, sc.created_by_user_id) as user_id,
           (sc.created_at at time zone 'Europe/Berlin')::date   as day,
           count(*)::bigint                                     as cnt
    from public.setting_calls sc
    where sc.workspace_id = p_workspace_id
      and (sc.created_at at time zone 'Europe/Berlin')::date between p_from and p_to
      and (v_eff is null or coalesce(sc.assigned_user_id, sc.created_by_user_id) = v_eff)
    group by 1, 2;
end;
$$;

grant execute on function public.rpc_appointments_booked (uuid, date, date, uuid) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 10) Telefon-RPCs: owner_name-Vorrang nachziehen
-- ---------------------------------------------------------------------------
-- Migration 0015 hat das für die LinkedIn-RPCs gemacht und den Telefon-Zweig
-- bewusst ausgelassen. Folge: Eine Telefonliste, die ein Admin FÜR ein
-- Mitglied angelegt hat (owner_name = Mitglied, created_by = Admin), zählt in
-- der Gruppierung beim Mitglied, im Personenfilter aber beim Admin — das
-- Mitglied sieht seine eigenen Zahlen nicht.
-- Signaturen bleiben unverändert, damit die Grants bestehen bleiben.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_phone_owner_metrics (
  p_workspace_id uuid,
  p_from date,
  p_to date,
  p_effective_user_id uuid default null
)
returns table (
  owner_name text,
  calls bigint,
  gatekeeper_reached bigint,
  decider_reached bigint,
  appointments bigint,
  callbacks bigint,
  dead bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eff uuid;
begin
  v_eff := public.rpc_effective_user (p_workspace_id, p_effective_user_id);
  return query
    select coalesce(l.owner_name, '—') as owner_name,
           count(*) filter (where pl.first_call_at between p_from and p_to)::bigint as calls,
           count(*) filter (where pl.gatekeeper_reached in ('ja', 'direkt'))::bigint as gatekeeper_reached,
           count(*) filter (where pl.decider_reached is true)::bigint as decider_reached,
           count(*) filter (where pl.appointment_set is true)::bigint as appointments,
           count(*) filter (where pl.status = 'rueckruf')::bigint as callbacks,
           count(*) filter (where pl.status = 'dead')::bigint as dead
    from public.phone_leads pl
    join public.phone_lists l on l.id = pl.list_id
    where pl.workspace_id = p_workspace_id
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    group by 1;
end;
$$;

create or replace function public.rpc_phone_day_metrics (
  p_workspace_id uuid,
  p_from date,
  p_to date,
  p_effective_user_id uuid default null
)
returns table (
  owner_name text,
  day date,
  calls bigint,
  gatekeeper_reached bigint,
  decider_reached bigint,
  appointments bigint,
  callbacks bigint,
  dead bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eff uuid;
begin
  v_eff := public.rpc_effective_user (p_workspace_id, p_effective_user_id);
  return query
    select coalesce(l.owner_name, '—') as owner_name,
           coalesce(pl.first_call_at, pl.created_at::date) as day,
           count(*) filter (where pl.first_call_at is not null)::bigint as calls,
           count(*) filter (where pl.gatekeeper_reached in ('ja', 'direkt'))::bigint as gatekeeper_reached,
           count(*) filter (where pl.decider_reached is true)::bigint as decider_reached,
           count(*) filter (where pl.appointment_set is true)::bigint as appointments,
           count(*) filter (where pl.status = 'rueckruf')::bigint as callbacks,
           count(*) filter (where pl.status = 'dead')::bigint as dead
    from public.phone_leads pl
    join public.phone_lists l on l.id = pl.list_id
    where pl.workspace_id = p_workspace_id
      and coalesce(pl.first_call_at, pl.created_at::date) between p_from and p_to
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    group by 1, 2;
end;
$$;

create or replace function public.rpc_phone_list_counts (
  p_workspace_id uuid,
  p_effective_user_id uuid default null
)
returns table (list_id uuid, status text, cnt bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eff uuid;
begin
  v_eff := public.rpc_effective_user (p_workspace_id, p_effective_user_id);
  return query
    select pl.list_id, pl.status, count(*)::bigint as cnt
    from public.phone_leads pl
    join public.phone_lists l on l.id = pl.list_id
    where pl.workspace_id = p_workspace_id
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    group by pl.list_id, pl.status;
end;
$$;

-- nachfassen_tasks: Telefon-Zweig auf owner_name-Vorrang, Setting- und
-- Closing-Zweig auf die neue Zuweisung. Signatur unverändert.
create or replace function public.nachfassen_tasks (
  p_workspace_id uuid,
  p_today date,
  p_now timestamptz,
  p_effective_user_id uuid default null
)
returns table (
  source text,
  entity_id uuid,
  owner_name text,
  lead_name text,
  company text,
  due_at timestamptz,
  channel text,
  next_fu_number int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eff uuid;
begin
  v_eff := public.rpc_effective_user (p_workspace_id, p_effective_user_id);
  return query
    -- LinkedIn Follow-ups
    select 'linkedin'::text, c.id, l.owner_name, c.name, c.company,
           c.next_follow_up_at::timestamptz, 'LinkedIn'::text,
           coalesce(c.follow_up_number, 0) + 1
    from public.contacts c
    join public.lists l on l.id = c.list_id
    where c.workspace_id = p_workspace_id
      and c.next_follow_up_at is not null
      and c.next_follow_up_at <= p_today
      and c.answered is distinct from true
      and c.appointment_set is distinct from true
      and c.follow_up_number is distinct from 3
      and c.blocked_at is null
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    union all
    -- Telefon Rückrufe (fällig zur gesetzten Uhrzeit)
    select 'telefon'::text, pl.id, l.owner_name, pl.decider_name, pl.company,
           pl.callback_at, 'Telefon'::text, null::int
    from public.phone_leads pl
    join public.phone_lists l on l.id = pl.list_id
    where pl.workspace_id = p_workspace_id
      and pl.status = 'rueckruf'
      and pl.callback_at is not null
      and pl.callback_at <= p_now
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    union all
    -- Closing Nachfassen
    select 'closing'::text, cc.id, null::text, cc.lead_name, cc.company,
           cc.follow_up_due::timestamptz, 'Closing'::text, null::int
    from public.closing_calls cc
    where cc.workspace_id = p_workspace_id
      and cc.status = 'nachfassen'
      and cc.follow_up_due is not null
      and cc.follow_up_due <= p_today
      and (v_eff is null or coalesce(cc.assigned_user_id, cc.created_by_user_id) = v_eff)
    union all
    -- Setting Nachfassen: No-Show erneut einladen, Unqualifizierte reaktivieren.
    -- security definer umgeht RLS — der v_eff-Filter ist hier die einzige
    -- Zugriffskontrolle.
    select 'setting'::text, sc.id, null::text, sc.lead_name, sc.company,
           sc.follow_up_due::timestamptz, 'Setting'::text, null::int
    from public.setting_calls sc
    where sc.workspace_id = p_workspace_id
      and sc.status in ('no_show', 'unqualifiziert')
      and sc.follow_up_due is not null
      and sc.follow_up_due <= p_today
      and (v_eff is null or coalesce(sc.assigned_user_id, sc.created_by_user_id) = v_eff);
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 11) Org-Grenzen-Guard für die Zuweisung
-- ---------------------------------------------------------------------------
-- move_user_scope() (0026) ermittelt Besitz über created_by_user_id. Mit der
-- Zuweisung gehört ein Termin auch dem Zugewiesenen — ohne diesen Guard bliebe
-- nach einem Umzug ein assigned_user_id zurück, das auf ein Nicht-Mitglied der
-- Ziel-Organisation zeigt (Invariante docs §8 verletzt).
--
-- BEWUSST NUR BEI 'update of workspace_id', nicht beim Insert: Ein
-- Plattform-Admin ist in einer Kunden-Organisation kein workspace_members-
-- Eintrag. Beim Insert würde der Guard seine Zuweisung still verwerfen —
-- stilles Verwerfen ist die schlechtere Fehlerart als ein Grenzfall, den die
-- App selbst abfangen kann.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.assigned_user_guard ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_user_id is not null
     and not exists (
       select 1
       from public.workspace_members wm
       where wm.user_id = new.assigned_user_id
         and wm.workspace_id = new.workspace_id
     ) then
    -- Fällt auf created_by_user_id zurück, statt über die Org-Grenze zu zeigen.
    new.assigned_user_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists setting_calls_assigned_guard on public.setting_calls;
create trigger setting_calls_assigned_guard
before update of workspace_id on public.setting_calls
for each row execute function public.assigned_user_guard ();

drop trigger if exists closing_calls_assigned_guard on public.closing_calls;
create trigger closing_calls_assigned_guard
before update of workspace_id on public.closing_calls
for each row execute function public.assigned_user_guard ();

-- Neue Spalten und Tabellen sofort über PostgREST verfügbar machen.
notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFIKATION — nach dem Ausführen
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Keine unaufgelöste Zuweisung:
--   select count(*) from setting_calls where assigned_user_id is null;   -- 0
--   select count(*) from closing_calls where assigned_user_id is null;   -- 0
--
-- Zuweisung zeigt nur auf Mitglieder DERSELBEN Organisation (docs §8):
--   select count(*) from setting_calls sc
--    where sc.assigned_user_id is not null
--      and not exists (select 1 from workspace_members wm
--                       where wm.user_id = sc.assigned_user_id
--                         and wm.workspace_id = sc.workspace_id);        -- 0
--   (identisch für closing_calls)
--
-- owner_name ohne auflösbaren Nutzer (Backfill ist dort auf den Ersteller
-- gefallen — Liste durchsehen):
--   select l.workspace_id, l.owner_name, count(*) from lists l
--    where l.owner_name is not null
--      and public.user_id_for_owner_name(l.workspace_id, l.owner_name) is null
--    group by 1, 2;
--
-- DIE Tabelle, die jeden Zahlensprung nach dem Deploy erklärt:
--   select p_alt.username as vorher, p_neu.username as nachher, count(*)
--     from setting_calls sc
--     left join profiles p_alt on p_alt.user_id = sc.created_by_user_id
--     left join profiles p_neu on p_neu.user_id = sc.assigned_user_id
--    where sc.created_by_user_id is distinct from sc.assigned_user_id
--    group by 1, 2 order by 3 desc;
--
-- Kein Ergebnis-Closing mehr ohne show_status:
--   select count(*) from closing_calls
--    where status <> 'offen' and show_status is null;                    -- 0
-- ═══════════════════════════════════════════════════════════════════════════
