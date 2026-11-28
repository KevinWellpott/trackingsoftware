-- 0051 — Richtwerte je Organisation für die Plattform-Übersicht
--
-- 0001–0050 sind eingespielt bzw. geschrieben; keine Zeile dieser Datei ändert
-- eine davon. Rein additiv: eine Tabelle, RLS, ein Aufräum-Trigger.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WARUM
--
--  `/admin/uebersicht` zeigt Plattform-Admins (Titan) je Organisation, was
--  heute, diese Woche und diesen Monat passiert ist: Anwahlen, LinkedIn-
--  Pitches, Settings, Closings, gelegte Termine. Daneben steht ein Soll aus
--  einem Richtwert PRO ARBEITSTAG je Kennzahl. Diese Richtwerte sind Titans
--  interne Steuerung — die Organisation selbst sieht und ändert sie nicht.
--
--  ENTWURF
--  · Eine Zeile je Organisation, fünf ganze Zahlen pro Arbeitstag. NULL heißt
--    „kein Richtwert“ (die Übersicht zeigt dann nur das Ist), 0 heißt „Soll 0“.
--  · `workspace_id` OHNE Fremdschlüssel (Muster termin_mails/0045): Ein
--    `on delete cascade` auf workspaces müsste in der Löschvorschau stehen
--    (§8-Invariante). Stattdessen räumt ein AFTER-DELETE-Trigger auf
--    `workspaces` die Zeile weg.
--  · RLS: lesen und schreiben NUR Plattform-Admins (`is_platform_admin()`).
--    Kein Mitglied einer Kunden-Organisation sieht die Tabelle.
--  · `updated_by_user_id` ist Audit (wer hat geändert).
--
--  EINSPIELEN: Reihenfolge zum Deploy frei. Ohne die Tabelle zeigt die
--  Übersicht nur das Ist und sagt, dass die Richtwerte fehlen; Speichern
--  meldet „Migration 0051 fehlt“. Ganze Datei, nichts markieren, danach den
--  Verifikationsblock am Ende.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.org_richtwerte (
  workspace_id       uuid primary key,
  anwahlen           integer check (anwahlen is null or anwahlen between 0 and 100000),
  pitches            integer check (pitches is null or pitches between 0 and 100000),
  settings           integer check (settings is null or settings between 0 and 100000),
  closings           integer check (closings is null or closings between 0 and 100000),
  termine            integer check (termine is null or termine between 0 and 100000),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at         timestamptz not null default now()
);

comment on table public.org_richtwerte is
  'Richtwerte pro Arbeitstag je Organisation für /admin/uebersicht (0051). Nur Plattform-Admins. Kein FK auf workspaces — Aufräumen per Trigger.';

alter table public.org_richtwerte enable row level security;

drop policy if exists org_richtwerte_platform_admin on public.org_richtwerte;
create policy org_richtwerte_platform_admin on public.org_richtwerte
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Organisation gelöscht → ihre Richtwerte auch.
create or replace function public.org_richtwerte_aufraeumen()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  delete from public.org_richtwerte where workspace_id = old.id;
  return old;
end;
$function$;

revoke execute on function public.org_richtwerte_aufraeumen() from public, anon, authenticated;

drop trigger if exists workspaces_org_richtwerte_aufraeumen on public.workspaces;
create trigger workspaces_org_richtwerte_aufraeumen
  after delete on public.workspaces
  for each row execute function public.org_richtwerte_aufraeumen();

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFIKATION (nach dem Einspielen einzeln ausführen)
--
--  V1  Tabelle und RLS da — erwartet: 1 Zeile, relrowsecurity = t
--      select relname, relrowsecurity from pg_class where relname = 'org_richtwerte';
--
--  V2  Genau eine Policy — erwartet: org_richtwerte_platform_admin
--      select policyname from pg_policies where tablename = 'org_richtwerte';
--
--  V3  Der Aufräum-Trigger hängt an workspaces — erwartet: 1 Zeile
--      select tgname from pg_trigger where tgname = 'workspaces_org_richtwerte_aufraeumen';
--
--  V4  Die §8-Invariante bleibt grün (kein neuer Cascade-FK auf workspaces) —
--      erwartet: keine Zeile mit org_richtwerte
--      select conrelid::regclass from pg_constraint
--       where confrelid = 'public.workspaces'::regclass and conrelid::regclass::text = 'org_richtwerte';
-- ═══════════════════════════════════════════════════════════════════════════
