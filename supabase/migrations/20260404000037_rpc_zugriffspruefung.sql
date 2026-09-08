-- 0037 — Zugriffsprüfung in schedule_recycle() und recycle_attempt()
--
-- Setzt 0032 voraus (dort steht das Muster) und 0033 (dort stehen die beiden
-- Funktionen). 0033 selbst wird NICHT angefasst: Sie ist eingespielt und
-- eingefroren, korrigiert wird ausschließlich über diese Datei.
--
-- Beide Funktionen sind `security definer` — sie laufen mit den Rechten ihres
-- Eigentümers und damit an der Zeilensicherheit vorbei. Genau deshalb muss
-- eine solche Funktion selbst prüfen, was RLS sonst geprüft hätte. Ihre
-- Nachbarin `apply_reminder_touches()` (0032) tut das als erste Anweisung,
-- diese beiden bisher nicht.
--
-- Was ohne die Prüfung möglich war: Ein angemeldeter Nutzer ruft die RPC mit
-- der `p_workspace_id` einer FREMDEN Organisation und der Id einer dortigen
-- Zeile auf. `schedule_recycle()` schreibt dann `next_recycle_at` und
-- `recycle_reason_code` in diese fremde Zeile, `recycle_attempt()` zählt
-- `recycle_attempt_count` hoch und nullt beim Erreichen des Deckels die
-- Wiedervorlage — ein fremder Lead taucht also in einer fremden Wiedervorlage
-- auf oder verschwindet lautlos daraus. Mehr als die beiden UUIDs braucht es
-- dafür nicht. Auslesen kann der Aufrufer die fremde Zeile dabei nicht — beide
-- RPCs geben nur ein Datum bzw. einen Zähler zurück, und beide Schreibpfade
-- verlangen weiterhin, dass Zeile und Organisation zusammenpassen
-- (`where id = ... and workspace_id = ...`). Der Schaden ist also begrenzt,
-- die Lücke trotzdem unnötig.
--
-- Die Prüfung ist WORTGLEICH aus `apply_reminder_touches()` übernommen, damit
-- es für schreibende RPCs genau ein Muster gibt und nicht zwei, die
-- auseinanderlaufen. Der zweite Zweig `is_platform_admin()` ist dabei nicht
-- optional: Ein Plattform-Admin ist in einer Kunden-Organisation bewusst KEIN
-- `workspace_members`-Eintrag (docs §2) — ohne diesen Zweig wäre der
-- Org-Umschalter für Simon und Kevin genau hier tot.
--
-- Die beiden LESENDEN RPCs aus 0033 (`recycle_tasks`, `dropout_lists`)
-- brauchen nichts: Sie rufen `rpc_effective_user()` auf, und die wirft für
-- Nichtmitglieder bereits `Not a workspace member`. Dieselbe Prüfung, andere
-- Formulierung — der Helfer verlangt aber einen `p_effective_user_id`-
-- Parameter, den diese beiden Funktionen nicht haben und für den es hier auch
-- keine Bedeutung gäbe.
--
-- Der Rumpf beider Funktionen ist ZEILENGLEICH aus 0033 übernommen; die
-- einzige Änderung ist die vorangestellte Prüfung. Signaturen, Rückgabetypen
-- und Vorgabewerte bleiben unverändert — deshalb genügt `create or replace`,
-- ein `drop function` träfe die Grants einer produktiv aufgerufenen Funktion.
--
-- Wiederholbar: ausschließlich `create or replace` plus erneut gesetzte
-- Grants, keine DDL auf Tabellen. Die Supabase-Konsole fährt ein Skript nicht
-- in einer Transaktion — ein Abbruch mittendrin lässt sich hier folgenlos
-- wiederholen.

-- ---------------------------------------------------------------------------
-- 1. schedule_recycle — Rumpf aus 0033, davor die Zugriffsprüfung
-- ---------------------------------------------------------------------------

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
  -- Zugriffsprüfung als ERSTE Anweisung, wortgleich zu
  -- apply_reminder_touches() (0032). Ohne sie schreibt diese Funktion mit
  -- Definer-Rechten in jede Organisation, deren UUID der Aufrufer kennt.
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  ) and not public.is_platform_admin() then
    raise exception 'Kein Zugriff auf diese Organisation';
  end if;

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
    -- Die Absage ohne Aussicht steht gleichberechtigt neben den beiden Status:
    -- Sie lässt `status` bewusst unangetastet (meist 'offen'), damit ein
    -- abgesagter Termin über `show_status is null` aus dem Nenner der Show- und
    -- Quali-Quote fällt, statt sie zu verfälschen (0032, Abschnitt 3). Ohne
    -- diesen Zweig wäre genau der Preis dafür, dass die Ablage „Abgesagt ohne
    -- Aussicht" NIE eine Wiedervorlage bekommt — obwohl `recycle_tasks` unten
    -- genau diesen Zweig abfragt und ihn damit anzeigen könnte.
    --
    -- Die Wartezeit teilt sie sich mit dem toten Lead
    -- (`days_default_setting_dead`). Ein eigener Absage-Wert wäre eine weitere
    -- Zahl in den Einstellungen, deren Unterschied zum Nachbarn niemand
    -- erklären kann — eine geteilte Frist ist ehrlicher als eine erfundene.
    -- 'unqualifiziert' behält seinen eigenen Wert und geht vor: ein Termin, der
    -- stattfand und den Lead aussortiert hat, sagt mehr als seine Absage.
    -- Dasselbe gilt für den No-Show ohne Antwort: Die Kette endet laut Konzept
    -- bei „Ziel ist es eine klare Antwort zu erhalten" und danach „Ablauf geht
    -- erneut von vorne los" — das Recycling IST dieses Von-vorne. Auch hier
    -- bleibt `status` unangetastet, damit die No-Show-Quote stimmt.
    select sc.disqualify_reason_code, sc.recycle_attempt_count,
           (sc.recycle_excluded_at is not null or sc.revived_at is not null
            or (sc.status not in ('dead', 'unqualifiziert')
                and sc.cancel_outlook is distinct from 'ohne_aussicht'
                and sc.no_show_resolution is distinct from 'ohne_antwort')),
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
-- 2. recycle_attempt — Rumpf aus 0033, davor die Zugriffsprüfung
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
  -- Zugriffsprüfung als ERSTE Anweisung, wortgleich zu
  -- apply_reminder_touches() (0032) und zur Prüfung in schedule_recycle()
  -- oben. Sie steht VOR der Ursprungs-Prüfung: Wer nicht zur Organisation
  -- gehört, soll nicht einmal erfahren, welche Ursprünge es gibt.
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  ) and not public.is_platform_admin() then
    raise exception 'Kein Zugriff auf diese Organisation';
  end if;

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
-- Verifikation
-- ---------------------------------------------------------------------------
--
-- A) Steht die Prüfung überhaupt in beiden Funktionen? Muss GENAU 2 Zeilen
--    liefern (schedule_recycle, recycle_attempt):
--
--      select p.proname
--        from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and p.proname in ('schedule_recycle', 'recycle_attempt')
--         and pg_get_functiondef(p.oid) like '%Kein Zugriff auf diese Organisation%';
--
-- B) Die eigentliche Probe. WICHTIG: nicht einfach im SQL-Editor absetzen —
--    dort läuft man als `postgres`, `auth.uid()` ist NULL und BEIDE Aufrufe
--    scheitern. Das sähe wie ein bestandener Test aus, prüft aber nichts. Also
--    eine angemeldete Sitzung nachstellen. <user> ist ein Mitglied der EIGENEN
--    Organisation und KEIN Plattform-Admin — sonst greift der zweite Zweig der
--    Prüfung und B1 läuft zu Recht durch (siehe C).
--
--    B1) FREMDE Organisation — MUSS scheitern, beide Aufrufe mit
--        `ERROR: Kein Zugriff auf diese Organisation`. Ein zurückgegebenes
--        Datum, eine Zahl oder auch nur ein stilles NULL ist ein Fehlschlag
--        der Prüfung:
--
--          begin;
--            set local role authenticated;
--            set local request.jwt.claims = '{"sub":"<user>","role":"authenticated"}';
--            select public.schedule_recycle('<fremde-ws>', 'closing', '<fremdes-closing>');
--          rollback;
--
--          begin;
--            set local role authenticated;
--            set local request.jwt.claims = '{"sub":"<user>","role":"authenticated"}';
--            select public.recycle_attempt('<fremde-ws>', 'closing', '<fremdes-closing>');
--          rollback;
--
--        (Je Aufruf eine eigene Transaktion: Die erste Exception bricht den
--        Block ab, ein zweites select im selben Block liefe gar nicht mehr.)
--
--    B2) EIGENE Organisation — MUSS durchlaufen, ohne Exception:
--
--          begin;
--            set local role authenticated;
--            set local request.jwt.claims = '{"sub":"<user>","role":"authenticated"}';
--            select public.schedule_recycle('<eigene-ws>', 'closing', '<eigenes-closing>');
--            select public.recycle_attempt('<eigene-ws>', 'closing', '<eigenes-closing>');
--          rollback;   -- der Probelauf soll keinen Versuch verbrennen
--
--        `schedule_recycle` liefert ein Datum ODER null — null ist hier KEIN
--        Fehler, sondern die reguläre Antwort „kein Recycling" (Status,
--        Ausschluss, Grund oder erreichter Deckel, siehe 0033). Entscheidend
--        ist allein, dass keine Exception fliegt. `recycle_attempt` liefert
--        den erhöhten Zähler.
--
-- C) Gegenprobe Plattform-Admin: dieselben Aufrufe wie in B1, aber mit der
--    <user>-UUID von Simon oder Kevin, müssen DURCHLAUFEN. Der Org-Umschalter
--    hängt daran (docs §2) — schlägt C fehl, ist die Arbeit in fremden
--    Organisationen ab hier tot.
--
-- D) Rechte unverändert: `create or replace` behält sie, die Grants oben
--    setzen sie zusätzlich erneut. Muss für beide Funktionen `authenticated`
--    enthalten:
--
--      select p.proname, p.proacl
--        from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and p.proname in ('schedule_recycle', 'recycle_attempt');
