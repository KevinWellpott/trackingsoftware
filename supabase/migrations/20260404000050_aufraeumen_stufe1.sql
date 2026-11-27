-- 0050 — Aufräumen Stufe 1: Tabellen, Spalten und Funktionen ohne Nutzung
--
-- ⚠ ERST EINSPIELEN, WENN DER ZUGEHÖRIGE CODE EINE WOCHE OHNE BESCHWERDE LIVE
--   WAR (Nutzungsanalyse 26.11.2026, Umsetzung Schritt 4). Vorher ein
--   CSV-Archiv der betroffenen Tabellen und Spalten ziehen (Abschnitt 0).
--   Die App liest keine der hier gelöschten Spalten mehr; zu FRÜH eingespielt
--   (vor dem Deploy des Codes) bräche dagegen jede Seite, die sie noch
--   namentlich selektiert.
--
-- 0001–0049 sind eingespielt und eingefroren; keine Zeile dieser Datei ändert
-- eine davon. Funktionen mit unveränderter Signatur per `create or replace`.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WAS FÄLLT (geprüft gegen alle Organisationen, keine Nutzung)
--
--  Tabellen: list_views (Smart Views, 0 Ansichten), organic_lists,
--    organic_posts (letzter Eintrag April), pipeline_stages (altes CRM,
--    automatisch angelegt, nie benutzt), die eingefrorenen Tabellen der alten
--    Kaskade reminder_touches, cascade_steps, message_templates,
--    template_catalog, dazu call_assignees (seit 0028 tot), followup_templates
--    (seit 0034 abgelöst) und die Sicherung _appt_tz_backup_20260727.
--  Funktionen: nachfassen_tasks, apply_reminder_touches (kein Aufrufer) und
--    die Trigger-/Zugriffsfunktionen der gelöschten Tabellen.
--  Spalten:
--    contacts       stage_id, deal_value, deal_closed, deal_lost_reason,
--                   custom_fields, meeting_notes, last_contacted_at,
--                   target_group
--    setting_calls  has_budget_8k, branche, sole_decider, can_decide_now,
--                   clear_need, ist_pain, warmth, soll_ziel, offer_type,
--                   recording_link, objections_handled, objections_open,
--                   wa_phone, wa_consent_at, wa_refused_at
--    closing_calls  recording_link, objections_handled, objections_open
--    phone_leads    answer_sentiment, objection_notes, video_link,
--                   decider_direct_dial, gatekeeper_attempts, script,
--                   no_transfer_reason, no_pitch_reason, no_appointment_reason
--    phone_lists    script_text
--    pipeline_settings reminder_horizon_days
--
--  WAS BLEIBT, obwohl wenig genutzt: contacts.company/email (Lesepfade im
--  Dossier, in der Suche und beim Buchen), setting_calls.call_at (Datums-
--  Rückfall in settingEffDate), phone_leads.pitch_delivered/mailbox/
--  gatekeeper_reached (Anruf-Log-Snapshots, Feld im Call-Modus optional).
--
--  Neu geschrieben werden, weil sie gelöschte Tabellen anfassen:
--  seed_workspace_defaults (nur noch pipeline_settings), move_user_scope
--  (Views/Organic liefern leere Arrays, Signatur bleibt), preview_move_user,
--  admin_move_user_to_workspace, preview_delete_workspace (Zähler der
--  gelöschten Tabellen entfallen — die §8-Invariante „jede Kaskade auf
--  workspaces steht in counts" bleibt dadurch grün).
--
--  Nebenbei geschlossen: Offener Punkt O1 (keine Löschmöglichkeit für die
--  WhatsApp-Nummer) — die Spalten gibt es danach nicht mehr.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0. ARCHIV (vorher, im SQL-Editor, Ergebnis als CSV herunterladen):
--    select * from public.list_views;  select * from public.organic_lists;
--    select * from public.organic_posts; select * from public.pipeline_stages;
--    select * from public.reminder_touches; select * from public.message_templates;
--    select * from public.call_assignees; select * from public.followup_templates;
--    select id, stage_id, deal_value, deal_closed, deal_lost_reason, custom_fields,
--           meeting_notes, last_contacted_at, target_group from public.contacts
--     where coalesce(stage_id::text, deal_value::text, deal_lost_reason, meeting_notes,
--                    last_contacted_at::text, target_group) is not null
--        or deal_closed is true or custom_fields <> '{}'::jsonb;
--    select id, has_budget_8k, branche, sole_decider, can_decide_now, clear_need,
--           ist_pain, warmth, soll_ziel, offer_type, recording_link,
--           objections_handled, objections_open, wa_phone, wa_consent_at, wa_refused_at
--      from public.setting_calls;
--    select id, recording_link, objections_handled, objections_open from public.closing_calls;
--    select id, answer_sentiment, objection_notes, video_link, decider_direct_dial,
--           gatekeeper_attempts, script, no_transfer_reason, no_pitch_reason,
--           no_appointment_reason from public.phone_leads;

begin;

-- ── 1. Funktionen neu, BEVOR die Tabellen fallen ───────────────────────────

create or replace function public.seed_workspace_defaults(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Seit 0050 nur noch die Konfigurationszeile: Die 21 Kaskadenstufen las
  -- seit dem Rückbau niemand mehr, die Tabelle ist gelöscht.
  insert into public.pipeline_settings (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;
end;
$function$;

create or replace function public.move_user_scope(
  p_user_id uuid, out o_username text, out o_src uuid, out o_list_ids uuid[], out o_view_ids uuid[],
  out o_phone_ids uuid[], out o_organic_ids uuid[], out o_setting_ids uuid[], out o_closing_ids uuid[])
returns record
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  -- Eigener Guard: Postgres vergibt EXECUTE standardmaessig an PUBLIC, und
  -- security definer umgeht RLS.
  if not public.is_platform_admin () then
    raise exception 'Nur Plattform-Admins duerfen Besitzverhaeltnisse aufloesen';
  end if;

  select p.username into o_username from public.profiles p where p.user_id = p_user_id;
  if o_username is null then
    raise exception 'Nutzer hat kein Profil (user_id %)', p_user_id;
  end if;

  select wm.workspace_id into o_src
  from public.workspace_members wm
  where wm.user_id = p_user_id
  limit 1;
  if o_src is null then
    raise exception 'Nutzer % hat keine Mitgliedschaft', o_username;
  end if;

  -- owner_name hat Vorrang vor created_by_user_id (list_owned_by_user()).
  select coalesce(array_agg(l.id), '{}'::uuid[]) into o_list_ids
  from public.lists l
  where l.workspace_id = o_src
    and ((l.owner_name is not null and l.owner_name = o_username)
      or (l.owner_name is null and l.created_by_user_id = p_user_id));

  -- Smart Views und Organic gibt es seit 0050 nicht mehr. Die OUT-Parameter
  -- bleiben, damit die Signatur gleich bleibt (kein drop function).
  o_view_ids := '{}'::uuid[];
  o_organic_ids := '{}'::uuid[];

  select coalesce(array_agg(pl.id), '{}'::uuid[]) into o_phone_ids
  from public.phone_lists pl
  where pl.workspace_id = o_src
    and ((pl.owner_name is not null and pl.owner_name = o_username)
      or (pl.owner_name is null and pl.created_by_user_id = p_user_id));

  -- setting_calls/closing_calls haben KEIN owner_name (docs/data-model.md §2)
  select coalesce(array_agg(sc.id), '{}'::uuid[]) into o_setting_ids
  from public.setting_calls sc
  where sc.workspace_id = o_src and sc.created_by_user_id = p_user_id;

  select coalesce(array_agg(cc.id), '{}'::uuid[]) into o_closing_ids
  from public.closing_calls cc
  where cc.workspace_id = o_src
    and (cc.created_by_user_id = p_user_id or cc.setting_call_id = any (o_setting_ids));
end;
$function$;

create or replace function public.preview_move_user(p_user_id uuid, p_target_workspace_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  s record;
  v_target_name text;
  v_src_name text;
  v_warnings jsonb := '[]'::jsonb;
  n bigint;
begin
  if not public.is_platform_admin () then
    raise exception 'Nur Plattform-Admins duerfen Nutzer verschieben';
  end if;

  select * into s from public.move_user_scope (p_user_id);

  select w.name into v_src_name from public.workspaces w where w.id = s.o_src;
  select w.name into v_target_name from public.workspaces w where w.id = p_target_workspace_id;
  if v_target_name is null then
    raise exception 'Zielorganisation existiert nicht';
  end if;

  select count(*) into n
  from public.setting_calls sc
  where sc.id = any (s.o_setting_ids)
    and sc.source_contact_id is not null
    and not exists (
      select 1 from public.contacts c
      where c.id = sc.source_contact_id and c.list_id = any (s.o_list_ids)
    );
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'orphan_setting_source', 'count', n,
      'text', n || ' Termin(e) verlieren ihren LinkedIn-Kontakt (Liste bleibt zurück).');
  end if;

  select count(*) into n
  from public.setting_calls sc
  where sc.id = any (s.o_setting_ids)
    and sc.source_phone_lead_id is not null
    and not exists (
      select 1 from public.phone_leads pl
      where pl.id = sc.source_phone_lead_id and pl.list_id = any (s.o_phone_ids)
    );
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'orphan_setting_phone_source', 'count', n,
      'text', n || ' Termin(e) verlieren ihren Telefon-Lead (Liste bleibt zurück).');
  end if;

  select count(*) into n
  from public.closing_calls cc
  where cc.id = any (s.o_closing_ids)
    and cc.setting_call_id is not null
    and not (cc.setting_call_id = any (s.o_setting_ids));
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'split_setting_closing', 'count', n,
      'text', n || ' Closing(s) verlieren ihren Setting-Bezug (anderer Ersteller).');
  end if;

  select count(*) into n
  from public.phone_call_attempts a
  join public.phone_leads pl on pl.id = a.lead_id
  where a.workspace_id = s.o_src
    and pl.list_id = any (s.o_phone_ids)
    and a.list_id is not null
    and not (a.list_id = any (s.o_phone_ids));
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'attempt_list_snapshot_split', 'count', n,
      'text', n || ' Anwahl(en) ziehen mit, ihre Ursprungsliste bleibt zurück (Snapshot bleibt unverändert).');
  end if;

  return jsonb_build_object(
    'username', s.o_username,
    'source_workspace_id', s.o_src,
    'source_workspace', v_src_name,
    'target_workspace_id', p_target_workspace_id,
    'target_workspace', v_target_name,
    -- Wortgleich zu den Updates im Mover — sonst schluege der
    -- p_expected-Vergleich fehl.
    'counts', jsonb_build_object(
      'lists', coalesce(array_length(s.o_list_ids, 1), 0),
      'contacts', (select count(*) from public.contacts where list_id = any (s.o_list_ids)),
      'phone_lists', coalesce(array_length(s.o_phone_ids, 1), 0),
      'phone_leads', (select count(*) from public.phone_leads where list_id = any (s.o_phone_ids)),
      'phone_call_attempts', (select count(*) from public.phone_call_attempts a
                               where a.workspace_id = s.o_src
                                 and exists (select 1 from public.phone_leads pl
                                              where pl.id = a.lead_id
                                                and pl.list_id = any (s.o_phone_ids))),
      'csv_imports', (select count(*) from public.csv_imports
                       where workspace_id = s.o_src
                         and (phone_list_id = any (s.o_phone_ids)
                              or (phone_list_id is null and created_by_user_id = p_user_id))),
      'setting_calls', coalesce(array_length(s.o_setting_ids, 1), 0),
      'closing_calls', coalesce(array_length(s.o_closing_ids, 1), 0),
      'performance_targets', (select count(*) from public.performance_targets where user_id = p_user_id)
    ),
    'warnings', v_warnings
  );
end;
$function$;

create or replace function public.admin_move_user_to_workspace(
  p_user_id uuid, p_target_workspace_id uuid, p_role text default null::text,
  p_data_scope text default null::text, p_force boolean default false, p_expected jsonb default null::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s record;
  v_old_role text;
  v_old_scope text;
  v_owner_count int;
  v_member_count int;
  v_actual jsonb;
  v_moved jsonb := '{}'::jsonb;
  n bigint;
begin
  if not public.is_platform_admin () then
    raise exception 'Nur Plattform-Admins duerfen Nutzer verschieben';
  end if;

  perform pg_advisory_xact_lock (hashtext ('move_user'), hashtext (p_user_id::text));

  select * into s from public.move_user_scope (p_user_id);

  -- ---- Vorbedingungen ----
  if s.o_src = p_target_workspace_id then
    raise exception 'Nutzer % ist bereits in dieser Organisation', s.o_username;
  end if;

  if not exists (select 1 from public.workspaces w where w.id = p_target_workspace_id) then
    raise exception 'Zielorganisation existiert nicht';
  end if;

  if exists (select 1 from public.lists where workspace_id = p_target_workspace_id and owner_name = s.o_username)
     or exists (select 1 from public.phone_lists where workspace_id = p_target_workspace_id and owner_name = s.o_username)
  then
    raise exception 'In der Zielorganisation existieren bereits Listen mit owner_name = %', s.o_username;
  end if;

  if exists (
    select 1 from public.phone_lists
    where workspace_id = p_target_workspace_id
      and created_by_user_id = p_user_id
      and list_kind <> 'akquise'
  ) then
    raise exception 'Zielorganisation hat bereits Routing-Telefonlisten dieses Nutzers';
  end if;

  select wm.role, wm.data_scope into v_old_role, v_old_scope
  from public.workspace_members wm
  where wm.user_id = p_user_id and wm.workspace_id = s.o_src;

  select count(*) into v_owner_count
  from public.workspace_members where workspace_id = s.o_src and role = 'owner';
  select count(*) into v_member_count
  from public.workspace_members where workspace_id = s.o_src;

  if v_old_role = 'owner' and v_owner_count = 1 and v_member_count > 1 and not p_force then
    raise exception
      'Nutzer % ist letzter Owner der Quellorganisation — p_force := true zum Erzwingen', s.o_username;
  end if;

  if p_expected is not null then
    v_actual := public.preview_move_user (p_user_id, p_target_workspace_id) -> 'counts';
    if v_actual is distinct from p_expected then
      raise exception 'Datenbestand hat sich seit der Vorschau geaendert (erwartet %, tatsaechlich %) — bitte erneut pruefen',
        p_expected, v_actual;
    end if;
  end if;

  -- ---- Kanten kappen, SOLANGE beide Seiten noch in der Quell-Org liegen ----
  update public.setting_calls sc set source_contact_id = null
   where sc.id = any (s.o_setting_ids)
     and sc.source_contact_id is not null
     and not exists (select 1 from public.contacts c
                      where c.id = sc.source_contact_id and c.list_id = any (s.o_list_ids));

  update public.setting_calls sc set source_phone_lead_id = null
   where sc.id = any (s.o_setting_ids)
     and sc.source_phone_lead_id is not null
     and not exists (select 1 from public.phone_leads pl
                      where pl.id = sc.source_phone_lead_id and pl.list_id = any (s.o_phone_ids));

  update public.contacts c
     set setting_call_id = null, appointment_set = false,
         appointment_at = null, meet_link = null
   where c.setting_call_id = any (s.o_setting_ids)
     and not (c.list_id = any (s.o_list_ids));

  update public.phone_leads pl
     set appointment_set = false, appointment_at = null, meet_link = null, status = 'aktiv'
   where pl.workspace_id = s.o_src
     and not (pl.list_id = any (s.o_phone_ids))
     and exists (select 1 from public.setting_calls sc
                  where sc.id = any (s.o_setting_ids) and sc.source_phone_lead_id = pl.id);

  update public.closing_calls cc set setting_call_id = null
   where cc.id = any (s.o_closing_ids)
     and cc.setting_call_id is not null
     and not (cc.setting_call_id = any (s.o_setting_ids));

  -- ---- Umstempeln, Eltern vor Kindern ----
  update public.lists set workspace_id = p_target_workspace_id where id = any (s.o_list_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('lists', n);

  update public.contacts set workspace_id = p_target_workspace_id where list_id = any (s.o_list_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('contacts', n);

  update public.phone_lists set workspace_id = p_target_workspace_id where id = any (s.o_phone_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('phone_lists', n);

  update public.phone_leads set workspace_id = p_target_workspace_id where list_id = any (s.o_phone_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('phone_leads', n);

  -- Das Anruf-Log folgt dem Lead; list_id/owner_name sind Snapshots (docs §3).
  update public.phone_call_attempts a
     set workspace_id = p_target_workspace_id
   where a.workspace_id = s.o_src
     and exists (select 1 from public.phone_leads pl
                  where pl.id = a.lead_id and pl.list_id = any (s.o_phone_ids));
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('phone_call_attempts', n);

  update public.csv_imports set workspace_id = p_target_workspace_id
   where workspace_id = s.o_src
     and (phone_list_id = any (s.o_phone_ids)
          or (phone_list_id is null and created_by_user_id = p_user_id));
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('csv_imports', n);

  update public.setting_calls set workspace_id = p_target_workspace_id where id = any (s.o_setting_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('setting_calls', n);

  update public.closing_calls set workspace_id = p_target_workspace_id where id = any (s.o_closing_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('closing_calls', n);

  update public.performance_targets set workspace_id = p_target_workspace_id where user_id = p_user_id;
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('performance_targets', n);

  -- ---- Mitgliedschaft zuletzt: ERST loeschen, DANN anlegen ----
  delete from public.workspace_members where user_id = p_user_id and workspace_id = s.o_src;
  insert into public.workspace_members (workspace_id, user_id, role, data_scope)
  values (
    p_target_workspace_id,
    p_user_id,
    coalesce(p_role, v_old_role, 'member'),
    coalesce(p_data_scope, v_old_scope, 'workspace')
  );

  return jsonb_build_object(
    'username', s.o_username,
    'source_workspace_id', s.o_src,
    'target_workspace_id', p_target_workspace_id,
    'moved', v_moved
  );
end;
$function$;

create or replace function public.preview_delete_workspace(p_workspace_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_name text;
  v_members jsonb;
  v_list_ids uuid[];
  v_phone_ids uuid[];
begin
  if not public.is_platform_admin () then
    raise exception 'Nur Plattform-Admins duerfen Organisationen loeschen';
  end if;

  select w.name into v_name from public.workspaces w where w.id = p_workspace_id;
  if v_name is null then
    raise exception 'Organisation existiert nicht';
  end if;

  select coalesce(jsonb_agg(x.username order by x.username), '[]'::jsonb)
    into v_members
  from (
    select coalesce(p.username, wm.user_id::text) as username
    from public.workspace_members wm
    left join public.profiles p on p.user_id = wm.user_id
    where wm.workspace_id = p_workspace_id
  ) x;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_list_ids
    from public.lists where workspace_id = p_workspace_id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_phone_ids
    from public.phone_lists where workspace_id = p_workspace_id;

  -- Jede Tabelle mit `on delete cascade` auf workspaces steht hier (§8-
  -- Invariante prüft das gegen pg_constraint).
  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'workspace', v_name,
    'members', v_members,
    'counts', jsonb_build_object(
      'lists', coalesce(array_length(v_list_ids, 1), 0),
      'contacts', (select count(*) from public.contacts where workspace_id = p_workspace_id),
      'phone_lists', coalesce(array_length(v_phone_ids, 1), 0),
      'phone_leads', (select count(*) from public.phone_leads where workspace_id = p_workspace_id),
      'csv_imports', (select count(*) from public.csv_imports where workspace_id = p_workspace_id),
      'setting_calls', (select count(*) from public.setting_calls where workspace_id = p_workspace_id),
      'closing_calls', (select count(*) from public.closing_calls where workspace_id = p_workspace_id),
      'performance_targets', (select count(*) from public.performance_targets where workspace_id = p_workspace_id),
      'phone_call_attempts', (select count(*) from public.phone_call_attempts where workspace_id = p_workspace_id),
      'pipeline_settings', (select count(*) from public.pipeline_settings where workspace_id = p_workspace_id)
    )
  );
end;
$function$;

-- ── 2. Funktionen ohne Aufrufer ────────────────────────────────────────────
drop function if exists public.nachfassen_tasks(uuid, date, timestamptz, uuid);
drop function if exists public.apply_reminder_touches(uuid, text, uuid, text, jsonb);

-- ── 3. Tabellen ────────────────────────────────────────────────────────────
-- Kinder vor Eltern; `cascade` nimmt Trigger, Policies und FKs der Tabelle mit.
drop table if exists public.reminder_touches cascade;
drop table if exists public.cascade_steps cascade;
drop table if exists public.message_templates cascade;
drop table if exists public.template_catalog cascade;
drop table if exists public.call_assignees cascade;
drop table if exists public.followup_templates cascade;
drop table if exists public.organic_posts cascade;
drop table if exists public.organic_lists cascade;
drop table if exists public.list_views cascade;
alter table public.contacts drop column if exists stage_id;
drop table if exists public.pipeline_stages cascade;
drop table if exists public._appt_tz_backup_20260727;

-- Trigger- und Zugriffsfunktionen der gelöschten Tabellen
drop function if exists public.reminder_touches_require_assignee();
drop function if exists public.reminder_touches_ws_guard();
drop function if exists public.touch_list_views_updated_at();
drop function if exists public.organic_posts_set_updated_at();
drop function if exists public.organic_posts_set_workspace();
drop function if exists public.can_access_organic_list(uuid);

-- ── 4. Spalten ─────────────────────────────────────────────────────────────
alter table public.contacts
  drop column if exists deal_value,
  drop column if exists deal_closed,
  drop column if exists deal_lost_reason,
  drop column if exists custom_fields,
  drop column if exists meeting_notes,
  drop column if exists last_contacted_at,
  drop column if exists target_group;

alter table public.setting_calls
  drop column if exists has_budget_8k,
  drop column if exists branche,
  drop column if exists sole_decider,
  drop column if exists can_decide_now,
  drop column if exists clear_need,
  drop column if exists ist_pain,
  drop column if exists warmth,
  drop column if exists soll_ziel,
  drop column if exists offer_type,
  drop column if exists recording_link,
  drop column if exists objections_handled,
  drop column if exists objections_open,
  drop column if exists wa_phone,
  drop column if exists wa_consent_at,
  drop column if exists wa_refused_at;

alter table public.closing_calls
  drop column if exists recording_link,
  drop column if exists objections_handled,
  drop column if exists objections_open;

alter table public.phone_leads
  drop column if exists answer_sentiment,
  drop column if exists objection_notes,
  drop column if exists video_link,
  drop column if exists decider_direct_dial,
  drop column if exists gatekeeper_attempts,
  drop column if exists script,
  drop column if exists no_transfer_reason,
  drop column if exists no_pitch_reason,
  drop column if exists no_appointment_reason;

alter table public.phone_lists drop column if exists script_text;
alter table public.pipeline_settings drop column if exists reminder_horizon_days;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFIKATION
-- ═══════════════════════════════════════════════════════════════════════════
-- V1 Keine der Tabellen existiert mehr. Erwartet: leere Menge.
-- select tablename from pg_tables where schemaname = 'public' and tablename in
--  ('list_views','organic_lists','organic_posts','pipeline_stages','reminder_touches','cascade_steps',
--   'message_templates','template_catalog','call_assignees','followup_templates','_appt_tz_backup_20260727');
--
-- V2 Keine der Spalten existiert mehr. Erwartet: leere Menge.
-- select table_name, column_name from information_schema.columns
--  where table_schema = 'public' and column_name in
--  ('stage_id','deal_value','deal_closed','deal_lost_reason','custom_fields','meeting_notes','target_group',
--   'has_budget_8k','branche','sole_decider','can_decide_now','clear_need','ist_pain','warmth','soll_ziel',
--   'offer_type','recording_link','objections_handled','objections_open','wa_phone','wa_consent_at',
--   'wa_refused_at','answer_sentiment','objection_notes','video_link','decider_direct_dial',
--   'gatekeeper_attempts','no_transfer_reason','no_pitch_reason','no_appointment_reason','script_text',
--   'reminder_horizon_days')
--    and not (table_name = 'phone_leads' and column_name = 'target_group')
--    and not (table_name = 'phone_lists' and column_name = 'target_group');
--
-- V3 Die Löschvorschau nennt jede Tabelle, die sie mitlöscht (§8). Erwartet: leere Menge.
-- select c.conrelid::regclass from pg_constraint c
--  where c.confrelid = 'public.workspaces'::regclass and c.confdeltype = 'c'
--    and c.conrelid::regclass::text <> 'workspace_members'
--    and not (preview_delete_workspace('<workspace>') -> 'counts') ? split_part(c.conrelid::regclass::text, '.', 2);
--
-- V4 Neue Organisation bekommt weiter ihre Konfigurationszeile (Trigger
--    workspaces_seed_defaults). Erwartet: 0.
-- select count(*) from public.workspaces w
--  where not exists (select 1 from public.pipeline_settings ps where ps.workspace_id = w.id);
