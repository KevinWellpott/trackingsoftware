-- 0035 — Pflichtfeld-Trigger: Absage-Grund und Disqualifikationsgrund
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NICHT VOR DEM DEPLOY EINSPIELEN.
--
--  ERST DEN BRANCH MERGEN UND AUSLIEFERN — DANN DIESE DATEI AUSFÜHREN.
--
--  Diese Migration erzwingt zwei Regeln, die heute nur die Oberfläche einhält.
--  Die aktuell PRODUKTIVE App schreibt `status='unqualifiziert'` ohne Grundcode
--  und sagt das selbst an (`cancelAppointment` in src/app/actions/settingCalls.ts:
--  „der Trigger dazu kommt bewusst erst nach dem Verifikationsfenster"). Wird
--  0035 vorher eingespielt, zerbricht jede Absage und jede Disqualifizierung
--  der laufenden Version an einer Datenbank-Exception — nicht irgendwann,
--  sondern beim nächsten Klick.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ───────────────────────────────────────────────────────────────────────────
--  ZUSÄTZLICHE VORBEDINGUNG FÜR REGEL 2 (vor dem Einspielen prüfen!)
-- ───────────────────────────────────────────────────────────────────────────
--  Auch der NEUE Code auf diesem Branch erfüllt Regel 2 noch nicht — er hält
--  sie nur im Dialog ein, schreibt sie aber in ZWEI Statements:
--    1. `setSettingOutcome({outcome:'unqualifiziert'})` → setzt nur den Status
--    2. `setDisqualifyReason(...)`                      → setzt den Grund danach
--  (src/components/scripts/SettingCallEditor.tsx, `submitFollowUpOutcome`).
--  Der Trigger greift bereits bei Statement 1, weil der Zustand dort NEU
--  entsteht — und der Grund liegt zu dem Zeitpunkt noch beim Client.
--
--  Vor dem Einspielen ist deshalb EINE der beiden Änderungen fällig:
--    (a) empfohlen — `setSettingOutcome` nimmt den Grundcode entgegen und
--        schreibt Status und Grund in DEMSELBEN UPDATE. Dann ist die Regel
--        auch bei einem Abbruch zwischen zwei Requests nicht verletzbar.
--    (b) minimal — in `submitFollowUpOutcome` die Reihenfolge tauschen:
--        erst `setDisqualifyReason`, dann `setSettingOutcome`.
--
--  Regel 1 (Absage) braucht das nicht: `cancelAppointment` schreibt
--  `cancelled_at` und `cancel_reason_code` bereits in einem Statement.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Die zwei Regeln:
--   1. Ein abgesagter Termin braucht einen Absage-Grundcode
--      (`cancelled_at is not null` → `cancel_reason_code is not null`),
--      auf BEIDEN Termin-Tabellen.
--   2. Ein Erstgespräch mit `status='unqualifiziert'` braucht einen
--      Disqualifikationsgrund (`disqualify_reason_code is not null`).
--
-- WARUM TRIGGER UND NICHT CHECK
-- Ein CHECK-Constraint wird bei JEDEM Update der Zeile ausgewertet, auch bei
-- einem, das eine ganz andere Spalte anfasst. Jede Bestandszeile ohne Grund
-- wäre damit dauerhaft unbearbeitbar — ausgerechnet die Zeilen, die
-- nachgepflegt werden müssen. Dieselbe Falle wie bei den `source_type`-
-- Altwerten (docs/data-model.md §4): Der CHECK dort bleibt nur deshalb weit
-- gefasst, weil sich sonst kein alter Termin mehr bearbeiten ließe.
--
-- Ein BEFORE-Trigger kann dagegen OLD und NEW vergleichen und nur dann prüfen,
-- wenn der verbotene Zustand in DIESEM Statement neu entsteht oder der Grund
-- aktiv geleert wird. Verboten ist das Herstellen des Fehlzustands, nicht sein
-- Vorhandensein.
--
-- WIEDERHOLBARKEIT
-- Die Supabase-Konsole fährt ein Skript nicht in einer Transaktion: bricht es
-- in der Mitte ab, bleibt ein Halbzustand zurück. Deshalb durchgehend
-- `create or replace function` und `drop trigger if exists` vor jedem
-- `create trigger` — die Datei ist beliebig oft ausführbar. Neue Spalten,
-- Constraints oder Tabellen kommen keine dazu, ein `notify pgrst` erübrigt
-- sich damit.

-- ---------------------------------------------------------------------------
-- 0. Vorbedingung: die Spalten aus 0032 müssen liegen
-- ---------------------------------------------------------------------------
-- Fail-fast, bevor der erste Trigger steht: ohne Transaktion wäre ein Abbruch
-- weiter unten sonst ein halb scharfes Regelwerk.

do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'setting_calls'
         and column_name in ('cancelled_at', 'cancel_reason_code',
                             'status', 'disqualify_reason_code')) < 4 then
    raise exception
      '0035 setzt Migration 0032 voraus — auf setting_calls fehlen Spalten (cancelled_at, cancel_reason_code, status, disqualify_reason_code).';
  end if;

  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'closing_calls'
         and column_name in ('cancelled_at', 'cancel_reason_code')) < 2 then
    raise exception
      '0035 setzt Migration 0032 voraus — auf closing_calls fehlen Spalten (cancelled_at, cancel_reason_code).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Regel 1 — Absage nur mit Grund (setting_calls + closing_calls)
-- ---------------------------------------------------------------------------
-- Eine Funktion für beide Tabellen: die Spalten heißen gleich, und zwei Kopien
-- liefen beim ersten Nachbessern auseinander.
--
-- Die drei IF-Blöcke sind bewusst geschachtelt statt zu einer Bedingung
-- verodert: PostgreSQL garantiert für `or`/`and` KEINE Auswertung von links
-- nach rechts, und `old` ist beim INSERT nicht zugewiesen — ein `tg_op =
-- 'INSERT' or old.cancelled_at is null` dürfte die rechte Seite trotzdem
-- anfassen und liefe dann in „record old is not assigned yet". Verschachtelte
-- IF-Anweisungen sind Kontrollfluss und damit eindeutig.

create or replace function public.require_cancel_reason ()
returns trigger
language plpgsql
as $$
begin
  -- Zustand in Ordnung: nicht abgesagt, oder abgesagt MIT Grund.
  if new.cancelled_at is null or new.cancel_reason_code is not null then
    return new;
  end if;

  -- Ab hier: abgesagt ohne Grund. Trug die Zeile diesen Zustand schon VOR dem
  -- Statement, ist sie ein Bestandsfall und bleibt bearbeitbar — sonst ließe
  -- sich ausgerechnet die Zeile nicht mehr anfassen, die nachgepflegt werden
  -- muss, und der Grund käme nie hinein.
  if tg_op = 'UPDATE' then
    if old.cancelled_at is not null and old.cancel_reason_code is null then
      return new;
    end if;
  end if;

  -- Bleiben zwei Fälle: die Absage entsteht in diesem Statement neu
  -- (old.cancelled_at war NULL), oder der Grund wird an einer abgesagten Zeile
  -- aktiv geleert (old.cancel_reason_code war gesetzt). Beides ist das
  -- Herstellen des Fehlzustands.
  --
  -- Der Text steht so in der Oberfläche: die App reicht `error.message` von
  -- PostgREST unverändert an den Nutzer durch.
  raise exception
    'Absage ohne Grund: Bitte einen Grund für die Absage auswählen (cancel_reason_code).';
end;
$$;

comment on function public.require_cancel_reason () is
  'Erzwingt cancel_reason_code bei einer Absage — aber nur, wenn der Fehlzustand im Statement NEU entsteht. Bestandszeilen ohne Grund bleiben bearbeitbar (siehe 0035).';

-- `update of ...` statt eines nackten `update`: der Trigger feuert damit nur,
-- wenn eine der beiden Spalten überhaupt im SET steht. Ein Update auf Notizen,
-- Zuweisung oder Termin einer Bestandszeile löst ihn gar nicht erst aus.
drop trigger if exists setting_calls_require_cancel_reason on public.setting_calls;
create trigger setting_calls_require_cancel_reason
  before insert or update of cancelled_at, cancel_reason_code on public.setting_calls
  for each row execute function public.require_cancel_reason ();

drop trigger if exists closing_calls_require_cancel_reason on public.closing_calls;
create trigger closing_calls_require_cancel_reason
  before insert or update of cancelled_at, cancel_reason_code on public.closing_calls
  for each row execute function public.require_cancel_reason ();

-- ---------------------------------------------------------------------------
-- 2. Regel 2 — 'unqualifiziert' nur mit Disqualifikationsgrund (setting_calls)
-- ---------------------------------------------------------------------------
-- Nur das Erstgespräch: ein Closing trägt seinen Grund in `lost_reason_code`,
-- und dort hängt zusätzlich die Recycling-Frist daran (docs/data-model.md §4) —
-- eine gemeinsame Funktion für zwei verschiedene Spalten mit verschiedener
-- Bedeutung wäre eine Ersparnis auf Kosten der Lesbarkeit.
--
-- Ohne diese Regel steht die Zeile später in der Ablage-Ansicht
-- „Disqualifiziert" ohne Grund, und die Auswertung „woran scheitert die
-- Qualifizierung" bleibt leer — die Frage, für die der Code überhaupt
-- eingeführt wurde. Code ist Statistik, Freitext ist Gedächtnis; erzwungen
-- wird deshalb der Code, nicht `disqualify_reason`.

create or replace function public.require_disqualify_reason ()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from 'unqualifiziert' or new.disqualify_reason_code is not null then
    return new;
  end if;

  -- Bestandsfall wie oben: Status stand schon vorher ohne Grund da. Genau über
  -- diesen Weg trägt die Ablage den Grund nach (`setDisqualifyReason`), also
  -- darf er nicht verriegelt sein.
  if tg_op = 'UPDATE' then
    if old.status is not distinct from 'unqualifiziert'
       and old.disqualify_reason_code is null then
      return new;
    end if;
  end if;

  raise exception
    'Unqualifiziert ohne Grund: Bitte einen Grund für die Disqualifizierung auswählen (disqualify_reason_code).';
end;
$$;

comment on function public.require_disqualify_reason () is
  'Erzwingt disqualify_reason_code bei status=unqualifiziert — nur beim Herstellen des Fehlzustands, damit Bestandszeilen nachpflegbar bleiben (siehe 0035).';

drop trigger if exists setting_calls_require_disqualify_reason on public.setting_calls;
create trigger setting_calls_require_disqualify_reason
  before insert or update of status, disqualify_reason_code on public.setting_calls
  for each row execute function public.require_disqualify_reason ();

-- ---------------------------------------------------------------------------
-- Verifikation (nach dem Einspielen im SQL-Editor ausführen)
-- ---------------------------------------------------------------------------
--
-- A. BESTANDSZEILEN OHNE GRUND — die Nachpflege-Liste
--    Diese Zeilen bleiben bewusst stehen und müssen von Hand nachgepflegt
--    werden (in der Oberfläche über /ablage). KEIN Backfill: 0029 hat alle
--    verlorenen Closings pauschal auf 'sonstiges' gesetzt, seither ist diese
--    Verteilung eine Aussage über das Deploy-Datum statt über die Einwände.
--    Der Fehler wird hier nicht wiederholt — ein geratener Grund ist schlimmer
--    als ein fehlender, weil er zählbar aussieht.
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
--
-- B. DIE SPERRE GREIFT — jedes dieser Statements MUSS fehlschlagen
--    (ein fehlschlagendes Statement schreibt nichts, die Tests sind daher
--    auch auf der produktiven Datenbank gefahrlos)
--
--    B1 Absage neu herstellen, ohne Grund. `cancel_outlook` muss mit gesetzt
--       werden, sonst schlüge schon der Paar-CHECK aus 0032 zu und der Test
--       bewiese nur, dass 0032 liegt:
--   update public.setting_calls
--      set cancelled_at = now(), cancel_outlook = 'ohne_aussicht', cancel_reason_code = null
--    where id = (select id from public.setting_calls where cancelled_at is null limit 1);
--
--   update public.closing_calls
--      set cancelled_at = now(), cancel_outlook = 'ohne_aussicht', cancel_reason_code = null
--    where id = (select id from public.closing_calls where cancelled_at is null limit 1);
--
--    B2 Grund einer korrekt abgesagten Zeile aktiv leeren:
--   update public.setting_calls set cancel_reason_code = null
--    where id = (select id from public.setting_calls
--                 where cancelled_at is not null and cancel_reason_code is not null limit 1);
--
--    B3 'unqualifiziert' setzen, ohne Grund — genau das, was
--       `setSettingOutcome` heute allein tut (siehe Vorbedingung im Kopf):
--   update public.setting_calls set status = 'unqualifiziert', disqualify_reason_code = null
--    where id = (select id from public.setting_calls
--                 where status = 'offen' limit 1);
--
--    B4 Grund einer korrekt disqualifizierten Zeile aktiv leeren:
--   update public.setting_calls set disqualify_reason_code = null
--    where id = (select id from public.setting_calls
--                 where status = 'unqualifiziert' and disqualify_reason_code is not null limit 1);
--
--    B5 Ein Insert im Fehlzustand kommt ebenfalls nicht durch. Beim Prüfen auf
--       die MELDUNG achten: Sie muss die des Triggers sein. Scheitert das
--       Statement stattdessen an einer NOT-NULL-Spalte, fehlt der Zeile nur
--       eine Pflichtangabe und der Test beweist nichts — dann sind B3/B4 die
--       maßgeblichen Nachweise:
--   insert into public.setting_calls (workspace_id, lead_name, status, disqualify_reason_code)
--   select workspace_id, 'Trigger-Test', 'unqualifiziert', null
--     from public.setting_calls limit 1;
--
--
-- C. BESTANDSZEILEN BLEIBEN BEARBEITBAR — beide MÜSSEN durchlaufen
--    Das ist die eigentliche Begründung für Trigger statt CHECK. Beide
--    Statements nennen die überwachte Spalte im SET, der Trigger feuert also
--    und muss die Zeile trotzdem passieren lassen:
--
--   update public.setting_calls set cancelled_at = cancelled_at
--    where cancelled_at is not null and cancel_reason_code is null;
--
--   update public.setting_calls set status = status
--    where status = 'unqualifiziert' and disqualify_reason_code is null;
--
--
-- D. DER NACHPFLEGE-WEG IST OFFEN — MUSS durchlaufen
--    Eine Bestandszeile bekommt ihren Grund nachträglich. Einzeln mit dem
--    tatsächlichen Grund, nie als Sammel-Update (siehe A).
--
--    Nachpflegen möglichst ÜBER DIE OBERFLÄCHE (/ablage): `setDisqualifyReason`
--    setzt bei 'keine_zusammenarbeit' zusätzlich das Kontaktverbot und räumt
--    bei 'falsche_zielgruppe' ein bereits geplantes Recycling-Datum ab. Ein
--    reines UPDATE hier lässt beides aus — der Lead bekäme trotz „nicht mehr
--    kontaktieren" eine Wiedervorlage.
--
--    Gültige Codes (CHECKs aus 0032):
--      cancel_reason_code     — kein_neuer_termin, krank, familiaer, beruflich,
--                               preis, sonstiges
--      disqualify_reason_code — geld, kein_budget, kein_bedarf,
--                               falscher_zeitpunkt, kein_entscheider,
--                               falsche_zielgruppe, keine_zusammenarbeit,
--                               sonstiges
--
--   update public.setting_calls set disqualify_reason_code = '<echter Grund>'
--    where id = '<Zeile aus A>';
--
--   update public.setting_calls set cancel_reason_code = '<echter Grund>'
--    where id = '<Zeile aus A>';
