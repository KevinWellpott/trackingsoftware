-- Analyse-Bereich: Telefon-Metriken je Owner und TAG — alle Spalten datumsbezogen.
-- (rpc_phone_owner_metrics filtert nur calls nach Zeitraum; für frei wählbare
--  Analyse-Zeiträume braucht es echte Tageswerte.) Rein additiv.

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
           -- calls: nur Leads mit tatsächlichem Erstkontakt (nie Angerufene
           -- tragen Status-Metriken bei, blähen aber die Call-Zahl nicht auf)
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
      and (v_eff is null or l.created_by_user_id = v_eff)
    group by 1, 2;
end;
$$;

grant execute on function public.rpc_phone_day_metrics (uuid, date, date, uuid) to authenticated;

-- Stützindex für den Range-Scan
create index if not exists idx_phone_leads_ws_first_call
  on public.phone_leads (workspace_id, first_call_at);
