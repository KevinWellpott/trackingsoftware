-- 0032 — Kaskaden-Konfiguration, Termin-Lebenszyklus und reminder_touches v2
--
-- ERSETZT die frühere Fassung 20260404000032_lead_recycling.sql (deren Inhalt
-- neu geschnitten als 0033 wiederkommt). Setzt 0031 voraus: cascade_steps
-- verweist auf template_catalog.
--
-- Der Kern der Ausarbeitung: statt EINES Offset-Tripels je Organisation gibt es
-- neun benannte Kaskaden mit je eigenen Stufen, Abständen und Texten — und die
-- Ereignisse, die im Diagramm zwischen den Kästen stehen (verschoben, abgesagt,
-- disqualifiziert, No-Show ohne Antwort), werden erfasst statt stillschweigend
-- als Statuswechsel zu verschwinden.

-- ---------------------------------------------------------------------------
-- 1. pipeline_settings — eine Konfigurationszeile je Organisation
-- ---------------------------------------------------------------------------
-- Ersetzt reminder_settings UND recycle_settings. Ein Seeding-Schritt, ein
-- RLS-Paar, eine Kartengruppe in den Einstellungen statt zweier.
--
-- Die Recycling-Wartezeiten liegen hier zweistufig: die fünf Ursprungs-Defaults
-- tragen die Konzept-Fristen (Kein Close 4 Wochen, Disqualifiziert 8 Wochen),
-- die neun Verlustgrund-Werte bleiben daneben bestehen und übersteuern sie.
-- Bewusst alle NOT NULL: nullable Spalten hätten die Staffelung faktisch
-- abgeschafft, statt sie zu erhalten.

create table if not exists public.pipeline_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,

  -- Termin-Disziplin
  max_reschedules       smallint not null default 2 check (max_reschedules between 1 and 5),
  reminder_horizon_days smallint not null default 7 check (reminder_horizon_days between 1 and 60),

  -- Recycling: Default je Ursprung (Konzept-Fristen)
  days_default_closing_lost          integer not null default 28  check (days_default_closing_lost > 0),
  days_default_setting_disqualified  integer not null default 56  check (days_default_setting_disqualified > 0),
  days_default_phone_dead            integer not null default 100 check (days_default_phone_dead > 0),
  days_default_setting_dead          integer not null default 100 check (days_default_setting_dead > 0),
  days_default_linkedin_exhausted    integer not null default 100 check (days_default_linkedin_exhausted > 0),

  -- Recycling: Feinstaffelung je Verlustgrund, übersteuert den Ursprungs-Default
  days_timing           integer not null default 75  check (days_timing > 0),
  days_preis            integer not null default 105 check (days_preis > 0),
  days_kein_bedarf      integer not null default 105 check (days_kein_bedarf > 0),
  days_entscheider      integer not null default 150 check (days_entscheider > 0),
  days_wettbewerb       integer not null default 270 check (days_wettbewerb > 0),
  days_vertrauen        integer not null default 270 check (days_vertrauen > 0),
  days_ghosting_breakup integer not null default 14  check (days_ghosting_breakup > 0),
  days_ghosting         integer not null default 180 check (days_ghosting > 0),
  days_sonstiges        integer not null default 120 check (days_sonstiges > 0),

  max_attempts smallint not null default 2 check (max_attempts between 1 and 5),

  updated_at         timestamptz not null default now(),
  updated_by_user_id uuid references auth.users (id) on delete set null
);

comment on table public.pipeline_settings is
  'Eine Konfigurationszeile je Organisation. Ersetzt reminder_settings und recycle_settings.';
comment on column public.pipeline_settings.max_reschedules is
  'Ab der (max_reschedules + 1)-ten Verschiebung warnt die Oberfläche und schlägt die Ablage vor. Keine harte Sperre.';

-- Für falsche_zielgruppe und kein_fit gibt es bewusst KEINE Spalte: diese
-- beiden Gründe bekommen nie ein Recycling-Datum.

drop trigger if exists pipeline_settings_touch on public.pipeline_settings;
create trigger pipeline_settings_touch
  before update on public.pipeline_settings
  for each row execute function public.touch_updated_at ();

-- ---------------------------------------------------------------------------
-- 2. cascade_steps — die Stufen selbst
-- ---------------------------------------------------------------------------
-- Zeile statt Spalte, weil die Stufenzahl je Kaskade verschieden ist
-- (Setting-Mail 2, Closing-Mail 3) und eine Stufe abschaltbar sein muss.
-- Minuten statt Stunden, damit „3 Tage vorher" (4320) und „1 Stunde vorher"
-- (60) in einer Einheit liegen.
--
-- anchor + nicht-negativer Offset statt vorzeichenbehafteter Minuten: derselbe
-- Ausdrucksumfang, aber eine Erinnerung NACH dem Termin lässt sich in einer
-- Vor-Termin-Kaskade gar nicht erst formulieren — die Absicherung sitzt im
-- Constraint, nicht im Editor-Code.

create table if not exists public.cascade_steps (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  cascade_kind text not null check (
                 cascade_kind in ('setting_msg', 'setting_mail', 'closing_msg', 'closing_mail',
                                  'followup_msg', 'closing_kickoff', 'no_show_setting',
                                  'no_show_closing', 'kein_close')
               ),
  step_no      smallint not null check (step_no between 1 and 5),

  trigger_event text not null check (trigger_event in ('scheduled', 'created', 'no_show', 'no_close')),
  anchor        text not null check (anchor in ('before_appointment', 'after_appointment')),
  offset_minutes integer not null check (offset_minutes >= 0),

  -- Wörtlich der Konzept-Pfeil „keine Antwort" zwischen Nachfassen 1 und 2.
  -- Gilt ausschließlich für die Ketten, nie für die Vor-Termin-Kaskaden.
  requires_no_response boolean not null default false,
  enabled              boolean not null default true,

  template_key text not null references public.template_catalog (template_key),

  primary key (workspace_id, cascade_kind, step_no),

  -- Eine geplante Stufe hängt immer vor dem Termin; alles andere reagiert auf
  -- ein Ereignis und liegt danach.
  constraint cascade_steps_anchor_matches_trigger
    check ((trigger_event = 'scheduled') = (anchor = 'before_appointment'))
);

comment on table public.cascade_steps is
  'Die Stufen der neun Kaskaden je Organisation. Die Reihenfolge wird beim Speichern der ganzen Kaskade geprüft, nicht per CHECK — sie ist ein zeilenübergreifender Zustand und die Meldung gehört in die Oberfläche.';

create index if not exists idx_cascade_steps_ws_kind
  on public.cascade_steps (workspace_id, cascade_kind, step_no)
  where enabled;

-- ---------------------------------------------------------------------------
-- 3. Termin-Lebenszyklus auf setting_calls und closing_calls
-- ---------------------------------------------------------------------------
-- Bewusst KEIN neuer status-Wert: status speist Show-Quote, Quali-Quote,
-- Trichter, terminMeta.outlineFor und die Vergleichsseite. Ein sechster Wert
-- zwänge jede dieser Definitionen zu einer Entscheidung. Eigene Felder lassen
-- einen abgesagten Termin dagegen über show_status is null korrekt aus dem
-- Show-Quoten-Nenner fallen.

alter table public.setting_calls
  add column if not exists cancelled_at        timestamptz,
  add column if not exists cancel_reason_code  text,
  add column if not exists cancel_reason       text,
  add column if not exists cancel_outlook      text,
  add column if not exists reschedule_count    integer not null default 0,
  add column if not exists last_reschedule_at  timestamptz,
  add column if not exists no_show_resolution  text,
  add column if not exists revived_at          timestamptz,
  add column if not exists revived_from_setting_call_id uuid references public.setting_calls (id) on delete set null,
  add column if not exists revived_from_closing_call_id uuid references public.closing_calls (id) on delete set null,
  add column if not exists disqualify_reason_code text,
  add column if not exists disqualify_reason      text,
  add column if not exists wa_phone       text,
  add column if not exists wa_consent_at  timestamptz,
  add column if not exists wa_refused_at  timestamptz;

alter table public.closing_calls
  add column if not exists cancelled_at        timestamptz,
  add column if not exists cancel_reason_code  text,
  add column if not exists cancel_reason       text,
  add column if not exists cancel_outlook      text,
  add column if not exists reschedule_count    integer not null default 0,
  add column if not exists last_reschedule_at  timestamptz,
  add column if not exists no_show_resolution  text,
  add column if not exists revived_at          timestamptz,
  add column if not exists follow_up_due_at    timestamptz,
  add column if not exists onboarding_at       date;

-- CHECKs getrennt hinzugefügt, damit ein erneutes Einspielen nicht scheitert.
do $$
begin
  -- Absage: Grund als Code (Statistik) neben Freitext (Gedächtnis).
  -- Die Pflicht, einen Code zu setzen, kommt erst in 0035 nach dem Deploy —
  -- die laufende Produktion schreibt heute Updates ohne ihn.
  if not exists (select 1 from pg_constraint where conname = 'setting_calls_cancel_reason_code_chk') then
    alter table public.setting_calls add constraint setting_calls_cancel_reason_code_chk
      check (cancel_reason_code is null or cancel_reason_code in
             ('kein_neuer_termin', 'krank', 'familiaer', 'beruflich', 'preis', 'sonstiges'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'setting_calls_cancel_outlook_chk') then
    alter table public.setting_calls add constraint setting_calls_cancel_outlook_chk
      check (cancel_outlook is null or cancel_outlook in ('ohne_aussicht', 'neuer_termin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'setting_calls_cancelled_pair_chk') then
    alter table public.setting_calls add constraint setting_calls_cancelled_pair_chk
      check ((cancelled_at is null) = (cancel_outlook is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'setting_calls_reschedule_count_chk') then
    alter table public.setting_calls add constraint setting_calls_reschedule_count_chk
      check (reschedule_count >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'setting_calls_no_show_resolution_chk') then
    alter table public.setting_calls add constraint setting_calls_no_show_resolution_chk
      check (no_show_resolution is null
             or (no_show_resolution in ('antwort', 'ohne_antwort', 'ersatztermin')
                 and show_status = 'no_show'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'setting_calls_revived_from_one_chk') then
    alter table public.setting_calls add constraint setting_calls_revived_from_one_chk
      check (revived_from_setting_call_id is null or revived_from_closing_call_id is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'setting_calls_disqualify_reason_code_chk') then
    alter table public.setting_calls add constraint setting_calls_disqualify_reason_code_chk
      check (disqualify_reason_code is null or disqualify_reason_code in
             ('geld', 'kein_budget', 'kein_bedarf', 'falscher_zeitpunkt', 'kein_entscheider',
              'falsche_zielgruppe', 'keine_zusammenarbeit', 'sonstiges'));
  end if;
  -- „Will keine Nummer rausgeben" ist eine dokumentierte Ausnahme, kein leeres
  -- Feld — nur so lässt sich eine Verweigerung von einer Erfassungslücke
  -- unterscheiden und der Kanal bewusst auf LinkedIn fallen.
  if not exists (select 1 from pg_constraint where conname = 'setting_calls_wa_refused_chk') then
    alter table public.setting_calls add constraint setting_calls_wa_refused_chk
      check (wa_refused_at is null or wa_phone is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'setting_calls_wa_consent_chk') then
    alter table public.setting_calls add constraint setting_calls_wa_consent_chk
      check (wa_consent_at is null or wa_phone is not null);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'closing_calls_cancel_reason_code_chk') then
    alter table public.closing_calls add constraint closing_calls_cancel_reason_code_chk
      check (cancel_reason_code is null or cancel_reason_code in
             ('kein_neuer_termin', 'krank', 'familiaer', 'beruflich', 'preis', 'sonstiges'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'closing_calls_cancel_outlook_chk') then
    alter table public.closing_calls add constraint closing_calls_cancel_outlook_chk
      check (cancel_outlook is null or cancel_outlook in ('ohne_aussicht', 'neuer_termin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'closing_calls_cancelled_pair_chk') then
    alter table public.closing_calls add constraint closing_calls_cancelled_pair_chk
      check ((cancelled_at is null) = (cancel_outlook is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'closing_calls_reschedule_count_chk') then
    alter table public.closing_calls add constraint closing_calls_reschedule_count_chk
      check (reschedule_count >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'closing_calls_no_show_resolution_chk') then
    alter table public.closing_calls add constraint closing_calls_no_show_resolution_chk
      check (no_show_resolution is null
             or (no_show_resolution in ('antwort', 'ohne_antwort', 'ersatztermin')
                 and show_status = 'no_show'));
  end if;
end $$;

-- kein_fit ist das Closing-Pendant zu „Zusammenarbeit macht keinen Sinn" —
-- der zweite Code neben falsche_zielgruppe, der nie ein Recycling-Datum
-- bekommt. Rein additiv, Bestandszeilen bleiben gültig.
do $$
declare
  con_name text;
begin
  select conname into con_name
    from pg_constraint
   where conrelid = 'public.closing_calls'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%lost_reason_code%';
  if con_name is not null then
    execute format('alter table public.closing_calls drop constraint %I', con_name);
  end if;
  alter table public.closing_calls add constraint closing_calls_lost_reason_code_chk
    check (lost_reason_code is null or lost_reason_code in
           ('preis', 'timing', 'kein_bedarf', 'entscheider', 'wettbewerb', 'vertrauen',
            'ghosting', 'falsche_zielgruppe', 'kein_fit', 'sonstiges'));
end $$;

create index if not exists idx_setting_calls_cancelled
  on public.setting_calls (workspace_id, cancel_outlook)
  where cancelled_at is not null;
create index if not exists idx_closing_calls_cancelled
  on public.closing_calls (workspace_id, cancel_outlook)
  where cancelled_at is not null;

-- ---------------------------------------------------------------------------
-- 4. reminder_touches v2
-- ---------------------------------------------------------------------------
-- Echte Fremdschlüssel statt einer polymorphen entity_id: ein direkter
-- DB-Delete oder ein vergessener Aufrufpfad nimmt die Touches mit, statt
-- Karteileichen zu hinterlassen, die kein Invarianten-Check findet.

create table if not exists public.reminder_touches (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,

  setting_call_id uuid references public.setting_calls (id) on delete cascade,
  closing_call_id uuid references public.closing_calls (id) on delete cascade,
  entity_type     text not null check (entity_type in ('setting', 'closing', 'closing_followup')),
  entity_id       uuid generated always as (coalesce(setting_call_id, closing_call_id)) stored,

  -- cascade = geplante Stufe vor dem Termin
  -- chain   = Stufe einer Kette nach einem Ereignis (No-Show, Kein Close)
  -- sofort  = Ersatz-Touch, wenn der Termin für jede Stufe zu kurzfristig war
  touch_kind   text not null check (touch_kind in ('cascade', 'chain', 'sofort')),
  cascade_kind text not null,
  step_no      smallint not null check (step_no >= 0),
  requires_no_response boolean not null default false,

  -- Snapshot: eine später umbenannte Stufe schreibt die Historie nicht um.
  template_key text not null,

  assigned_user_id uuid references auth.users (id) on delete set null,
  due_at           timestamptz not null,
  appointment_at   timestamptz not null,

  channel        text check (channel in ('linkedin', 'telefon', 'whatsapp', 'mail')),
  channel_locked boolean not null default false,

  outcome    text check (outcome in ('antwort', 'keine_antwort', 'bestaetigt', 'abgesagt', 'verschoben')),
  done_note  text,
  snoozed_until timestamptz,

  done_at        timestamptz,
  done_by_user_id uuid references auth.users (id) on delete set null,
  superseded_at  timestamptz,
  created_at     timestamptz not null default now(),

  constraint reminder_touches_setting_fk_matches
    check ((entity_type = 'setting') = (setting_call_id is not null)),
  constraint reminder_touches_closing_fk_matches
    check ((entity_type in ('closing', 'closing_followup')) = (closing_call_id is not null)),
  constraint reminder_touches_done_pair
    check ((done_at is null) = (done_by_user_id is null)),
  constraint reminder_touches_done_before_superseded
    check (superseded_at is null or done_at is null or done_at <= superseded_at),
  -- Der sofort-Touch ist ausgenommen: sein due_at ist der Erzeugungszeitpunkt,
  -- und der Termin darf näher liegen als jede geplante Stufe.
  constraint reminder_touches_cascade_due_before_appointment
    check (touch_kind <> 'cascade' or due_at <= appointment_at)
);

comment on column public.reminder_touches.outcome is
  'Ergebnis des Kontakts. Bei touch_kind=''cascade'' wird es gespeichert und angezeigt, entwertet aber KEINE Folgestufe — eine Bestätigung auf Stufe 1 lässt Stufe 2 und 3 fällig, weil der Link aus Stufe 3 auch nach einer Zusage rausgehen soll.';
comment on column public.reminder_touches.channel is
  'Snapshot für die Auswertung. Die Anzeige löst den Kanal live auf, damit eine nachträglich erfasste Einwilligung noch wirkt; channel_locked merkt eine bewusste Nutzerwahl.';

-- Der Unique-Index kennt die Kaskade: mit Nachrichten- UND Mail-Spur auf
-- demselben Termin kollidierte Stufe 1 der einen sonst mit Stufe 1 der anderen.
-- Der sofort-Touch liegt mit step_no = 0 kollisionsfrei daneben.
create unique index if not exists uq_reminder_touches_active
  on public.reminder_touches (entity_type, entity_id, cascade_kind, step_no)
  where superseded_at is null;

-- Deckt die Hauptabfrage von /erinnerungen ab — die trug bisher keinen Index.
create index if not exists idx_reminder_touches_inbox
  on public.reminder_touches (workspace_id, assigned_user_id, due_at)
  where superseded_at is null and done_at is null;

create index if not exists idx_reminder_touches_entity
  on public.reminder_touches (entity_type, entity_id)
  where superseded_at is null;

create index if not exists idx_reminder_touches_cascade
  on public.reminder_touches (workspace_id, cascade_kind, due_at);

-- Zuständigkeit ist Pflicht bei der ERZEUGUNG, aber die Spalte bleibt nullable:
-- deleteUser ruft auth.admin.deleteUser() direkt und räumt nichts vor; ein
-- NOT NULL bräche die Nutzerverwaltung, ein on delete cascade löschte die
-- Erledigungs-Historie, die superseded_at bewusst aufhebt.
create or replace function public.reminder_touches_require_assignee ()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_user_id is null then
    raise exception 'reminder_touches.assigned_user_id darf beim Anlegen nicht NULL sein (Termin %, Kaskade %)',
      coalesce(new.setting_call_id, new.closing_call_id), new.cascade_kind;
  end if;
  return new;
end;
$$;

drop trigger if exists reminder_touches_require_assignee on public.reminder_touches;
create trigger reminder_touches_require_assignee
  before insert on public.reminder_touches
  for each row execute function public.reminder_touches_require_assignee ();

-- Pendant zu assigned_user_guard (0028): eine Erinnerung an einen Termin in
-- einer fremden Organisation ist nicht handelbar — superseden statt nullen,
-- damit die Historie erhalten bleibt.
create or replace function public.reminder_touches_ws_guard ()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_user_id is not null
     and not exists (
       select 1 from public.workspace_members wm
       where wm.user_id = new.assigned_user_id
         and wm.workspace_id = new.workspace_id
     )
  then
    new.superseded_at := coalesce(new.superseded_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists reminder_touches_ws_guard on public.reminder_touches;
create trigger reminder_touches_ws_guard
  before update of workspace_id, assigned_user_id on public.reminder_touches
  for each row execute function public.reminder_touches_ws_guard ();

-- ---------------------------------------------------------------------------
-- 5. apply_reminder_touches — Entwerten und Neuanlegen in EINEM Körper
-- ---------------------------------------------------------------------------
-- Bisher waren Supersede und Insert zwei Statements gegen einen partiellen
-- Unique-Index. Zwei dicht aufeinanderfolgende Auslöser (Umterminieren plus
-- Ergebnis) ließen den ganzen Array-Insert scheitern — und weil der Aufruf
-- fail-soft ist, stand der Termin danach ohne Kaskade da. Mit zwei Kaskaden je
-- Termin wird dieses Fenster größer, nicht kleiner.

create or replace function public.apply_reminder_touches (
  p_workspace_id uuid,
  p_entity_type  text,
  p_entity_id    uuid,
  p_cascade_kind text,
  p_rows         jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  ) and not public.is_platform_admin() then
    raise exception 'Kein Zugriff auf diese Organisation';
  end if;

  update public.reminder_touches
     set superseded_at = now()
   where workspace_id = p_workspace_id
     and entity_type  = p_entity_type
     and entity_id    = p_entity_id
     and cascade_kind = p_cascade_kind
     and superseded_at is null;

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  insert into public.reminder_touches (
    workspace_id, created_by_user_id,
    setting_call_id, closing_call_id, entity_type,
    touch_kind, cascade_kind, step_no, requires_no_response,
    template_key, assigned_user_id, due_at, appointment_at, channel
  )
  select
    p_workspace_id,
    auth.uid(),
    case when p_entity_type = 'setting' then p_entity_id end,
    case when p_entity_type in ('closing', 'closing_followup') then p_entity_id end,
    p_entity_type,
    coalesce(r ->> 'touch_kind', 'cascade'),
    p_cascade_kind,
    (r ->> 'step_no')::smallint,
    coalesce((r ->> 'requires_no_response')::boolean, false),
    r ->> 'template_key',
    (r ->> 'assigned_user_id')::uuid,
    (r ->> 'due_at')::timestamptz,
    (r ->> 'appointment_at')::timestamptz,
    nullif(r ->> 'channel', '')
  from jsonb_array_elements(p_rows) as r;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

grant execute on function public.apply_reminder_touches (uuid, text, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------

alter table public.pipeline_settings enable row level security;

drop policy if exists pipeline_settings_select on public.pipeline_settings;
create policy pipeline_settings_select on public.pipeline_settings
  for select to authenticated
  using (exists (select 1 from public.workspace_members wm
                 where wm.workspace_id = pipeline_settings.workspace_id
                   and wm.user_id = auth.uid()));

drop policy if exists pipeline_settings_manage on public.pipeline_settings;
create policy pipeline_settings_manage on public.pipeline_settings
  for all to authenticated
  using (public.can_manage_org_settings(workspace_id))
  with check (public.can_manage_org_settings(workspace_id));

alter table public.cascade_steps enable row level security;

drop policy if exists cascade_steps_select on public.cascade_steps;
create policy cascade_steps_select on public.cascade_steps
  for select to authenticated
  using (exists (select 1 from public.workspace_members wm
                 where wm.workspace_id = cascade_steps.workspace_id
                   and wm.user_id = auth.uid()));

drop policy if exists cascade_steps_manage on public.cascade_steps;
create policy cascade_steps_manage on public.cascade_steps
  for all to authenticated
  using (public.can_manage_org_settings(workspace_id))
  with check (public.can_manage_org_settings(workspace_id));

alter table public.reminder_touches enable row level security;

drop policy if exists reminder_touches_scoped_member on public.reminder_touches;
create policy reminder_touches_scoped_member on public.reminder_touches
  for all to authenticated
  using (
    public.can_access_owned_workspace_row(workspace_id, created_by_user_id)
    or public.can_access_owned_workspace_row(workspace_id, assigned_user_id)
  )
  with check (
    public.can_access_owned_workspace_row(workspace_id, created_by_user_id)
    or public.can_access_owned_workspace_row(workspace_id, assigned_user_id)
  );

drop policy if exists reminder_touches_platform_admin on public.reminder_touches;
create policy reminder_touches_platform_admin on public.reminder_touches
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Verifikation (nach dem Einspielen im SQL-Editor ausführen)
-- ---------------------------------------------------------------------------
-- Jeder aktive Touch hat eine zuständige Person — muss 0 ergeben:
--   select count(*) from public.reminder_touches
--    where superseded_at is null and assigned_user_id is null;
--
-- Ein Touch ohne Zuständige lässt sich nicht anlegen (muss fehlschlagen):
--   insert into public.reminder_touches
--     (workspace_id, setting_call_id, entity_type, touch_kind, cascade_kind,
--      step_no, template_key, due_at, appointment_at)
--   select workspace_id, id, 'setting', 'cascade', 'setting_msg', 1,
--          'setting_msg_1', now(), now() + interval '1 day'
--     from public.setting_calls limit 1;
--
-- Absage ohne Aussicht ist immer paarweise gesetzt — muss 0 ergeben:
--   select count(*) from public.setting_calls
--    where (cancelled_at is null) <> (cancel_outlook is null);
--
-- Kaskaden-Stufen sind widerspruchsfrei verankert — muss 0 ergeben:
--   select count(*) from public.cascade_steps
--    where (trigger_event = 'scheduled') <> (anchor = 'before_appointment');
