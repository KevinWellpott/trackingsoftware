-- Setting-Ergebnismodell: ein Feld für Ordner, Nachfass-Trigger und Auswertung.
--
-- Bisher lief show_status ('show'/'no_show') als separates, manuell zu pflegendes
-- Feld neben dem status — ein No-Show hatte weder einen eigenen Status noch einen
-- Ordner noch eine Wiedervorlage. Ergebnis: Show/No-Show war praktisch nicht
-- auswertbar.
--
--   status      +no_show, disqualifiziert → unqualifiziert
--   follow_up_due   Wiedervorlage (analog closing_calls.follow_up_due)
--   no_show_count   zählt No-Shows über Neuterminierungen hinweg mit, damit ein
--                   wiederverwendeter Datensatz die Show-Quote nicht schönt
--   nachfassen_tasks  4. UNION-Zweig: fällige Setting-Wiedervorlagen

-- ── 1. Status-Set erweitern ───────────────────────────────────
-- Reihenfolge zwingend: erst Constraint weg, dann Daten migrieren, dann neuer
-- Constraint — sonst verletzt 'unqualifiziert' kurzzeitig den alten Check.
alter table public.setting_calls
  drop constraint if exists setting_calls_status_check;

update public.setting_calls
set status = 'unqualifiziert'
where status = 'disqualifiziert';

alter table public.setting_calls
  add constraint setting_calls_status_check
  check (status in ('offen', 'no_show', 'qualifiziert', 'closing_gelegt', 'unqualifiziert', 'dead'));

-- ── 2. Wiedervorlage + No-Show-Zähler ─────────────────────────
alter table public.setting_calls
  add column if not exists follow_up_due date;

alter table public.setting_calls
  add column if not exists no_show_count int not null default 0;

create index if not exists idx_setting_calls_workspace_followup
  on public.setting_calls (workspace_id, follow_up_due);

-- ── 3. Backfill show_status aus dem Status ────────────────────
-- Nur wo noch nichts erfasst ist. 'offen' (noch nicht stattgefunden) und 'dead'
-- (kann Show oder No-Show gewesen sein) bleiben bewusst NULL statt geraten.
update public.setting_calls
set show_status = 'show'
where show_status is null
  and status in ('qualifiziert', 'closing_gelegt', 'unqualifiziert');

update public.setting_calls
set no_show_count = 1
where show_status = 'no_show'
  and no_show_count = 0;

-- ── 4. Nachfassen: Setting-Wiedervorlagen aufnehmen ───────────
-- Signatur und returns table unverändert → create or replace genügt, Grants bleiben.
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
