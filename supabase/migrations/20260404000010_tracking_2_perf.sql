-- Tracking 2.0 — Performance-Härtung (rein additiv, non-destruktiv).
-- Indizes für die tatsächlichen ORDER BY-/Filter-Spalten der Queue- und
-- Telefon-Pfade + eine Aggregat-RPC, damit die Telefon-Übersicht nicht mehr
-- alle Leads nur zum Zählen laden muss.

-- ── Indizes ────────────────────────────────────────────────────
create index if not exists idx_setting_calls_ws_appt
  on public.setting_calls (workspace_id, appointment_at);

create index if not exists idx_closing_calls_ws_call_at
  on public.closing_calls (workspace_id, call_at);

create index if not exists idx_phone_leads_ws_creator
  on public.phone_leads (workspace_id, created_by_user_id);

-- ── Telefon: Status-Counts je Liste (ersetzt Full-Table-Read in /telefon) ──
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
      and (v_eff is null or l.created_by_user_id = v_eff)
    group by pl.list_id, pl.status;
end;
$$;

grant execute on function public.rpc_phone_list_counts (uuid, uuid) to authenticated;

-- ── Closing-Terminplanung: Meet-Link + Termin mit Uhrzeit ──────
-- Closing-Calls hatten weder einen Meet-Link noch eine Uhrzeit am Termin
-- (call_at war date), obwohl die UI Datum + Uhrzeit anzeigt. Beides hier
-- nachgezogen — non-destruktiv: bestehende call_at-Werte werden Mitternacht.
alter table public.closing_calls
  add column if not exists meet_link text;

alter table public.closing_calls
  alter column call_at type timestamptz
  using call_at::timestamptz;
