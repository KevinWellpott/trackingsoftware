-- ═══════════════════════════════════════════════════════════════════════════
-- 0031 · Erinnerungs-Kaskade: Bestätigungs-Touches für Setting/Closing/
--        Nachfass-Termine, WhatsApp-Erfassung, No-Show-Trigger
-- ---------------------------------------------------------------------------
-- Voraussetzung: 0030 eingespielt. Läuft NICHT automatisch (docs §7) —
-- im Supabase-SQL-Editor ausführen.
--
-- Rein additiv: zwei neue Spalten auf setting_calls, eine neue Spalte auf
-- closing_calls, zwei neue Tabellen. Kein Backfill — die Kaskade gilt bewusst
-- nur für Termine, die NACH diesem Deploy angelegt/verschoben werden
-- (docs zum Feature: kein rückwirkender Rollout, sonst reißt beim Rollout ein
-- Schwall sofort überfälliger Erinnerungen auf).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) WhatsApp-Erfassung am Setting
-- ---------------------------------------------------------------------------
-- Persönliche Nummer des Entscheiders + Einwilligungs-Zeitstempel. Bewusst
-- getrennt von setting_calls.phone: das ist die Einwahlnummer bei
-- meeting_kind='telefon' (docs §3), nicht die private Erreichbarkeit des
-- Leads. wa_consent_at ist der Beleg für die Einwilligung — nach deutschem
-- UWG braucht eine WhatsApp-Erinnerung an einen kalten Lead eine dokumentierte
-- Zustimmung, auch im B2B; eine reine Termin-/Service-Nachricht ist dann
-- unkritisch.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.setting_calls
  add column if not exists wa_phone text,
  add column if not exists wa_consent_at timestamptz;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Präziser Nachfass-Zeitpunkt am Closing
-- ---------------------------------------------------------------------------
-- follow_up_due (date) bleibt unverändert bestehen — nachfassen_tasks liest
-- weiter genau dieses Feld. follow_up_due_at ist die Ergänzung für die
-- Erinnerungs-Kaskade: ein Datum ohne Uhrzeit reicht nicht, um T-3 Tage/T-1
-- Tag/T-1 Stunde dagegen zu rechnen. Beide bleiben synchron — App-seitig
-- (withFollowUpDateSynced in closingCalls.ts), nicht per Trigger: kein anderes
-- abgeleitetes Feld dieser App (show_status, no_show_count) läuft über
-- Business-Logic in der DB.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.closing_calls
  add column if not exists follow_up_due_at timestamptz;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) reminder_settings — Kaskaden-Konfiguration je Organisation
-- ---------------------------------------------------------------------------
-- Eine Zeile pro Workspace. Offsets in Stunden vor dem Termin, editierbar
-- durch den Owner — deshalb offset_1/2/3 statt hartkodierter Namen wie
-- "t_minus_3d": ein geänderter Wert würde einen Tages-Namen sonst zur Lüge
-- machen. Die Anzeige rechnet die verbleibende Zeit immer aus due_at auf
-- reminder_touches, nie aus dem Slot-Namen.
--
-- 5 Textvorlagen: Setting-Reminder, Closing-Reminder, Nachfass-Termin-
-- Reminder, No-Show-Setting, No-Show-Closing — der Nutzer wollte diese
-- explizit editierbar, nicht fest im Code.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.reminder_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,

  offset_1_hours integer not null default 72 check (offset_1_hours > 0),
  offset_2_hours integer not null default 24 check (offset_2_hours > 0),
  offset_3_hours integer not null default 1 check (offset_3_hours > 0),
  check (offset_1_hours > offset_2_hours and offset_2_hours > offset_3_hours),

  template_setting_reminder text not null
    default 'Hi {vorname}, wir freuen uns auf unser Gespräch am {datum} um {uhrzeit}. Passt der Termin noch?',
  template_closing_reminder text not null
    default 'Hi {vorname}, kurze Erinnerung an unser Gespräch am {datum} um {uhrzeit} — bis gleich!',
  template_followup_reminder text not null
    default 'Hi {vorname}, wie besprochen melde ich mich am {datum} um {uhrzeit} bei dir zurück.',
  template_no_show_setting text not null
    default 'Hi {vorname}, schade, dass es gerade eben nicht geklappt hat — sollen wir einen neuen Termin finden?',
  template_no_show_closing text not null
    default 'Hi {vorname}, schade, dass unser Termin eben nicht stattfinden konnte — wann passt es dir erneut?',

  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references auth.users (id) on delete set null
);

alter table public.reminder_settings enable row level security;

-- Lesen: jedes Workspace-Mitglied — die Vorlagen werden von allen zum
-- Rendern der eigenen "Meine Erinnerungen heute"-Ansicht gebraucht.
drop policy if exists "reminder_settings_select_member" on public.reminder_settings;
create policy "reminder_settings_select_member" on public.reminder_settings
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = reminder_settings.workspace_id
        and wm.user_id = auth.uid ()
    )
  );

-- Schreiben: nur role='owner' — Muster workspaces_update_owner (0000_init).
drop policy if exists "reminder_settings_insert_owner" on public.reminder_settings;
create policy "reminder_settings_insert_owner" on public.reminder_settings
  for insert with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = reminder_settings.workspace_id
        and wm.user_id = auth.uid ()
        and wm.role = 'owner'
    )
  );

drop policy if exists "reminder_settings_update_owner" on public.reminder_settings;
create policy "reminder_settings_update_owner" on public.reminder_settings
  for update using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = reminder_settings.workspace_id
        and wm.user_id = auth.uid ()
        and wm.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = reminder_settings.workspace_id
        and wm.user_id = auth.uid ()
        and wm.role = 'owner'
    )
  );

drop policy if exists "reminder_settings_platform_admin" on public.reminder_settings;
create policy "reminder_settings_platform_admin" on public.reminder_settings
  for all using ((select public.is_platform_admin ()))
          with check ((select public.is_platform_admin ()));

-- ───────────────────────────────────────────────────────────────────────────
-- 4) reminder_touches — ein fälliger Bestätigungs-Touch je Zeile
-- ---------------------------------------------------------------------------
-- Polymorph wie call_assignees (entity_type/entity_id, kein FK — zwei
-- mögliche Zieltabellen, siehe Kommentar dort in 0008_tracking_2_core.sql).
-- assigned_user_id ist ein SNAPSHOT zum Erzeugungszeitpunkt nach exakt der
-- personOf()-Regel (assigned_user_id ?? created_by_user_id des Eltern-
-- Termins) — niemals live nachschlagen. Präzedenzfall: phone_call_attempts
-- snapshotet list_id/owner_name aus demselben Grund (0028 §3): ohne Snapshot
-- wandert eine historische Erinnerung lautlos zwischen Personen, sobald
-- setAssignee() die Zuweisung später ändert.
--
-- superseded_at statt Hard-Delete: eine Neuterminierung oder ein erfasstes
-- Ergebnis macht offene Touches obsolet, aber die Erledigungs-Historie bleibt
-- für die Analytics-Blöcke zählbar.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.reminder_touches (
  id uuid primary key default gen_random_uuid (),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,

  entity_type text not null check (entity_type in ('setting', 'closing', 'closing_followup')),
  entity_id uuid not null,

  touch_type text not null check (touch_type in ('offset_1', 'offset_2', 'offset_3', 'no_show')),
  -- Ein Nachfass-Termin hat keinen eigenen No-Show-Trigger — der entsteht nur
  -- aus einem tatsächlich stattgefundenen (oder eben nicht stattgefundenen)
  -- Setting-/Closing-Termin.
  check (touch_type <> 'no_show' or entity_type in ('setting', 'closing')),

  assigned_user_id uuid references auth.users (id) on delete set null,

  due_at timestamptz not null,
  -- Snapshot des Termins, gegen den due_at berechnet wurde — reine
  -- Anzeige-/Nachvollziehbarkeitshilfe, nicht für Berechnungen live gelesen.
  appointment_at timestamptz not null,

  -- null = kein Kanal ableitbar (Quelle ohne Vorlaufkanal wie 'ads'/'sonstige',
  -- oder ein Closing ohne Setting-Bezug) — die UI zeigt dann "Kanal frei
  -- wählen" statt zu raten.
  channel text check (channel is null or channel in ('linkedin', 'telefon', 'whatsapp')),

  -- Manuelles, kanalunabhängiges Häkchen. Bewusst NICHT mit
  -- phone_call_attempts verknüpft, auch nicht bei channel='telefon' — dieser
  -- Haken ist Reminder-Disziplin, kein Anruf-Ereignis.
  done_at timestamptz,
  done_by_user_id uuid references auth.users (id) on delete set null,

  superseded_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists idx_reminder_touches_ws_due
  on public.reminder_touches (workspace_id, due_at);
create index if not exists idx_reminder_touches_entity
  on public.reminder_touches (entity_type, entity_id);
create index if not exists idx_reminder_touches_ws_assigned
  on public.reminder_touches (workspace_id, assigned_user_id);

-- Höchstens ein AKTIVER Touch je (Termin, Touch-Art) gleichzeitig — verhindert
-- doppelte Kaskaden-Generierung, wenn ein Termin über zwei Pfade gleichzeitig
-- angefasst wird (z. B. Reschedule + Outcome kurz hintereinander).
create unique index if not exists uq_reminder_touches_active
  on public.reminder_touches (entity_type, entity_id, touch_type)
  where superseded_at is null;

drop trigger if exists reminder_touches_bi on public.reminder_touches;
create trigger reminder_touches_bi
before insert on public.reminder_touches
for each row execute function public.set_workspace_and_creator ();

alter table public.reminder_touches enable row level security;

-- Spiegelt setting_calls_scoped_member/closing_calls_scoped_member (0028 §5),
-- aber gegen die EIGENE, snapshotted assigned_user_id-Spalte dieser Tabelle —
-- nicht gegen die des Eltern-Termins, den RLS hier gar nicht kennt.
drop policy if exists "reminder_touches_scoped_member" on public.reminder_touches;
create policy "reminder_touches_scoped_member" on public.reminder_touches
  for all using (
        public.can_access_owned_workspace_row (reminder_touches.workspace_id, reminder_touches.created_by_user_id)
     or public.can_access_owned_workspace_row (reminder_touches.workspace_id, reminder_touches.assigned_user_id)
  )
  with check (
        public.can_access_owned_workspace_row (reminder_touches.workspace_id, reminder_touches.created_by_user_id)
     or public.can_access_owned_workspace_row (reminder_touches.workspace_id, reminder_touches.assigned_user_id)
  );

drop policy if exists "reminder_touches_platform_admin" on public.reminder_touches;
create policy "reminder_touches_platform_admin" on public.reminder_touches
  for all using ((select public.is_platform_admin ()))
          with check ((select public.is_platform_admin ()));

notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFIKATION — nach dem Ausführen
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Neue Spalten/Tabellen sichtbar:
--   select column_name from information_schema.columns
--    where table_name = 'setting_calls' and column_name in ('wa_phone','wa_consent_at');   -- 2 Zeilen
--   select column_name from information_schema.columns
--    where table_name = 'closing_calls' and column_name = 'follow_up_due_at';               -- 1 Zeile
--   select count(*) from reminder_settings;   -- 0 (noch keine Organisation hat gespeichert)
--   select count(*) from reminder_touches;    -- 0 (kein Backfill)
--
-- Kein Touch ohne zuständige Person (sollte nach dem Rollout stets 0 bleiben —
-- die Erzeugung snapshotet immer assigned_user_id ?? created_by_user_id):
--   select count(*) from reminder_touches where assigned_user_id is null;    -- 0
--
-- Höchstens ein aktiver Touch je (Termin, Touch-Art):
--   select entity_type, entity_id, touch_type, count(*) from reminder_touches
--    where superseded_at is null group by 1,2,3 having count(*) > 1;         -- 0 Zeilen
-- ═══════════════════════════════════════════════════════════════════════════
