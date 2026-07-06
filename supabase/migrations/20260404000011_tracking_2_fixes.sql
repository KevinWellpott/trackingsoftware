-- Tracking 2.0 — Fixes nach Nutzer-Gegencheck (rein additiv, keine Bestandsdaten-Mutation).
-- 1) FK call_assignees/workspace_members → profiles (repariert PostgREST-Embeds:
--    Setting-/Closing-Crash, leerer CSV-Import-Picker, leere Team-Liste).
-- 2) Simon wird zweiter Owner (Admin-Datensicht).
-- 3) followup_templates: FU-Texte pro Nutzer editierbar.
-- 4) rpc_owner_day_metrics: Tages-Aggregat (DMs/Antworten/Termine) für die neuen
--    persönlichen/Team-Dashboards — ersetzt den Full-Table-Load.

-- ── Vorab-Check (muss 0 Zeilen liefern, sonst FK-Anlage prüfen) ──
-- select user_id from public.workspace_members
--  where user_id not in (select user_id from public.profiles);

-- ── 1) Foreign Keys für PostgREST-Embeds ───────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'call_assignees_user_id_profiles_fkey'
  ) then
    alter table public.call_assignees
      add constraint call_assignees_user_id_profiles_fkey
      foreign key (user_id) references public.profiles (user_id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'workspace_members_user_id_profiles_fkey'
  ) then
    alter table public.workspace_members
      add constraint workspace_members_user_id_profiles_fkey
      foreign key (user_id) references public.profiles (user_id) on delete cascade;
  end if;
end $$;

-- ── 2) Simon zum Admin (zweiter Owner) machen ──────────────────
update public.workspace_members
   set role = 'owner'
 where user_id = (select user_id from public.profiles where username = 'Simon')
   and role <> 'owner';

-- ── 3) Follow-up-Vorlagen pro Nutzer ───────────────────────────
create table if not exists public.followup_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  fu_number int not null check (fu_number between 1 and 3),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fu_number)
);

drop trigger if exists followup_templates_touch on public.followup_templates;
create trigger followup_templates_touch
  before update on public.followup_templates
  for each row execute function public.touch_updated_at ();

alter table public.followup_templates enable row level security;

drop policy if exists followup_templates_all on public.followup_templates;
create policy followup_templates_all on public.followup_templates
  for all
  using (public.can_access_owned_workspace_row (workspace_id, user_id))
  with check (public.can_access_owned_workspace_row (workspace_id, user_id));

-- ── 4) Tages-Metriken je Owner (Dashboard 3.0) ─────────────────
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
      and (v_eff is null or l.created_by_user_id = v_eff)
    group by 1, 2;
end;
$$;

grant execute on function public.rpc_owner_day_metrics (uuid, date, date, uuid) to authenticated;
