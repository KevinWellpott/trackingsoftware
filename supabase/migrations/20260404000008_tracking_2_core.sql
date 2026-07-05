-- Tracking Software 2.0 — Kern: Telefon, Setting, Closing, Zuweisungen, Ziele, RPCs.
-- ADDITIV: keine bestehenden Tabellen/Spalten werden geändert oder gelöscht.
-- Die Bestandsdaten (public.contacts u.a.) bleiben vollständig unangetastet.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shared Trigger-Helper (Muster aus set_created_by_user_id / contacts_set_workspace)
-- ---------------------------------------------------------------------------

-- Workspace der aktuell authentifizierten Person (eine Mitgliedschaft pro User).
create or replace function public.resolve_workspace_from_auth ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select wm.workspace_id
  from public.workspace_members wm
  where wm.user_id = auth.uid ()
  limit 1;
$$;

-- BEFORE INSERT: workspace_id + created_by_user_id automatisch setzen.
create or replace function public.set_workspace_and_creator ()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is null then
    new.workspace_id := public.resolve_workspace_from_auth ();
  end if;
  if new.created_by_user_id is null then
    new.created_by_user_id := auth.uid ();
  end if;
  return new;
end;
$$;

-- BEFORE INSERT: nur workspace_id setzen (für Tabellen ohne created_by_user_id).
create or replace function public.set_workspace_from_auth ()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is null then
    new.workspace_id := public.resolve_workspace_from_auth ();
  end if;
  return new;
end;
$$;

-- BEFORE UPDATE: updated_at pflegen.
create or replace function public.touch_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabelle: phone_lists (Telefon-Analogon zu lists, inkl. Routing-Listen)
-- ---------------------------------------------------------------------------

create table if not exists public.phone_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,
  owner_name text,
  name text not null,
  list_kind text not null default 'akquise'
    check (list_kind in ('akquise', 'rueckruf', 'nicht_erreicht')),
  source_import_id uuid,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_phone_lists_workspace on public.phone_lists (workspace_id);
create index if not exists idx_phone_lists_workspace_created_by
  on public.phone_lists (workspace_id, created_by_user_id);

-- Routing-Listen (rueckruf / nicht_erreicht) existieren genau einmal pro Owner.
create unique index if not exists uq_phone_lists_routing
  on public.phone_lists (workspace_id, created_by_user_id, list_kind)
  where list_kind <> 'akquise';

drop trigger if exists phone_lists_biu on public.phone_lists;
create trigger phone_lists_biu
before insert on public.phone_lists
for each row execute function public.set_workspace_and_creator ();

-- ---------------------------------------------------------------------------
-- Tabelle: phone_leads (workspace_id aus phone_lists, wie contacts)
-- ---------------------------------------------------------------------------

create table if not exists public.phone_leads (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.phone_lists (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,
  first_call_at date,
  decider_name text,
  company text,
  phone text,
  website text,
  email text,
  decider_direct_dial text,
  call_attempt smallint check (call_attempt is null or call_attempt between 1 and 3),
  gatekeeper_reached text check (gatekeeper_reached is null or gatekeeper_reached in ('ja', 'nein', 'direkt')),
  gatekeeper_attempts smallint check (gatekeeper_attempts is null or gatekeeper_attempts between 1 and 2),
  script text,
  decider_reached boolean,
  callback_at timestamptz,
  answer_sentiment text check (answer_sentiment is null or answer_sentiment in ('positiv', 'neutral', 'negativ')),
  objection_notes text,
  status text not null default 'aktiv'
    check (status in ('aktiv', 'rueckruf', 'nicht_erreicht', 'termin', 'dead')),
  mailbox boolean,
  appointment_set boolean not null default false,
  appointment_at timestamptz,
  meet_link text,
  yt_video_link text,
  target_group text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_phone_leads_list on public.phone_leads (list_id);
create index if not exists idx_phone_leads_workspace_status on public.phone_leads (workspace_id, status);
create index if not exists idx_phone_leads_workspace_callback on public.phone_leads (workspace_id, callback_at);
create index if not exists idx_phone_leads_workspace_appointment on public.phone_leads (workspace_id, appointment_set);

-- workspace_id + created_by aus der Liste ableiten (analog contacts_set_workspace).
create or replace function public.phone_leads_set_workspace ()
returns trigger
language plpgsql
as $$
begin
  select l.workspace_id into strict new.workspace_id
  from public.phone_lists l
  where l.id = new.list_id;
  if new.created_by_user_id is null then
    new.created_by_user_id := auth.uid ();
  end if;
  return new;
end;
$$;

drop trigger if exists phone_leads_workspace_biu on public.phone_leads;
create trigger phone_leads_workspace_biu
before insert or update of list_id on public.phone_leads
for each row execute function public.phone_leads_set_workspace ();

drop trigger if exists phone_leads_updated_at on public.phone_leads;
create trigger phone_leads_updated_at
before update on public.phone_leads
for each row execute function public.touch_updated_at ();

-- ---------------------------------------------------------------------------
-- Tabelle: setting_calls
-- ---------------------------------------------------------------------------

create table if not exists public.setting_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,
  source_type text check (source_type is null or source_type in ('linkedin', 'telefon', 'inbound', 'website')),
  source_contact_id uuid references public.contacts (id) on delete set null,
  source_phone_lead_id uuid references public.phone_leads (id) on delete set null,
  lead_name text,
  company text,
  call_at date,
  branche text check (branche is null or branche in ('agentur', 'coach', 'consultant', 'sonstiges')),
  offer_type text,
  show_status text check (show_status is null or show_status in ('show', 'no_show')),
  has_budget_8k text check (has_budget_8k is null or has_budget_8k in ('ja', 'nein', 'unklar')),
  sole_decider boolean,
  can_decide_now boolean,
  clear_need boolean,
  ist_pain smallint check (ist_pain is null or ist_pain between 1 and 10),
  soll_ziel text,
  warmth smallint check (warmth is null or warmth between 1 and 10),
  closing_scheduled boolean not null default false,
  closing_at timestamptz,
  recording_link text,
  objections_handled text,
  objections_open text,
  meet_link text,
  appointment_at timestamptz,
  script_answers jsonb not null default '{}'::jsonb,
  status text not null default 'offen'
    check (status in ('offen', 'qualifiziert', 'disqualifiziert', 'closing_gelegt', 'dead')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_setting_calls_workspace_created_by on public.setting_calls (workspace_id, created_by_user_id);
create index if not exists idx_setting_calls_workspace_status on public.setting_calls (workspace_id, status);
create index if not exists idx_setting_calls_source_contact on public.setting_calls (source_contact_id);
create index if not exists idx_setting_calls_source_phone_lead on public.setting_calls (source_phone_lead_id);

drop trigger if exists setting_calls_bi on public.setting_calls;
create trigger setting_calls_bi
before insert on public.setting_calls
for each row execute function public.set_workspace_and_creator ();

drop trigger if exists setting_calls_updated_at on public.setting_calls;
create trigger setting_calls_updated_at
before update on public.setting_calls
for each row execute function public.touch_updated_at ();

-- ---------------------------------------------------------------------------
-- Tabelle: closing_calls
-- ---------------------------------------------------------------------------

create table if not exists public.closing_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,
  setting_call_id uuid references public.setting_calls (id) on delete set null,
  lead_name text,
  company text,
  call_at date,
  show_status text check (show_status is null or show_status in ('show', 'no_show')),
  closed boolean,
  deal_volume numeric(14, 2),
  payment_type text,
  signature_received boolean,
  contract_start date,
  lost_reason text,
  follow_up_due date,
  recording_link text,
  objections_handled text,
  objections_open text,
  script_answers jsonb not null default '{}'::jsonb,
  status text not null default 'offen'
    check (status in ('offen', 'gewonnen', 'verloren', 'nachfassen')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_closing_calls_workspace_created_by on public.closing_calls (workspace_id, created_by_user_id);
create index if not exists idx_closing_calls_workspace_status on public.closing_calls (workspace_id, status);
create index if not exists idx_closing_calls_setting_call on public.closing_calls (setting_call_id);
create index if not exists idx_closing_calls_workspace_followup on public.closing_calls (workspace_id, follow_up_due);

drop trigger if exists closing_calls_bi on public.closing_calls;
create trigger closing_calls_bi
before insert on public.closing_calls
for each row execute function public.set_workspace_and_creator ();

drop trigger if exists closing_calls_updated_at on public.closing_calls;
create trigger closing_calls_updated_at
before update on public.closing_calls
for each row execute function public.touch_updated_at ();

-- ---------------------------------------------------------------------------
-- Tabelle: call_assignees (flexibles Multi-Select für Setting/Closing)
-- ---------------------------------------------------------------------------

create table if not exists public.call_assignees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,
  entity_type text not null check (entity_type in ('setting_call', 'closing_call')),
  entity_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, user_id)
);

create index if not exists idx_call_assignees_entity on public.call_assignees (entity_type, entity_id);
create index if not exists idx_call_assignees_workspace_user on public.call_assignees (workspace_id, user_id);

drop trigger if exists call_assignees_bi on public.call_assignees;
create trigger call_assignees_bi
before insert on public.call_assignees
for each row execute function public.set_workspace_and_creator ();

-- ---------------------------------------------------------------------------
-- Tabelle: csv_imports (Protokoll der Telefon-Importe)
-- ---------------------------------------------------------------------------

create table if not exists public.csv_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,
  owner_name text,
  filename text,
  phone_list_id uuid references public.phone_lists (id) on delete set null,
  row_count int not null default 0,
  imported_count int not null default 0,
  duplicate_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_csv_imports_workspace on public.csv_imports (workspace_id, created_by_user_id);

drop trigger if exists csv_imports_bi on public.csv_imports;
create trigger csv_imports_bi
before insert on public.csv_imports
for each row execute function public.set_workspace_and_creator ();

-- ---------------------------------------------------------------------------
-- Tabelle: performance_targets (Tages-/Wochenziele je Nutzer)
-- ---------------------------------------------------------------------------

create table if not exists public.performance_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null check (channel in ('linkedin', 'telefon')),
  period text not null check (period in ('daily', 'weekly')),
  metric text not null check (metric in ('pitches', 'calls', 'appointments')),
  target_value int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel, period, metric)
);

create index if not exists idx_performance_targets_workspace on public.performance_targets (workspace_id);

drop trigger if exists performance_targets_bi on public.performance_targets;
create trigger performance_targets_bi
before insert on public.performance_targets
for each row execute function public.set_workspace_from_auth ();

drop trigger if exists performance_targets_updated_at on public.performance_targets;
create trigger performance_targets_updated_at
before update on public.performance_targets
for each row execute function public.touch_updated_at ();

-- ---------------------------------------------------------------------------
-- RLS-Helper (spiegelt can_access_pitch_list für phone_lists)
-- ---------------------------------------------------------------------------

create or replace function public.can_access_phone_list (p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.phone_lists l
    join public.workspace_members wm on wm.workspace_id = l.workspace_id
    where l.id = p_list_id
      and wm.user_id = auth.uid ()
      and (
        wm.data_scope = 'workspace'
        or (wm.data_scope = 'own' and l.created_by_user_id = auth.uid ())
      )
  );
$$;

grant execute on function public.can_access_phone_list (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS aktivieren + Policies (gleiches Muster wie 000006)
-- ---------------------------------------------------------------------------

alter table public.phone_lists enable row level security;
alter table public.phone_leads enable row level security;
alter table public.setting_calls enable row level security;
alter table public.closing_calls enable row level security;
alter table public.call_assignees enable row level security;
alter table public.csv_imports enable row level security;
alter table public.performance_targets enable row level security;

drop policy if exists "phone_lists_scoped_member" on public.phone_lists;
create policy "phone_lists_scoped_member" on public.phone_lists
  for all using (public.can_access_owned_workspace_row(phone_lists.workspace_id, phone_lists.created_by_user_id))
  with check (public.can_access_owned_workspace_row(phone_lists.workspace_id, phone_lists.created_by_user_id));

drop policy if exists "phone_leads_scoped_member" on public.phone_leads;
create policy "phone_leads_scoped_member" on public.phone_leads
  for all using (public.can_access_phone_list(phone_leads.list_id))
  with check (public.can_access_phone_list(phone_leads.list_id));

drop policy if exists "setting_calls_scoped_member" on public.setting_calls;
create policy "setting_calls_scoped_member" on public.setting_calls
  for all using (public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.created_by_user_id))
  with check (public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.created_by_user_id));

drop policy if exists "closing_calls_scoped_member" on public.closing_calls;
create policy "closing_calls_scoped_member" on public.closing_calls
  for all using (public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.created_by_user_id))
  with check (public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.created_by_user_id));

drop policy if exists "call_assignees_scoped_member" on public.call_assignees;
create policy "call_assignees_scoped_member" on public.call_assignees
  for all using (public.can_access_owned_workspace_row(call_assignees.workspace_id, call_assignees.created_by_user_id))
  with check (public.can_access_owned_workspace_row(call_assignees.workspace_id, call_assignees.created_by_user_id));

drop policy if exists "csv_imports_scoped_member" on public.csv_imports;
create policy "csv_imports_scoped_member" on public.csv_imports
  for all using (public.can_access_owned_workspace_row(csv_imports.workspace_id, csv_imports.created_by_user_id))
  with check (public.can_access_owned_workspace_row(csv_imports.workspace_id, csv_imports.created_by_user_id));

-- Ziele: mit 'own'-Scope sieht/ändert man nur die eigenen; Workspace-Scope (inkl. Owner) alle.
drop policy if exists "performance_targets_scoped_member" on public.performance_targets;
create policy "performance_targets_scoped_member" on public.performance_targets
  for all using (public.can_access_owned_workspace_row(performance_targets.workspace_id, performance_targets.user_id))
  with check (public.can_access_owned_workspace_row(performance_targets.workspace_id, performance_targets.user_id));

-- ---------------------------------------------------------------------------
-- RPCs (SECURITY DEFINER). Erzwingen Mitgliedschaft + Scope defensiv:
-- data_scope='own' überschreibt p_effective_user_id immer mit auth.uid().
-- ---------------------------------------------------------------------------

-- Interner Helper: prüft Mitgliedschaft, liefert den effektiv erlaubten Scope-User.
create or replace function public.rpc_effective_user (
  p_workspace_id uuid,
  p_effective_user_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope text;
begin
  select wm.data_scope into v_scope
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid ();
  if v_scope is null then
    raise exception 'Not a workspace member';
  end if;
  if v_scope = 'own' then
    return auth.uid ();
  end if;
  return p_effective_user_id; -- null = workspace-weit
end;
$$;

-- LinkedIn: Pitches je Owner und Tag im Zeitraum (Wochenduell + Historie + Tagesziel).
create or replace function public.rpc_owner_week_counts (
  p_workspace_id uuid,
  p_from date,
  p_to date,
  p_effective_user_id uuid default null
)
returns table (owner_name text, day date, cnt bigint)
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
           coalesce(c.pitched_at, c.created_at::date) as day,
           count(*)::bigint as cnt
    from public.contacts c
    join public.lists l on l.id = c.list_id
    where c.workspace_id = p_workspace_id
      and coalesce(c.pitched_at, c.created_at::date) between p_from and p_to
      and (v_eff is null or l.created_by_user_id = v_eff)
    group by 1, 2;
end;
$$;

-- LinkedIn: Gesamt-DMs und Termine (Terminquote).
create or replace function public.rpc_appt_rate (
  p_workspace_id uuid,
  p_effective_user_id uuid default null
)
returns table (total_dms bigint, total_appts bigint)
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
    select count(*)::bigint,
           count(*) filter (where c.appointment_set is true)::bigint
    from public.contacts c
    join public.lists l on l.id = c.list_id
    where c.workspace_id = p_workspace_id
      and (v_eff is null or l.created_by_user_id = v_eff);
end;
$$;

-- LinkedIn: Follow-up-Alerts (fällig / überfällig) für das Dashboard.
create or replace function public.rpc_followup_alerts (
  p_workspace_id uuid,
  p_today date,
  p_effective_user_id uuid default null
)
returns table (due_soon bigint, overdue bigint)
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
    select count(*) filter (where c.next_follow_up_at between p_today and (p_today + 3))::bigint,
           count(*) filter (where c.next_follow_up_at < p_today)::bigint
    from public.contacts c
    join public.lists l on l.id = c.list_id
    where c.workspace_id = p_workspace_id
      and c.next_follow_up_at is not null
      and c.answered is distinct from true
      and c.appointment_set is distinct from true
      and c.follow_up_number is distinct from 3
      and (v_eff is null or l.created_by_user_id = v_eff);
end;
$$;

-- Telefon: Metriken je Owner (personenbezogen + global via Aggregat im App-Layer).
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
      and (v_eff is null or l.created_by_user_id = v_eff)
    group by 1;
end;
$$;

-- Nachfassen: Union aus LinkedIn-FU, Telefon-Rückruf und Closing-Nachfassen.
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
      and (v_eff is null or l.created_by_user_id = v_eff)
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
      and (v_eff is null or l.created_by_user_id = v_eff)
    union all
    -- Closing Nachfassen
    select 'closing'::text, cc.id, null::text, cc.lead_name, cc.company,
           cc.follow_up_due::timestamptz, 'Closing'::text, null::int
    from public.closing_calls cc
    where cc.workspace_id = p_workspace_id
      and cc.status = 'nachfassen'
      and cc.follow_up_due is not null
      and cc.follow_up_due <= p_today
      and (v_eff is null or cc.created_by_user_id = v_eff);
end;
$$;

grant execute on function public.rpc_effective_user (uuid, uuid) to authenticated;
grant execute on function public.rpc_owner_week_counts (uuid, date, date, uuid) to authenticated;
grant execute on function public.rpc_appt_rate (uuid, uuid) to authenticated;
grant execute on function public.rpc_followup_alerts (uuid, date, uuid) to authenticated;
grant execute on function public.rpc_phone_owner_metrics (uuid, date, date, uuid) to authenticated;
grant execute on function public.nachfassen_tasks (uuid, date, timestamptz, uuid) to authenticated;
