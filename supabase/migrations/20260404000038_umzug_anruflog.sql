-- 0038 — Nutzer-Umzug: das Anruf-Log zieht mit
--
-- Setzt 0026 (Nutzer-Umzug), 0028 (phone_call_attempts) und 0036 voraus.
--
-- Die letzte dokumentierte Umzugsluecke. 0036 hat preview_move_user() und
-- admin_move_user_to_workspace() auf 16 Tabellen nachgezogen und dabei
-- phone_call_attempts ausdruecklich offen gelassen (Verifikationsblock 0036,
-- Punkt D; docs/data-model.md §2 und die benannte Ausnahme in §8). Folge: Beim
-- Umzug wandern die Telefonlisten und ihre Leads in die neue Organisation, das
-- Anruf-Log bleibt in der alten liegen. Die Zeilen sind damit doppelt
-- unerreichbar — in der neuen Organisation fehlt die Historie zu Leads, die man
-- dort sieht, und in der alten steht Historie zu Leads, die es dort nicht mehr
-- gibt. Ein `on delete cascade` raeumt sie erst auf, wenn irgendwann die alte
-- Organisation geloescht wird; bis dahin waechst still die Zahl, die die
-- Invariante in §8 misst.
--
-- WAS FACHLICH MITZIEHT: die Anwahlen zu den mitziehenden Telefon-Leads. Der
-- Anruf haengt am Lead (lead_id, not null, on delete cascade), nicht am Nutzer:
-- Eine Anwahl, die der Umziehende auf einem Lead protokolliert hat, der
-- zurueckbleibt, gehoert zur Historie dieses Leads und bleibt bei ihm. Umgekehrt
-- ziehen Anwahlen mit, die jemand anderes protokolliert hat — ihr Lead geht ja
-- auch. Dieselbe Regel wie bei reminder_touches in 0036: das Kind folgt seinem
-- Elternobjekt, nicht seiner Person.
--
-- WAS BEWUSST NICHT ANGEFASST WIRD: list_id und owner_name sind SNAPSHOTS des
-- Zeitpunkts, an dem angerufen wurde (0028, docs §3). Der Lead wandert bei
-- "Rueckruf"/"Nicht erreicht" physisch in eine Routing-Liste; wer die Snapshots
-- auf den heutigen Stand zoege, schriebe die Historie rueckwirkend um und
-- zerstoerte genau die Auswertung, fuer die das Log existiert. Diese Migration
-- aendert deshalb ausschliesslich workspace_id. Der Restfall, der daraus
-- entsteht, ist unten als Warnung 'attempt_list_snapshot_split' sichtbar
-- gemacht und im Verifikationsblock nachmessbar — entschieden wird er hier
-- nicht (siehe Punkt D am Ende).
--
-- Beide Funktionen werden per `create or replace` mit UNVERAENDERTER Signatur
-- neu geschrieben; ihr Rumpf ist der aus 0036, Zeile fuer Zeile, die
-- Ergaenzungen sind mit "Nachtrag 0038" markiert. Ein geaenderter Rueckgabetyp
-- braeuchte `drop function` und traefe die Grants einer produktiv aufgerufenen
-- Funktion; beide liefern jsonb, ein neuer Schluessel ist deshalb rein additiv.
-- Anwendungscode braucht diese Migration keinen: Die Umzugsvorschau rendert
-- jeden Schluessel aus 'counts' und kennt 'phone_call_attempts' bereits als
-- "Anwahlen" (COUNT_LABELS in src/lib/lifecycleLabels.ts — die Loeschvorschau
-- zeigt ihn seit 0036), und eine Warnung zeigt immer zuerst ihren DB-Text
-- (moveWarningText ebenda), der hier mitgeliefert wird.
--
-- Vorschau und Umzug muessen denselben Zaehlbegriff benutzen: Der Mover
-- vergleicht p_expected gegen preview_move_user() -> 'counts' und bricht bei
-- Abweichung ab. Der neue Zaehler und das neue Update stehen deshalb wortgleich
-- auf derselben Bedingung. Beide Funktionen gehoeren in dieselbe Ausfuehrung —
-- eine halb eingespielte Datei (markierter Text im Supabase-Editor, §7) liesse
-- eine Vorschau mit neuem Schluessel gegen einen Mover ohne ihn laufen, und
-- jeder Umzug mit p_expected schluege fehl.
--
-- preview_delete_workspace() bleibt UNANGETASTET: Sie kennt phone_call_attempts
-- bereits seit 0036 (dort im counts-Block, Kommentar "die fuenf Tabellen, die
-- bisher fehlten"). Nachgeprueft — Punkt C unten.
--
-- move_user_scope() bleibt ebenfalls unangetastet: Sie liefert mit o_phone_ids
-- alles, was hier gebraucht wird, und ein weiterer OUT-Parameter waere eine
-- Signaturaenderung (dieselbe Begruendung wie in 0036).
--
-- Wiederholbar: ausschliesslich `create or replace` plus idempotente Grants,
-- keine DDL auf Tabellen. Ein Abbruch mittendrin laesst sich folgenlos
-- wiederholen; ein zweiter Lauf des Umzugs findet keine Zeilen mehr, weil die
-- Bedingung auf workspace_id = s.o_src steht.

-- ---------------------------------------------------------------------------
-- 1) Vorschau des Umzugs
-- ---------------------------------------------------------------------------
create or replace function public.preview_move_user (
  p_user_id uuid,
  p_target_workspace_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  v_target_name text;
  v_src_name text;
  v_warnings jsonb := '[]'::jsonb;
  n bigint;
begin
  if not public.is_platform_admin () then
    raise exception 'Nur Plattform-Admins duerfen Nutzer verschieben';
  end if;

  select * into s from public.move_user_scope (p_user_id);

  select w.name into v_src_name from public.workspaces w where w.id = s.o_src;
  select w.name into v_target_name from public.workspaces w where w.id = p_target_workspace_id;
  if v_target_name is null then
    raise exception 'Zielorganisation existiert nicht';
  end if;

  -- Warnung: Termin verliert seine Quelle, weil die Liste zurueckbleibt.
  select count(*) into n
  from public.setting_calls sc
  where sc.id = any (s.o_setting_ids)
    and sc.source_contact_id is not null
    and not exists (
      select 1 from public.contacts c
      where c.id = sc.source_contact_id and c.list_id = any (s.o_list_ids)
    );
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'orphan_setting_source', 'count', n,
      'text', n || ' Termin(e) verlieren ihren LinkedIn-Kontakt (Liste bleibt zurück).');
  end if;

  select count(*) into n
  from public.setting_calls sc
  where sc.id = any (s.o_setting_ids)
    and sc.source_phone_lead_id is not null
    and not exists (
      select 1 from public.phone_leads pl
      where pl.id = sc.source_phone_lead_id and pl.list_id = any (s.o_phone_ids)
    );
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'orphan_setting_phone_source', 'count', n,
      'text', n || ' Termin(e) verlieren ihren Telefon-Lead (Liste bleibt zurück).');
  end if;

  -- Warnung: Closing verliert seinen Setting-Bezug.
  select count(*) into n
  from public.closing_calls cc
  where cc.id = any (s.o_closing_ids)
    and cc.setting_call_id is not null
    and not (cc.setting_call_id = any (s.o_setting_ids));
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'split_setting_closing', 'count', n,
      'text', n || ' Closing(s) verlieren ihren Setting-Bezug (anderer Ersteller).');
  end if;

  -- Warnung: Zuweisungen an Terminen, die zurueckbleiben.
  select count(*) into n
  from public.call_assignees ca
  where ca.workspace_id = s.o_src
    and ca.user_id = p_user_id
    and not (
      (ca.entity_type = 'setting_call' and ca.entity_id = any (s.o_setting_ids))
      or (ca.entity_type = 'closing_call' and ca.entity_id = any (s.o_closing_ids))
    );
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'assignee_dropped', 'count', n,
      'text', n || ' Zuweisung(en) an Terminen der alten Organisation werden entfernt.');
  end if;

  -- Warnung: Smart View wird zum Wurzelknoten.
  select count(*) into n
  from public.list_views v
  where v.id = any (s.o_view_ids)
    and v.parent_id is not null
    and not (v.parent_id = any (s.o_view_ids));
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'orphan_view_parent', 'count', n,
      'text', n || ' Ansicht(en) werden zum Wurzelknoten (Ordner bleibt zurück).');
  end if;

  -- Nachtrag 0036 — Warnung: Erinnerungen an Terminen, die zurueckbleiben.
  -- Ein Touch haengt per CHECK an genau EINEM Termin (setting_call_id oder
  -- closing_call_id, 0032). Bleibt dieser Termin in der alten Organisation,
  -- kann die Erinnerung nicht mitziehen, ohne eine Kante ueber die Org-Grenze
  -- zu ziehen — sie wird stattdessen entwertet (superseded_at), damit sie in
  -- keiner Inbox mehr auftaucht. Betroffen ist vor allem der in docs §2
  -- benannte Fall: ein Termin, der dem Umziehenden nur ZUGEWIESEN ist, gehoert
  -- ihm laut move_user_scope() nicht und bleibt liegen.
  select count(*) into n
  from public.reminder_touches rt
  where rt.workspace_id = s.o_src
    and rt.assigned_user_id = p_user_id
    and rt.superseded_at is null
    and not (coalesce(rt.setting_call_id = any (s.o_setting_ids), false)
          or coalesce(rt.closing_call_id = any (s.o_closing_ids), false));
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'reminder_touch_superseded', 'count', n,
      'text', n || ' Erinnerung(en) an Terminen der alten Organisation werden entwertet.');
  end if;

  -- Nachtrag 0038 — Warnung: Anwahl zieht mit, ihr Listen-SNAPSHOT bleibt
  -- zurueck. Der Normalfall ist 0: Der Snapshot zeigt auf eine Telefonliste
  -- desselben Nutzers, und die zieht mit. Groesser wird die Zahl nur, wenn die
  -- damalige Liste inzwischen jemand anderem gehoert (owner_name geaendert) —
  -- dann steht in der Zeile nach dem Umzug eine Referenz ueber die Org-Grenze.
  -- Der Umzug laesst sie stehen, weil list_id Historie ist und nicht
  -- rueckwirkend umgeschrieben werden darf; die Warnung macht sie sichtbar,
  -- statt sie stillschweigend zu erzeugen.
  select count(*) into n
  from public.phone_call_attempts a
  join public.phone_leads pl on pl.id = a.lead_id
  where a.workspace_id = s.o_src
    and pl.list_id = any (s.o_phone_ids)
    and a.list_id is not null
    and not (a.list_id = any (s.o_phone_ids));
  if n > 0 then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'attempt_list_snapshot_split', 'count', n,
      'text', n || ' Anwahl(en) ziehen mit, ihre Ursprungsliste bleibt zurück (Snapshot bleibt unverändert).');
  end if;

  return jsonb_build_object(
    'username', s.o_username,
    'source_workspace_id', s.o_src,
    'source_workspace', v_src_name,
    'target_workspace_id', p_target_workspace_id,
    'target_workspace', v_target_name,
    -- array_length liefert bei leeren Arrays NULL, nicht 0 — ohne coalesce
    -- stuenden in der Vorschau Luecken statt Nullen, und der p_expected-
    -- Vergleich im Mover verglichen NULL gegen 0.
    'counts', jsonb_build_object(
      'lists', coalesce(array_length(s.o_list_ids, 1), 0),
      'contacts', (select count(*) from public.contacts where list_id = any (s.o_list_ids)),
      'list_views', coalesce(array_length(s.o_view_ids, 1), 0),
      'phone_lists', coalesce(array_length(s.o_phone_ids, 1), 0),
      'phone_leads', (select count(*) from public.phone_leads where list_id = any (s.o_phone_ids)),
      -- Nachtrag 0038. Die Anwahl folgt ihrem LEAD, nicht ihrer Liste: list_id
      -- ist der Snapshot des Anrufzeitpunkts und zeigt bei einem Lead, der
      -- inzwischen in einer Routing-Liste liegt, noch auf die Akquise-Liste
      -- (0028, docs §3). Ueber list_id gezaehlt fehlten also ausgerechnet die
      -- Anwahlen der weitergezogenen Leads. Die Einschraenkung auf o_src ist
      -- dieselbe Vorsichtsmassnahme wie bei message_templates: Zeilen, die ein
      -- frueherer unvollstaendiger Umzug in einer dritten Organisation
      -- zurueckgelassen hat, zieht dieser Umzug nicht mit ein.
      -- Wortgleich zum Update im Mover — sonst schluege der p_expected-
      -- Vergleich fehl.
      'phone_call_attempts', (select count(*) from public.phone_call_attempts a
                               where a.workspace_id = s.o_src
                                 and exists (select 1 from public.phone_leads pl
                                              where pl.id = a.lead_id
                                                and pl.list_id = any (s.o_phone_ids))),
      'csv_imports', (select count(*) from public.csv_imports
                       where workspace_id = s.o_src
                         and (phone_list_id = any (s.o_phone_ids)
                              or (phone_list_id is null and created_by_user_id = p_user_id))),
      'setting_calls', coalesce(array_length(s.o_setting_ids, 1), 0),
      'closing_calls', coalesce(array_length(s.o_closing_ids, 1), 0),
      'organic_lists', coalesce(array_length(s.o_organic_ids, 1), 0),
      'organic_posts', (select count(*) from public.organic_posts where list_id = any (s.o_organic_ids)),
      'performance_targets', (select count(*) from public.performance_targets where user_id = p_user_id),
      'followup_templates', (select count(*) from public.followup_templates where user_id = p_user_id),
      -- Nachtrag 0036. Nur die PERSOENLICHEN Vorlagen ziehen mit: eine Zeile
      -- mit user_id is null ist der Standard der Organisation und gehoert ihr,
      -- nicht dem Umziehenden. Die Einschraenkung auf o_src ist keine Zierde,
      -- sondern Schutz: haette ein frueherer, unvollstaendiger Umzug Zeilen in
      -- einer dritten Organisation zurueckgelassen, zoege ein ungefiltertes
      -- Update sie mit und liefe in uq_message_templates_user (0031).
      'message_templates', (select count(*) from public.message_templates
                             where workspace_id = s.o_src and user_id = p_user_id),
      -- Erinnerungen ziehen an ihrem TERMIN mit, nicht an ihrer Zustaendigen —
      -- ein Touch ohne seinen Termin ist in der neuen Organisation nicht
      -- auffindbar. Superseded Touches zaehlen mit: die Erledigungs-Historie
      -- gehoert zum Termin (Analyse "Erinnerungs-Disziplin", docs §5.1).
      'reminder_touches', (select count(*) from public.reminder_touches rt
                            where rt.workspace_id = s.o_src
                              and (coalesce(rt.setting_call_id = any (s.o_setting_ids), false)
                                or coalesce(rt.closing_call_id = any (s.o_closing_ids), false)))
    ),
    'warnings', v_warnings
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Der Umzug
-- ---------------------------------------------------------------------------
create or replace function public.admin_move_user_to_workspace (
  p_user_id uuid,
  p_target_workspace_id uuid,
  p_role text default null,
  p_data_scope text default null,
  p_force boolean default false,
  p_expected jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_old_role text;
  v_old_scope text;
  v_owner_count int;
  v_member_count int;
  v_actual jsonb;
  v_moved jsonb := '{}'::jsonb;
  n bigint;
begin
  if not public.is_platform_admin () then
    raise exception 'Nur Plattform-Admins duerfen Nutzer verschieben';
  end if;

  -- Zwei gleichzeitige Umzuege desselben Nutzers wuerden sich gegenseitig die
  -- Zwischenstaende ueberschreiben. Die Sperre faellt am Transaktionsende.
  perform pg_advisory_xact_lock (hashtext ('move_user'), hashtext (p_user_id::text));

  select * into s from public.move_user_scope (p_user_id);

  -- ---- Vorbedingungen: alles pruefen, BEVOR irgendetwas geschrieben wird ----
  if s.o_src = p_target_workspace_id then
    raise exception 'Nutzer % ist bereits in dieser Organisation', s.o_username;
  end if;

  if not exists (select 1 from public.workspaces w where w.id = p_target_workspace_id) then
    raise exception 'Zielorganisation existiert nicht';
  end if;

  -- owner_name-Kollision: in der Zielorganisation liegen bereits Daten unter
  -- diesem Namen. Praktisch unmoeglich (Benutzernamen sind global eindeutig),
  -- aber ein von Hand gesetzter owner_name koennte es ausloesen.
  if exists (select 1 from public.lists where workspace_id = p_target_workspace_id and owner_name = s.o_username)
     or exists (select 1 from public.phone_lists where workspace_id = p_target_workspace_id and owner_name = s.o_username)
     or exists (select 1 from public.list_views where workspace_id = p_target_workspace_id and owner_name = s.o_username)
  then
    raise exception 'In der Zielorganisation existieren bereits Listen mit owner_name = %', s.o_username;
  end if;

  -- Routing-Listen (Rueckruf / Nicht erreicht) existieren je Owner und
  -- Organisation genau einmal (uq_phone_lists_routing, 20260404000008:88).
  if exists (
    select 1 from public.phone_lists
    where workspace_id = p_target_workspace_id
      and created_by_user_id = p_user_id
      and list_kind <> 'akquise'
  ) then
    raise exception 'Zielorganisation hat bereits Routing-Telefonlisten dieses Nutzers';
  end if;

  -- Nachtrag 0036: Vorlagen-Kollision. message_templates ist je (workspace_id,
  -- user_id, template_key) eindeutig (uq_message_templates_user, 0031) —
  -- anders als performance_targets und followup_templates, deren Unique ohne
  -- workspace_id auskommt und beim Umzug deshalb nie kollidieren kann. Zeilen
  -- dieses Nutzers in der ZIELorganisation koennen nur aus einem frueheren,
  -- unvollstaendigen Umzug stammen; ein benannter Abbruch ist verstaendlicher
  -- als ein 'duplicate key value violates unique constraint' aus dem Index.
  if exists (
    select 1 from public.message_templates
    where workspace_id = p_target_workspace_id and user_id = p_user_id
  ) then
    raise exception
      'In der Zielorganisation liegen bereits persoenliche Nachrichtenvorlagen von % — bitte zuerst dort aufraeumen',
      s.o_username;
  end if;

  select wm.role, wm.data_scope into v_old_role, v_old_scope
  from public.workspace_members wm
  where wm.user_id = p_user_id and wm.workspace_id = s.o_src;

  select count(*) into v_owner_count
  from public.workspace_members where workspace_id = s.o_src and role = 'owner';
  select count(*) into v_member_count
  from public.workspace_members where workspace_id = s.o_src;

  if v_old_role = 'owner' and v_owner_count = 1 and v_member_count > 1 and not p_force then
    raise exception
      'Nutzer % ist letzter Owner der Quellorganisation — p_force := true zum Erzwingen', s.o_username;
  end if;

  -- Die Vorschau muss noch stimmen: sonst verschiebt die UI etwas anderes,
  -- als der Admin bestaetigt hat.
  if p_expected is not null then
    v_actual := public.preview_move_user (p_user_id, p_target_workspace_id) -> 'counts';
    if v_actual is distinct from p_expected then
      raise exception 'Datenbestand hat sich seit der Vorschau geaendert (erwartet %, tatsaechlich %) — bitte erneut pruefen',
        p_expected, v_actual;
    end if;
  end if;

  -- ---- Kanten kappen, SOLANGE beide Seiten noch in der Quell-Org liegen ----
  update public.setting_calls sc set source_contact_id = null
   where sc.id = any (s.o_setting_ids)
     and sc.source_contact_id is not null
     and not exists (select 1 from public.contacts c
                      where c.id = sc.source_contact_id and c.list_id = any (s.o_list_ids));

  update public.setting_calls sc set source_phone_lead_id = null
   where sc.id = any (s.o_setting_ids)
     and sc.source_phone_lead_id is not null
     and not exists (select 1 from public.phone_leads pl
                      where pl.id = sc.source_phone_lead_id and pl.list_id = any (s.o_phone_ids));

  -- Gegenrichtung: ein zurueckbleibender Kontakt darf nicht auf einen Termin
  -- der neuen Organisation zeigen. Er faellt in den Nicht-terminiert-Zustand
  -- zurueck, damit er in der alten Organisation wieder bearbeitbar ist.
  update public.contacts c
     set setting_call_id = null, appointment_set = false,
         appointment_at = null, meet_link = null
   where c.setting_call_id = any (s.o_setting_ids)
     and not (c.list_id = any (s.o_list_ids));

  update public.phone_leads pl
     set appointment_set = false, appointment_at = null, meet_link = null, status = 'aktiv'
   where pl.workspace_id = s.o_src
     and not (pl.list_id = any (s.o_phone_ids))
     and exists (select 1 from public.setting_calls sc
                  where sc.id = any (s.o_setting_ids) and sc.source_phone_lead_id = pl.id);

  update public.closing_calls cc set setting_call_id = null
   where cc.id = any (s.o_closing_ids)
     and cc.setting_call_id is not null
     and not (cc.setting_call_id = any (s.o_setting_ids));

  update public.list_views v set parent_id = null
   where v.id = any (s.o_view_ids)
     and v.parent_id is not null
     and not (v.parent_id = any (s.o_view_ids));

  -- Zuweisungen an Terminen, die NICHT mitziehen, entfallen: der Nutzer ist
  -- gleich nicht mehr Mitglied der alten Organisation.
  delete from public.call_assignees ca
   where ca.workspace_id = s.o_src
     and ca.user_id = p_user_id
     and not (
       (ca.entity_type = 'setting_call' and ca.entity_id = any (s.o_setting_ids))
       or (ca.entity_type = 'closing_call' and ca.entity_id = any (s.o_closing_ids))
     );

  -- Nachtrag 0036: Erinnerungen an Terminen, die NICHT mitziehen. Anders als
  -- die Zuweisung wird der Touch nicht geloescht, sondern entwertet — genau die
  -- Begruendung von reminder_touches_ws_guard (0032): die Erledigungs-Historie
  -- traegt die Analyse-Sektion "Erinnerungs-Disziplin" und darf nicht
  -- verschwinden, nur weil jemand die Organisation gewechselt hat. Er bleibt
  -- damit bewusst in der ALTEN Organisation liegen: mitgenommen zeigte er auf
  -- einen Termin jenseits der Org-Grenze, und eine Erinnerung an einen Termin,
  -- den man nicht oeffnen kann, ist nicht handelbar.
  update public.reminder_touches rt
     set superseded_at = now()
   where rt.workspace_id = s.o_src
     and rt.assigned_user_id = p_user_id
     and rt.superseded_at is null
     and not (coalesce(rt.setting_call_id = any (s.o_setting_ids), false)
           or coalesce(rt.closing_call_id = any (s.o_closing_ids), false));
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('reminder_touches_entwertet', n);

  -- ---- Umstempeln, Eltern vor Kindern ----
  update public.lists set workspace_id = p_target_workspace_id where id = any (s.o_list_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('lists', n);

  -- contacts.workspace_id wird sonst per Trigger aus der Liste abgeleitet —
  -- der feuert hier aber nicht, weil sich die LISTE geaendert hat, nicht der
  -- Kontakt. Also explizit nachziehen.
  update public.contacts set workspace_id = p_target_workspace_id where list_id = any (s.o_list_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('contacts', n);
  -- pipeline_stages hat kein workspace_id (nur list_id) — nichts zu tun.

  update public.list_views set workspace_id = p_target_workspace_id where id = any (s.o_view_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('list_views', n);

  update public.phone_lists set workspace_id = p_target_workspace_id where id = any (s.o_phone_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('phone_lists', n);

  update public.phone_leads set workspace_id = p_target_workspace_id where list_id = any (s.o_phone_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('phone_leads', n);

  -- Nachtrag 0038: das Anruf-Log. Es haengt am Lead, also gilt hier dieselbe
  -- Bedingung wie eine Zeile darueber — nur ueber lead_id statt list_id, weil
  -- a.list_id der Snapshot des Anrufzeitpunkts ist und nicht der heutige Ort
  -- des Leads. Reihenfolge egal: Die Bedingung liest pl.list_id, das das
  -- Update darueber nicht anfasst; ein Trigger existiert auf
  -- phone_call_attempts nur BEFORE INSERT (phone_call_attempts_bi, 0028).
  -- NUR workspace_id wird gesetzt: list_id und owner_name sind Snapshots
  -- (docs §3) — auf den heutigen Stand gezogen wuerden sie die Historie
  -- umschreiben, die die einzige Ereignis-Auswertung der App traegt.
  update public.phone_call_attempts a
     set workspace_id = p_target_workspace_id
   where a.workspace_id = s.o_src
     and exists (select 1 from public.phone_leads pl
                  where pl.id = a.lead_id and pl.list_id = any (s.o_phone_ids));
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('phone_call_attempts', n);

  update public.csv_imports set workspace_id = p_target_workspace_id
   where workspace_id = s.o_src
     and (phone_list_id = any (s.o_phone_ids)
          or (phone_list_id is null and created_by_user_id = p_user_id));
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('csv_imports', n);

  update public.setting_calls set workspace_id = p_target_workspace_id where id = any (s.o_setting_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('setting_calls', n);

  update public.closing_calls set workspace_id = p_target_workspace_id where id = any (s.o_closing_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('closing_calls', n);

  update public.call_assignees set workspace_id = p_target_workspace_id
   where workspace_id = s.o_src
     and ((entity_type = 'setting_call' and entity_id = any (s.o_setting_ids))
       or (entity_type = 'closing_call' and entity_id = any (s.o_closing_ids)));
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('call_assignees', n);

  update public.organic_lists set workspace_id = p_target_workspace_id where id = any (s.o_organic_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('organic_lists', n);

  update public.organic_posts set workspace_id = p_target_workspace_id where list_id = any (s.o_organic_ids);
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('organic_posts', n);

  -- performance_targets und followup_templates sind unique ueber (user_id, …)
  -- OHNE workspace_id — beim Umzug kann es dort also keinen Konflikt geben.
  update public.performance_targets set workspace_id = p_target_workspace_id where user_id = p_user_id;
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('performance_targets', n);

  update public.followup_templates set workspace_id = p_target_workspace_id where user_id = p_user_id;
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('followup_templates', n);

  -- ---- Mitgliedschaft zuletzt ----
  -- ERST loeschen, DANN anlegen. Zwei Mitgliedschaften wuerden
  -- getAccessContext() aus der Bahn werfen und den Nutzer aussperren.
  delete from public.workspace_members where user_id = p_user_id and workspace_id = s.o_src;
  insert into public.workspace_members (workspace_id, user_id, role, data_scope)
  values (
    p_target_workspace_id,
    p_user_id,
    coalesce(p_role, v_old_role, 'member'),
    coalesce(p_data_scope, v_old_scope, 'workspace')
  );

  -- ---- Nachtrag 0036: die Tabellen, die 0026 noch nicht kannte ----
  -- BEWUSST NACH der Mitgliedschaft, und zwar wegen reminder_touches_ws_guard
  -- (0032): Der Trigger entwertet beim Umstempeln jede Erinnerung, deren
  -- Zustaendige in der Zielorganisation kein Mitglied ist. Stuende dieser Block
  -- oben bei den uebrigen Tabellen, waere der Umziehende dort noch kein
  -- Mitglied — seine eigenen Erinnerungen kaemen samt und sonders entwertet an,
  -- und die Kaskade des naechsten Termins liefe ins Leere. (Genau diese Falle
  -- stellt assigned_user_guard aus 0028 dem Block oben; sie bleibt hier
  -- unangetastet, weil ein Umzug sonst mehr aendert als er soll.)
  update public.message_templates set workspace_id = p_target_workspace_id
   where workspace_id = s.o_src and user_id = p_user_id;
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('message_templates', n);

  -- Die Erinnerung folgt ihrem TERMIN, nicht ihrer Zustaendigen: ein Touch
  -- haengt per CHECK an genau einer setting_call_id ODER closing_call_id
  -- (0032), ein zweiter Zweig ueber assigned_user_id koennte also nur Touches
  -- einsammeln, deren Termin zurueckbleibt — und die sind oben bereits
  -- entwertet worden. Umgekehrt ziehen Touches mit, die einer anderen Person
  -- zugewiesen sind: ihr Termin geht ja auch. Der ws_guard entwertet genau die
  -- beim Umstempeln, ohne die Zuweisung zu nullen (Historie).
  update public.reminder_touches set workspace_id = p_target_workspace_id
   where workspace_id = s.o_src
     and (coalesce(setting_call_id = any (s.o_setting_ids), false)
       or coalesce(closing_call_id = any (s.o_closing_ids), false));
  get diagnostics n = row_count; v_moved := v_moved || jsonb_build_object('reminder_touches', n);

  return jsonb_build_object(
    'username', s.o_username,
    'source_workspace_id', s.o_src,
    'target_workspace_id', p_target_workspace_id,
    'moved', v_moved
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Grants
-- ---------------------------------------------------------------------------
-- `create or replace` erhaelt die bestehenden Rechte; die Zeilen stehen hier
-- trotzdem, damit die Datei auf einer Datenbank ohne 0026/0036-Grants
-- (Wiederherstellung, frischer Klon) denselben Endzustand erzeugt. Postgres
-- vergibt EXECUTE per Default an PUBLIC — bei security-definer-Funktionen die
-- falsche Grundeinstellung.
revoke execute on function public.preview_move_user (uuid, uuid) from public;
revoke execute on function public.admin_move_user_to_workspace (uuid, uuid, text, text, boolean, jsonb) from public;
grant execute on function public.preview_move_user (uuid, uuid) to authenticated;
grant execute on function public.admin_move_user_to_workspace (uuid, uuid, text, text, boolean, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Verifikation (nach dem Einspielen im SQL-Editor ausfuehren)
-- ---------------------------------------------------------------------------
-- A) DER Test dieser Migration. Er ist woertlich die Abfrage, die 0036 unter
--    Punkt D als bekannte Luecke hinterlassen hat und die docs §8 als benannte
--    Ausnahme fuehrt: Keine Anwahl liegt in einer anderen Organisation als ihr
--    Lead. Vor dem naechsten Umzug misst sie den Altbestand (Umzuege, die vor
--    dieser Migration liefen — die repariert 0038 NICHT, siehe E), nach jedem
--    Umzug ab hier muss sie 0 ergeben:
--      select count(*) from public.phone_call_attempts a
--        join public.phone_leads pl on pl.id = a.lead_id
--       where a.workspace_id <> pl.workspace_id;
--
-- B) Probelauf ohne Schreibzugriff — die Vorschau kennt den neuen Schluessel.
--    Erwartet: eine Zahl, kein NULL (der Schluessel fehlt sonst, dann lief die
--    Datei nur zur Haelfte durch):
--      select public.preview_move_user('<user>', '<zielorganisation>')
--             -> 'counts' -> 'phone_call_attempts';
--
--    Gegenprobe, dass Vorschau und Umzug dieselbe Menge meinen — die Zahl aus
--    B muss der hier gezaehlten entsprechen:
--      select count(*) from public.phone_call_attempts a
--       where a.workspace_id = (select workspace_id from public.workspace_members
--                                where user_id = '<user>')
--         and exists (select 1 from public.phone_leads pl
--                      join public.phone_lists l on l.id = pl.list_id
--                      where pl.id = a.lead_id
--                        and l.workspace_id = a.workspace_id
--                        and ((l.owner_name is not null
--                              and l.owner_name = (select username from public.profiles
--                                                   where user_id = '<user>'))
--                          or (l.owner_name is null and l.created_by_user_id = '<user>')));
--
-- C) Die Loeschvorschau kennt phone_call_attempts bereits (0036) — diese
--    Migration aendert daran nichts und darf es auch nicht. Muss `true`
--    liefern:
--      select (public.preview_delete_workspace('<workspace>') -> 'counts')
--             ? 'phone_call_attempts';
--
--    Und weiterhin leer bleiben muss die Katalog-Gegenprobe aus 0036, Punkt A
--    (jede Tabelle mit `on delete cascade` auf workspaces steht in der
--    Vorschau).
--
-- D) OFFEN GELASSEN, bewusst: der Snapshot-Restfall. list_id ist der Snapshot
--    der Liste zum Anrufzeitpunkt und wird hier nicht umgeschrieben. In aller
--    Regel zieht diese Liste mit demselben Nutzer um, und die Zahl ist 0.
--    Groesser als 0 wird sie nur, wenn der Snapshot auf eine Liste zeigt, die
--    zurueckbleibt (Liste inzwischen einem anderen owner_name zugeordnet) —
--    dann steht in der Zeile eine Referenz ueber die Org-Grenze, und die
--    zweite Bedingung der Policy phone_call_attempts_scoped_member (0028,
--    `list_id is not null and can_access_phone_list(list_id)`) prueft die
--    Mitgliedschaft in der ALTEN Organisation. Die Vorschau weist solche
--    Zeilen als Warnung 'attempt_list_snapshot_split' aus. Ob der Snapshot in
--    diesem Fall genullt (Kante kappen, wie bei source_contact_id) oder
--    stehen gelassen wird (Historie unangetastet), ist eine Produkt-
--    entscheidung und gehoert nicht in eine Migration, die sonst nur eine
--    dokumentierte Luecke schliesst. Zahl im Blick behalten:
--      select count(*) from public.phone_call_attempts a
--        join public.phone_lists l on l.id = a.list_id
--       where a.workspace_id <> l.workspace_id;
--
-- E) KEIN Backfill. Anwahlen, die frueheren Umzuegen hinterherhinken, bleiben
--    liegen: Welcher Lead damals mit welcher Person umgezogen ist, steht
--    nirgends: move_user_scope() rechnet den Besitz aus dem HEUTIGEN Stand von
--    owner_name/created_by_user_id, und der Umzug hat genau diesen Stand
--    verschoben. Ein Backfill muesste raten, und geraten wuerde ausgerechnet
--    an der einzigen Ereignis-Historie der App. A) nennt die Zahl; korrigiert
--    wird sie, wenn ueberhaupt, von Hand und je Fall:
--      update public.phone_call_attempts a
--         set workspace_id = pl.workspace_id
--        from public.phone_leads pl
--       where pl.id = a.lead_id and a.workspace_id <> pl.workspace_id;
--    (Nicht Teil dieser Migration — bewusst auskommentiert.)
