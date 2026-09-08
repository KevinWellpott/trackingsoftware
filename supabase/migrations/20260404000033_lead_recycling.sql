-- 0033 — Lead-Recycling und die gesonderten Listen
--
-- ERSETZT die frühere Fassung 20260404000032_lead_recycling.sql. Setzt 0032
-- voraus (pipeline_settings trägt die Wartezeiten, die Termin-Zustandsspalten
-- speisen die Listen).
--
-- Zwei Fehler der alten Fassung verschwinden hier strukturell:
--
--  1. Das Recycling wurde nie zurückgenommen, wenn ein Lead auf anderem Weg
--     wiederbelebt wurde. Die RPC prüfte keinen Status, kein Schreibpfad nullte
--     das Datum — ein gewonnener Deal tauchte Monate später als Aufgabe auf.
--     Jetzt sichern BEIDE Ebenen: der App-Code hält die Daten sauber, die RPC
--     ist der davon unabhängige Riegel. Eine der beiden wird immer vergessen.
--
--  2. Der Versuchszähler wurde gelesen, gerechnet und zurückgeschrieben. Zwei
--     parallele Klicks auf „Nochmal versucht" verbrannten zwei von zwei
--     erlaubten Versuchen. recycle_attempt() erhöht ihn in EINER Anweisung,
--     und der Deckel sitzt in derselben Anweisung statt im App-Code.

-- ---------------------------------------------------------------------------
-- 1. Recycling-Spalten auf den vier Ursprungstabellen
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'phone_leads', 'setting_calls', 'closing_calls'] loop
    execute format($f$
      alter table public.%I
        add column if not exists next_recycle_at           date,
        add column if not exists recycle_attempt_count     integer not null default 0,
        add column if not exists recycle_excluded_at       timestamptz,
        add column if not exists recycle_last_contacted_at timestamptz,
        add column if not exists recycle_responded_at      timestamptz,
        add column if not exists recycle_reason_code       text
    $f$, t);

    -- Die beiden Invarianten werden strukturell unverletzbar statt nur
    -- nachprüfbar: „endgültig raus" und „noch im Rennen" schließen sich aus.
    if not exists (select 1 from pg_constraint where conname = t || '_recycle_exclusive_chk') then
      execute format($f$
        alter table public.%I add constraint %I
          check (recycle_excluded_at is null or next_recycle_at is null)
      $f$, t, t || '_recycle_exclusive_chk');
    end if;

    if not exists (select 1 from pg_constraint where conname = t || '_recycle_count_chk') then
      execute format($f$
        alter table public.%I add constraint %I check (recycle_attempt_count >= 0)
      $f$, t, t || '_recycle_count_chk');
    end if;

    execute format($f$
      create index if not exists %I on public.%I (workspace_id, next_recycle_at)
        where next_recycle_at is not null
    $f$, 'idx_' || t || '_next_recycle', t);
  end loop;
end $$;

-- Die beiden Gründe, die nie ein Recycling bekommen — bisher nur eine Regel in
-- TypeScript, jetzt eine Regel der Datenbank.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'closing_calls_no_recycle_reasons_chk') then
    alter table public.closing_calls add constraint closing_calls_no_recycle_reasons_chk
      check (lost_reason_code is null
             or lost_reason_code not in ('falsche_zielgruppe', 'kein_fit')
             or next_recycle_at is null);
  end if;
end $$;

comment on column public.closing_calls.recycle_responded_at is
  'Wann der Lead auf einen Recycling-Versuch reagiert hat. Ohne diesen Zeitstempel gibt es keine Wiederbelebungsquote — und damit keine Grundlage, die Wartezeiten begründet zu ändern.';

-- ---------------------------------------------------------------------------
-- 2. schedule_recycle — Wartezeit serverseitig bestimmen
-- ---------------------------------------------------------------------------
-- Grund UND Status kommen aus der Ursprungszeile, nicht vom Aufrufer: bisher
-- schickte der Client den Grund mit, womit sich jede beliebige Wartezeit
-- auslösen ließ. Der Versuchszähler wird hier NICHT angefasst — das tut allein
-- recycle_attempt(); die alte Fassung setzte ihn bei jedem Aufruf auf 0 zurück
-- und startete damit den Deckel neu.

create or replace function public.schedule_recycle (
  p_workspace_id uuid,
  p_origin       text,
  p_entity_id    uuid,
  p_today        date default (now() at time zone 'Europe/Berlin')::date
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  s          public.pipeline_settings%rowtype;
  v_days     integer;
  v_reason   text;
  v_attempts integer := 0;
  v_blocked  boolean := false;
  v_due      date;
begin
  select * into s from public.pipeline_settings where workspace_id = p_workspace_id;
  if not found then
    return null;  -- ohne Konfiguration kein Recycling; seed_workspace_defaults legt sie an
  end if;

  if p_origin = 'closing' then
    select cc.lost_reason_code, cc.recycle_attempt_count,
           (cc.recycle_excluded_at is not null or cc.revived_at is not null or cc.status <> 'verloren')
      into v_reason, v_attempts, v_blocked
      from public.closing_calls cc
     where cc.id = p_entity_id and cc.workspace_id = p_workspace_id;

    v_days := case coalesce(v_reason, 'sonstiges')
                when 'timing'      then s.days_timing
                when 'preis'       then s.days_preis
                when 'kein_bedarf' then s.days_kein_bedarf
                when 'entscheider' then s.days_entscheider
                when 'wettbewerb'  then s.days_wettbewerb
                when 'vertrauen'   then s.days_vertrauen
                -- Ghosting ist zweistufig: erst ein kurzer Breakup-Touch,
                -- danach das lange Intervall.
                when 'ghosting'    then case when v_attempts = 0 then s.days_ghosting_breakup else s.days_ghosting end
                when 'sonstiges'   then s.days_sonstiges
                else s.days_default_closing_lost
              end;

    if coalesce(v_reason, '') in ('falsche_zielgruppe', 'kein_fit') then
      v_days := null;
    end if;

  elsif p_origin = 'setting' then
    select sc.disqualify_reason_code, sc.recycle_attempt_count,
           (sc.recycle_excluded_at is not null or sc.revived_at is not null
            or sc.status not in ('dead', 'unqualifiziert')),
           case when sc.status = 'unqualifiziert'
                then s.days_default_setting_disqualified
                else s.days_default_setting_dead end
      into v_reason, v_attempts, v_blocked, v_days
      from public.setting_calls sc
     where sc.id = p_entity_id and sc.workspace_id = p_workspace_id;

    -- „Zusammenarbeit macht keinen Sinn" ist die rote Notiz „kein weiteres
    -- kontaktieren!" — sie bekommt kein Datum, sondern ein Kontaktverbot.
    if coalesce(v_reason, '') in ('falsche_zielgruppe', 'keine_zusammenarbeit') then
      v_days := null;
    end if;

  elsif p_origin = 'telefon' then
    select pl.recycle_attempt_count, (pl.recycle_excluded_at is not null or pl.status <> 'dead')
      into v_attempts, v_blocked
      from public.phone_leads pl
     where pl.id = p_entity_id and pl.workspace_id = p_workspace_id;
    v_reason := 'dead';
    v_days := s.days_default_phone_dead;

  elsif p_origin = 'linkedin' then
    select c.recycle_attempt_count,
           (c.recycle_excluded_at is not null or c.blocked_at is not null
            or c.answered is true or c.appointment_set is true)
      into v_attempts, v_blocked
      from public.contacts c
     where c.id = p_entity_id and c.workspace_id = p_workspace_id;
    v_reason := 'fu_exhausted';
    v_days := s.days_default_linkedin_exhausted;

  else
    raise exception 'Unbekannter Recycling-Ursprung: %', p_origin;
  end if;

  if v_blocked or v_days is null or v_attempts >= s.max_attempts then
    return null;
  end if;

  v_due := p_today + v_days;

  execute format(
    'update public.%I set next_recycle_at = $1, recycle_reason_code = $2 where id = $3 and workspace_id = $4',
    case p_origin when 'closing' then 'closing_calls'
                  when 'setting' then 'setting_calls'
                  when 'telefon' then 'phone_leads'
                  else 'contacts' end
  ) using v_due, v_reason, p_entity_id, p_workspace_id;

  return v_due;
end;
$$;

grant execute on function public.schedule_recycle (uuid, text, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. recycle_attempt — atomar hochzählen, Deckel in derselben Anweisung
-- ---------------------------------------------------------------------------

create or replace function public.recycle_attempt (
  p_workspace_id uuid,
  p_origin       text,
  p_entity_id    uuid,
  p_today        date default (now() at time zone 'Europe/Berlin')::date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text := case p_origin when 'closing' then 'closing_calls'
                                when 'setting' then 'setting_calls'
                                when 'telefon' then 'phone_leads'
                                when 'linkedin' then 'contacts'
                                else null end;
  v_max   smallint;
  v_count integer;
begin
  if v_table is null then
    raise exception 'Unbekannter Recycling-Ursprung: %', p_origin;
  end if;

  select max_attempts into v_max from public.pipeline_settings where workspace_id = p_workspace_id;
  v_max := coalesce(v_max, 2);

  -- Lesen, Rechnen und Schreiben in EINER Anweisung: zwei gleichzeitige Klicks
  -- erhöhen den Zähler zweimal, statt beide von demselben Ausgangswert zu
  -- rechnen und einer den anderen überschreiben zu lassen.
  execute format($f$
    update public.%I
       set recycle_attempt_count     = recycle_attempt_count + 1,
           recycle_last_contacted_at = now(),
           next_recycle_at           = case
             when recycle_attempt_count + 1 >= $1 then null
             else next_recycle_at
           end
     where id = $2 and workspace_id = $3
     returning recycle_attempt_count
  $f$, v_table) into v_count using v_max, p_entity_id, p_workspace_id;

  return v_count;
end;
$$;

grant execute on function public.recycle_attempt (uuid, text, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. recycle_tasks — mit Status-Riegel je Zweig
-- ---------------------------------------------------------------------------

drop function if exists public.recycle_tasks (uuid, date, uuid);

create or replace function public.recycle_tasks (
  p_workspace_id      uuid,
  p_today             date,
  p_effective_user_id uuid default null
)
returns table (
  origin             text,
  entity_id          uuid,
  owner_name         text,
  lead_name          text,
  company            text,
  due_at             date,
  reason             text,
  reason_note        text,
  attempt_count      integer,
  assigned_user_id   uuid,
  last_contacted_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  v_user := public.rpc_effective_user(p_workspace_id, p_effective_user_id);

  return query
  -- LinkedIn: Nachfasssequenz erschöpft, nie geantwortet, kein Termin
  select 'linkedin'::text, c.id, l.owner_name, c.name, c.company,
         c.next_recycle_at, coalesce(c.recycle_reason_code, 'fu_exhausted'), null::text,
         c.recycle_attempt_count, null::uuid, c.recycle_last_contacted_at
    from public.contacts c
    join public.lists l on l.id = c.list_id
   where c.workspace_id = p_workspace_id
     and c.next_recycle_at <= p_today
     and c.recycle_excluded_at is null
     and c.recycle_responded_at is null
     and c.blocked_at is null
     and c.answered is not true
     and c.appointment_set is not true
     and c.follow_up_number = 3
     and (v_user is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_user))

  union all
  -- Telefon: toter Lead
  select 'telefon'::text, pl.id, pll.owner_name, pl.decider_name, pl.company,
         pl.next_recycle_at, coalesce(pl.recycle_reason_code, 'dead'), null::text,
         pl.recycle_attempt_count, null::uuid, pl.recycle_last_contacted_at
    from public.phone_leads pl
    join public.phone_lists pll on pll.id = pl.list_id
   where pl.workspace_id = p_workspace_id
     and pl.next_recycle_at <= p_today
     and pl.recycle_excluded_at is null
     and pl.recycle_responded_at is null
     and pl.status = 'dead'
     and (v_user is null or public.list_owned_by_user(pll.owner_name, pll.created_by_user_id, v_user))

  union all
  -- Erstgespräch: dead oder unqualifiziert, ohne Antwort, ohne Aussicht
  select 'setting'::text, sc.id, p.username, sc.lead_name, sc.company,
         sc.next_recycle_at, coalesce(sc.recycle_reason_code, 'dead'), sc.disqualify_reason,
         sc.recycle_attempt_count, coalesce(sc.assigned_user_id, sc.created_by_user_id),
         sc.recycle_last_contacted_at
    from public.setting_calls sc
    left join public.profiles p on p.user_id = coalesce(sc.assigned_user_id, sc.created_by_user_id)
   where sc.workspace_id = p_workspace_id
     and sc.next_recycle_at <= p_today
     and sc.recycle_excluded_at is null
     and sc.recycle_responded_at is null
     and sc.revived_at is null
     and (sc.status in ('dead', 'unqualifiziert')
          or sc.no_show_resolution = 'ohne_antwort'
          or sc.cancel_outlook = 'ohne_aussicht')
     and (v_user is null or coalesce(sc.assigned_user_id, sc.created_by_user_id) = v_user)

  union all
  -- Closing: verloren
  select 'closing'::text, cc.id, p.username, cc.lead_name, cc.company,
         cc.next_recycle_at, coalesce(cc.recycle_reason_code, cc.lost_reason_code, 'sonstiges'),
         cc.lost_reason, cc.recycle_attempt_count,
         coalesce(cc.assigned_user_id, cc.created_by_user_id), cc.recycle_last_contacted_at
    from public.closing_calls cc
    left join public.profiles p on p.user_id = coalesce(cc.assigned_user_id, cc.created_by_user_id)
   where cc.workspace_id = p_workspace_id
     and cc.next_recycle_at <= p_today
     and cc.recycle_excluded_at is null
     and cc.recycle_responded_at is null
     and cc.revived_at is null
     and cc.status = 'verloren'
     and (v_user is null or coalesce(cc.assigned_user_id, cc.created_by_user_id) = v_user);
end;
$$;

grant execute on function public.recycle_tasks (uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. dropout_lists — die gesonderten Listen, aus dem Zeilenzustand abgeleitet
-- ---------------------------------------------------------------------------
-- Bewusst KEINE eigene Tabelle: die wäre eine zweite Wahrheit neben status und
-- cancelled_at und liefe beim ersten Statuswechsel auseinander — derselbe
-- Fehler, den call_assignees hinterlassen hat. Nebeneffekt der Ableitung: die
-- Listen sind am ersten Tag automatisch gefüllt.

create or replace function public.dropout_lists (
  p_workspace_id      uuid,
  p_list              text,
  p_effective_user_id uuid default null
)
returns table (
  entity_type      text,
  entity_id        uuid,
  lead_name        text,
  company          text,
  owner_name       text,
  assigned_user_id uuid,
  reason_code      text,
  reason_text      text,
  dropped_at       timestamptz,
  next_recycle_at  date,
  recycle_attempt_count integer,
  excluded         boolean,
  revived_at       timestamptz,
  reschedule_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if p_list not in ('abgesagt', 'ersatztermin_offen', 'disqualifiziert',
                    'kein_close', 'no_show_ohne_antwort', 'gesperrt') then
    raise exception 'Unbekannte Liste: %', p_list;
  end if;

  v_user := public.rpc_effective_user(p_workspace_id, p_effective_user_id);

  -- Ein Kontaktverbot, das nur sein Besitzer sieht, ist keines: die nächste
  -- Person spricht den Lead sonst neu an. Genau diese eine Liste ignoriert
  -- deshalb den Personenfilter und liefert immer org-weit.
  if p_list = 'gesperrt' then
    v_user := null;
  end if;

  return query
  select * from (
    select 'setting'::text, sc.id, sc.lead_name, sc.company, p.username,
           coalesce(sc.assigned_user_id, sc.created_by_user_id),
           case p_list
             when 'disqualifiziert' then sc.disqualify_reason_code
             when 'no_show_ohne_antwort' then null::text
             else sc.cancel_reason_code end,
           case p_list
             when 'disqualifiziert' then sc.disqualify_reason
             else sc.cancel_reason end,
           coalesce(sc.cancelled_at, sc.updated_at, sc.created_at),
           sc.next_recycle_at, sc.recycle_attempt_count,
           sc.recycle_excluded_at is not null, sc.revived_at, sc.reschedule_count
      from public.setting_calls sc
      left join public.profiles p on p.user_id = coalesce(sc.assigned_user_id, sc.created_by_user_id)
     where sc.workspace_id = p_workspace_id
       and (v_user is null or coalesce(sc.assigned_user_id, sc.created_by_user_id) = v_user)
       and case p_list
             when 'abgesagt'            then sc.cancel_outlook = 'ohne_aussicht'
             when 'ersatztermin_offen'  then sc.cancel_outlook = 'neuer_termin' and sc.revived_at is null
             when 'disqualifiziert'     then sc.status in ('unqualifiziert', 'dead')
             when 'no_show_ohne_antwort' then sc.no_show_resolution = 'ohne_antwort'
             when 'gesperrt'            then sc.recycle_excluded_at is not null
             else false
           end

    union all

    select 'closing'::text, cc.id, cc.lead_name, cc.company, p.username,
           coalesce(cc.assigned_user_id, cc.created_by_user_id),
           case p_list when 'kein_close' then cc.lost_reason_code else cc.cancel_reason_code end,
           case p_list when 'kein_close' then cc.lost_reason else cc.cancel_reason end,
           coalesce(cc.cancelled_at, cc.updated_at, cc.created_at),
           cc.next_recycle_at, cc.recycle_attempt_count,
           cc.recycle_excluded_at is not null, cc.revived_at, cc.reschedule_count
      from public.closing_calls cc
      left join public.profiles p on p.user_id = coalesce(cc.assigned_user_id, cc.created_by_user_id)
     where cc.workspace_id = p_workspace_id
       and (v_user is null or coalesce(cc.assigned_user_id, cc.created_by_user_id) = v_user)
       and case p_list
             when 'abgesagt'            then cc.cancel_outlook = 'ohne_aussicht'
             when 'ersatztermin_offen'  then cc.cancel_outlook = 'neuer_termin' and cc.revived_at is null
             when 'kein_close'          then cc.status = 'verloren'
             when 'no_show_ohne_antwort' then cc.no_show_resolution = 'ohne_antwort'
             when 'gesperrt'            then cc.recycle_excluded_at is not null
             else false
           end
  ) rows;
end;
$$;

grant execute on function public.dropout_lists (uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Verifikation (nach dem Einspielen im SQL-Editor ausführen)
-- ---------------------------------------------------------------------------
-- Ausschluss und Wiedervorlage schließen sich aus — alle vier müssen 0 ergeben:
--   select count(*) from public.contacts      where recycle_excluded_at is not null and next_recycle_at is not null;
--   select count(*) from public.phone_leads   where recycle_excluded_at is not null and next_recycle_at is not null;
--   select count(*) from public.setting_calls where recycle_excluded_at is not null and next_recycle_at is not null;
--   select count(*) from public.closing_calls where recycle_excluded_at is not null and next_recycle_at is not null;
--
-- Die beiden Gründe ohne Recycling — muss 0 ergeben:
--   select count(*) from public.closing_calls
--    where lost_reason_code in ('falsche_zielgruppe','kein_fit') and next_recycle_at is not null;
--
-- Die Sperrliste ignoriert die Datensicht (als Mitglied mit data_scope='own'
-- aufrufen; muss auch fremde gesperrte Leads zeigen):
--   select count(*) from public.dropout_lists('<workspace>', 'gesperrt');
