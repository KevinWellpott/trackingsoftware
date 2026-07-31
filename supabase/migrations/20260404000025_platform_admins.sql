-- Plattform-Admins: eine Instanz OBERHALB der Organisation.
--
-- Modell: `workspaces` ist die Organisation (= ein Kunde). Ein normaler Nutzer
-- hat genau eine Mitgliedschaft und sieht ausschliesslich seine Organisation.
-- Ein Plattform-Admin (Simon, Kevin) ist Mitglied NUR seiner eigenen Heim-Org,
-- darf aber in jede andere hineinsehen und dort arbeiten.
--
-- LEITPRINZIP: Ein Plattform-Admin wird NIEMALS Mitglied einer Kunden-Org.
-- Sonst taucht er im Team-Dashboard und in der Datensicht-Auswahl des Kunden
-- auf — und der Kunde in unseren Uebersichten. Genau das soll dieser Umbau
-- verhindern. Der Zugriff laeuft deshalb ueber is_platform_admin(), nicht
-- ueber workspace_members.

-- ---------------------------------------------------------------------------
-- 1) Tabelle + Funktion
-- ---------------------------------------------------------------------------

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- WICHTIG: Auf DIESER Tabelle darf niemals is_platform_admin() referenziert
-- werden — das waere die einzige echte Rekursionsquelle des Entwurfs.
-- Lesen: nur die eigene Zeile (damit die App "bin ich Admin?" beantworten
-- kann). Schreiben: gar nicht — Pflege ausschliesslich per service_role bzw.
-- im SQL-Editor. Ein selbst setzbares Admin-Flag waere wertlos.
drop policy if exists "platform_admins_select_self" on public.platform_admins;
create policy "platform_admins_select_self" on public.platform_admins
  for select using (user_id = auth.uid ());

create or replace function public.is_platform_admin ()
returns boolean
language sql
stable            -- parameterlos + stable => der Planner zieht den Aufruf als
                  -- InitPlan aus der Zeilenschleife: einmal pro Query statt
                  -- einmal pro Zeile. Bei `volatile` waere das nicht erlaubt.
security definer  -- noetig, weil platform_admins fuer 'authenticated' faktisch
                  -- gesperrt ist (nur die eigene Zeile ist lesbar).
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid ()
  );
$$;

-- BEWUSST bei PUBLIC belassen (kein revoke): diese Funktion wird INNERHALB
-- der RLS-Policies ausgewertet, und zwar mit den Rechten der abfragenden
-- Rolle. Fehlt einer Rolle das EXECUTE, wirft die Policy-Auswertung
-- "permission denied for function" — statt einfach keine Zeilen zu liefern.
-- Der Sicherheitsgewinn waere ohnehin null: die Funktion verraet nur, ob der
-- AUFRUFER selbst Plattform-Admin ist (fuer anon immer false).
grant execute on function public.is_platform_admin () to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Wächter fuer die verwaiste Spalte profiles.is_super_admin
-- ---------------------------------------------------------------------------
-- Die Spalte existiert in der Produktion, wird von keiner Zeile Code gelesen
-- und ist als Berechtigungsflag unbrauchbar: `profiles_update_own`
-- (20260404000001:59) laesst jeden Nutzer seine eigene Profilzeile aendern.
-- Wir loeschen sie nicht (nicht-destruktiv), sondern frieren sie ein: nur ein
-- Plattform-Admin kann den Wert ueberhaupt noch veraendern. Damit ist sie
-- inert, egal wer sie irgendwann versehentlich auswertet.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'is_super_admin'
  ) then
    create or replace function public.profiles_guard_super_admin ()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      if new.is_super_admin is distinct from old.is_super_admin
         and not public.is_platform_admin () then
        new.is_super_admin := old.is_super_admin;
      end if;
      return new;
    end;
    $fn$;

    drop trigger if exists trg_profiles_guard_super_admin on public.profiles;
    create trigger trg_profiles_guard_super_admin
      before update on public.profiles
      for each row execute function public.profiles_guard_super_admin ();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) RLS: additive Policies statt Eingriff in die can_access_*-Helfer
-- ---------------------------------------------------------------------------
-- Der naheliegende Weg waere ein `or is_platform_admin()` INNERHALB von
-- can_access_owned_workspace_row() & Co. Dagegen sprechen zwei Dinge:
--   (a) Diese Helfer sind security definer und damit nicht inlinebar — sie
--       laufen pro ZEILE. Ein Zusatz dort liefe ebenfalls pro Zeile.
--       Eine eigene permissive Policy mit `(select is_platform_admin())`
--       wird dagegen als InitPlan einmal pro QUERY ausgewertet.
--   (b) Ein Fehler in can_access_owned_workspace_row() legt 9 laufende
--       Policies gleichzeitig lahm. Eine zusaetzliche Policy laesst sich mit
--       `drop policy` zurueckrollen, ohne den Mandantenpfad zu beruehren.
-- Permissive Policies werden OR-verknuepft; der bestehende Mitgliederpfad
-- bleibt also unveraendert bestehen.

do $$
declare t text;
begin
  foreach t in array array[
    'lists', 'pipeline_stages', 'contacts',
    'organic_lists', 'organic_posts',
    'phone_lists', 'phone_leads',
    'setting_calls', 'closing_calls', 'call_assignees', 'csv_imports',
    'performance_targets', 'followup_templates', 'list_views'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_platform_admin', t);
    execute format(
      'create policy %I on public.%I for all
         using ((select public.is_platform_admin ()))
         with check ((select public.is_platform_admin ()))',
      t || '_platform_admin', t
    );
  end loop;
end $$;

-- workspaces: lesen (Org-Umschalter, /admin) und umbenennen.
-- Bewusst KEIN insert: Organisationen entstehen ueber platform_create_workspace().
drop policy if exists "workspaces_platform_admin_select" on public.workspaces;
create policy "workspaces_platform_admin_select" on public.workspaces
  for select using ((select public.is_platform_admin ()));

drop policy if exists "workspaces_platform_admin_update" on public.workspaces;
create policy "workspaces_platform_admin_update" on public.workspaces
  for update using ((select public.is_platform_admin ()))
          with check ((select public.is_platform_admin ()));

-- workspace_members: hier fehlte bis heute JEDE insert- und update-Policy —
-- deshalb laeuft die Nutzerverwaltung ueber den service_role-Client
-- (src/app/actions/workspace.ts). Mit dieser Policy kann /admin ueber den
-- normalen RLS-Pfad arbeiten.
drop policy if exists "wm_platform_admin_all" on public.workspace_members;
create policy "wm_platform_admin_all" on public.workspace_members
  for all using ((select public.is_platform_admin ()))
          with check ((select public.is_platform_admin ()));

-- profiles: der bestehende Self-Join (20260404000001:44) bleibt unangetastet.
-- Dass ein Plattform-Admin alle Profile LESEN darf, leakt nicht in fremde
-- Uebersichten: listDataViewUsers(), /termine, globalSearch() und /team
-- filtern samt und sonders explizit auf workspace_id. Die Org-Grenze in der
-- UI traegt access.workspace_id, nicht RLS.
drop policy if exists "profiles_platform_admin_select" on public.profiles;
create policy "profiles_platform_admin_select" on public.profiles
  for select using ((select public.is_platform_admin ()));

drop policy if exists "profiles_platform_admin_update" on public.profiles;
create policy "profiles_platform_admin_update" on public.profiles
  for update using ((select public.is_platform_admin ()))
          with check ((select public.is_platform_admin ()));

-- ---------------------------------------------------------------------------
-- 4) Ein Hebel fuer alle 8 Metrik-RPCs
-- ---------------------------------------------------------------------------
-- rpc_owner_day_metrics, rpc_owner_week_counts, rpc_appt_rate,
-- rpc_followup_alerts, rpc_phone_owner_metrics, rpc_phone_day_metrics,
-- rpc_phone_list_counts und nachfassen_tasks rufen diese Funktion alle als
-- erste Anweisung auf. Der Plattform-Admin-Zweig hier macht sie damit
-- org-uebergreifend, ohne dass eine einzige RPC angefasst werden muss.
create or replace function public.rpc_effective_user (
  p_workspace_id uuid,
  p_effective_user_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope text;
begin
  -- Plattform-Admins zuerst: sie sind in JEDER Organisation org-weit
  -- unterwegs, unabhaengig von ihrer Heim-Mitgliedschaft. Die
  -- Datensicht-Impersonation funktioniert weiter, weil die App den
  -- gewuenschten Nutzer explizit als p_effective_user_id mitgibt.
  if public.is_platform_admin () then
    return p_effective_user_id;  -- null = org-weit
  end if;

  select wm.data_scope into v_scope
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid ();

  if v_scope is null then
    raise exception 'Not a workspace member';
  end if;

  if v_scope = 'own' then
    return auth.uid ();
  end if;

  return p_effective_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) workspace_id beim INSERT: raten ist ab jetzt verboten
-- ---------------------------------------------------------------------------
-- resolve_workspace_from_auth() kennt nur auth.uid(). Die AKTIVE Organisation
-- eines Plattform-Admins steckt dagegen in einem Cookie, von dem die Datenbank
-- nichts weiss. Jeder Insert ohne explizites workspace_id waehrend der Arbeit
-- in einer Kunden-Org landete also in der Heim-Org des Admins — eine stille
-- Datenverfaelschung, die niemandem auffiele.
--
-- Deshalb: die App setzt workspace_id explizit (src/app/actions/*), und der
-- Trigger wird zum lauten Waechter statt zur stillen Notloesung.
create or replace function public.set_workspace_and_creator ()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is null then
    if public.is_platform_admin () then
      raise exception
        'workspace_id muss beim Insert in % explizit gesetzt werden (Plattform-Admin arbeitet ggf. in einer fremden Organisation)',
        tg_table_name;
    end if;
    new.workspace_id := public.resolve_workspace_from_auth ();
  end if;
  if new.created_by_user_id is null then
    new.created_by_user_id := auth.uid ();
  end if;
  return new;
end;
$$;

create or replace function public.set_workspace_from_auth ()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is null then
    if public.is_platform_admin () then
      raise exception
        'workspace_id muss beim Insert in % explizit gesetzt werden (Plattform-Admin arbeitet ggf. in einer fremden Organisation)',
        tg_table_name;
    end if;
    new.workspace_id := public.resolve_workspace_from_auth ();
  end if;
  return new;
end;
$$;

-- Und kein stilles `limit 1` mehr: haette ein Nutzer je zwei Mitgliedschaften,
-- wuerde die alte Fassung willkuerlich eine Organisation auswaehlen. Jetzt
-- liefert sie NULL, und die not-null-Constraint schlaegt hoerbar zu.
create or replace function public.resolve_workspace_from_auth ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  -- array_agg statt min(): fuer uuid gibt es kein min()-Aggregat.
  select case when count(*) = 1 then (array_agg(wm.workspace_id))[1] end
  from public.workspace_members wm
  where wm.user_id = auth.uid ();
$$;

-- ---------------------------------------------------------------------------
-- 6) Organisation anlegen
-- ---------------------------------------------------------------------------
-- bootstrap_workspace() und join_workspace() (20260404000000:222/246) werfen
-- beide 'Already in a workspace', sobald der Aufrufer irgendeine Mitgliedschaft
-- hat. Ein Plattform-Admin koennte damit keine Kunden-Organisation anlegen.
create or replace function public.platform_create_workspace (p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid;
begin
  if not public.is_platform_admin () then
    raise exception 'Nur Plattform-Admins duerfen Organisationen anlegen';
  end if;

  insert into public.workspaces (name)
  values (coalesce(nullif(trim(p_name), ''), 'Neue Organisation'))
  returning id into wid;

  -- BEWUSST: der Aufrufer wird NICHT Mitglied der neuen Organisation
  -- (siehe Leitprinzip oben).
  return wid;
end;
$$;

revoke execute on function public.platform_create_workspace (text) from public;
grant execute on function public.platform_create_workspace (text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Benutzernamen bleiben global eindeutig
-- ---------------------------------------------------------------------------
-- Die Login-Adresse wird aus dem Benutzernamen abgeleitet
-- (src/lib/internal-email.ts: "<slug>@pitchtracker.internal"), und zwar
-- kleingeschrieben. profiles.username ist zwar unique, aber case-sensitiv —
-- 'kevin' und 'Kevin' kaemen beide durch und ergaeben dieselbe Login-Adresse.
-- Der Index macht daraus einen sauberen DB-Fehler statt eines kryptischen
-- Auth-Fehlers beim Anlegen.
do $$
declare
  v_dupes text;
begin
  select string_agg(d.u, ', ')
    into v_dupes
  from (
    select lower(username) as u
    from public.profiles
    group by lower(username)
    having count(*) > 1
  ) d;

  if v_dupes is not null then
    raise notice 'uq_profiles_username_ci NICHT angelegt — vorhandene Kollisionen: %', v_dupes;
  else
    create unique index if not exists uq_profiles_username_ci
      on public.profiles (lower(username));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8) Toten anon-Zugriff entziehen
-- ---------------------------------------------------------------------------
-- get_email_by_username() ist an 'anon' vergeben (20260404000001:79) und
-- erlaubt damit unauthentifiziertes Durchprobieren von Benutzernamen. Der
-- Login benutzt sie gar nicht — src/app/login/LoginForm.tsx berechnet die
-- Adresse clientseitig ueber usernameToInternalEmail().
revoke execute on function public.get_email_by_username (text) from anon;

-- ---------------------------------------------------------------------------
-- 9) Seed
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  insert into public.platform_admins (user_id, note)
  select p.user_id, 'Gruender'
  from public.profiles p
  where p.username in ('Simon', 'Kevin')
  on conflict (user_id) do nothing;

  select count(*) into v_count from public.platform_admins;
  raise notice 'platform_admins enthaelt jetzt % Eintraege', v_count;

  if v_count = 0 then
    raise warning 'KEIN Plattform-Admin angelegt — stimmen die Benutzernamen (Simon/Kevin) in public.profiles?';
  end if;
end $$;
