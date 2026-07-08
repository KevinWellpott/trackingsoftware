-- Fix: persönliche LinkedIn-DM-Dashboards zählten Einträge beim Ersteller
-- der Liste (created_by_user_id) statt beim eingetragenen Besitzer (owner_name).
-- Legt z.B. ein Owner eine Liste FÜR ein Teammitglied an (owner_name = Mitglied,
-- created_by_user_id = Owner), tauchten alle DMs, die das Mitglied dort einträgt,
-- fälschlich im persönlichen Dashboard des Owners auf statt beim Mitglied.
-- src/lib/access.ts (buildOwnScope) wurde dafür bereits auf owner_name-Vorrang
-- umgestellt — dieselbe Logik fehlte bislang in den SQL-Metrik-RPCs. Rein additiv
-- (create or replace, keine Datenänderung).

create or replace function public.list_owned_by_user (
  p_owner_name text,
  p_created_by_user_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner_name is not null then
      exists (
        select 1 from public.profiles pr
        where pr.user_id = p_user_id and pr.username = p_owner_name
      )
    else
      p_created_by_user_id = p_user_id
  end;
$$;

grant execute on function public.list_owned_by_user (text, uuid, uuid) to authenticated;

-- ── Tages-Metriken je Owner (Dashboard 3.0) ─────────────────
create or replace function public.rpc_owner_day_metrics (
  p_workspace_id uuid,
  p_from date,
  p_to date,
  p_effective_user_id uuid default null
)
returns table (owner_name text, day date, dms bigint, answers bigint, appts bigint)
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
           count(*)::bigint as dms,
           count(*) filter (where c.answered is true)::bigint as answers,
           count(*) filter (where c.appointment_set is true)::bigint as appts
    from public.contacts c
    join public.lists l on l.id = c.list_id
    where c.workspace_id = p_workspace_id
      and coalesce(c.pitched_at, c.created_at::date) between p_from and p_to
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    group by 1, 2;
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
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
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
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff));
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
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff));
end;
$$;

-- Nachfassen: Union aus LinkedIn-FU, Telefon-Rückruf und Closing-Nachfassen.
-- Nur der LinkedIn-Teil wird hier auf owner_name-Vorrang umgestellt (Telefon/
-- Closing bewusst außerhalb dieses Fixes, siehe Rückfrage im Chat).
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
