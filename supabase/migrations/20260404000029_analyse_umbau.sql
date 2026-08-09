-- ═══════════════════════════════════════════════════════════════════════════
-- 0029 · Analyse-Umbau: echte Terminquellen, Telefonnummer am Termin,
--        codierte Verlustgründe, A/B-testbare Telefon-Skripte
-- ---------------------------------------------------------------------------
-- Voraussetzung: 0028 eingespielt. Läuft NICHT automatisch (docs §7) —
-- im Supabase-SQL-Editor ausführen, und zwar VOR dem Deploy des zugehörigen
-- Codes: src/lib/analyseData.ts selektiert die neuen Spalten namentlich, und
-- eine fehlende Spalte lässt PostgREST die GESAMTE Abfrage abweisen (der
-- Analyse-Bereich wäre dann leer, nicht nur unvollständig).
--
-- VOR DEM AUSFÜHREN ansehen — der Backfill in §1 liest genau dieses Feld:
--   select coalesce(source_detail, '(leer)') as detail, count(*)
--   from setting_calls where source_type = 'manuell'
--   group by 1 order by 2 desc;
--
-- Rein additiv: vier neue Spalten, ein erweiterter CHECK (es kommen nur Werte
-- HINZU), ein neuer CHECK, zwei bewusst konservative Backfills. Kein DROP
-- COLUMN, keine Policy, keine RPC — nichts, was bestehende Grants oder
-- Sichtbarkeiten anfasst.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) setting_calls.source_type — die Quelle wieder aussagekräftig machen
-- ---------------------------------------------------------------------------
-- Bisher erlaubte der CHECK (0016) nur linkedin|telefon|inbound|website|manuell.
-- Alles, was nicht aus einer LinkedIn-Liste oder einem Telefon-Lead entstand,
-- landete deshalb unter 'manuell' — im Funnel ist das inzwischen die
-- umsatzstärkste Zeile und sagt exakt nichts aus. Der echte Ursprung steht als
-- Freitext in `source_detail` (0017) und wird von keiner Auswertung gelesen.
--
-- Künftig sind genau FÜNF Werte wählbar:
--   LinkedIn · Telefon · Social Media · Ads · Sonstige
-- Die drei Altwerte bleiben erlaubt, aber nicht mehr anbietbar. Sie zu
-- streichen wäre kein Aufräumen, sondern Datenverlust: der CHECK gilt auch für
-- UPDATEs auf ganz anderen Spalten — jedes Bearbeiten eines alten Termins
-- würde sonst scheitern.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.setting_calls
  drop constraint if exists setting_calls_source_type_check;

alter table public.setting_calls
  add constraint setting_calls_source_type_check
  check (
    source_type is null
    or source_type in (
      -- neu wählbar
      'linkedin', 'telefon', 'social_media', 'ads', 'sonstige',
      -- Altwerte, nur noch für Bestandszeilen
      'inbound', 'website', 'manuell'
    )
  );

-- Backfill NUR bei eindeutigem Freitext. Der Rest bleibt 'manuell' und wird im
-- UI als „Manuell (ohne Angabe)" beschriftet — eine ehrliche Restkategorie ist
-- besser als geratene Statistik, die niemand mehr von echten Angaben
-- unterscheiden kann. Die verbliebenen Zeilen sind zugleich die To-do-Liste
-- fürs Nachpflegen (Verifikationsblock am Ende).
--
-- REIHENFOLGE IST ABSICHT: Ads zuerst. „Facebook Ads" enthält beide Muster und
-- ist ein bezahlter Kanal — der spezifischere Treffer muss gewinnen.
-- Angefasst wird ausschließlich 'manuell'; 'inbound' und 'website' sind
-- gepflegte eigene Kategorien und werden nicht umgedeutet.

update public.setting_calls
   set source_type = 'ads'
 where source_type = 'manuell'
   and source_detail is not null
   -- 'ads' NUR mit Wortgrenzen (\m…\M). Ein simples '%ads%' träfe sonst jedes
   -- „Leads" — das häufigste Wort in diesem Freitextfeld überhaupt.
   and source_detail ~* '(\mads\M|\mwerbung\M|werbeanzeige|\manzeigen?\M)';

update public.setting_calls
   set source_type = 'social_media'
 where source_type = 'manuell'
   and source_detail is not null
   -- Diese vier sind als Teilwort unmissverständlich: „Instagram", „Social
   -- Selling", „Facebook-DM", „TikTok". Bewusst KEIN „youtube" o. ä. — dort
   -- ist organisch vs. bezahlt aus dem Text nicht entscheidbar.
   and source_detail ~* '(insta|social|facebook|tiktok)';

-- ───────────────────────────────────────────────────────────────────────────
-- 2) setting_calls.phone — die Nummer gehört an den Termin
-- ---------------------------------------------------------------------------
-- Bei Termin-Art „Telefon" (`meeting_kind = 'telefon'`) gibt es heute kein
-- Feld für die Rufnummer. Wer kurzfristig für einen Kollegen einspringt, hat
-- damit einen Termin ohne Anschluss.
--
-- Warum nicht aus der Quelle joinen: `phone_leads.phone` ist die Firmennummer
-- (Zentrale/Gatekeeper), nicht die Durchwahl aus dem Gespräch — und manuelle
-- sowie LinkedIn-Termine haben überhaupt keine Lead-Zeile.
--
-- Bewusst nullable und ohne CHECK gegen `meeting_kind`: Jede Bestandszeile mit
-- meeting_kind='telefon' hätte ihn sofort gebrochen, und ein Termin darf nicht
-- am fehlenden Feld scheitern. Die Pflicht gehört ins Formular, nicht in die
-- Tabelle.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.setting_calls
  add column if not exists phone text;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) closing_calls.lost_reason_code — Verlustgründe endlich zählbar
-- ---------------------------------------------------------------------------
-- `lost_reason` ist Freitext und wird beim Ergebnis „Verloren" erzwungen.
-- Zählen lässt er sich nicht: „zu teuer", „Preis", „Budget nicht da" sind drei
-- Zeilen in jeder Auswertung. Der Code daneben macht daraus eine Kennzahl.
--
-- `lost_reason` bleibt erhalten und wird NICHT ersetzt: der Freitext trägt den
-- Kontext („will erst nach der Messe"), den neun Codes nie abbilden können.
-- Code = Statistik, Freitext = Gedächtnis.
--
-- Warum 'falsche_zielgruppe' in der Liste steht: Sie ist der einzige Code, der
-- nicht das Closing bewertet, sondern die Stufe davor. Ein Deal, der an der
-- falschen Zielgruppe stirbt, war schon im Setting falsch qualifiziert — ohne
-- eigenen Code verschwindet er unter 'kein_bedarf', und die Qualifizierung
-- bleibt für immer unangreifbar. Genau das soll messbar werden.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.closing_calls
  add column if not exists lost_reason_code text;

alter table public.closing_calls
  drop constraint if exists closing_calls_lost_reason_code_check;

alter table public.closing_calls
  add constraint closing_calls_lost_reason_code_check
  check (
    lost_reason_code is null
    or lost_reason_code in (
      'preis',              -- Angebot zu teuer / Preis-Leistung passt nicht
      'timing',             -- grundsätzlich ja, aber nicht jetzt
      'kein_bedarf',        -- Problem trägt nicht (stark genug)
      'entscheider',        -- weiterer Entscheider hat abgelehnt / war nie dabei
      'wettbewerb',         -- an einen Mitbewerber verloren
      'vertrauen',          -- Zweifel an Anbieter, Ergebnis oder Referenzen
      'ghosting',           -- meldet sich nicht mehr, ohne Absage
      'falsche_zielgruppe', -- passte nie ins Profil (Fehler im Setting)
      'sonstiges'
    )
  );

-- KEIN automatisches Mapping der Bestandsdaten aus `lost_reason`.
-- Die Menge ist klein, die Freitexte sind uneinheitlich, und eine Rateregel
-- erzeugt eine Statistik, der man ihre Herkunft hinterher nicht mehr ansieht —
-- ein falscher Zahlenwert ist schlimmer als ein fehlender. Alle vorhandenen
-- verlorenen Deals bekommen deshalb 'sonstiges' und SOLLEN VON HAND
-- NACHGEPFLEGT WERDEN; die Liste dafür steht im Verifikationsblock.
update public.closing_calls
   set lost_reason_code = 'sonstiges'
 where status = 'verloren'
   and lost_reason_code is null;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) phone_lists: Skript + Testarm + Ziel-Branche
-- ---------------------------------------------------------------------------
-- Telefon-Skripte sollen A/B-testbar werden. `phone_leads.script` gibt es zwar
-- schon, aber pro Lead — als Testachse unbrauchbar.
--
-- Warum ZWEI Spalten und nicht nur `script_text`: Jeder CSV-Import legt eine
-- neue Liste an. Ohne ein Label zersplittert der Test damit in so viele Arme
-- wie es Importe gab, und jede Liste hat ihre eigene Fallzahl (= keine).
-- `script_label` ist die Gruppierungsachse: zehn Listen, zwei Testarme, zwei
-- Terminquoten mit belastbarer Fallzahl. Der Text sagt WAS gesagt wurde, das
-- Label sagt WELCHER VARIANTE das zuzurechnen ist.
--
-- `target_group` ist der Listen-Default für die Branche. `phone_leads.
-- target_group` (0008) existiert bereits und bleibt je Lead maßgeblich — die
-- Liste liefert nur den Wert beim Import, sonst müsste jede Zeile derselben
-- Importdatei einzeln gepflegt werden und die Auswertung „welche Branche
-- konvertiert" bliebe leer.
-- Alle drei bewusst als freies `text` ohne CHECK: Skriptvarianten und
-- Zielbranchen erfindet der Vertrieb laufend neu, eine Enum-Pflege wäre eine
-- Migration pro Test.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.phone_lists
  add column if not exists script_text  text,
  add column if not exists script_label text,
  add column if not exists target_group text;

-- Neue Spalten sofort über PostgREST verfügbar machen.
notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFIKATION — nach dem Ausführen
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Beide CHECKs stehen wie erwartet:
--   select conrelid::regclass as tabelle, conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conname in ('setting_calls_source_type_check',
--                      'closing_calls_lost_reason_code_check');
--
-- Quellen-Verteilung nach dem Backfill — 'manuell' muss kleiner geworden sein:
--   select coalesce(source_type, '(null)') as quelle, count(*)
--     from setting_calls group by 1 order by 2 desc;
--
-- DIE Liste, die den Backfill erklärt (was zugeordnet wurde):
--   select source_type, coalesce(source_detail, '(leer)'), count(*)
--     from setting_calls where source_type in ('ads', 'social_media')
--    group by 1, 2 order by 3 desc;
--
-- Was NICHT zugeordnet werden konnte. Kein Fehler, sondern die To-do-Liste:
-- diese Zeilen erscheinen im UI als „Manuell (ohne Angabe)".
--   select coalesce(source_detail, '(leer)') as detail, count(*)
--     from setting_calls where source_type = 'manuell'
--    group by 1 order by 2 desc;
--
-- Kein verlorener Deal ohne Code:
--   select count(*) from closing_calls
--    where status = 'verloren' and lost_reason_code is null;            -- 0
--
-- VON HAND NACHPFLEGEN — alle Bestandszeilen stehen jetzt auf 'sonstiges',
-- der Freitext daneben ist die Vorlage dafür:
--   select id, company, lost_reason, call_at
--     from closing_calls
--    where status = 'verloren' and lost_reason_code = 'sonstiges'
--    order by call_at desc nulls last;
--
-- Neue Spalten sind da (und damit auch für PostgREST sichtbar):
--   select table_name, column_name from information_schema.columns
--    where (table_name = 'setting_calls' and column_name = 'phone')
--       or (table_name = 'closing_calls' and column_name = 'lost_reason_code')
--       or (table_name = 'phone_lists'
--           and column_name in ('script_text', 'script_label', 'target_group'))
--    order by 1, 2;                                                     -- 5 Zeilen
-- ═══════════════════════════════════════════════════════════════════════════
