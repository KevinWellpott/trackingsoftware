-- Nutzer samt Daten in eine andere Organisation verschieben.
--
-- Warum das nicht trivial ist: workspace_id ist auf 14 Tabellen
-- denormalisiert, und die Besitz-Zuordnung laeuft je nach Tabelle ueber
-- owner_name (Vorrang) oder created_by_user_id. Ausserdem entstehen beim
-- Trennen zwangslaeufig Kanten, die ueber die neue Org-Grenze zeigen: ein
-- Termin, dessen LinkedIn-Kontakt in der alten Organisation bleibt, oder ein
-- Closing, dessen Setting von einer anderen Person angelegt wurde.
--
-- Diese Kanten werden GENULLT, nicht blockiert: lead_name und company liegen
-- auf setting_calls/closing_calls als Snapshot vor (20260404000008:176), die
-- Termine bleiben also vollstaendig lesbar. Ein harter Abbruch wuerde jeden
-- realistischen Umzug verhindern.
--
-- Ein plpgsql-Funktionskoerper ist EINE Transaktion: jedes `raise` rollt
-- saemtliche bis dahin erfolgten Updates zurueck.

-- ---------------------------------------------------------------------------
-- 1) Gemeinsame Besitz-Ermittlung
-- ---------------------------------------------------------------------------
-- Vorschau und Umzug MUESSEN dieselben Praedikate benutzen — sonst zeigt die
-- Vorschau etwas anderes an, als anschliessend passiert. Deshalb genau eine
-- Stelle, die "was gehoert dieser Person?" beantwortet.
create or replace function public.move_user_scope (
  p_user_id uuid,
  out o_username text,
  out o_src uuid,
  out o_list_ids uuid[],
  out o_view_ids uuid[],
  out o_phone_ids uuid[],
  out o_organic_ids uuid[],
  out o_setting_ids uuid[],
  out o_closing_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Eigener Guard, obwohl nur preview/move diese Funktion aufrufen: Postgres
  -- vergibt EXECUTE auf Funktionen standardmaessig an PUBLIC, und security
  -- definer umgeht RLS. Ohne diese Zeile koennte jeder eingeloggte Nutzer die
  -- Listen-, Termin- und View-IDs einer beliebigen Person abfragen.
  if not public.is_platform_admin () then
    raise exception 'Nur Plattform-Admins duerfen Besitzverhaeltnisse aufloesen';
  end if;

  select p.username into o_username from public.profiles p where p.user_id = p_user_id;
  if o_username is null then
    raise exception 'Nutzer hat kein Profil (user_id %)', p_user_id;
  end if;

  select wm.workspace_id into o_src
  from public.workspace_members wm
  where wm.user_id = p_user_id
  limit 1;
  if o_src is null then
    raise exception 'Nutzer % hat keine Mitgliedschaft', o_username;
  end if;

  -- owner_name hat Vorrang vor created_by_user_id — dieselbe Regel wie in
  -- list_owned_by_user() (20260404000015) und buildOwnScope()
  -- (src/lib/access.ts). Ein Admin kann eine Liste FUER jemanden anlegen;
  -- dann gehoert sie dem Eingetragenen, nicht dem Ersteller.
  select coalesce(array_agg(l.id), '{}'::uuid[]) into o_list_ids
  from public.lists l
  where l.workspace_id = o_src
    and ((l.owner_name is not null and l.owner_name = o_username)
      or (l.owner_name is null and l.created_by_user_id = p_user_id));

  select coalesce(array_agg(v.id), '{}'::uuid[]) into o_view_ids
  from public.list_views v
  where v.workspace_id = o_src
    and ((v.owner_name is not null and v.owner_name = o_username)
      or (v.owner_name is null and v.created_by_user_id = p_user_id));

  select coalesce(array_agg(pl.id), '{}'::uuid[]) into o_phone_ids
  from public.phone_lists pl
  where pl.workspace_id = o_src
    and ((pl.owner_name is not null and pl.owner_name = o_username)
      or (pl.owner_name is null and pl.created_by_user_id = p_user_id));

  select coalesce(array_agg(ol.id), '{}'::uuid[]) into o_organic_ids
  from public.organic_lists ol
  where ol.workspace_id = o_src
    and ((ol.owner_name is not null and ol.owner_name = o_username)
      or (ol.owner_name is null and ol.created_by_user_id = p_user_id));

  -- setting_calls/closing_calls haben KEIN owner_name (docs/data-model.md §2)
  select coalesce(array_agg(sc.id), '{}'::uuid[]) into o_setting_ids
  from public.setting_calls sc
  where sc.workspace_id = o_src and sc.created_by_user_id = p_user_id;

  -- Ein Closing zieht mit, wenn es der Person gehoert ODER an einem
  -- mitziehenden Setting haengt. Sonst blieben Setting und Closing in
  -- verschiedenen Organisationen zurueck.
  select coalesce(array_agg(cc.id), '{}'::uuid[]) into o_closing_ids
  from public.closing_calls cc
  where cc.workspace_id = o_src
    and (cc.created_by_user_id = p_user_id or cc.setting_call_id = any (o_setting_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Vorschau
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
      'followup_templates', (select count(*) from public.followup_templates where user_id = p_user_id)
    ),
    'warnings', v_warnings
  );
end;
$$;

grant execute on function public.preview_move_user (uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Der Umzug
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

  return jsonb_build_object(
    'username', s.o_username,
    'source_workspace_id', s.o_src,
    'target_workspace_id', p_target_workspace_id,
    'moved', v_moved
  );
end;
$$;

grant execute on function public.admin_move_user_to_workspace (uuid, uuid, text, text, boolean, jsonb) to authenticated;

-- Postgres vergibt EXECUTE per Default an PUBLIC. Bei security-definer-
-- Funktionen ist das die falsche Grundeinstellung — deshalb explizit
-- zuruecknehmen und nur 'authenticated' behalten (die Funktionen pruefen
-- zusaetzlich selbst auf is_platform_admin()).
revoke execute on function public.move_user_scope (uuid) from public;
revoke execute on function public.preview_move_user (uuid, uuid) from public;
revoke execute on function public.admin_move_user_to_workspace (uuid, uuid, text, text, boolean, jsonb) from public;
grant execute on function public.move_user_scope (uuid) to authenticated;
