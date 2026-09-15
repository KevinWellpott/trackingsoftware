-- 0042 — „Durchgeführt von": wer das Gespräch GEFÜHRT hat
--
-- Die zweite Migration nach dem Rückbau. 0001–0041 sind eingespielt und
-- eingefroren; keine Zeile dieser Datei ändert eine davon. Die beiden
-- RLS-Policies unten werden unter demselben Namen ERSETZT — dasselbe Vorgehen
-- wie in 0028, das sie zuletzt geschrieben hat.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WARUM
--
--  Bis hierher trug `assigned_user_id` drei Aufgaben zugleich: in wessen
--  Arbeitsliste ein Termin steht (wer erinnert und nervt), wem die Analyse ihn
--  zurechnet, und bei Closings, wer ihn führt. Mit mehreren Settern fallen die
--  drei auseinander. Wörtlich:
--
--    „Wenn ich einen Termin lege, muss ich ihn an den Termin erinnern. Wenn er
--     nicht erscheint, muss weiterhin ich ihn nerven. Aber wenn Kevin das
--     Closing gemacht hätte, würde er die Zuweisung [bekommen]. Wir brauchen
--     ein neues Feld, das immer leer ist, wo wir eintragen, wer den Termin
--     gemacht hat."
--
--  Die Zuweisung bleibt „wer erinnert". Neu ist die Person, die das Gespräch
--  geführt hat. Sie zählt in der Analyse (Termine, Umsatz, Quoten) und bekommt
--  einen erschienenen Lead ohne Ergebnis in ihre Arbeitsliste — No-Show und
--  „Nicht qualifiziert" bleiben beim, der den Termin gelegt hat. Die Regeln
--  stehen in src/lib/personResolution.ts (`erinnererOf`, `gespraechsPersonOf`).
-- ═══════════════════════════════════════════════════════════════════════════
--
--  WAS
--
--   1. `conducted_by_user_id` auf `setting_calls` und `closing_calls` — uuid,
--      nullable, OHNE Default, OHNE Backfill: „immer leer, wir tragen ein".
--      Ein Default oder ein Backfill aus `assigned_user_id` behauptete für den
--      ganzen Bestand eine Durchführung, die niemand eingetragen hat.
--      `on delete set null` wie jede Personen-Spalte (Muster 0041).
--   2. Ein Guard, der eine Durchführung über die Org-Grenze NULLT — beim
--      INSERT, beim Setzen der Spalte und beim Org-Umzug. Dieselbe Bauart wie
--      `assigned_user_guard` (0028/0040), als eigene Funktion für die neue
--      Spalte; die alte bleibt unangetastet.
--   3. Die Policies `setting_calls_scoped_member` / `closing_calls_scoped_member`
--      bekommen einen dritten Zweig: Wer ein Gespräch geführt hat, sieht es auch
--      mit `data_scope='own'`. Ohne ihn stünde ein erschienener Lead in der
--      Arbeitsliste eines Closers, der die Zeile gar nicht laden darf.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WANN EINSPIELEN — VOR dem Deploy des zugehörigen Codes.
--
--   * Zu spät zerbricht etwas: Der Analyse-Bereich selektiert die Spalte
--     NAMENTLICH (src/lib/analyseData.ts, Muster 0029/0032). Fehlt sie, weist
--     PostgREST die ganze Abfrage ab, und die Analyse ist leer statt
--     unvollständig. Dasselbe gilt für /termine bei aktiver Datensicht — der
--     Personenfilter nennt die Spalte.
--   * Zu früh ist folgenlos: Die heute laufende App liest und schreibt die
--     Spalte nicht; ein `select *` bekommt eine Spalte mehr, die überall NULL
--     ist. Der zusätzliche Policy-Zweig greift nie, solange die Spalte leer ist.
--
--  Die Supabase-Konsole führt bei markiertem Text nur die Markierung aus und
--  hinterlässt Halbzustände ohne Fehlermeldung (docs §7): NICHTS markieren,
--  „Run" auf die ganze Datei, danach den Verifikationsblock am Ende fahren.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WIEDERHOLBAR: `add column if not exists`, `comment on column`,
-- `create or replace function`, `drop … if exists` + `create`. Kein Backfill,
-- keine Datenbewegung, keine Zeile wird umgedeutet.

begin;

-- ===========================================================================
-- 1) Die Spalte
-- ===========================================================================

alter table public.setting_calls
  add column if not exists conducted_by_user_id uuid references auth.users (id) on delete set null;

alter table public.closing_calls
  add column if not exists conducted_by_user_id uuid references auth.users (id) on delete set null;

comment on column public.setting_calls.conducted_by_user_id is
  'Durchgeführt von (0042): wer das Erstgespräch geführt hat. Leer, bis es jemand einträgt. '
  'Zählt in der Analyse vor assigned_user_id. Wer erinnert und nervt, bleibt assigned_user_id '
  '— außer bei einem erschienenen Lead ohne Ergebnis, der geht an diese Person.';

comment on column public.closing_calls.conducted_by_user_id is
  'Durchgeführt von (0042): wer das Closing geführt hat. Leer, bis es jemand einträgt. '
  'Zählt in der Analyse vor assigned_user_id (Umsatz, Abschlussrate). Wer erinnert und nervt, '
  'bleibt assigned_user_id — außer bei einem erschienenen Lead ohne Ergebnis.';

-- ===========================================================================
-- 2) Der Guard — keine Durchführung über die Org-Grenze
-- ===========================================================================
--
-- Die App prüft die Mitgliedschaft selbst (`setConductedBy`,
-- src/app/actions/assignees.ts). Der Guard deckt den direkten POST/PATCH auf
-- PostgREST und den Nutzer-Umzug ab — dieselbe Lücke, die 0040 für
-- `assigned_user_id` geschlossen hat. Er nullt statt zu werfen: Eine
-- Durchführung durch jemanden, der nicht (mehr) zur Organisation gehört, ist
-- in den Kundendaten unauffindbar, und die Analyse fällt dann auf die
-- Zuweisung zurück.

create or replace function public.conducted_by_guard ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.conducted_by_user_id is not null
     and not exists (
       select 1
         from public.workspace_members wm
        where wm.user_id = new.conducted_by_user_id
          and wm.workspace_id = new.workspace_id
     ) then
    new.conducted_by_user_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists setting_calls_conducted_guard on public.setting_calls;
create trigger setting_calls_conducted_guard
  before insert or update of workspace_id, conducted_by_user_id on public.setting_calls
  for each row execute function public.conducted_by_guard ();

drop trigger if exists closing_calls_conducted_guard on public.closing_calls;
create trigger closing_calls_conducted_guard
  before insert or update of workspace_id, conducted_by_user_id on public.closing_calls
  for each row execute function public.conducted_by_guard ();

-- ===========================================================================
-- 3) RLS — wer das Gespräch geführt hat, sieht es
-- ===========================================================================
--
-- Wortgleich die beiden Zweige aus 0028, dazu der dritte. Die Helfer-Funktion
-- verträgt NULL in der Personen-Spalte (bei `assigned_user_id` ist das seit
-- 0028 der Normalfall für Altbestände).

drop policy if exists "setting_calls_scoped_member" on public.setting_calls;
create policy "setting_calls_scoped_member" on public.setting_calls
  for all using (
        public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.created_by_user_id)
     or public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.assigned_user_id)
     or public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.conducted_by_user_id)
  )
  with check (
        public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.created_by_user_id)
     or public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.assigned_user_id)
     or public.can_access_owned_workspace_row(setting_calls.workspace_id, setting_calls.conducted_by_user_id)
  );

drop policy if exists "closing_calls_scoped_member" on public.closing_calls;
create policy "closing_calls_scoped_member" on public.closing_calls
  for all using (
        public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.created_by_user_id)
     or public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.assigned_user_id)
     or public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.conducted_by_user_id)
  )
  with check (
        public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.created_by_user_id)
     or public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.assigned_user_id)
     or public.can_access_owned_workspace_row(closing_calls.workspace_id, closing_calls.conducted_by_user_id)
  );

-- Neue Spalte, Trigger und Policies sofort über PostgREST sichtbar machen.
notify pgrst, 'reload schema';

commit;

-- ===========================================================================
-- VERIFIKATION — nach dem Einspielen im SQL-Editor ausführen
-- ===========================================================================
--
-- A1) Die Spalte steht auf beiden Tabellen. Muss GENAU 2 Zeilen liefern, je
--     `uuid` / `YES`:
--
--       select table_name, data_type, is_nullable
--         from information_schema.columns
--        where table_schema = 'public'
--          and table_name in ('setting_calls', 'closing_calls')
--          and column_name = 'conducted_by_user_id';
--
-- A2) Beide Guards hängen. Muss GENAU 2 Zeilen liefern:
--
--       select tgname from pg_trigger
--        where not tgisinternal
--          and tgname in ('setting_calls_conducted_guard', 'closing_calls_conducted_guard');
--
-- A3) Beide Policies tragen den dritten Zweig — in USING UND in WITH CHECK.
--     Muss GENAU 2 Zeilen liefern. Weniger heißt: Die Datei lief nur zum Teil
--     (markierter Text im Editor), und ein Closer mit `data_scope='own'` sieht
--     seine geführten Gespräche nicht.
--
--       select policyname from pg_policies
--        where schemaname = 'public'
--          and policyname in ('setting_calls_scoped_member', 'closing_calls_scoped_member')
--          and qual like '%conducted_by_user_id%'
--          and with_check like '%conducted_by_user_id%';
--
-- A4) Die Spalte ist leer — kein Backfill. Muss 0 und 0 liefern:
--
--       select (select count(*) from setting_calls where conducted_by_user_id is not null) as setting,
--              (select count(*) from closing_calls where conducted_by_user_id is not null) as closing;
--
-- B) Dauerhaft (docs §8): Eine Durchführung zeigt nur auf Mitglieder DERSELBEN
--    Organisation. Muss 0 liefern — ein Treffer heißt, beim Nutzer-Umzug ist
--    eine Zeile ZURÜCKGEBLIEBEN (den Guard lösen nur Zeilen aus, die
--    mitziehen):
--
--       select count(*) from setting_calls sc
--        where sc.conducted_by_user_id is not null
--          and not exists (select 1 from workspace_members wm
--                           where wm.user_id = sc.conducted_by_user_id
--                             and wm.workspace_id = sc.workspace_id);
--       (identisch für closing_calls)
