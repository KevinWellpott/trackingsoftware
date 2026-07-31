-- Organisation loeschen.
--
-- ACHTUNG, das ist die destruktivste Operation der ganzen App: JEDE Tabelle
-- mit workspace_id haengt per `on delete cascade` an public.workspaces
-- (14 Fremdschluessel, siehe 20260404000000/0005/0008/0011/0023). Ein
-- schlichtes `delete from workspaces` loescht damit stillschweigend saemtliche
-- Listen, Kontakte, Telefon-Leads, Termine, Ziele und Vorlagen dieser
-- Organisation mit. Es gibt kein Undo.
--
-- Deshalb drei Sicherungen:
--   1. Eine Organisation MIT Mitgliedern laesst sich gar nicht loeschen. Der
--      Admin muss die Leute vorher verschieben oder loeschen — beide Wege gibt
--      es in /admin. Sonst entstuenden verwaiste Accounts: die Mitgliedschaft
--      kaskadiert weg, der Login bliebe bestehen, und der Nutzer landete beim
--      naechsten Aufruf auf /onboarding.
--   2. Die eigene Organisation ist nie loeschbar.
--   3. p_expected muss den Zahlen der Vorschau entsprechen — sonst loescht
--      man etwas anderes, als man bestaetigt hat.

-- ---------------------------------------------------------------------------
-- 1) Vorschau: was genau wuerde verschwinden?
-- ---------------------------------------------------------------------------
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
      'followup_templates', (select count(*) from public.followup_templates where workspace_id = p_workspace_id)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Loeschen
-- ---------------------------------------------------------------------------
create or replace function public.platform_delete_workspace (
  p_workspace_id uuid,
  p_expected jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_preview jsonb;
  v_member_count int;
  v_members text;
begin
  if not public.is_platform_admin () then
    raise exception 'Nur Plattform-Admins duerfen Organisationen loeschen';
  end if;

  v_preview := public.preview_delete_workspace (p_workspace_id);

  -- Sicherung 2: nie die eigene Organisation. Ein Plattform-Admin ist in
  -- Kunden-Organisationen ohnehin kein Mitglied, das trifft also genau die
  -- Heim-Organisation.
  if exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid ()
  ) then
    raise exception 'Die eigene Organisation kann nicht geloescht werden';
  end if;

  -- Sicherung 1: keine Mitglieder mehr.
  select jsonb_array_length(v_preview -> 'members') into v_member_count;
  if v_member_count > 0 then
    select string_agg(value #>> '{}', ', ') into v_members
    from jsonb_array_elements(v_preview -> 'members');
    raise exception
      'Organisation "%" hat noch % Mitglied(er) (%). Verschiebe oder loesche sie zuerst.',
      v_preview ->> 'workspace', v_member_count, v_members;
  end if;

  -- Sicherung 3: die Vorschau muss noch stimmen.
  if p_expected is not null and (v_preview -> 'counts') is distinct from p_expected then
    raise exception
      'Datenbestand hat sich seit der Vorschau geaendert (erwartet %, tatsaechlich %) — bitte erneut pruefen',
      p_expected, v_preview -> 'counts';
  end if;

  -- Ab hier raeumt `on delete cascade` alles ab.
  delete from public.workspaces where id = p_workspace_id;

  return v_preview;
end;
$$;

revoke execute on function public.preview_delete_workspace (uuid) from public;
revoke execute on function public.platform_delete_workspace (uuid, jsonb) from public;
grant execute on function public.preview_delete_workspace (uuid) to authenticated;
grant execute on function public.platform_delete_workspace (uuid, jsonb) to authenticated;
