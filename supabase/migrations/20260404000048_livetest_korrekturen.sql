-- 0048 — Korrekturen aus dem Live-Test vom 26.11.2026
--
-- 0001–0047 sind eingespielt und eingefroren; keine Zeile dieser Datei ändert
-- eine davon. Funktionen werden per `create or replace` mit UNVERÄNDERTER
-- Signatur neu geschrieben (Grants bleiben), Daten nur nachgezogen, wo die
-- Quelle eindeutig ist.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  INHALT
--
--  1. Backfill `phone_leads.first_call_at` (P1-1). Der Termin-Knopf im
--     Call-Modus setzte das Datum nie; der Lead fehlte im Nenner jeder
--     Telefon-Quote und sein Termin landete im Importmonat (live 291 von 368
--     Telefon-Terminen). Quelle: früheste Anwahl im Log, sonst der früheste
--     Telefon-Termin des Leads — jeweils als Berliner Kalendertag.
--  2. Backfill „Entscheider erreicht" (N5). Ein Termin oder ein „Kein Termin"
--     setzt ein Gespräch mit dem Entscheider voraus; das Feld wurde kaum
--     gepflegt (62 von 91 November-Terminen ohne). Am Lead und im Anruf-Log.
--  3. Drei Tages-RPCs auf den BERLINER Tag (P3-2). `created_at::date` lief in
--     UTC: Ein Pitch um 00:30 Berliner Zeit landete im Vortag. Gilt nur für
--     den Rückfall ohne `pitched_at`/`first_call_at`.
--  4. Kundenspace: zurückgenommener Deal (P1-6, Entscheidung E3). Wechselt
--     ein Closing von „gewonnen" weg, wird der Kunde gelöscht, solange weder
--     Rate noch Zahlung erfasst ist; sonst wird der Vertrag „abgebrochen" und
--     der Kunde „abgesprungen". Vorher blieb er mit Vertragswert stehen.
--  5. Rechte: `kunde_aus_closing()` und `seed_workspace_defaults()` sind für
--     `anon` nicht mehr ausführbar (offene Lücke aus dem Kundenspace-Review;
--     Postgres grantet EXECUTE per Vorgabe an PUBLIC).
--
--  NICHT hier: Listen, deren Inhaber kein Mitglied ist (P2-5). Bei allen
--  Treffern ist auch der Ersteller kein Mitglied — ein Backfill müsste raten.
--  Die App erzwingt den Inhaber beim Anlegen; der Bestand ist von Hand zu
--  pflegen (Abfrage V5 unten listet ihn).
--
--  REIHENFOLGE ZUM DEPLOY: frei. Der zugehörige Code verhält sich mit und
--  ohne diese Datei korrekt; die Datei macht nur den Bestand richtig.
--
--  EINSPIELEN: ganze Datei, nichts markieren (docs/data-model.md §7), danach
--  den Verifikationsblock am Ende fahren.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. first_call_at nachziehen ────────────────────────────────────────────
-- Vorher-Zahl je Organisation (erscheint als NOTICE im SQL-Editor).
do $$
declare r record;
begin
  for r in
    select pl.workspace_id, count(*) as n
      from public.phone_leads pl
     where pl.first_call_at is null
       and (exists (select 1 from public.phone_call_attempts a where a.lead_id = pl.id)
            or exists (select 1 from public.setting_calls sc where sc.source_phone_lead_id = pl.id))
     group by 1
  loop
    raise notice '0048 first_call_at vorher: workspace % → % Leads ohne Erstkontakt', r.workspace_id, r.n;
  end loop;
end $$;

update public.phone_leads pl
   set first_call_at = src.tag
  from (
    select pl2.id,
           coalesce(
             (select min((a.called_at at time zone 'Europe/Berlin')::date)
                from public.phone_call_attempts a where a.lead_id = pl2.id),
             (select min((sc.created_at at time zone 'Europe/Berlin')::date)
                from public.setting_calls sc where sc.source_phone_lead_id = pl2.id)
           ) as tag
      from public.phone_leads pl2
     where pl2.first_call_at is null
  ) src
 where pl.id = src.id
   and src.tag is not null;

-- ── 2. Entscheider aus dem Ergebnis ────────────────────────────────────────
update public.phone_leads
   set decider_reached = true
 where decider_reached is not true
   and (status in ('termin', 'kein_termin') or appointment_set is true);

update public.phone_call_attempts
   set decider_reached = true
 where decider_reached is not true
   and outcome in ('termin', 'kein_termin');

-- ── 3. Tages-RPCs auf den Berliner Tag ─────────────────────────────────────
create or replace function public.rpc_owner_day_metrics(
  p_workspace_id uuid, p_from date, p_to date, p_effective_user_id uuid default null::uuid)
returns table(owner_name text, day date, dms bigint, answers bigint, appts bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_eff uuid;
begin
  v_eff := public.rpc_effective_user (p_workspace_id, p_effective_user_id);
  return query
    select coalesce(l.owner_name, '—') as owner_name,
           coalesce(c.pitched_at, (c.created_at at time zone 'Europe/Berlin')::date) as day,
           count(*)::bigint as dms,
           count(*) filter (where c.answered is true)::bigint as answers,
           count(*) filter (where c.appointment_set is true)::bigint as appts
    from public.contacts c
    join public.lists l on l.id = c.list_id
    where c.workspace_id = p_workspace_id
      and coalesce(c.pitched_at, (c.created_at at time zone 'Europe/Berlin')::date) between p_from and p_to
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    group by 1, 2;
end;
$function$;

create or replace function public.rpc_owner_week_counts(
  p_workspace_id uuid, p_from date, p_to date, p_effective_user_id uuid default null::uuid)
returns table(owner_name text, day date, cnt bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_eff uuid;
begin
  v_eff := public.rpc_effective_user (p_workspace_id, p_effective_user_id);
  return query
    select coalesce(l.owner_name, '—') as owner_name,
           coalesce(c.pitched_at, (c.created_at at time zone 'Europe/Berlin')::date) as day,
           count(*)::bigint as cnt
    from public.contacts c
    join public.lists l on l.id = c.list_id
    where c.workspace_id = p_workspace_id
      and coalesce(c.pitched_at, (c.created_at at time zone 'Europe/Berlin')::date) between p_from and p_to
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    group by 1, 2;
end;
$function$;

create or replace function public.rpc_phone_day_metrics(
  p_workspace_id uuid, p_from date, p_to date, p_effective_user_id uuid default null::uuid)
returns table(owner_name text, day date, calls bigint, gatekeeper_reached bigint, decider_reached bigint,
              appointments bigint, callbacks bigint, dead bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_eff uuid;
begin
  v_eff := public.rpc_effective_user (p_workspace_id, p_effective_user_id);
  return query
    select coalesce(l.owner_name, '—') as owner_name,
           coalesce(pl.first_call_at, (pl.created_at at time zone 'Europe/Berlin')::date) as day,
           count(*) filter (where pl.first_call_at is not null)::bigint as calls,
           count(*) filter (where pl.gatekeeper_reached in ('ja', 'direkt'))::bigint as gatekeeper_reached,
           count(*) filter (where pl.decider_reached is true)::bigint as decider_reached,
           count(*) filter (where pl.appointment_set is true)::bigint as appointments,
           count(*) filter (where pl.status = 'rueckruf')::bigint as callbacks,
           count(*) filter (where pl.status = 'dead')::bigint as dead
    from public.phone_leads pl
    join public.phone_lists l on l.id = pl.list_id
    where pl.workspace_id = p_workspace_id
      and coalesce(pl.first_call_at, (pl.created_at at time zone 'Europe/Berlin')::date) between p_from and p_to
      and (v_eff is null or public.list_owned_by_user(l.owner_name, l.created_by_user_id, v_eff))
    group by 1, 2;
end;
$function$;

-- ── 4. Kundenspace: zurückgenommener Deal ──────────────────────────────────
-- Unverändert aus 0047, ergänzt um den Zweig „nicht mehr gewonnen" ganz oben.
create or replace function public.closing_calls_kunde_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_kunde uuid;
begin
  if new.workspace_id <> public.intern_workspace_id() then
    return new;
  end if;

  -- Gewonnen → etwas anderes (Zurücksetzen, Verloren, Nachfassen). Ohne
  -- Rate und Zahlung ist der Kunde nie entstanden; mit Geldspur bleibt er als
  -- Historie und der Vertrag gilt als abgebrochen (Entscheidung E3).
  if tg_op = 'UPDATE' and old.status = 'gewonnen' and new.status is distinct from 'gewonnen' then
    select id into v_kunde from public.kunden where closing_call_id = new.id;
    if v_kunde is null then
      return new;
    end if;
    if not exists (select 1 from public.kunden_raten where kunde_id = v_kunde)
       and not exists (select 1 from public.kunden_zahlungen where kunde_id = v_kunde) then
      delete from public.kunden where id = v_kunde;
    else
      update public.kunden_vertraege
         set abgebrochen_am = coalesce(abgebrochen_am, (now() at time zone 'Europe/Berlin')::date),
             abbruch_grund  = coalesce(abbruch_grund, 'Deal im Closing zurückgenommen'),
             version        = version + 1,
             updated_at     = now()
       where kunde_id = v_kunde;
      update public.kunden set status = 'abgesprungen', updated_at = now() where id = v_kunde;
      insert into public.kunden_log (kunde_id, bereich, art, text, user_id)
      values (v_kunde, 'finanz', 'vertrag',
              'Closing steht nicht mehr auf „gewonnen" — Vertrag als abgebrochen markiert.', auth.uid());
    end if;
    return new;
  end if;

  if new.status <> 'gewonnen' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.kunde_aus_closing(new.id);
  elsif old.status is distinct from 'gewonnen' then
    perform public.kunde_aus_closing(new.id);
  else
    -- Nachziehen, solange niemand den Vertrag bewusst geändert hat.
    if new.deal_volume is distinct from old.deal_volume then
      update public.kunden_vertraege kv
         set vertragswert = least(greatest(coalesce(new.deal_volume, 0), 0), 9999999999),
             version = kv.version + 1,
             updated_at = now()
        from public.kunden k
       where k.closing_call_id = new.id
         and kv.kunde_id = k.id
         and kv.vertragswert = least(greatest(coalesce(old.deal_volume, 0), 0), 9999999999);
      if found then
        insert into public.kunden_log (kunde_id, bereich, art, text, user_id)
        select k.id, 'finanz', 'vertrag',
               'Vertragswert aus dem Closing übernommen: ' || coalesce(old.deal_volume, 0) || ' → ' || coalesce(new.deal_volume, 0) || ' €.',
               auth.uid()
          from public.kunden k where k.closing_call_id = new.id;
      end if;
    end if;
    if new.contract_start is distinct from old.contract_start then
      update public.kunden_vertraege kv
         set vertragsstart = new.contract_start,
             version = kv.version + 1,
             updated_at = now()
        from public.kunden k
       where k.closing_call_id = new.id
         and kv.kunde_id = k.id
         and kv.vertragsstart is not distinct from old.contract_start;
    end if;
  end if;
  return new;
end;
$function$;

-- Bestand: Kunden, deren Closing heute nicht (mehr) gewonnen ist, nach
-- derselben Regel behandeln.
do $$
declare r record;
begin
  for r in
    select k.id
      from public.kunden k
      join public.closing_calls cc on cc.id = k.closing_call_id
     where cc.status is distinct from 'gewonnen'
  loop
    if not exists (select 1 from public.kunden_raten where kunde_id = r.id)
       and not exists (select 1 from public.kunden_zahlungen where kunde_id = r.id) then
      delete from public.kunden where id = r.id;
    else
      update public.kunden_vertraege
         set abgebrochen_am = coalesce(abgebrochen_am, (now() at time zone 'Europe/Berlin')::date),
             abbruch_grund  = coalesce(abbruch_grund, 'Deal im Closing zurückgenommen'),
             version        = version + 1,
             updated_at     = now()
       where kunde_id = r.id;
      update public.kunden set status = 'abgesprungen', updated_at = now() where id = r.id;
    end if;
  end loop;
end $$;

-- ── 5. Rechte ──────────────────────────────────────────────────────────────
revoke execute on function public.kunde_aus_closing(uuid) from public, anon;
revoke execute on function public.seed_workspace_defaults(uuid) from public, anon;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFIKATION — nach dem Einspielen einzeln fahren
-- ═══════════════════════════════════════════════════════════════════════════
--
-- V1 Leads mit Anwahl oder Telefon-Termin, aber ohne Erstkontakt. Erwartet: 0.
-- select count(*) from public.phone_leads pl
--  where pl.first_call_at is null
--    and (exists (select 1 from public.phone_call_attempts a where a.lead_id = pl.id)
--         or exists (select 1 from public.setting_calls sc where sc.source_phone_lead_id = pl.id));
--
-- V2 Termin/Kein Termin ohne Entscheider. Erwartet: 0 und 0.
-- select count(*) from public.phone_leads
--  where decider_reached is not true and (status in ('termin','kein_termin') or appointment_set is true);
-- select count(*) from public.phone_call_attempts
--  where decider_reached is not true and outcome in ('termin','kein_termin');
--
-- V3 Die drei RPCs rechnen auf den Berliner Tag. Erwartet: 3 Zeilen.
-- select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('rpc_owner_day_metrics','rpc_owner_week_counts','rpc_phone_day_metrics')
--    and pg_get_functiondef(p.oid) like '%Europe/Berlin%';
--
-- V4 Kunden ohne gewonnenes Closing, die weder abgesprungen noch abgebrochen
--    sind. Erwartet: 0.
-- select count(*) from public.kunden k
--   join public.closing_calls cc on cc.id = k.closing_call_id
--   join public.kunden_vertraege kv on kv.kunde_id = k.id
--  where cc.status is distinct from 'gewonnen' and kv.abgebrochen_am is null;
--
-- V5 Listen ohne gültigen Inhaber (P2-5, von Hand zu pflegen). Zählt, ändert nichts.
-- select 'lists' as t, count(*) from public.lists l
--  where l.owner_name is null or not exists (
--    select 1 from public.workspace_members wm join public.profiles p on p.user_id = wm.user_id
--     where wm.workspace_id = l.workspace_id and p.username = l.owner_name)
-- union all
-- select 'phone_lists', count(*) from public.phone_lists l
--  where l.owner_name is null or not exists (
--    select 1 from public.workspace_members wm join public.profiles p on p.user_id = wm.user_id
--     where wm.workspace_id = l.workspace_id and p.username = l.owner_name);
--
-- V6 Rechte: keine Zeile für PUBLIC oder anon. Erwartet: leere Menge.
-- select p.proname, acl.eintrag from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   cross join lateral unnest(coalesce(p.proacl, '{}')) as acl(eintrag)
--  where n.nspname = 'public' and p.proname in ('kunde_aus_closing','seed_workspace_defaults')
--    and (acl.eintrag::text like '=%' or acl.eintrag::text like 'anon=%');
