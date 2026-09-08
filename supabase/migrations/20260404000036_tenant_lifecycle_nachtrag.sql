-- 0036 — Nachtrag Mandanten-Lebenszyklus: Nutzer-Umzug und Loeschvorschau
--
-- Setzt 0026 (Nutzer-Umzug), 0027 (Organisation loeschen), 0031
-- (message_templates), 0032 (pipeline_settings, cascade_steps,
-- reminder_touches) und 0033/0034 voraus.
--
-- Zwei Funktionen sind aelter als die Tabellen des Nachfassen-Umbaus und
-- kennen sie deshalb nicht:
--
--  1. move_user_scope()/admin_move_user_to_workspace() stempeln 14 Tabellen um.
--     Die persoenlichen Nachrichtenvorlagen des Umziehenden bleiben dadurch in
--     der alten Organisation zurueck — unsichtbar, weil die Vorrangkette
--     (Liste > persoenlich > Organisation > Auslieferungstext) den fehlenden
--     Text lautlos durch den Org-Standard ersetzt. Seine Erinnerungen bleiben
--     ebenfalls liegen, mit einer assigned_user_id, die in der alten
--     Organisation niemandem mehr gehoert.
--
--  2. preview_delete_workspace() zaehlt 13 Tabellen, geloescht werden inzwischen
--     18 (plus workspace_members, das die Vorschau als 'members' fuehrt). Eine
--     Loeschvorschau, die weniger nennt als sie loescht, ist gefaehrlicher als
--     gar keine: Sie erweckt Vertrauen in eine Zahl, die zu klein ist.
--
-- Beide Funktionen werden per `create or replace` mit UNVERAENDERTER Signatur
-- neu geschrieben — ihr bisheriger Rumpf steht hier vollstaendig und
-- unveraendert, die Ergaenzungen sind mit "Nachtrag 0036" markiert. Ein
-- geaenderter Rueckgabetyp braeuchte `drop function` und traefe die Grants
-- einer produktiv aufgerufenen Funktion; beide liefern jsonb, neue Schluessel
-- sind deshalb rein additiv (die Oberflaeche beschriftet unbekannte Schluessel
-- ueber COUNT_LABELS[key] ?? key und faellt auf den Rohnamen zurueck).
--
-- move_user_scope() selbst bleibt UNANGETASTET. Ein weiterer OUT-Parameter
-- waere eine Aenderung ihres Rueckgabetyps, und ihre bestehenden Ausgaben
-- reichen: Vorlagen haengen an user_id, Erinnerungen an den bereits
-- ermittelten Termin-Ids.
--
-- Wiederholbar: ausschliesslich `create or replace` plus idempotente Grants,
-- keine DDL auf Tabellen. Die Supabase-Konsole faehrt ein Skript nicht in einer
-- Transaktion — ein Abbruch mittendrin laesst sich hier folgenlos wiederholen.

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
-- 3) Loeschvorschau
-- ---------------------------------------------------------------------------
-- platform_delete_workspace() bleibt unveraendert: Sie ruft diese Vorschau auf
-- und vergleicht deren 'counts' mit p_expected — die neuen Schluessel wirken
-- dort automatisch.
create or replace function public.preview_delete_workspace (p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_name text;
  v_members jsonb;
  v_list_ids uuid[];
  v_phone_ids uuid[];
  v_organic_ids uuid[];
begin
  if not public.is_platform_admin () then
    raise exception 'Nur Plattform-Admins duerfen Organisationen loeschen';
  end if;

  select w.name into v_name from public.workspaces w where w.id = p_workspace_id;
  if v_name is null then
    raise exception 'Organisation existiert nicht';
  end if;

  select coalesce(jsonb_agg(x.username order by x.username), '[]'::jsonb)
    into v_members
  from (
    select coalesce(p.username, wm.user_id::text) as username
    from public.workspace_members wm
    left join public.profiles p on p.user_id = wm.user_id
    where wm.workspace_id = p_workspace_id
  ) x;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_list_ids
    from public.lists where workspace_id = p_workspace_id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_phone_ids
    from public.phone_lists where workspace_id = p_workspace_id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_organic_ids
    from public.organic_lists where workspace_id = p_workspace_id;

  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'workspace', v_name,
    'members', v_members,
    'counts', jsonb_build_object(
      'lists', coalesce(array_length(v_list_ids, 1), 0),
      'contacts', (select count(*) from public.contacts where workspace_id = p_workspace_id),
      'list_views', (select count(*) from public.list_views where workspace_id = p_workspace_id),
      'phone_lists', coalesce(array_length(v_phone_ids, 1), 0),
      'phone_leads', (select count(*) from public.phone_leads where workspace_id = p_workspace_id),
      'csv_imports', (select count(*) from public.csv_imports where workspace_id = p_workspace_id),
      'setting_calls', (select count(*) from public.setting_calls where workspace_id = p_workspace_id),
      'closing_calls', (select count(*) from public.closing_calls where workspace_id = p_workspace_id),
      'call_assignees', (select count(*) from public.call_assignees where workspace_id = p_workspace_id),
      'organic_lists', coalesce(array_length(v_organic_ids, 1), 0),
      'organic_posts', (select count(*) from public.organic_posts where workspace_id = p_workspace_id),
      'performance_targets', (select count(*) from public.performance_targets where workspace_id = p_workspace_id),
      'followup_templates', (select count(*) from public.followup_templates where workspace_id = p_workspace_id),
      -- Nachtrag 0036 — die fuenf Tabellen, die bisher fehlten. Alle fuenf
      -- haengen mit `on delete cascade` an workspaces und verschwinden also
      -- mit; genannt wurden sie nicht. phone_call_attempts (0028) ist dabei
      -- der unangenehmste Fall: das Anruf-Log ist die einzige
      -- Ereignis-Historie der App und typischerweise die groesste Tabelle der
      -- Organisation. pipeline_settings zaehlt 0 oder 1 (workspace_id ist dort
      -- Primaerschluessel) und steht trotzdem in der Liste — eine Vorschau,
      -- die Tabellen nach erwarteter Zeilenzahl auswaehlt, waere wieder eine
      -- Vorschau mit Ermessensspielraum.
      'phone_call_attempts', (select count(*) from public.phone_call_attempts where workspace_id = p_workspace_id),
      'message_templates', (select count(*) from public.message_templates where workspace_id = p_workspace_id),
      'pipeline_settings', (select count(*) from public.pipeline_settings where workspace_id = p_workspace_id),
      'cascade_steps', (select count(*) from public.cascade_steps where workspace_id = p_workspace_id),
      'reminder_touches', (select count(*) from public.reminder_touches where workspace_id = p_workspace_id)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Grants
-- ---------------------------------------------------------------------------
-- `create or replace` erhaelt die bestehenden Rechte; die Zeilen stehen hier
-- trotzdem, damit die Datei auf einer Datenbank ohne 0026/0027-Grants
-- (Wiederherstellung, frischer Klon) denselben Endzustand erzeugt. Postgres
-- vergibt EXECUTE per Default an PUBLIC — bei security-definer-Funktionen die
-- falsche Grundeinstellung.
revoke execute on function public.preview_move_user (uuid, uuid) from public;
revoke execute on function public.admin_move_user_to_workspace (uuid, uuid, text, text, boolean, jsonb) from public;
revoke execute on function public.preview_delete_workspace (uuid) from public;
grant execute on function public.preview_move_user (uuid, uuid) to authenticated;
grant execute on function public.admin_move_user_to_workspace (uuid, uuid, text, text, boolean, jsonb) to authenticated;
grant execute on function public.preview_delete_workspace (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Verifikation (nach dem Einspielen im SQL-Editor ausfuehren)
-- ---------------------------------------------------------------------------
-- A) Die Loeschvorschau nennt ALLES, was das Kaskaden-Loeschen mitnimmt. Das
--    ist der eigentliche Test dieser Migration: Er vergleicht die Schluessel
--    der Vorschau mit den Tabellen, die per `on delete cascade` an workspaces
--    haengen — er veraltet also nicht mit der naechsten neuen Tabelle, sondern
--    schlaegt dann an. workspace_members ist ausgenommen, weil die Vorschau
--    die Mitglieder namentlich unter 'members' fuehrt.
--    Muss eine LEERE Menge liefern:
--      select c.relname
--        from pg_constraint con
--        join pg_class c on c.oid = con.conrelid
--       where con.confrelid = 'public.workspaces'::regclass
--         and con.contype = 'f'
--         and con.confdeltype = 'c'
--         and c.relname <> 'workspace_members'
--         and c.relname not in (
--               select jsonb_object_keys(
--                        public.preview_delete_workspace('<workspace>') -> 'counts'));
--
--    Gegenprobe (nennt die Vorschau etwas, das es nicht gibt?) — ebenfalls leer:
--      select k from jsonb_object_keys(
--                      public.preview_delete_workspace('<workspace>') -> 'counts') k
--       where k not in (select c.relname from pg_constraint con
--                         join pg_class c on c.oid = con.conrelid
--                        where con.confrelid = 'public.workspaces'::regclass
--                          and con.contype = 'f' and con.confdeltype = 'c');
--
-- B) Nach JEDEM Nutzer-Umzug (ergaenzt die Invarianten aus docs §8):
--
--    Keine Erinnerung liegt in einer anderen Organisation als ihr Termin —
--    muss 0 ergeben:
--      select count(*)
--        from public.reminder_touches rt
--        left join public.setting_calls sc on sc.id = rt.setting_call_id
--        left join public.closing_calls cc on cc.id = rt.closing_call_id
--       where rt.workspace_id is distinct from coalesce(sc.workspace_id, cc.workspace_id);
--
--    Keine AKTIVE Erinnerung ist jemandem zugewiesen, der in ihrer
--    Organisation kein Mitglied ist — muss 0 ergeben. Genau diese Zeilen
--    blieben vor 0036 nach einem Umzug zurueck:
--      select count(*) from public.reminder_touches rt
--       where rt.superseded_at is null
--         and rt.assigned_user_id is not null
--         and not exists (select 1 from public.workspace_members wm
--                          where wm.user_id = rt.assigned_user_id
--                            and wm.workspace_id = rt.workspace_id);
--
--    Keine persoenliche Vorlage liegt in einer Organisation, in der ihr
--    Besitzer kein Mitglied ist — muss 0 ergeben:
--      select count(*) from public.message_templates mt
--       where mt.user_id is not null
--         and not exists (select 1 from public.workspace_members wm
--                          where wm.user_id = mt.user_id
--                            and wm.workspace_id = mt.workspace_id);
--
-- C) Probelauf ohne Schreibzugriff — die Vorschau kennt die neuen Schluessel
--    (erwartet: message_templates und reminder_touches sind enthalten):
--      select public.preview_move_user('<user>', '<zielorganisation>') -> 'counts';
--
-- D) NOCH OFFEN, bewusst nicht in dieser Migration: phone_call_attempts zieht
--    beim Nutzer-Umzug weiterhin NICHT mit (docs §2). Das Anruf-Log bliebe
--    also in der alten Organisation, waehrend seine Leads umziehen. Die
--    Loeschvorschau kennt die Tabelle ab hier, der Umzug nicht — das ist eine
--    eigene Entscheidung ueber die Snapshot-Spalten list_id/owner_name und
--    gehoert nicht in einen Nachtrag, der sonst nur Bekanntes ergaenzt:
--      select count(*) from public.phone_call_attempts a
--        join public.phone_leads pl on pl.id = a.lead_id
--       where a.workspace_id <> pl.workspace_id;
