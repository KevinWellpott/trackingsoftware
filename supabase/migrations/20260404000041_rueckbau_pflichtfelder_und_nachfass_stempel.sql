-- 0041 — Rückbau: die drei Pflichtfeld-Trigger fallen, der Nachfass-Stempel kommt
--
-- Die erste Migration NACH 0031-0040. Alles davor ist eingespielt und
-- eingefroren; keine Zeile dieser Datei fasst eine der zehn an.
--
-- Diese Datei begleitet den Rückbau des Nachfass-Systems: Kaskaden, Stufen,
-- Vorlagen und Grund-Codes verschwinden aus der Oberfläche, übrig bleibt EINE
-- Arbeitsliste je Person. Die Tabellen bleiben dabei stehen — Muster
-- `call_assignees` und `followup_templates` (docs §3): Was fällt, ist der Code,
-- der sie liest, nicht die Zeile, die schon dasteht. Genau zwei Dinge muss die
-- Datenbank dafür tun, und beide stehen hier.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WANN EINSPIELEN
--
--  TEIL 1 (drei Trigger entfernen) — VOR dem Deploy der neuen Oberfläche.
--  Das ist die gefährlichste Stelle des ganzen Rückbaus, und sie ist
--  einseitig: Zu früh kostet nichts, zu spät zerbricht alles.
--
--    * Zu früh ist folgenlos. Die HEUTE produktive App schickt die Grundcodes
--      ohnehin mit (`cancelAppointment` schreibt `cancelled_at` und
--      `cancel_reason_code` in einem Statement, `setSettingOutcome` Status und
--      Disqualifikationsgrund ebenso, docs §4). Ein entfernter Trigger nimmt
--      ihr also nichts weg, was sie tut — er hört nur auf, etwas zu verlangen,
--      das sie freiwillig liefert.
--    * Zu spät zerbricht die neue Oberfläche sofort und für alle. Sobald sie
--      aufhört, Grundcodes mitzuschicken — genau das bedeutet „keine
--      Reason-Codes" —, wirft die Datenbank bei JEDER Absage und JEDER
--      Disqualifizierung eine Exception. Nicht schleichend, nicht bei einem
--      Sonderfall: beim nächsten Klick, bei jedem Nutzer.
--
--  TEIL 2 (zwei Spalten je Termin-Tabelle) — jederzeit, auch lange vorher.
--  Rein additiv, beide Spalten nullable ohne Default. Kein bestehender
--  Schreibpfad kennt sie, keine Abfrage liest sie, bis die neue Oberfläche da
--  ist; ein `select *` bekommt zwei Spalten mehr, die überall NULL sind.
--
--  DARAUS FOLGT: Die ganze Datei darf beliebig früh laufen, muss aber
--  spätestens unmittelbar VOR dem Deploy gelaufen sein. Die beiden Teile
--  stehen in dieser Reihenfolge und nicht umgekehrt, damit ein Abbruch im
--  harmlosen Teil 2 den dringenden Teil 1 nicht mit sich zieht — die
--  Supabase-Konsole führt bei markiertem Text nur die Markierung aus und
--  hinterlässt Halbzustände (docs §7).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WIEDERHOLBAR: drei `drop trigger if exists`, zwei Kommentare hinter einer
-- Existenzprüfung, `add column if not exists`, `comment on column`. Kein
-- `drop function`, kein Backfill, keine Datenbewegung, keine Zeile wird
-- umgedeutet. Die Datei ist beliebig oft ausführbar.

-- ===========================================================================
-- TEIL 1 — Die drei Pflichtfeld-Trigger aus 0035
-- ===========================================================================
--
-- 0035 hat zwei Regeln in die Datenbank gezogen, die vorher nur die Oberfläche
-- einhielt: Eine Absage braucht einen `cancel_reason_code`, ein Erstgespräch
-- mit `status='unqualifiziert'` einen `disqualify_reason_code`. Das war
-- richtig, solange die Codes das Rückgrat der Auswertung waren — „Code ist
-- Statistik, Freitext ist Gedächtnis" (docs §4).
--
-- Diese Grundlage entfällt mit dem Rückbau. Die neue Arbeitsliste kennt drei
-- Zustände (offen · verlegt · tot) und keinen Grundkatalog; „tot" fällt auf den
-- vorhandenen Wert `dead`. Ein Pflichtfeld, das kein Formular mehr anbietet,
-- ist kein Qualitätsanspruch mehr, sondern eine Sperre gegen die eigene App.
--
-- WAS DAMIT AUSDRÜCKLICH AUFHÖRT — das ist eine Entscheidung, kein Nebenschaden:
--   * Neue Absagen und Disqualifizierungen dürfen wieder ohne Grund entstehen.
--   * Die drei Nachpflege-Zählungen in docs §8 („Zwei Nachpflege-Zählungen, die
--     (noch) NICHT null sein müssen") dürfen ab jetzt wieder wachsen. Sie
--     zählen keinen Defekt mehr, sondern nur noch, wie oft niemand einen Grund
--     angegeben hat.
--   * Die Einspiel-Kontrolle in docs §8, die „genau 3" Pflichtfeld-Trigger
--     erwartet, erwartet ab jetzt 0. Die Doku zieht das außerhalb dieser Datei
--     nach; die Verifikation unten (A1) ist die maßgebliche Fassung.
--
-- Die Bestandszeilen MIT Grund behalten ihn. Kein `update`, kein Nullen: Ein
-- Grund, der einmal erfasst wurde, ist erhobene Information, und sie zu
-- verwerfen wäre teurer als sie stehenzulassen — dieselbe Linie, aus der die
-- Tabellen stehen bleiben statt zu fallen.

drop trigger if exists setting_calls_require_cancel_reason on public.setting_calls;
drop trigger if exists closing_calls_require_cancel_reason on public.closing_calls;
drop trigger if exists setting_calls_require_disqualify_reason on public.setting_calls;

-- ---------------------------------------------------------------------------
-- ENTSCHEIDUNG: die beiden Triggerfunktionen BLEIBEN STEHEN
-- ---------------------------------------------------------------------------
-- `require_cancel_reason()` und `require_disqualify_reason()` haben ab hier
-- keinen Aufrufer mehr. Sie werden trotzdem nicht gelöscht — aus drei Gründen,
-- von denen der dritte der eigentliche ist:
--
--  1. Eine Funktion ohne Trigger ist inert. Sie ist `returns trigger`, lässt
--     sich also gar nicht anders aufrufen als aus einem Trigger heraus; ohne
--     einen solchen kann sie nichts tun. Stehenlassen kostet nichts außer einer
--     Zeile in `pg_proc`.
--  2. Es ist das Muster des ganzen Rückbaus. `call_assignees` und
--     `followup_templates` stehen aus demselben Grund noch da (docs §3): Der
--     Aufrufer fällt, das Artefakt bleibt, weil das Entfernen des Artefakts der
--     riskante Teil ist und keinen Nutzen bringt.
--  3. Und das ist der teure Punkt: Was in den beiden Funktionen steckt, ist
--     nicht die Regel — die ist trivial —, sondern die BAUART, mit der sie
--     Bestandszeilen verschont. Sie vergleichen OLD gegen NEW und werfen nur,
--     wenn der Fehlzustand im laufenden Statement NEU entsteht; die IF-Blöcke
--     sind geschachtelt statt verodert, weil PostgreSQL für `or` keine
--     Auswertung von links nach rechts garantiert und `old` beim INSERT nicht
--     zugewiesen ist. Wer die Regel je wieder scharf stellen will, hängt einen
--     Trigger an — drei Zeilen. Wer die Funktion vorher gelöscht hat, leitet
--     diese Feinheiten neu her und baut mit hoher Wahrscheinlichkeit den
--     CHECK-Constraint nach, den 0035 ausdrücklich vermieden hat.
--
-- Der Gegeneinwand — „tote Funktion, jemand hängt sie versehentlich wieder an"
-- — trägt nicht: Ein Trigger entsteht nicht versehentlich, sondern durch ein
-- `create trigger`. Damit niemand rätselt, warum die Funktion ohne Trigger
-- dasteht, bekommt sie einen Vermerk. Der ist gleichzeitig der Nachweis, dass
-- diese Datei ganz durchgelaufen ist und nicht nur bis zu den drei `drop`s
-- (Verifikation A2).

do $$
begin
  if to_regprocedure('public.require_cancel_reason()') is not null then
    execute $c$
      comment on function public.require_cancel_reason () is
        'STILLGELEGT mit 0041 (Rückbau): Trigger entfernt, Funktion absichtlich behalten. Sie erzwang cancel_reason_code bei einer neu entstehenden Absage und verschonte Bestandszeilen über einen OLD/NEW-Vergleich. Wieder scharf stellen heißt: einen before-insert-or-update-of-Trigger anhängen — nicht einen CHECK bauen, der jede Bestandszeile ohne Grund dauerhaft unbearbeitbar machte (siehe 0035).'
    $c$;
  end if;

  if to_regprocedure('public.require_disqualify_reason()') is not null then
    execute $c$
      comment on function public.require_disqualify_reason () is
        'STILLGELEGT mit 0041 (Rückbau): Trigger entfernt, Funktion absichtlich behalten. Sie erzwang disqualify_reason_code bei status=unqualifiziert, ebenfalls nur beim Herstellen des Fehlzustands. Zum Wiederanhängen siehe 0035; die Bauart mit OLD/NEW-Vergleich ist der wertvolle Teil, nicht die Regel.'
    $c$;
  end if;
end $$;

-- ===========================================================================
-- TEIL 2 — Der Nachfass-Stempel auf beiden Termin-Tabellen
-- ===========================================================================
--
-- Das eine Feld, ohne das das Zielbild nicht funktioniert. Die neue
-- Arbeitsliste zeigt jeden offenen Vorgang, bis er neu terminiert oder tot ist
-- — wer offen ist, wird jeden Tag kontaktiert. Ohne eine Spur davon, WANN das
-- zuletzt geschehen ist, leuchtet jede Zeile jeden Tag gleich hell: Es gibt
-- nichts abzuhaken, und niemand sieht, ob heute schon jemand drangewesen ist.
-- Der Ein-Klick-Knopf stempelt genau hier hinein.
--
-- ---------------------------------------------------------------------------
-- Warum diese Namen, dieser Typ, diese Nullability
-- ---------------------------------------------------------------------------
-- Vorbild ist `recycle_last_contacted_at` (0033): `timestamptz`, nullable, ohne
-- Default, NULL heißt „noch nie kontaktiert". Zwei Felder derselben Bedeutung
-- mit verschiedenen Konventionen wären ein Fehler — und zwar ein teurer, weil
-- die beiden im Rückbau nebeneinander weiterleben: das Recycling für die toten
-- Enden, der Nachfass-Stempel für die offenen Vorgänge. Der Präfix benennt wie
-- dort den Bereich (`recycle_` ↔ `follow_up_`) und schließt an `follow_up_due`
-- / `follow_up_due_at` auf denselben Tabellen an.
--
-- `timestamptz`, nicht `date`: Die Liste beantwortet „habe ich den heute schon
-- genervt?" — eine Frage innerhalb eines Tages. Ein reines Datum könnte sie
-- nicht beantworten. Gebucketet wird wie überall über den Berliner
-- Kalendertag (docs §6), das ist Sache der Anzeige, nicht der Spalte.
--
-- Nullable ohne Default und ohne Backfill: Ein Default `now()` behauptete für
-- jeden Bestandstermin, er sei heute nachgefasst worden — die ganze Liste wäre
-- am ersten Tag abgehakt. NULL ist die ehrliche Antwort und gleichzeitig die
-- nützliche: Die Zeile leuchtet, bis jemand den Knopf drückt.
--
-- ---------------------------------------------------------------------------
-- ENTSCHEIDUNG: es kommt eine ZWEITE Spalte dazu — WER nachgefasst hat
-- ---------------------------------------------------------------------------
-- Das Recycling kommt mit dem Zeitstempel allein aus. Hier reicht er nicht,
-- und der Grund ist nicht Vollständigkeit, sondern der Rückbau selbst:
--
--  * Die Erledigungs-Historie, die heute beides festhält, fällt. Sie steckt in
--    `reminder_touches.done_at`/`done_by_user_id` — und mit der Kaskade fällt
--    die Oberfläche, die diese Zeilen schreibt. Käme jetzt nur ein Zeitstempel,
--    hielte anschließend NIRGENDS mehr etwas fest, wer einen Lead angefasst
--    hat. Das ist kein Verlust an Statistik, sondern einer an Abstimmung.
--  * „Eine Liste pro Person" heißt nicht „nur eine Person schreibt hinein". Ein
--    Owner mit Team-Sicht arbeitet über die Datensicht die Liste eines Kollegen
--    ab, ein Plattform-Admin arbeitet in einer fremden Organisation (docs §2).
--    Wer geklickt hat, steht deshalb NICHT schon in der Zeile: `assigned_user_id`
--    sagt, wem der Termin gehört, nicht wer heute angerufen hat.
--  * Zu dritt ist genau das die Frage, die täglich anfällt: „Hast du den
--    angerufen oder ich?" Ohne die Spalte ist die Antwort ein Zuruf.
--
-- Die Spalte ist ein AUDIT-Feld in der Bedeutung von `created_by_user_id`
-- („wer hat geklickt"), nicht eine Zuständigkeit wie `assigned_user_id` („wem
-- gehört der Termin") — docs §2. Daraus folgen zwei Dinge: Keine Auswertung
-- darf sie als Personenachse benutzen (dafür bleibt `personOf()` maßgeblich),
-- und sie bekommt bewusst KEINEN Mitgliedschafts-Wächter — ein Plattform-Admin
-- ist in einer Kunden-Organisation kein Mitglied, und er soll trotzdem
-- stempeln können, wenn er dort arbeitet.
--
-- KEIN Paar-CHECK zwischen den beiden Spalten, obwohl `reminder_touches` einen
-- hat (`reminder_touches_done_pair`). Der ist dort nämlich mit `on delete set
-- null` auf derselben Spalte kombiniert, und die beiden Klauseln widersprechen
-- einander: Wird ein Nutzer gelöscht, setzt der Fremdschlüssel
-- `done_by_user_id` auf NULL, und genau dieses UPDATE verletzt den CHECK — das
-- Löschen scheitert an der eigenen Prüfung der Zeile. Dieselbe Falle in neuer
-- Form ist die aus 0035: Ein CHECK wird bei JEDEM Update der Zeile
-- ausgewertet, auch bei einem, der eine ganz andere Spalte anfasst. Ein
-- Termin, dessen Stempler das Unternehmen verlassen hat, wäre dauerhaft
-- unbearbeitbar. Der Preis dafür, den CHECK wegzulassen, ist ein möglicher
-- Zustand „Zeitstempel ohne Person" — und der ist genau richtig: Er heißt
-- „wurde nachgefasst, der Kollege ist weg", und das ist wahr.

do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and table_name in ('setting_calls', 'closing_calls')
         and column_name = 'recycle_last_contacted_at') < 2 then
    raise exception
      '0041 Teil 2 setzt Migration 0033 voraus — recycle_last_contacted_at fehlt auf setting_calls/closing_calls. Teil 2 kopiert Name, Typ und Nullability von dieser Spalte; ohne sie gibt es die Vorlage nicht, gegen die die Verifikation vergleicht.';
  end if;
end $$;

-- `on delete set null` wie bei `reminder_touches.done_by_user_id` (0032) und
-- `assigned_user_id` (0028): Das Löschen eines Nutzers darf weder scheitern
-- (`not null`) noch die Zeile mitnehmen (`on delete cascade`) — der Termin
-- bleibt, der Zeitstempel bleibt, nur der Name verschwindet.
alter table public.setting_calls
  add column if not exists follow_up_last_contacted_at          timestamptz,
  add column if not exists follow_up_last_contacted_by_user_id  uuid references auth.users (id) on delete set null;

alter table public.closing_calls
  add column if not exists follow_up_last_contacted_at          timestamptz,
  add column if not exists follow_up_last_contacted_by_user_id  uuid references auth.users (id) on delete set null;

comment on column public.setting_calls.follow_up_last_contacted_at is
  'Wann dieser Termin zuletzt nachgefasst wurde — der Ein-Klick-Stempel der Arbeitsliste. NULL heißt „noch nie", nicht „vor langer Zeit": Ohne den Stempel leuchtet die Zeile weiter. Konvention und Typ wie recycle_last_contacted_at (0033), das ist der Nachbar für die toten Enden.';
comment on column public.setting_calls.follow_up_last_contacted_by_user_id is
  'Wer gestempelt hat. AUDIT-Feld in der Bedeutung von created_by_user_id, KEINE Zuständigkeit — die steht in assigned_user_id und bleibt die Personenachse jeder Auswertung. Bewusst ohne Paar-CHECK zum Zeitstempel: on delete set null und ein solcher CHECK widersprechen einander (siehe 0041).';

comment on column public.closing_calls.follow_up_last_contacted_at is
  'Wann dieses Closing zuletzt nachgefasst wurde — der Ein-Klick-Stempel der Arbeitsliste. NULL heißt „noch nie". Konvention und Typ wie recycle_last_contacted_at (0033).';
comment on column public.closing_calls.follow_up_last_contacted_by_user_id is
  'Wer gestempelt hat. AUDIT-Feld wie created_by_user_id, keine Zuständigkeit. Bewusst ohne Paar-CHECK zum Zeitstempel (siehe 0041).';

-- KEIN INDEX. Das Recycling hat einen (`idx_*_next_recycle`), weil
-- `next_recycle_at` eine FÄLLIGKEIT ist, nach der die RPC filtert. Der
-- Nachfass-Stempel ist das Gegenteil: Er wird geschrieben und angezeigt, aber
-- nicht gefiltert — die Liste steht über Zuständigkeit und Zustand des
-- Termins, und was nach diesem Filter übrig ist, sind bei drei Personen ein
-- paar Dutzend Zeilen, die der Planer ohnehin sortiert statt indiziert
-- nachzuschlagen. Ein Index, den keine Abfrage benutzt, kostet bei jedem
-- Schreiben — und ausgerechnet geschrieben wird diese Spalte oft.

-- Die zwei neuen Spalten je Tabelle sofort über PostgREST sichtbar machen;
-- sonst antwortet die API mit PGRST204 („column ... does not exist"), bis der
-- Schema-Cache von selbst nachzieht.
notify pgrst, 'reload schema';

-- ===========================================================================
-- VERIFIKATION — nach dem Einspielen im SQL-Editor ausführen
-- ===========================================================================
--
-- LIES DAS ZUERST. Der Verifikationsblock von 0037 hatte eine Falle: Im
-- SQL-Editor ist man `postgres`, `auth.uid()` ist NULL, und deshalb scheiterte
-- JEDER Aufruf der geprüften RPCs — auch der, der hätte durchlaufen müssen.
-- Beide Seiten scheiterten, das sah wie ein bestandener Test aus und bewies
-- nichts.
--
-- Hier hat dieselbe Falle eine andere Gestalt, und sie ist heimtückischer, weil
-- diese Datei etwas WEGNIMMT. Die naheliegende Probe für Teil 1 lautet „das
-- verbotene Statement läuft jetzt durch" — und ein UPDATE, dessen WHERE keine
-- Zeile trifft, läuft ebenfalls durch, ohne irgendetwas berührt zu haben. Ein
-- Erfolg aus Untätigkeit ist von einem echten nicht zu unterscheiden.
--
-- Deshalb gilt hier durchgehend:
--   * Jede dynamische Probe endet auf `returning` und muss GENAU EINE ZEILE
--     liefern. KEINE Zeile ist KEIN bestandener Test, sondern ein kaputter.
--   * Jede Probe hat eine Gegenprobe, die weiterhin SCHEITERN bzw. weiterhin
--     ETWAS FINDEN muss. Erst beide zusammen beweisen etwas.
--   * Alles läuft in `begin; … rollback;`. Die Proben dürfen auf der
--     produktiven Datenbank nichts hinterlassen.
--
-- ---------------------------------------------------------------------------
-- A) Statisch — steht in der Datenbank, was in der Datei steht?
-- ---------------------------------------------------------------------------
--
-- A1) TEIL 1: An den beiden Funktionen hängt KEIN Trigger mehr. Gezählt wird
--     über die FUNKTION, nicht über die drei Namen aus 0035 — so fällt auch
--     ein vierter, von Hand angehängter Trigger auf. Muss 0 Zeilen liefern:
--
--       select c.relname as tabelle, t.tgname
--         from pg_trigger t
--         join pg_class c on c.oid = t.tgrelid
--        where not t.tgisinternal
--          and t.tgfoid in (to_regprocedure('public.require_cancel_reason()')::oid,
--                           to_regprocedure('public.require_disqualify_reason()')::oid);
--
-- A2) DIE GEGENPROBE, ohne die A1 nichts beweist. Wären die beiden Funktionen
--     weg, lieferte A1 ebenfalls 0 Zeilen — aus dem falschen Grund. Muss
--     GENAU 2 Zeilen liefern, beide mit `t`:
--
--       select p.proname,
--              obj_description(p.oid, 'pg_proc') like 'STILLGELEGT mit 0041%' as vermerkt
--         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public'
--          and p.proname in ('require_cancel_reason', 'require_disqualify_reason');
--
--     Kommen 2 Zeilen mit `f`, ist die Datei nur bis zu den drei `drop`s
--     gelaufen (§7, Teil-Ausführung bei markiertem Text) — Teil 2 fehlt dann
--     ebenfalls, A3 zeigt es. Kommen 0 Zeilen, hat jemand die Funktionen
--     gelöscht; A1 ist dann wertlos und muss über die Trigger-Namen wiederholt
--     werden.
--
-- A3) TEIL 2: Die neue Spalte folgt der Konvention ihres Vorbilds. Verglichen
--     wird gegen `recycle_last_contacted_at` DERSELBEN Tabelle, statt nur
--     Existenz zu prüfen — die Konvention ist der Punkt, nicht das Vorhandensein.
--     Muss 0 Zeilen liefern:
--
--       select f.table_name, f.data_type, r.data_type as vorbild_typ,
--              f.is_nullable, r.is_nullable as vorbild_nullable
--         from information_schema.columns f
--         join information_schema.columns r
--           on r.table_schema = f.table_schema and r.table_name = f.table_name
--          and r.column_name = 'recycle_last_contacted_at'
--        where f.table_schema = 'public'
--          and f.table_name in ('setting_calls', 'closing_calls')
--          and f.column_name = 'follow_up_last_contacted_at'
--          and (f.data_type, f.is_nullable, coalesce(f.column_default, '-'))
--              is distinct from
--              (r.data_type, r.is_nullable, coalesce(r.column_default, '-'));
--
-- A4) DIE GEGENPROBE ZU A3 — dieselbe Verbindung ohne die Abweichungs-
--     bedingung. Fehlte die neue Spalte ganz, lieferte A3 ebenfalls 0 Zeilen.
--     Muss GENAU 2 liefern (setting_calls und closing_calls):
--
--       select f.table_name, f.column_name, f.data_type, f.is_nullable
--         from information_schema.columns f
--         join information_schema.columns r
--           on r.table_schema = f.table_schema and r.table_name = f.table_name
--          and r.column_name = 'recycle_last_contacted_at'
--        where f.table_schema = 'public'
--          and f.table_name in ('setting_calls', 'closing_calls')
--          and f.column_name = 'follow_up_last_contacted_at';
--
--     ERWARTET je Zeile: `timestamp with time zone`, `YES`.
--
-- A5) Die Wer-Spalte hängt per `on delete set null` an `auth.users`. Muss
--     GENAU 2 Zeilen liefern, beide mit confdeltype = `n`:
--
--       select conrelid::regclass as tabelle, conname, confdeltype,
--              pg_get_constraintdef(oid) as definition
--         from pg_constraint
--        where contype = 'f'
--          and conrelid in ('public.setting_calls'::regclass,
--                           'public.closing_calls'::regclass)
--          and pg_get_constraintdef(oid) like '%follow_up_last_contacted_by_user_id%';
--
--     `c` (cascade) statt `n` wäre der teure Fehler: Das Löschen eines Nutzers
--     nähme dann seine Termine mit.
--
-- A6) Und es gibt KEINEN Paar-CHECK zwischen den beiden neuen Spalten — die
--     Falle, die `reminder_touches_done_pair` zusammen mit `on delete set null`
--     stellt. Muss 0 Zeilen liefern:
--
--       select conrelid::regclass as tabelle, conname, pg_get_constraintdef(oid)
--         from pg_constraint
--        where contype = 'c'
--          and conrelid in ('public.setting_calls'::regclass,
--                           'public.closing_calls'::regclass)
--          and pg_get_constraintdef(oid) like '%follow_up_last_contacted%';
--
-- ---------------------------------------------------------------------------
-- B) TEIL 1 dynamisch — genau die Statements, die 0035 abgewiesen hat
-- ---------------------------------------------------------------------------
-- Alle drei sind wörtlich die Proben aus dem Verifikationsblock von 0035, dort
-- unter „B. DIE SPERRE GREIFT — jedes dieser Statements MUSS fehlschlagen".
-- Hier gilt das Gegenteil: Sie müssen durchlaufen UND eine Zeile zurückgeben.
--
-- B1) Absage neu herstellen, ohne Grund. `cancel_outlook` muss mitgesetzt
--     werden, sonst schlägt der Paar-CHECK aus 0032 zu und die Probe misst
--     etwas anderes:
--
--       begin;
--         update public.setting_calls
--            set cancelled_at = now(), cancel_outlook = 'ohne_aussicht',
--                cancel_reason_code = null
--          where id = (select id from public.setting_calls
--                       where cancelled_at is null limit 1)
--         returning id, cancel_reason_code is null as ohne_grund_durchgelassen;
--       rollback;
--
--     ERWARTET: GENAU EINE Zeile mit `t`.
--     KEINE Zeile heißt: Das WHERE hat nichts getroffen (keine unabgesagte
--     Zeile vorhanden) — die Probe hat den Trigger gar nicht erreicht und
--     beweist nichts. Dann eine andere Zeile suchen, nicht abhaken.
--     Ein `ERROR: Absage ohne Grund …` heißt: Der Trigger hängt noch, Teil 1
--     ist nicht angekommen. NICHT ausliefern.
--
-- B2) Dasselbe auf `closing_calls`, in einer eigenen Transaktion:
--
--       begin;
--         update public.closing_calls
--            set cancelled_at = now(), cancel_outlook = 'ohne_aussicht',
--                cancel_reason_code = null
--          where id = (select id from public.closing_calls
--                       where cancelled_at is null limit 1)
--         returning id, cancel_reason_code is null as ohne_grund_durchgelassen;
--       rollback;
--
-- B3) 'unqualifiziert' ohne Grund — der Fall, an dem die neue Oberfläche sonst
--     bei jedem Klick zerbräche:
--
--       begin;
--         update public.setting_calls
--            set status = 'unqualifiziert', disqualify_reason_code = null
--          where id = (select id from public.setting_calls
--                       where status = 'offen' limit 1)
--         returning id, status, disqualify_reason_code is null as ohne_grund_durchgelassen;
--       rollback;
--
--     ERWARTET: GENAU EINE Zeile, `unqualifiziert`, `t`.
--
-- B4) DIE GEGENPROBE ZU B1-B3, und die wichtigste Probe des ganzen Blocks:
--     Es ist NICHT alles weg. Der Paar-CHECK aus 0032 muss weiterhin
--     zuschlagen — er ist der Beweis, dass die Statements oben die Tabelle
--     tatsächlich erreichen und nicht etwa an einer Berechtigung vorbeilaufen:
--
--       begin;
--         update public.setting_calls
--            set cancelled_at = now(), cancel_outlook = null
--          where id = (select id from public.setting_calls
--                       where cancelled_at is null limit 1);
--       rollback;
--
--     ERWARTET: `ERROR: … verletzt Check-Constraint
--     »setting_calls_cancelled_pair_chk«`. Läuft dieses Statement durch, ist
--     mehr entfernt worden als diese Datei entfernt — dann steht 0032 nicht
--     mehr vollständig, und der Befund ist größer als 0041.
--
-- ---------------------------------------------------------------------------
-- C) TEIL 2 dynamisch — der Stempel kommt an
-- ---------------------------------------------------------------------------
--
-- C1) Schreiben und zurücklesen, in einem Statement. `returning` ist auch hier
--     der Punkt: Eine Spalte, die es nicht gäbe, ließe das UPDATE werfen — ein
--     WHERE, das nichts trifft, dagegen nicht.
--
--       begin;
--         update public.setting_calls
--            set follow_up_last_contacted_at = now(),
--                follow_up_last_contacted_by_user_id =
--                  coalesce(assigned_user_id, created_by_user_id)
--          where id = (select id from public.setting_calls
--                       where coalesce(assigned_user_id, created_by_user_id) is not null
--                       limit 1)
--         returning id,
--                   follow_up_last_contacted_at is not null          as gestempelt,
--                   follow_up_last_contacted_by_user_id is not null  as mit_person;
--       rollback;
--
--     ERWARTET: GENAU EINE Zeile, beide Spalten `t`. Dasselbe für
--     `closing_calls` wiederholen.
--     Kommt `mit_person = f`, hat die gewählte Zeile weder Zuständigen noch
--     Ersteller — dann eine andere nehmen; der Stempel selbst ist davon
--     unberührt.
--
-- C2) Der Stempel löst KEINEN der verbliebenen Trigger aus. Das ist keine
--     Vermutung, sondern liest sich an den Spaltenlisten ab: Die
--     Zuweisungs-Wächter aus 0040 hängen an `update of workspace_id,
--     assigned_user_id`, und keine der beiden neuen Spalten steht dort. Die
--     Probe dafür ist C1 selbst — sie ändert `assigned_user_id` nicht und
--     bekommt die Zeile unverändert zurück. Ein zusätzlicher Nachweis:
--
--       select t.tgname, a.attname
--         from pg_trigger t
--         join pg_class c on c.oid = t.tgrelid
--         join lateral unnest(t.tgattr::int2[]) as col(num) on true
--         join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.num
--        where not t.tgisinternal
--          and c.relname in ('setting_calls', 'closing_calls')
--          and a.attname like 'follow_up_last_contacted%';
--
--     ERWARTET: 0 Zeilen. Stünde hier etwas, feuerte bei jedem Klick auf den
--     Nachfass-Knopf ein Trigger mit.
--
-- C3) Die Spalten sind über die API erreichbar. Das `notify pgrst` steht in
--     dieser Datei; kommt in der Anwendung trotzdem PGRST204 („column
--     follow_up_last_contacted_at does not exist"), hat der Schema-Cache das
--     Signal verpasst — dann von Hand nachschicken:
--
--       notify pgrst, 'reload schema';
--
-- ---------------------------------------------------------------------------
-- D) Zustandsaufnahme — was Teil 1 ab jetzt NICHT mehr verhindert
-- ---------------------------------------------------------------------------
-- Diese drei Zahlen standen vor dem Einspielen fest und dürfen ab jetzt wieder
-- wachsen. Sie sind kein Defekt und keine Nachpflege-Liste mehr, sondern nur
-- noch die Auskunft, wie oft niemand einen Grund angegeben hat. Einmal jetzt
-- notieren, damit später niemand einen Sprung für einen Fehler hält:
--
--   select count(*) as absage_ohne_grund_setting from public.setting_calls
--    where cancelled_at is not null and cancel_reason_code is null;
--
--   select count(*) as absage_ohne_grund_closing from public.closing_calls
--    where cancelled_at is not null and cancel_reason_code is null;
--
--   select count(*) as unqualifiziert_ohne_grund from public.setting_calls
--    where status = 'unqualifiziert' and disqualify_reason_code is null;
--
-- BESTANDEN ist die Migration, wenn A1 und A6 leer sind, A2 zwei Zeilen mit
-- `t` liefert, A4 zwei Zeilen mit `timestamp with time zone`/`YES`, A3 leer
-- ist, B1-B3 je genau eine Zeile mit `t` zurückgeben und B4 weiterhin
-- scheitert.
