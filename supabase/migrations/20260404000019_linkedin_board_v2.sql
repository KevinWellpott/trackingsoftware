-- LinkedIn-Board V2: Blockiert-Status, flexible Termin-Art, Listen-Index.
--
--   contacts.blocked_at      Lead hat uns auf LinkedIn blockiert. Blockierte
--                            Kontakte fliegen aus dem Follow-up-Flow: die App
--                            nullt next_follow_up_at, zusätzlich schließen
--                            nachfassen_tasks + rpc_followup_alerts sie aus
--                            (Gürtel + Hosenträger, falls das Feld je manuell
--                            gesetzt wird).
--   setting_calls.meeting_kind  Termin-Art: 'link' (Meet o. ä.), 'telefon',
--                            NULL = keine Angabe. meet_link ist nicht mehr
--                            Pflicht — nur bei meeting_kind='link' gesetzt.
--   idx_contacts_list_pitched   Sortierung der Listen-Detailseite
--                            (pitched_at desc je Liste).

-- ── 1. contacts.blocked_at ────────────────────────────────────
alter table public.contacts
  add column if not exists blocked_at timestamptz;

-- ── 2. setting_calls.meeting_kind ─────────────────────────────
alter table public.setting_calls
  add column if not exists meeting_kind text
  check (meeting_kind is null or meeting_kind in ('link', 'telefon'));

-- Bestand: alles mit Link war bisher zwingend ein (Meet-)Link-Termin.
update public.setting_calls
set meeting_kind = 'link'
where meeting_kind is null
  and meet_link is not null;

-- ── 3. Index für die Listen-Detailseite ───────────────────────
create index if not exists idx_contacts_list_pitched
  on public.contacts (list_id, pitched_at desc);

-- ── 4. rpc_followup_alerts: blockierte Kontakte ausschließen ──
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
      and c.blocked_at is null
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff));
end;
$$;

-- ── 5. nachfassen_tasks: blockierte Kontakte ausschließen ─────
-- Signatur/returns unverändert (Stand Migration 0018) → create or replace
-- genügt, Grants bleiben. Einzige Änderung: blocked_at-Filter im LinkedIn-Zweig.
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
      and (v_eff is null or cc.created_by_user_id = v_eff)
    union all
    -- Setting Nachfassen: No-Show erneut einladen, Unqualifizierte reaktivieren.
    -- security definer umgeht RLS — der v_eff-Filter ist hier die einzige
    -- Zugriffskontrolle (setting_calls hat kein owner_name, daher created_by_user_id
    -- wie beim Closing-Zweig).
    select 'setting'::text, sc.id, null::text, sc.lead_name, sc.company,
           sc.follow_up_due::timestamptz, 'Setting'::text, null::int
    from public.setting_calls sc
    where sc.workspace_id = p_workspace_id
      and sc.status in ('no_show', 'unqualifiziert')
      and sc.follow_up_due is not null
      and sc.follow_up_due <= p_today
      and (v_eff is null or sc.created_by_user_id = v_eff);
end;
$$;

-- Neue Spalten sofort über PostgREST verfügbar machen.
notify pgrst, 'reload schema';
