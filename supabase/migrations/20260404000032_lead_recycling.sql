-- ═══════════════════════════════════════════════════════════════════════════
-- 0032 · Lead-Recycling: Wiedervorlage für die vier "toten Enden" der Pipeline
--        (Closing verloren, Telefon dead, Setting dead, LinkedIn FU3-Ende)
-- ---------------------------------------------------------------------------
-- Voraussetzung: 0031 eingespielt. Läuft NICHT automatisch (docs §7) —
-- im Supabase-SQL-Editor ausführen.
--
-- Konzept: Vier Stellen im Datenmodell lassen einen Lead heute endgültig
-- fallen, ohne dass je wieder etwas passiert — contacts nach FU3 ohne Antwort
-- (nextFollowUpAfter liefert dort bewusst null), phone_leads.status='dead',
-- setting_calls.status='dead' (anders als no_show/unqualifiziert OHNE eigenes
-- follow_up_due) und closing_calls.status='verloren' (komplett ohne
-- Wiedervorlage, unabhängig vom lost_reason_code). Recycling gibt jedem davon
-- ein Wiedervorlage-Datum mit einer je nach Verlustgrund unterschiedlichen
-- Wartezeit (Recherche: Timing-/Budget-Verluste lohnen sich nach Wochen,
-- Vertrauens-/Wettbewerbsverluste erst nach Monaten) statt einer einzigen
-- globalen Frist.
--
-- Rein additiv: je drei neue Spalten auf vier bestehenden Tabellen (kein
-- Backfill — gilt nur für Zeilen, die NACH diesem Deploy terminal werden),
-- eine neue Konfigurationstabelle, eine neue RPC. `nachfassen_tasks` bleibt
-- unverändert (Signatur + Verhalten) — Recycling ist bewusst eine eigene RPC
-- mit eigener Rückgabeform (4 Ursprungstabellen mit unterschiedlicher
-- Grund-Semantik lassen sich nicht verlustfrei in die bestehenden 8 Spalten
-- pressen), die App-Seite mischt beide Listen zu EINER Union auf JS-Ebene.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Recycling-Felder auf allen vier Ursprungstabellen
-- ---------------------------------------------------------------------------
-- next_recycle_at (date, nicht timestamptz): Recycling ist Wochen/Monate-
-- Kadenz, keine Uhrzeit-Präzision wie die Erinnerungs-Kaskade (0031) —
-- dieselbe Tages-Granularität wie follow_up_due/next_follow_up_at.
-- recycle_attempt_count: wie viele Recycling-Versuche bereits gemacht wurden
-- (0 = noch keiner). recycle_excluded_at: permanentes Opt-out ("hat explizit
-- nein gesagt"), unabhängig von blocked_at (das kennt nur LinkedIn).
-- ───────────────────────────────────────────────────────────────────────────

alter table public.contacts
  add column if not exists next_recycle_at date,
  add column if not exists recycle_attempt_count integer not null default 0,
  add column if not exists recycle_excluded_at timestamptz;

alter table public.phone_leads
  add column if not exists next_recycle_at date,
  add column if not exists recycle_attempt_count integer not null default 0,
  add column if not exists recycle_excluded_at timestamptz;

alter table public.setting_calls
  add column if not exists next_recycle_at date,
  add column if not exists recycle_attempt_count integer not null default 0,
  add column if not exists recycle_excluded_at timestamptz;

alter table public.closing_calls
  add column if not exists next_recycle_at date,
  add column if not exists recycle_attempt_count integer not null default 0,
  add column if not exists recycle_excluded_at timestamptz;

create index if not exists idx_contacts_recycle
  on public.contacts (workspace_id, next_recycle_at) where next_recycle_at is not null;
create index if not exists idx_phone_leads_recycle
  on public.phone_leads (workspace_id, next_recycle_at) where next_recycle_at is not null;
create index if not exists idx_setting_calls_recycle
  on public.setting_calls (workspace_id, next_recycle_at) where next_recycle_at is not null;
create index if not exists idx_closing_calls_recycle
  on public.closing_calls (workspace_id, next_recycle_at) where next_recycle_at is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) recycle_settings — Wartezeiten + Vorlagen je Organisation
-- ---------------------------------------------------------------------------
-- Eine Zeile pro Workspace, Muster reminder_settings (0031). Wartezeiten in
-- Tagen, je Verlustgrund/Ursprung getrennt (Recherche: ein globaler Timer
-- ignoriert, dass "falscher Zeitpunkt" nach Wochen wieder relevant wird,
-- "Vertrauen verloren" aber erst nach Monaten). max_attempts deckelt die
-- Anzahl der Recycling-Versuche pro Lead — sonst nervt ein nie antwortender
-- Lead alle paar Monate für immer weiter.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.recycle_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,

  -- closing_calls.lost_reason_code → Wartezeit bis zum ersten Recycling-Versuch
  days_timing integer not null default 75 check (days_timing > 0),
  days_preis integer not null default 105 check (days_preis > 0),
  days_kein_bedarf integer not null default 105 check (days_kein_bedarf > 0),
  days_entscheider integer not null default 150 check (days_entscheider > 0),
  days_wettbewerb integer not null default 270 check (days_wettbewerb > 0),
  days_vertrauen integer not null default 270 check (days_vertrauen > 0),
  -- Ghosting ist zweistufig: kurzer "Breakup"-Touch zuerst, danach das lange
  -- Intervall wie bei Vertrauen/Wettbewerb (siehe recycleCadence.ts).
  days_ghosting_breakup integer not null default 14 check (days_ghosting_breakup > 0),
  days_ghosting integer not null default 180 check (days_ghosting > 0),
  -- Fallback für 'sonstiges' UND für Zeilen ohne Code (Bestand vor 0029).
  days_sonstiges integer not null default 120 check (days_sonstiges > 0),
  -- 'falsche_zielgruppe' hat bewusst KEINE Spalte — nie automatisches
  -- Recycling, siehe recycleCadence.ts.

  -- Telefon/Setting/LinkedIn kennen keinen Verlustgrund-Code, nur EINEN
  -- generischen Wert je Ursprung.
  days_phone_dead integer not null default 100 check (days_phone_dead > 0),
  days_setting_dead integer not null default 100 check (days_setting_dead > 0),
  days_linkedin_exhausted integer not null default 100 check (days_linkedin_exhausted > 0),

  max_attempts integer not null default 2 check (max_attempts between 1 and 5),

  template_recycle_linkedin text not null
    default 'Hi {vorname}, ist schon eine Weile her — {anlass}. Hättest du gerade 15 Minuten für ein kurzes Update?',
  template_recycle_telefon text not null
    default 'Hi {vorname}, wir hatten vor einiger Zeit telefoniert — {anlass}. Passt es gerade nochmal für ein kurzes Gespräch?',
  template_recycle_setting text not null
    default 'Hi {vorname}, unser Termin hatte damals nicht geklappt — {anlass}. Sollen wir einen neuen Anlauf nehmen?',
  template_recycle_closing text not null
    default 'Hi {vorname}, wir hatten uns vor einiger Zeit ausgetauscht — {anlass}. Macht es Sinn, das Thema nochmal aufzugreifen?',

  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references auth.users (id) on delete set null
);

alter table public.recycle_settings enable row level security;

drop policy if exists "recycle_settings_select_member" on public.recycle_settings;
create policy "recycle_settings_select_member" on public.recycle_settings
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = recycle_settings.workspace_id
        and wm.user_id = auth.uid ()
    )
  );

drop policy if exists "recycle_settings_insert_owner" on public.recycle_settings;
create policy "recycle_settings_insert_owner" on public.recycle_settings
  for insert with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = recycle_settings.workspace_id
        and wm.user_id = auth.uid ()
        and wm.role = 'owner'
    )
  );

drop policy if exists "recycle_settings_update_owner" on public.recycle_settings;
create policy "recycle_settings_update_owner" on public.recycle_settings
  for update using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = recycle_settings.workspace_id
        and wm.user_id = auth.uid ()
        and wm.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = recycle_settings.workspace_id
        and wm.user_id = auth.uid ()
        and wm.role = 'owner'
    )
  );

drop policy if exists "recycle_settings_platform_admin" on public.recycle_settings;
create policy "recycle_settings_platform_admin" on public.recycle_settings
  for all using ((select public.is_platform_admin ()))
          with check ((select public.is_platform_admin ()));

-- ───────────────────────────────────────────────────────────────────────────
-- 3) recycle_tasks — fällige Recycling-Versuche über alle vier Ursprünge
-- ---------------------------------------------------------------------------
-- Eigene RPC statt Erweiterung von nachfassen_tasks: eine geänderte
-- RETURNS-TABLE-Signatur einer bestehenden Funktion bräuchte DROP + CREATE
-- (Postgres erlaubt CREATE OR REPLACE nicht bei geändertem Rückgabetyp) und
-- risikiert Grants/Abhängigkeiten der bestehenden Funktion. Zwei RPCs mit
-- fester Signatur sind hier das kleinere Risiko; die App mischt beide Listen
-- zu einer Union (getNachfassenTasks in actions/nachfassen.ts).
--
-- reason: bei 'closing' der lost_reason_code (oder 'sonstiges' ohne Code),
-- bei 'setting'/'telefon' der feste Wert 'dead', bei 'linkedin' 'fu_exhausted'
-- — die App braucht das, um Text + Badge zu wählen (recycleCadence.ts).
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.recycle_tasks (
  p_workspace_id uuid,
  p_today date,
  p_effective_user_id uuid default null
)
returns table (
  origin text,
  entity_id uuid,
  owner_name text,
  lead_name text,
  company text,
  due_at date,
  reason text,
  attempt_count int
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
    -- LinkedIn: FU-Flow ohne Antwort zu Ende gelaufen (§4 docs)
    select 'linkedin'::text, c.id, l.owner_name, c.name, c.company,
           c.next_recycle_at, 'fu_exhausted'::text, c.recycle_attempt_count
    from public.contacts c
    join public.lists l on l.id = c.list_id
    where c.workspace_id = p_workspace_id
      and c.next_recycle_at is not null
      and c.next_recycle_at <= p_today
      and c.recycle_excluded_at is null
      and c.blocked_at is null
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    union all
    -- Telefon: toter Lead
    select 'telefon'::text, pl.id, l.owner_name, pl.decider_name, pl.company,
           pl.next_recycle_at, 'dead'::text, pl.recycle_attempt_count
    from public.phone_leads pl
    join public.phone_lists l on l.id = pl.list_id
    where pl.workspace_id = p_workspace_id
      and pl.next_recycle_at is not null
      and pl.next_recycle_at <= p_today
      and pl.recycle_excluded_at is null
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    union all
    -- Setting: dead (anders als no_show/unqualifiziert — die bleiben in
    -- nachfassen_tasks, weil sie einen aktiven Wiederanlauf, kein Recycling sind)
    select 'setting'::text, sc.id, null::text, sc.lead_name, sc.company,
           sc.next_recycle_at, 'dead'::text, sc.recycle_attempt_count
    from public.setting_calls sc
    where sc.workspace_id = p_workspace_id
      and sc.next_recycle_at is not null
      and sc.next_recycle_at <= p_today
      and sc.recycle_excluded_at is null
      and (v_eff is null or coalesce(sc.assigned_user_id, sc.created_by_user_id) = v_eff)
    union all
    -- Closing: verloren, Grund = lost_reason_code (Migration 0029)
    select 'closing'::text, cc.id, null::text, cc.lead_name, cc.company,
           cc.next_recycle_at, coalesce(cc.lost_reason_code, 'sonstiges'), cc.recycle_attempt_count
    from public.closing_calls cc
    where cc.workspace_id = p_workspace_id
      and cc.next_recycle_at is not null
      and cc.next_recycle_at <= p_today
      and cc.recycle_excluded_at is null
      and (v_eff is null or coalesce(cc.assigned_user_id, cc.created_by_user_id) = v_eff);
end;
$$;

grant execute on function public.recycle_tasks (uuid, date, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFIKATION — nach dem Ausführen
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Neue Spalten sichtbar (4 Zeilen):
--   select table_name, column_name from information_schema.columns
--    where column_name = 'next_recycle_at';
--
-- recycle_settings existiert, noch keine Organisation hat gespeichert:
--   select count(*) from recycle_settings;   -- 0
--
-- RPC aufrufbar, liefert leer (kein Backfill):
--   select * from recycle_tasks('<eine workspace_id>'::uuid, current_date);
-- ═══════════════════════════════════════════════════════════════════════════
