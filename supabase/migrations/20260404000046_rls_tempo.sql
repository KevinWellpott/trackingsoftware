-- 0046 — Zeilensicherheit ohne Funktionsaufruf je Zeile
--
-- 0001–0045 sind geschrieben; keine Zeile dieser Datei ändert eine davon.
-- Neu sind drei Hilfsfunktionen; ersetzt werden die `*_scoped_member`-
-- Policies der neun Tabellen, die bei jedem Seitenaufruf gelesen werden, und
-- vier Policies, die `auth.uid()` je Zeile neu auswerten.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WARUM
--
--  Die Policies rufen eine SECURITY-DEFINER-Funktion mit einer Spalte der
--  Zeile als Argument auf, z. B. `can_access_pitch_list(list_id)`. Postgres
--  kann eine solche Funktion nicht inlinen und wertet sie deshalb für JEDE
--  Zeile neu aus — jedes Mal ein Join über `lists` und `workspace_members`.
--  Gemessen am 18. Oktober 2026 in der Haupt-Organisation (6962 Kontakte),
--  identische Ergebnismenge:
--
--    alte Policy   `can_access_pitch_list(list_id)`               290 ms
--    neue Policy   `list_id in (select <erlaubte Listen-IDs>)`      6 ms
--
--  Die neue Form ist eine unkorrelierte Unterabfrage: Postgres rechnet die
--  erlaubten IDs EINMAL je Abfrage aus (hashed SubPlan) und vergleicht danach
--  nur noch. Dasselbe Muster gilt für `phone_leads` (Join über `phone_lists`
--  je Zeile — daher 1,5 Mio. Seq-Scans auf `phone_lists`) und für die
--  Termin-Tabellen, die je Zeile DREI Funktionsaufrufe hatten.
--  `workspace_members` stand mit 14,9 Mio. Seq-Scans in der Statistik.
--
--  Der Supabase-Linter meldet dazu `auth_rls_initplan` (12×). Vier davon
--  liegen auf Tabellen, die jede Anfrage im Zugriffskontext liest
--  (`workspaces`, `workspace_members`, `profiles`, `pipeline_settings`); sie
--  bekommen hier `(select auth.uid())` statt `auth.uid()`. Die übrigen acht
--  liegen auf selten gelesenen oder eingefrorenen Tabellen und bleiben.
-- ═══════════════════════════════════════════════════════════════════════════
--
--  WAS SICH AN DER BERECHTIGUNG ÄNDERT: NICHTS.
--
--  Jede neue Bedingung ist die wörtliche Umformung der alten:
--
--    can_access_owned_workspace_row(ws, x)
--      = es gibt eine Mitgliedschaft (ws, ich) mit
--          data_scope = 'workspace'  ODER  (data_scope = 'own' UND x = ich)
--      = ws ∈ meine 'workspace'-Organisationen
--        ODER (x = ich UND ws ∈ meine 'own'-Organisationen)
--
--    can_access_pitch_list(l) / can_access_phone_list(l)
--      = l ∈ { Listen meiner Organisationen, bei 'own' nur die eigenen }
--
--  `data_scope` ist `not null` mit CHECK auf genau diese zwei Werte (0006),
--  ein dritter Fall existiert nicht. NULL-Spalten verhalten sich gleich: Eine
--  NULL-Liste oder NULL-Person trifft weder die alte noch die neue Bedingung.
--  Vor dem Schreiben dieser Datei wurde die Gleichheit auf der Produktions-
--  Datenbank für JEDES Mitglied und jeden Plattform-Admin auf contacts,
--  phone_leads, setting_calls, closing_calls und phone_call_attempts
--  nachgerechnet (alte Funktion vs. neue Unterabfrage, gleiche JWT-Claims):
--  in allen Fällen identische Zeilenzahlen. Der Verifikationsblock am Ende
--  wiederholt genau diese Probe nach dem Einspielen.
--
--  Die alten Funktionen (`can_access_pitch_list`, `can_access_phone_list`,
--  `can_access_owned_workspace_row`) bleiben unverändert stehen — RPCs und
--  andere Policies benutzen sie weiter, und der Verifikationsblock braucht
--  sie als Referenz.
--
--  Die `*_platform_admin`-Policies bleiben unangetastet; sie sind bereits in
--  der InitPlan-Form `(select is_platform_admin())`.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WANN EINSPIELEN: jederzeit, unabhängig vom Deploy. Die App merkt nichts
--  außer der Geschwindigkeit. Wiederholbar: `create or replace` auf drei neue
--  Funktionen, `drop policy if exists` + `create policy` unter denselben
--  Namen. Alles in EINER Transaktion — ein Abbruch lässt die alten Policies
--  stehen. Wie immer: nichts im Editor markieren, „Run" auf die ganze Datei,
--  danach den Verifikationsblock am Dateiende fahren.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── Hilfsfunktionen ────────────────────────────────────────────────────────
-- SECURITY DEFINER aus demselben Grund wie die alten Helfer: Sie lesen
-- `workspace_members`, `lists` und `phone_lists` an deren eigener RLS vorbei,
-- sonst entstünde eine Rekursion (die Policy auf `lists` fragte `lists`).
-- Sie liefern ausschließlich, was dem Aufrufer selbst zusteht; für `anon`
-- (auth.uid() ist NULL) liefern sie nichts.

create or replace function public.rls_workspace_ids(p_scope text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select wm.workspace_id
  from public.workspace_members wm
  where wm.user_id = auth.uid()
    and wm.data_scope = p_scope;
$$;

create or replace function public.rls_pitch_list_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from public.lists l
  join public.workspace_members wm on wm.workspace_id = l.workspace_id
  where wm.user_id = auth.uid()
    and (
      wm.data_scope = 'workspace'
      or (wm.data_scope = 'own' and l.created_by_user_id = auth.uid())
    );
$$;

create or replace function public.rls_phone_list_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from public.phone_lists l
  join public.workspace_members wm on wm.workspace_id = l.workspace_id
  where wm.user_id = auth.uid()
    and (
      wm.data_scope = 'workspace'
      or (wm.data_scope = 'own' and l.created_by_user_id = auth.uid())
    );
$$;

grant execute on function public.rls_workspace_ids(text) to authenticated;
grant execute on function public.rls_pitch_list_ids() to authenticated;
grant execute on function public.rls_phone_list_ids() to authenticated;

-- ── Listen-gebundene Tabellen ──────────────────────────────────────────────

drop policy if exists "contacts_scoped_member" on public.contacts;
create policy "contacts_scoped_member" on public.contacts
  for all
  using (list_id in (select public.rls_pitch_list_ids()))
  with check (list_id in (select public.rls_pitch_list_ids()));

drop policy if exists "stages_scoped_member" on public.pipeline_stages;
create policy "stages_scoped_member" on public.pipeline_stages
  for all
  using (list_id in (select public.rls_pitch_list_ids()))
  with check (list_id in (select public.rls_pitch_list_ids()));

drop policy if exists "phone_leads_scoped_member" on public.phone_leads;
create policy "phone_leads_scoped_member" on public.phone_leads
  for all
  using (list_id in (select public.rls_phone_list_ids()))
  with check (list_id in (select public.rls_phone_list_ids()));

-- ── Besitz-gebundene Tabellen (Ersteller) ──────────────────────────────────

drop policy if exists "lists_scoped_member" on public.lists;
create policy "lists_scoped_member" on public.lists
  for all
  using (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or (created_by_user_id = (select auth.uid())
        and workspace_id in (select public.rls_workspace_ids('own')))
  )
  with check (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or (created_by_user_id = (select auth.uid())
        and workspace_id in (select public.rls_workspace_ids('own')))
  );

drop policy if exists "phone_lists_scoped_member" on public.phone_lists;
create policy "phone_lists_scoped_member" on public.phone_lists
  for all
  using (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or (created_by_user_id = (select auth.uid())
        and workspace_id in (select public.rls_workspace_ids('own')))
  )
  with check (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or (created_by_user_id = (select auth.uid())
        and workspace_id in (select public.rls_workspace_ids('own')))
  );

drop policy if exists "list_views_scoped_member" on public.list_views;
create policy "list_views_scoped_member" on public.list_views
  for all
  using (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or (created_by_user_id = (select auth.uid())
        and workspace_id in (select public.rls_workspace_ids('own')))
  )
  with check (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or (created_by_user_id = (select auth.uid())
        and workspace_id in (select public.rls_workspace_ids('own')))
  );

-- ── Termine: drei Personenspalten (0028 Zuweisung, 0042 Durchgeführt von) ──
-- `ich in (a, b, c)` ist `ich = a or ich = b or ich = c`; eine NULL-Spalte
-- trifft dabei nie — genau wie `can_access_owned_workspace_row(ws, NULL)`.

drop policy if exists "setting_calls_scoped_member" on public.setting_calls;
create policy "setting_calls_scoped_member" on public.setting_calls
  for all
  using (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or ((select auth.uid()) in (created_by_user_id, assigned_user_id, conducted_by_user_id)
        and workspace_id in (select public.rls_workspace_ids('own')))
  )
  with check (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or ((select auth.uid()) in (created_by_user_id, assigned_user_id, conducted_by_user_id)
        and workspace_id in (select public.rls_workspace_ids('own')))
  );

drop policy if exists "closing_calls_scoped_member" on public.closing_calls;
create policy "closing_calls_scoped_member" on public.closing_calls
  for all
  using (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or ((select auth.uid()) in (created_by_user_id, assigned_user_id, conducted_by_user_id)
        and workspace_id in (select public.rls_workspace_ids('own')))
  )
  with check (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or ((select auth.uid()) in (created_by_user_id, assigned_user_id, conducted_by_user_id)
        and workspace_id in (select public.rls_workspace_ids('own')))
  );

-- ── Anruf-Log: Ersteller ODER Zugriff auf die (Snapshot-)Liste ─────────────

drop policy if exists "phone_call_attempts_scoped_member" on public.phone_call_attempts;
create policy "phone_call_attempts_scoped_member" on public.phone_call_attempts
  for all
  using (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or (created_by_user_id = (select auth.uid())
        and workspace_id in (select public.rls_workspace_ids('own')))
    or (list_id is not null and list_id in (select public.rls_phone_list_ids()))
  )
  with check (
    workspace_id in (select public.rls_workspace_ids('workspace'))
    or (created_by_user_id = (select auth.uid())
        and workspace_id in (select public.rls_workspace_ids('own')))
    or (list_id is not null and list_id in (select public.rls_phone_list_ids()))
  );

-- ── auth.uid() einmal je Abfrage statt je Zeile (Linter auth_rls_initplan) ─
-- Wortgleich mit den bestehenden Policies, nur `auth.uid()` →
-- `(select auth.uid())`. Rollen und Befehle unverändert.

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member" on public.workspaces
  for select
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id and wm.user_id = (select auth.uid())
  ));

drop policy if exists "wm_select_member" on public.workspace_members;
create policy "wm_select_member" on public.workspace_members
  for select
  using (user_id = (select auth.uid()));

drop policy if exists "profiles_select_workspace_member" on public.profiles;
create policy "profiles_select_workspace_member" on public.profiles
  for select
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.workspace_members wm1
      join public.workspace_members wm2 on wm1.workspace_id = wm2.workspace_id
      where wm1.user_id = (select auth.uid()) and wm2.user_id = profiles.user_id
    )
  );

drop policy if exists "pipeline_settings_select" on public.pipeline_settings;
create policy "pipeline_settings_select" on public.pipeline_settings
  for select
  to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = pipeline_settings.workspace_id
      and wm.user_id = (select auth.uid())
  ));

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFIKATION — nach dem Einspielen als eigener Lauf.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- (A) Alle 13 Policies stehen in der neuen Form. Erwartet: 13 Zeilen, keine
--     davon mit `can_access_` im Ausdruck.
--
--   select tablename, policyname, qual
--     from pg_policies
--    where schemaname = 'public'
--      and policyname in ('contacts_scoped_member','stages_scoped_member',
--        'phone_leads_scoped_member','lists_scoped_member',
--        'phone_lists_scoped_member','list_views_scoped_member',
--        'setting_calls_scoped_member','closing_calls_scoped_member',
--        'phone_call_attempts_scoped_member','workspaces_select_member',
--        'wm_select_member','profiles_select_workspace_member',
--        'pipeline_settings_select')
--    order by 1;
--
-- (B) Gleichheit je Nutzer: Für jedes Mitglied und jeden Plattform-Admin wird
--     die alte Prüffunktion gegen die neue Policy-Bedingung gerechnet. Der
--     Block wirft IMMER — die Meldung ist das Ergebnis. Erwartet:
--     „ERGEBNIS: alle identisch". Jede andere Meldung nennt Tabelle, Nutzer
--     und beide Zahlen; dann sofort die alten Policies aus 0028/0042
--     zurückspielen.
--
--   do $$
--   declare r record; msg text := ''; a bigint; b bigint;
--   begin
--     for r in select distinct user_id from public.workspace_members
--              union select user_id from public.platform_admins loop
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
--       select count(*) filter (where public.can_access_pitch_list(list_id)),
--              count(*) filter (where list_id in (select public.rls_pitch_list_ids()))
--         into a, b from public.contacts;
--       if a <> b then msg := msg || format('contacts %s: %s/%s; ', r.user_id, a, b); end if;
--       select count(*) filter (where public.can_access_phone_list(list_id)),
--              count(*) filter (where list_id in (select public.rls_phone_list_ids()))
--         into a, b from public.phone_leads;
--       if a <> b then msg := msg || format('phone_leads %s: %s/%s; ', r.user_id, a, b); end if;
--       select count(*) filter (where public.can_access_owned_workspace_row(workspace_id, created_by_user_id)
--                                  or public.can_access_owned_workspace_row(workspace_id, assigned_user_id)
--                                  or public.can_access_owned_workspace_row(workspace_id, conducted_by_user_id)),
--              count(*) filter (where workspace_id in (select public.rls_workspace_ids('workspace'))
--                                  or ((select auth.uid()) in (created_by_user_id, assigned_user_id, conducted_by_user_id)
--                                      and workspace_id in (select public.rls_workspace_ids('own'))))
--         into a, b from public.setting_calls;
--       if a <> b then msg := msg || format('setting_calls %s: %s/%s; ', r.user_id, a, b); end if;
--       select count(*) filter (where public.can_access_owned_workspace_row(workspace_id, created_by_user_id)
--                                  or public.can_access_owned_workspace_row(workspace_id, assigned_user_id)
--                                  or public.can_access_owned_workspace_row(workspace_id, conducted_by_user_id)),
--              count(*) filter (where workspace_id in (select public.rls_workspace_ids('workspace'))
--                                  or ((select auth.uid()) in (created_by_user_id, assigned_user_id, conducted_by_user_id)
--                                      and workspace_id in (select public.rls_workspace_ids('own'))))
--         into a, b from public.closing_calls;
--       if a <> b then msg := msg || format('closing_calls %s: %s/%s; ', r.user_id, a, b); end if;
--       select count(*) filter (where public.can_access_owned_workspace_row(workspace_id, created_by_user_id)),
--              count(*) filter (where workspace_id in (select public.rls_workspace_ids('workspace'))
--                                  or (created_by_user_id = (select auth.uid())
--                                      and workspace_id in (select public.rls_workspace_ids('own'))))
--         into a, b from public.lists;
--       if a <> b then msg := msg || format('lists %s: %s/%s; ', r.user_id, a, b); end if;
--       select count(*) filter (where public.can_access_owned_workspace_row(workspace_id, created_by_user_id)
--                                  or (list_id is not null and public.can_access_phone_list(list_id))),
--              count(*) filter (where workspace_id in (select public.rls_workspace_ids('workspace'))
--                                  or (created_by_user_id = (select auth.uid())
--                                      and workspace_id in (select public.rls_workspace_ids('own')))
--                                  or (list_id is not null and list_id in (select public.rls_phone_list_ids())))
--         into a, b from public.phone_call_attempts;
--       if a <> b then msg := msg || format('phone_call_attempts %s: %s/%s; ', r.user_id, a, b); end if;
--     end loop;
--     raise exception 'ERGEBNIS: %', coalesce(nullif(msg, ''), 'alle identisch');
--   end $$;
--
-- (C) Wirkung: Der Linter (Advisors → Performance) meldet danach
--     `auth_rls_initplan` nur noch für die acht bewusst nicht angefassten
--     Policies (cascade_steps, message_templates, platform_admins,
--     profiles_insert_own/_update_own, wm_delete_owner_or_self,
--     workspaces_update_owner).
