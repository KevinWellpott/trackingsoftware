# Datenmodell & Auswertungs-Glossar (Pitch-Tracker)

Kontext für KI-gestützte Datenauswertung über den read-only Supabase-MCP.
Quellen: `supabase/migrations/` (maßgeblich für Schema) + tatsächliche Nutzung in `src/`.
Stand: 11. September 2026, **nach dem Rückbau des Nachfass-Systems** (drei Wellen am
10. September: `4189cbd` Oberfläche · `d8c654f` Arbeitsliste · `e87a924` Kaskaden-Kern,
dazu `0fdfce8` die Befunde einer adversarischen Prüfung). Schema live bis Migration
`20260404000040_schreibpfad_mandantengrenzen.sql`; **0041**
(`rueckbau_pflichtfelder_und_nachfass_stempel`) ist geschrieben und noch **nicht**
eingespielt (§7).

> ## ⚠ Lies das zuerst: Der Rückbau hat die Oberfläche verkleinert, nicht das Schema
>
> Der Geschäftspartner hat das Nachfass-System als over-engineered zurückgewiesen:
> „Wir haben Kaskaden mit Stufenlogik, Template-Kataloge, Recycling-Regeln mit
> Reason-Codes und Wiedervorlage-Fristen pro Einwandtyp. Das ist ein Produkt für eine
> Firma mit zwanzig Settern. Wir sind zu dritt." Zielbild: **eine Liste je Person mit
> den Namen, die genervt werden müssen** — wer offen ist, wird jeden Tag kontaktiert
> und verschwindet, wenn er neu terminiert oder tot ist. Begründung und die
> abgewogenen Alternativen: `docs/nachfassen-umbau/ENTSCHEIDUNGEN.md`, Nachtrag
> „Der Rückbau".
>
> **Für Auswertungen sind daraus genau drei Dinge wichtig:**
>
> 1. **Vier Tabellen stehen weiter da und werden von keiner Zeile Code mehr gelesen:**
>    `template_catalog`, `message_templates`, `cascade_steps`, `reminder_touches`
>    (§3). Sie sind weder gelöscht noch lebendig — sie sind **eingefroren**. Ihre
>    Zeilen beschreiben den Zustand vom 8. bis 10. September 2026 und wachsen nicht
>    mehr. Wer sie auswertet, wertet ein abgeschlossenes Experiment aus; wer aus ihrer
>    Leere schließt „es wird nicht nachgefasst", irrt. Dasselbe Muster wie
>    `call_assignees` (§2) und `followup_templates` (§3).
> 2. **„Offen" heißt in der neuen Arbeitsliste das GEGENTEIL von
>    `setting_calls.status='offen'`.** Das ist die gefährlichste Verwechslung des
>    neuen Modells und steht ausführlich in §1 („Die abgeleiteten Zustände"). Kurz:
>    Der gespeicherte Wert heißt „Termin steht, Ergebnis fehlt", der abgeleitete
>    Zustand heißt „es steht KEIN Termin". Es gibt keine Spalte für den abgeleiteten
>    Zustand — er wird bei jedem Rendern neu berechnet.
> 3. **Recycling bleibt, aber flach.** Der Mechanismus, die vier Ursprünge und alle
>    sechs Spalten je Tabelle sind unverändert; was fällt, ist die *Staffelung* in der
>    Oberfläche: In `/settings` stehen noch **zwei** Zahlen statt sechzehn —
>    Verschiebe-Kontingent und EINE Recycling-Frist (die alle vierzehn Frist-Spalten
>    zugleich schreibt). Die grundabhängigen
>    Wartezeiten stehen weiterhin in `pipeline_settings` und werden weiterhin von der
>    eingefrorenen RPC `schedule_recycle()` ausgewertet — §5 sagt genau, was das für
>    eine Auswertung bedeutet.
>
>    **Der Versuchs-Deckel `max_attempts` ist die Zahl, die dabei zweimal die Seite
>    gewechselt hat — und für Auswertungen ist nur eine Tatsache wichtig: Er WIRKT,
>    unabhängig davon, was die Oberfläche zeigt.** `recycle_attempt()` (0033,
>    eingefroren) nullt beim Erreichen des Deckels `next_recycle_at`, der Lead
>    verschwindet also nach standardmäßig zwei Versuchen endgültig aus der
>    Wiedervorlage. Der Rückbau nahm das Feld heraus; eine Prüfung holte es zurück
>    („was wirkt, muss man sehen können"); der Auftraggeber hat es endgültig
>    herausgenommen — **der Wert bleibt, die Bedienung fällt**. Abschalten ginge
>    ohnehin nicht ohne Migration (der CHECK aus 0032 klemmt ihn zwischen 1 und 5,
>    einen „greift nie"-Wert gibt es dort nicht). Sichtbar ist die Grenze heute an
>    genau einer Stelle, und zwar am Ort der Handlung: „1 von 2" auf der Ablage-Karte
>    samt dem Satz, warum „Jetzt wieder anschreiben" dort fehlt.
>
> **Was der Rückbau NICHT angefasst hat:** die LinkedIn-Liste, den Telefon-Funnel, die
> fünf Quoten des Termin-Funnels (§5), den Trichter, die Absagequote, die
> Vergleichsseite und den Termin-Lebenszyklus (Absage, Verschiebung, No-Show-Ausgang,
> Disqualifikationsgrund). Wer eine dieser Zahlen nachrechnet, rechnet unverändert.

**Migrationen bis 0040 sind eingespielt und eingefroren.** Für Auswertungen heißt das:
Jede Tabelle, jede RPC und jeder Trigger, den dieses Dokument beschreibt, existiert
live — ob die App noch hineinschreibt, steht jeweils dabei. Was die 0032/0033-Tabellen
NICHT tragen, ist Vergangenheit: Für `reminder_touches` und die Recycling-Spalten gibt
es bewusst **keinen Backfill** (§7) — leer heißt dort „gab es damals noch nicht", nicht
„niemand hat gearbeitet". Dasselbe Muster wie beim Anruf-Log aus 0028 (§3).

**0041 ist der offene Punkt.** Sie entfernt die drei Pflichtfeld-Trigger aus 0035 und
legt den **Nachfass-Stempel** an (`follow_up_last_contacted_at` + `_by_user_id` je
Termin-Tabelle). Solange sie nicht läuft, gibt es die beiden Spalten nicht: Der Knopf
„Genervt" der Arbeitsliste antwortet mit einem eigenen Satz statt mit einer rohen
Postgres-Meldung, und **jede Zeile der Liste leuchtet dauerhaft**, weil „noch nie
kontaktiert" die einzig mögliche Antwort ist. Die LESENDE Seite ist davon nicht
betroffen — die Termine-Seite lädt mit `select("*")` und bekommt dann schlicht zwei
Felder weniger (§7).

**Historie — der Zustand davor steht in diesem Dokument an mehreren Stellen noch als
Begründung.** Zwischen dem 8. und dem 10. September war die Datenbank dem
ausgelieferten Code absichtlich voraus: 0031–0034, 0036 und 0037 lagen live, der
zugehörige Code nur auf Branch `feature/erinnerungs-kaskade`. Das war das geplante
Verifikationsfenster und gefahrlos, weil `main` keine der neuen Tabellen las. Wer
unten Sätze wie „muss **vor** dem Deploy laufen" oder „die heute produktive App
zerbräche daran" liest, liest eine Begründung aus dieser Zeit: Sie erklärt, warum eine
Migration so geschnitten und in dieser Reihenfolge eingespielt wurde — einen offenen
Punkt beschreibt sie nicht mehr.

**Und ein zweites Mal Historie: die Kaskade selbst.** Abschnitte, die Stufen, Vorlagen,
Kanäle und Touch-Fälligkeiten beschreiben, sind **nicht gelöscht, sondern als
historisch gekennzeichnet**. Sie erklären, warum vier Tabellen mit diesen Spalten
dastehen, warum `reminder_touches` echte Fremdschlüssel statt einer polymorphen
`entity_id` hat und warum `follow_up_due_at` neben `follow_up_due` liegt. Wer sie für
eine Beschreibung des heutigen Verhaltens hält, sucht eine Oberfläche, die es nicht
mehr gibt — jeder dieser Abschnitte sagt das in seinem ersten Satz.

**Frühere Nummerierung — Vorsicht beim Nachschlagen.** Bis Anfang September trugen
0031 „Erinnerungs-Kaskade" und 0032 „Lead-Recycling". Beide waren auf keiner
Datenbank eingespielt und wurden deshalb neu geschnitten statt durch
Korrektur-Migrationen ergänzt; ihr Inhalt steckt jetzt verteilt in 0031–0034.
Wer eine ältere Fassung dieses Dokuments oder Commit `b145b35` liest, findet dort
die alten Nummern — und die Tabellen `reminder_settings` und `recycle_settings`,
die es **nicht mehr gibt** (§3).

## 1. Was die App trackt (Lifecycle)

Vertriebs-Funnel eines Teams, zwei Akquise-Kanäle, die in einen gemeinsamen Termin-Funnel münden:

```
LinkedIn:  contacts (1 Zeile = 1 Pitch/DM) ──unbeantwortet──▶ FU1/FU2/FU3 (Nachfassen)
                    └──Antwort/Termin──▶ setting_calls (source_type='linkedin')
Telefon:   CSV-Import ▶ phone_leads ──Call-Outcome──▶ Rückruf | Nicht erreicht | Dead
                    └──Termin──▶ setting_calls (source_type='telefon')
Direkt:    manuell angelegter Termin ▶ setting_calls (source_type = social_media | ads | sonstige,
                                       source_detail = Freitext; Altbestand: manuell | inbound | website)

setting_calls (Erstgespräch/Qualifizierung) ──qualifiziert──▶ closing_calls (Abschlussgespräch)
closing_calls ▶ gewonnen (Umsatz = deal_volume) | verloren (lost_reason_code + optionaler Freitext) | nachfassen

Die ARBEITSLISTE /termine?view=liste — die zentrale Arbeitsfläche seit dem Rückbau:
  Jede Setting- und Closing-Zeile trägt GENAU EINEN abgeleiteten Zustand
  (src/lib/dranRegel.ts), berechnet aus status + show_status + Termin + cancelled_at
  + revived_at. Nichts davon wird geschrieben, es gibt keine Zustands-Spalte.
  Arbeitsmenge = offen | no_show | show  ─ „es steht kein Termin, der Mensch liegt
  in der Luft". Raus kommt man über zwei BEDIENTE Wege: neu terminiert (→ verlegt)
  oder tot (→ dead bzw. verloren). Dazu ZWEI Zustände, die schon aus dem Funnel
  gefallen sind, ohne dass ein status es sagt — abgesagt ohne Aussicht und No-Show
  ohne Antwort; sie liegen in der Ablage und werden auf tot/kein_close abgebildet.
  Nichts sonst nimmt eine Zeile von der Liste.
  Gold leuchtet, wer in der Arbeitsmenge liegt UND heute noch nicht gestempelt ist
  (follow_up_last_contacted_at, Migration 0041) — dieselbe Regel wie die
  LinkedIn-Liste, aus ihr herausgelöst und geteilt.
  Kein Altersschnitt: Wie lange eine Zeile schon liegt, nimmt sie NICHT herunter
  (§5.5 — die Entscheidung und ihre Vorgeschichte).

Termin-Lebenszyklus (0032) — eigene Spalten, KEIN neuer status-Wert:
  verschoben (reschedule_count, nur durch den Lead) · abgesagt (cancelled_at +
  cancel_reason_code + cancel_outlook) · No-Show mit Ausgang (no_show_resolution) ·
  disqualifiziert (disqualify_reason_code) · zurückgeholt (revived_at).

Terminal negativ (closing_calls.status='verloren' | phone_leads/setting_calls.status='dead' |
setting_calls abgesagt ohne Aussicht bzw. No-Show ohne Antwort | contacts nach FU3 ohne
Antwort) ──▶ Ablage /ablage (2 abgeleitete Ansichten, nur Ansicht)
                └──Recycling (next_recycle_at)──▶ Wiedervorlage nach einer Wartezeit,
                  zurück in denselben Funnel — außer lost_reason_code in
                  ('falsche_zielgruppe','kein_fit') bzw. disqualify_reason_code in
                  ('falsche_zielgruppe','keine_zusammenarbeit') (nie) oder
                  recycle_attempt_count ≥ max_attempts (Deckel — wirkt in der Datenbank,
                  ausgeliefert bei 2, NICHT einstellbar, §5).

HISTORISCH (bis 10.09.2026, Code gefallen — die Tabellen stehen noch, §3):
  Erinnerungs-Kaskade  cascade_steps ──▶ reminder_touches, 3 Tage / 1 Tag / 1 Stunde
  vor jedem Termin, neun benannte Kaskaden, dazu die Ereignis-Ketten nach No-Show,
  Qualifizierung und verlorenem Closing. Seite /erinnerungen (leitet nach /termine um).
```

**Zwei Nachfass-Mechanismen — nicht verwechseln.** Bis zum Rückbau waren es drei
(`/nachfassen` als Tages-Wiedervorlage, `/erinnerungen` als stundengenaue Kaskade,
Recycling als dritte Kadenz). Geblieben sind zwei, und sie unterscheiden sich um
Größenordnungen in der Zeitkörnung — genau deshalb sind es weiterhin zwei Seiten und nicht
eine. In der Seitenleiste stehen sie zusammen im Block „Meine Arbeit" (mit `/ablage`), jede
mit erklärendem Tooltip:

| Mechanismus | Frage | Körnung | Seite | Quellen |
|---|---|---|---|---|
| **Arbeitsliste** | „Wer liegt in der Luft und wurde heute noch nicht genervt?" | Tag | `/termine` (Reiter **Liste**) | alle `setting_calls` und `closing_calls` im abgeleiteten Zustand `offen`/`no_show`/`show` — unabhängig davon, ob je ein Termin stand, und **unabhängig davon, wie alt die Zeile ist** (§5.5) |
| **Telefon-Rückruf** | „Was habe ich für wann zugesagt?" | **Minute** | `/termine` (Reiter **Rückrufe**) | `phone_leads` mit `status='rueckruf'` und `callback_at` — vollständig, auch ein Rückruf vom Februar |
| **Recycling** | „Welcher tote Lead ist wieder einen Versuch wert?" | Woche/Monat | `/nachfassen` | Closing verloren, Telefon-/Setting-Lead dead, Setting abgesagt ohne Aussicht / No-Show ohne Antwort, LinkedIn FU3 ohne Antwort |

Der Telefon-Rückruf steht bewusst als eigener **Reiter** neben der Liste und nicht in ihr:
Er ist die einzige Aufgabe der ganzen Software mit einer **mit dem Lead verabredeten
Uhrzeit** und entscheidet „du bist dran" deshalb auf die Minute, während die Liste daneben
auf Tage rechnet. Zwei Dringlichkeits-Begriffe in einer Tabelle wären in derselben Spalte
zwei verschiedene Aussagen. Er steht aber auf **derselben Seite**, weil es dieselbe Frage
ist („um wen kümmere ich mich jetzt") und weil eine eigene Seite für eine Handvoll Zeilen
genau der Überbau wäre, gegen den sich der Rückbau richtet.

> **Warum `/nachfassen` bleibt, obwohl es nur noch das Recycling zeigt.** Der Grund ist
> strukturell, nicht Bequemlichkeit: Das Recycling deckt **vier** Ursprungstabellen ab,
> darunter `contacts` und `phone_leads`. Die haben gar keinen Termin und können in einer
> Terminliste nicht vorkommen — ein LinkedIn-Kontakt nach FU3 ohne Antwort wäre nach einem
> Umzug **nirgends** mehr erreichbar, denn das Listen-Board schließt genau ihn aus
> (`isDueFollowUp` verlangt `follow_up_number !== 3`, der Recycling-Zweig verlangt
> `follow_up_number = 3` — die beiden Mengen sind disjunkt). Dazu die fachliche Seite:
> „Wer offen ist, wird jeden Tag kontaktiert" ist für einen Lead mit 28–270 Tagen Wartezeit
> genau die falsche Regel.
>
> **Weg sind dort:** die Telefon-Rückruf-, Setting- und Closing-Sektion (stehen jetzt in
> der Terminliste bzw. in deren Rückruf-Reiter), die Kanal-Pillen, der aus einer Vorlage
> gerenderte Kopiertext samt Vorlagen-Herkunft und die beiden Verweise nach
> `/erinnerungen`. **Die Namen bleiben** — Route, Datei und Server-Action heißen weiter
> „nachfassen", weil Lesezeichen und der Rückweg der Detailseiten (`?from=nachfassen`)
> daran hängen; auf dem Bildschirm heißt die Seite „Recycling".
>
> **Historisch, damit die Codestellen einsortierbar bleiben:** Der LinkedIn-Zweig von
> `nachfassen_tasks` wurde schon vor dem Rückbau app-seitig verworfen (die Kadenz gehört an
> die Liste, wo auch Pitch-Text und FU-Sequenz stehen). Seit dem Rückbau liest die Seite
> die RPC `nachfassen_tasks` **gar nicht mehr** — sie ruft nur noch `recycle_tasks` (§5).
> Der Navigations-Zähler tut das noch, und genau daraus entsteht die einzige verbliebene
> Abweichung zwischen Badge und Seite (§5.4).

**Es gibt keine Überschneidungen mehr.** Bis zum Rückbau standen an genau zwei Stellen
dieselbe Ursache in zwei Mechanismen — ein Closing im Status `nachfassen` (Tages-Eintrag
*und* Kaskade `followup_msg`) und ein Erstgespräch mit `no_show` (Wiedervorlage *und* Kette
`no_show_setting`) —, und beide Seiten verlinkten dort aufeinander, statt die Logik zu
duplizieren. Mit der Kaskade ist die zweite Hälfte jedes Paars entfallen: Beide Fälle sind
heute schlicht Zeilen in der Arbeitsmenge der Terminliste.

> **⚠ `follow_up_due` steuert keine Arbeitsliste mehr — gelesen wird es trotzdem noch.** Die
> Unterscheidung ist wichtig genug für einen eigenen Absatz, weil beide Hälften falsch
> verstanden werden können:
> * **Geschrieben** wird es unverändert von `setSettingOutcome`/`setClosingOutcome` (No-Show
>   +1 Tag, unqualifiziert +7 Tage, Closing im Status `nachfassen`), und es ist auf den beiden
>   **Detailseiten weiter ein bedienbares Feld** (`SettingCallEditor`, `ClosingCallEditor`).
>   Das **Lead-Dossier** zeigt es als Ereignis in der Zeitleiste („Wiedervorlage Setting",
>   „Nachfass-Kontakt vereinbart", §5.3).
> * **Was es NICHT mehr tut:** eine Arbeitsmenge bestimmen. Die Terminliste fragt nicht nach
>   einer Wiedervorlage, sondern nach dem Zustand „es steht kein Termin" (§1) — sie liest die
>   Spalte gar nicht. Der einzige Leser, der aus ihr eine Aufgabenliste machte, war
>   `nachfassen_tasks` (Zweige ③④), und die RPC hat keinen Aufrufer mehr (§5).
>
> **Für Auswertungen heißt das:** `follow_up_due` ist ein gepflegtes Feld mit einer
> abgeschwächten Folge. Wer daraus die tägliche Arbeitsmenge ableitet, bekommt eine andere
> Menge als die Oberfläche — in beide Richtungen: Ein Setting im Status `offen` ohne Termin
> steht in der Liste, aber trägt kein `follow_up_due`; ein unqualifiziertes trägt eines, steht
> aber nicht in der Liste.

**Die Gegenrichtung: `/ablage`** (Migration 0033, Entscheidung #7 in
`docs/nachfassen-umbau/ENTSCHEIDUNGEN.md`). Die Mechanismen oben zeigen, was
noch ANSTEHT; die Ablage zeigt, was aus dem Funnel GEFALLEN ist — ein Bereich, **zwei**
Ansichten (`?liste=`), gespeist aus der RPC `dropout_lists()`. Sie ist kein dritter
Nachfass-Mechanismus, sondern eine reine Ansicht: Die Zugehörigkeit steht in **keiner
Tabelle**, sondern wird aus dem Zeilenzustand abgeleitet — eine Ablage-Tabelle wäre
eine zweite Wahrheit neben `status` und `cancelled_at` und liefe beim ersten
Statuswechsel auseinander (derselbe Fehler, den `call_assignees` hinterlassen hat, §2).
Nebeneffekt der Ableitung: Die Listen sind am ersten Tag gefüllt. Die zwei Ansichten:
**Ausgeschieden** (vier Endzustände in einer Liste) und **Sperrliste** (Details und die
Sonderrolle der Sperrliste im Begriff „Ablage" unten).

> **Aus sechs Ansichten wurden zwei — warum.** Die sechs Reiter der RPC hatten ihren Sinn,
> solange der GRUND eine Folge hatte: Er bestimmte die Recycling-Wartezeit und die Kaskade.
> Beides ist gefallen. Damit unterscheiden vier der sechs Listen nur noch die *Art* des
> Endes — und die steht seither als **Kennzeichen auf jeder Karte**
> (`DROPOUT_SOURCE_LABELS`, `src/lib/dropoutLists.ts`). Ohne diesen Chip stünde ein
> No-Show ohne Antwort nur mit „Ohne Grund" da (die RPC liefert für ihn gar keinen
> Grund-Code) und wäre von einer Absage mit vergessenem Grund nicht zu unterscheiden.
>
> **Eine Liste ist ersatzlos weg: „Abgesagt, Ersatztermin steht aus".** Sie beschrieb
> keinen Endzustand, sondern einen Lead ohne nächsten Termin — also genau den, der jetzt in
> der Hauptliste steht und täglich genervt wird. Ein Archivreiter für offene Arbeit war
> schon vorher die Ausnahme (er war der einzige mit einem Zähler); neben der Arbeitsliste
> wäre er eine zweite, stille Arbeitsliste.
>
> **Die RPC ist unverändert** (0033, eingefroren) und kennt weiterhin alle sechs Werte,
> `ersatztermin_offen` eingeschlossen — wer per SQL auswertet, bekommt sie. Die App fragt
> nur noch fünf davon ab und legt sie zu zwei Ansichten zusammen. Alte Adressen brechen
> nicht: `parseDropoutList()` bildet jeden alten `?liste=`-Wert auf die Ansicht ab, in der
> sein Inhalt jetzt liegt.

**Quer zu allem: das Lead-Dossier `/lead/[kind]/[id]`** (§5.3). Die Seiten oben zeigen
jeweils einen Ausschnitt nach *Fälligkeit*; das Dossier zeigt einen einzelnen Lead nach
*Vollständigkeit* — alles, was mit ihm je passiert ist, über alle vier Ursprungstabellen
hinweg. Es ist aus `/nachfassen` und `/ablage` als Overlay erreichbar und zählt selbst
nichts.

Begriffe:
- **Pitch / DM** = eine Zeile in `contacts`. Pitch-Datum = `pitched_at` (bzw. `created_at::date` als Fallback).
- **Liste** = `lists` (LinkedIn) bzw. `phone_lists` (Telefon). Kontakte/Leads hängen immer an einer Liste; die Liste bestimmt den Owner.
- **Anwahl** = eine Zeile in `phone_call_attempts`: 1 Wählversuch, **Ereignis-Ebene** — derselbe Lead zählt dort mehrfach.
- **Erstkontakt** = eine Firma mit `phone_leads.first_call_at` im Zeitraum: **Lead-Ebene** — jede Firma genau einmal. Wer 40-mal wählt und dabei 12 neue Firmen erreicht, hat **40 Anwahlen und 12 Erstkontakte**. Die beiden Wörter sind im ganzen Analyse-Bereich für genau diese zwei Ebenen reserviert und nicht austauschbar; ein gemeinsames Wort ergäbe zwei verschiedene Zahlen unter demselben Namen. Die RPC-Spalte heißt aus historischen Gründen weiter `calls`, zählt aber Erstkontakte (§5).
- **Setting** = `setting_calls`: gebuchter Termin + Qualifizierungsgespräch (Budget, Pain, Entscheider …). Genau eine zuständige Person (`assigned_user_id`, §2).
- **Closing** = `closing_calls`: Abschlussgespräch, entsteht aus qualifiziertem Setting (verknüpft über `closing_calls.setting_call_id`).
- **Termine** = `/termine`: die **Arbeitsfläche**, drei gleichrangige Reiter — **Liste** (Vorgabe) · **Kalender** (Monat/Woche/Tag) · **Rückrufe**. Bis zum Rückbau öffnete die Seite im Kalender und die Liste war eine versteckte Nebenansicht; jetzt ist es umgekehrt, weil die Liste die Frage beantwortet, mit der man den Tag beginnt („um wen kümmere ich mich?"), und der Kalender die, die man zwischendurch stellt („wann habe ich Zeit?"). Die Monat/Woche/Tag-Wahl erscheint **nur im Kalender**: Sie ist eine Frage *innerhalb* des Kalenders, keine Geschwister der Liste. Feste Dauern: Setting 30 min, Closing 60 min. `/setting`, `/closing` und `/erinnerungen` leiten dorthin um; die Detailrouten `/setting/[id]` und `/closing/[id]` bleiben. **Es wird nichts ausgeblendet** — auch nicht `dead`/`unqualifiziert`. Der frühere „Versteckt"-Schalter ließ Termine lautlos verschwinden; stattdessen kodiert der Chip beides zugleich: **Füllung = Typ** (Setting/Closing), **Rahmen = Status** (durchgezogen = steht noch an, gestrichelt = Ergebnis steht fest, abgeblendet = erledigt). Eine **Absage** ist dabei kein Status, sondern ein eigener Pill „Abgesagt" (`CANCELLED_PILL`) — sie lässt `status` und `show_status` unangetastet (§3), ein abgesagtes Erstgespräch stünde sonst als „Offen" im Kalender. Definitionen ausschließlich in `src/lib/terminMeta.ts` (`outlineFor`). Dieselbe Datei entscheidet, was sich **verschieben** lässt: `moveLockReason(kind, status, cancelled)` sperrt den Kalender-Drag bei einer Absage („bitte einen neuen Termin anlegen statt zu verschieben") und bei terminalem Status — `TERMINAL_SETTING_STATUS` trägt dafür seit dem ersten Produktivtag **`unqualifiziert` neben `dead`**, `TERMINAL_CLOSING_STATUS` `gewonnen` und `verloren`. Der abgeprallte Zug sagt jeweils den Grund, statt nur nicht zu greifen.
- **Termin-Art** (`setting_calls.meeting_kind`) = `link` **oder** `telefon`. Die dritte Option „Ohne" gibt es nicht mehr: Bei `telefon` ist die Rufnummer (`setting_calls.phone`) Pflicht, bei `link` der Meet-Link — ein Termin ohne beides ist einer, den niemand übernehmen kann. Bestandszeilen mit `meeting_kind is null` bleiben gültig.
- **Kanal / Quelle** = `setting_calls.source_type`. Schlüssel, Labels, Farben und die Frage, ob ein Kanal ein eigenes Akquise-Volumen hat, stehen an genau **einer** Stelle: der Kanal-Registry `src/lib/channels.ts` (§4). Nur LinkedIn (`contacts`) und Telefon (`phone_leads`) haben eine Stufe **vor** dem Termin; Ads, Social Media und Sonstige beginnen erst beim Termin und zeigen dort „—" statt 0.
- **Arbeitsliste** = `/termine?view=liste`, die zentrale Arbeitsfläche seit dem Rückbau. Geschnitten wird über drei Reiter-Werte in `?zeit=`: **Zu tun** (Vorgabe, = Arbeitsmenge) · **Verlegt** · **Alle**. Drei Knöpfe je Zeile, alle ohne Seitenwechsel: **Genervt** (stempelt, ohne Rückfrage — folgenlos), **Termin** (Datum-Zeit-Feld; danach `verlegt` und raus aus der Arbeitsmenge), **Tot** (mit Rückfrage, weil es die Zeile beendet). Genau zwei Abgangskriterien, nichts sonst. Personenachse `?wer=`: `mein` (Vorgabe, `effective_user_id ?? user.id` nach `personOf()`) oder `alle` — Letzteres nur für einen Owner mit Team-Sicht, sonst wäre der Schalter eine Lüge über zugeschnittene Daten.
- **Abgeleiteter Zustand** = die EINE Aussage je Zeile der Arbeitsliste (`terminZustand()`, `src/lib/dranRegel.ts`): `verlegt` · `offen` · `show` · `no_show` · `qualifiziert` · `closing_gelegt` · `nicht_qualifiziert` · `tot` · `close` · `kein_close`. **Steht in keiner Spalte und wird nirgends geschrieben** — er entsteht bei jedem Rendern aus `status`, `show_status`, dem Termin, `cancelled_at` und `revived_at`. Siehe die Warnung „Die abgeleiteten Zustände" unten; sie ist die wichtigste Stelle dieses Abschnitts.
- **Gold-Regel** = „du bist dran". Eine Zeile leuchtet gold, wenn sie in der Arbeitsmenge liegt **und** heute noch niemand an ihr war. Die Regel steht EINMAL (`src/lib/dranRegel.ts`) und wird von der LinkedIn-Liste (`istKontaktDran`) und der Terminliste (`istTerminDran`) geteilt — samt Farbton (`DRAN_TONE`, die vorhandenen Warn-Tokens, keine neue Farbe). Herausgelöst statt abgeschrieben: Zwei Definitionen von „du bist dran" wären genau der Fehler, den dieses Projekt an `nachfassen_tasks` vs. `isDueFollowUp` schon einmal bezahlt hat. Die *Bedingung* ist bewusst nicht geteilt — ein LinkedIn-Kontakt steht über seine Fälligkeit in der Arbeitsmenge, ein Termin über seinen abgeleiteten Zustand plus den Nachfass-Stempel; ein gemeinsamer Union-Typ über zwei so verschiedene Quellen wäre wieder Überbau.
- **Nachfass-Stempel** = `follow_up_last_contacted_at` + `follow_up_last_contacted_by_user_id` auf beiden Termin-Tabellen (Migration 0041, §3). Der Ein-Klick-Knopf „Genervt" schreibt hinein; die Zeile wird dadurch ruhig und leuchtet morgen wieder. **WIE genervt wurde, interessiert bewusst niemanden** — „DM, Anruf, WhatsApp, Mail, Brieftaube": kein Kanal, keine Stufe, kein Text. Die Spalte hält **einen Zeitpunkt, keine Historie**: Wer dreimal nachgefasst hat, hinterlässt eine Zeile, nicht drei. Ein Ereignis-Log je Klick wäre genau der Überbau, der hier abgeräumt wurde.
- **Nachfassen** = seit dem Rückbau ausschließlich das **Recycling** (`/nachfassen`, Titel auf dem Bildschirm: „Recycling"), gespeist allein aus RPC `recycle_tasks` (4 Ursprünge). `nachfassen_tasks` wird von der Seite **nicht mehr gelesen** — nur noch vom Navigations-Zähler (§5.4). Über die Anzeige legt sich **kein weiterer Schnitt**: Was die RPC als fällig liefert, steht auf dem Bildschirm (§5.5).
- **Erinnerung / Touch** = **historisch.** Eine Zeile in `reminder_touches` (Migration 0032): ein fälliger Kontakt vor einem Setting-/Closing-Termin, vor einem vereinbarten Nachfass-Kontakt oder nach einem Ereignis, stundengenau auf der Seite `/erinnerungen` gruppiert. Die Seite ist mit dem Rückbau gefallen und leitet nach `/termine` um; **kein Code erzeugt, liest oder erledigt noch einen Touch**. Die Tabelle steht weiter da und behält ihre Zeilen (§3). Nachfolger im neuen Modell ist der Nachfass-Stempel — dasselbe Ereignis in flacher Form, ohne Stufe, Kanal und Text.
- **Kaskade** = **historisch.** Die konfigurierte Abfolge von Stufen, aus der Touches entstanden: neun benannte Kaskaden je Organisation (`cascade_steps.cascade_kind`, §4), Setting und Closing mit eigenen Abständen, eine eigene Mail-Spur, jede Stufe abschaltbar. Gerechnet wurde in `src/lib/cascadeEngine.ts` (gelöscht) und zwar in Berliner Wandzeit; dazu kam die **Buchungstag-Regel** — am Tag der Vereinbarung ging keine Erinnerung raus. `cascade_steps` steht weiter da und trägt je Organisation seine 21 geseedeten Stufen; **niemand liest sie mehr**.
- **Vorlage** = **historisch.** Ein Nachrichtentext aus dem gemeinsamen Katalog (`template_catalog`, 31 Schlüssel) mit der Vorrangkette Liste > persönlich > Organisation > Auslieferungstext. Die Auslieferungstexte standen in TypeScript (`src/lib/messageTemplates.ts`, gelöscht), die Abweichungen in `message_templates`. Mit der Kaskade ist auch der Vorlagen-Editor gefallen; es gibt in der ganzen App **keinen vorformulierten Text mehr** — `/nachfassen` zeigt Namen und Grund, nicht einen fertigen Satz zum Kopieren. Einzige Ausnahme und **unverändert**: die FU-Texte der LinkedIn-Liste (`lists.fu1_text`/`fu2_text`/`fu3_text`), die das Listen-Board schon immer selbst trug.
- **Recycling** = Wiedervorlage für terminal negative Leads (Migration 0033) — die „toten Enden" der Pipeline, an denen ein Lead sonst spurlos verschwindet: `closing_calls.status='verloren'`, `phone_leads.status='dead'`, `setting_calls.status='dead'` oder `unqualifiziert`, ein Erstgespräch mit `cancel_outlook='ohne_aussicht'` bzw. `no_show_resolution='ohne_antwort'`, `contacts` nach FU3 ohne Antwort. Der **Mechanismus bleibt unverändert**, die Staffelung nicht: In `/settings` steht seit dem Rückbau **EIN** Feld „Recycling — Wartezeit (Tage)", und es schreibt **alle vierzehn** Frist-Spalten in `pipeline_settings` mit derselben Zahl. Gerechnet wird weiterhin **serverseitig** in `schedule_recycle()` — der Grund kommt aus der Ursprungszeile, nicht vom Client (§5). Vier Codes bekommen bewusst nie ein Recycling-Datum: `lost_reason_code` in `falsche_zielgruppe`/`kein_fit`, `disqualify_reason_code` in `falsche_zielgruppe`/`keine_zusammenarbeit`. Der Versuchs-Deckel `max_attempts` **wirkt weiter, ist aber NICHT einstellbar** — er hat kein Feld in `/settings` (mehr) und steht auf seinem gespeicherten Wert, ausgeliefert 2. Sichtbar wird er nur an der Ablage-Karte („1 von 2") und in der Sperrbegründung von `recycleBlockedReason` (Begründung im Kasten am Dokumentanfang und in §5).
- **Ablage** = `/ablage`, **zwei** abgeleitete Ansichten ausgeschiedener Vorgänge (RPC `dropout_lists`, §5): **Ausgeschieden** (abgesagt ohne Aussicht · disqualifiziert · kein Close · No-Show ohne Antwort, zusammengelegt, mit Kennzeichen je Karte) und **Sperrliste**. Die Sperrliste ist die **einzige Ansicht der App, die die Datensicht bewusst ignoriert** und immer org-weit liefert: Ein Kontaktverbot, das nur sein Besitzer sieht, ist keines — die nächste Person spräche den Lead sonst neu an. Sie ist außerdem die einzige, die alle vier Recycling-Tabellen abdeckt; die vier zusammengelegten Endzustände beschreiben Ereignisse, die es nur an einem Termin gibt.
- **Lead-Dossier** = `/lead/[kind]/[id]` (`src/lib/leadDossier.ts`, §5.3) — die Akte EINES Leads über alle vier Ursprungstabellen hinweg: Verlauf, Kontaktwege, Steckbrief, Notizen. Kein Zähl-, sondern ein Nachschlagewerk; es kommt in keiner Auswertung vor. Entscheidend ist die **Zwei-Stufen-Lösung der Lead-Identität**: belegt vs. vermutet (§5.3) — Vermutetes zählt nirgends mit.
- **Navigations-Zähler** = **ein** Badge in der Seitenleiste (`src/lib/navCounts.ts`, §5.4), an `/nachfassen`. Aus drei wurden zwei wurden einer: Der Erinnerungs-Zähler fiel mit der Kaskade (ein Zähler auf `reminder_touches` zählte danach eine Tabelle, die keine Oberfläche mehr füllt — erst dauerhaft dieselbe Zahl, dann dauerhaft 0, und beides ist eine Aussage über nichts), der Ablage-Zähler mit der Ablage-Liste, die er zählte (§5.4). `/termine` hat bewusst **keinen** bekommen, obwohl dort jetzt die meiste Arbeit liegt (§5.4). `null` heißt „nicht ermittelbar", **nicht** „null Aufgaben" — bei einem Fehler verschwindet das Badge, statt eine beruhigende 0 zu behaupten.
- **Kontaktfrequenz-Warnung** = **gefallen als Warnung, geblieben als Sprechweise.** Der amberfarbene Hinweis „Zuletzt kontaktiert vor …" auf den Nachfass- und Erinnerungs-Karten (Entscheidung K3, `CONTACT_GAP_WARN_DAYS = 3`) hatte seine Datenbasis in den erledigten Kaskaden-Touches; ohne sie wäre die einzige verbliebene Quelle der letzte Versuch DESSELBEN Vorgangs gewesen, den die Warnung ausdrücklich ausschloss — sie hätte einen Roundtrip je Seitenaufruf gekostet und niemals angeschlagen. Die Warnung ist damit weg, und mit ihr die Frage, die sie beantwortete: Die neue Liste sagt „wer offen ist, wird jeden Tag kontaktiert", da gibt es keine Obergrenze mehr zu bewachen. **`src/lib/contactGap.ts` bleibt** — `dayDiff()` und `lastContactLabel()` beschriften jetzt „Zuletzt kontaktiert" im Lead-Dossier (§5.3) und die Unterzeile jeder Zeile der Arbeitsliste („heute genervt · kevin", „vor 3 Tagen", „noch nie kontaktiert"). Dieselbe Zahl muss überall gleich heißen.

### Die abgeleiteten Zustände — und die gefährlichste Verwechslung des neuen Modells

> **⚠ `offen` heißt in der Arbeitsliste das GEGENTEIL von `setting_calls.status='offen'`.**
>
> In der Datenbank ist `offen` der **Anfangszustand jeder Zeile** und bedeutet „ein Termin
> steht, das Ergebnis fehlt noch". In der Arbeitsliste bedeutet `offen` „es steht **kein**
> Termin — der Mensch liegt in der Luft". Dieselben fünf Buchstaben, entgegengesetzte
> Aussagen.
>
> Deshalb wurde beim Rückbau **nichts umgedeutet und nichts geschrieben**: Der Zustand wird
> bei jedem Rendern neu abgeleitet. Wer den gespeicherten Wert stattdessen übernommen hätte,
> hätte die Bedeutung des halben Bestands umgedreht, ohne dass irgendwo eine Zahl rot
> geworden wäre. Für Auswertungen gilt: **`status='offen'` ist keine Arbeitsmenge.** Wer die
> Arbeitsliste in SQL nachbauen will, muss die Ableitung unten nachbauen.

Berechnet in `terminZustand()` (`src/lib/dranRegel.ts`), Reihenfolge ist die ganze
Fachlichkeit:

1. **Ergebnis schlägt alles.** Ein toter, disqualifizierter, gewonnener oder verlorener
   Vorgang ist vorbei — egal welches Datum in der Zeile steht. `qualifiziert` und
   `closing_gelegt` beenden ihn nicht, schieben ihn aber ins Closing weiter; die Arbeit hängt
   ab dort an der Closing-Zeile, sonst stünde derselbe Mensch zweimal auf derselben Liste.
2. **Abgesagt UND ohne Aussicht?** Dann ist er aus dem Funnel → `tot` (Setting) bzw.
   `kein_close` (Closing). Steht **vor** der Termin-Frage, weil die Zeile ihr altes Datum
   behält; `revived_at` hebt es auf.
3. **Steht ein Termin?** Dann ist er versorgt → `verlegt`. Verglichen wird auf **Berliner
   Kalendertage**, nicht auf die Minute: Die Liste hat Tages-Körnung wie alles außer dem
   Telefon-Rückruf (§6), und ein Termin, der heute um 10:00 war, soll nicht ab 10:01 golden
   mahnen — dafür gibt es den No-Show-Eintrag.
4. **Was ist beim Termin passiert?** `show_status` ist die einzige Quelle dafür;
   `closing_calls` kennt gar keinen No-Show-Status (§4). Ein No-Show mit
   `no_show_resolution='ohne_antwort'` ist ebenfalls aus dem Funnel (wieder `tot`/`kein_close`)
   — geprüft **nach** der Termin-Frage, damit ein inzwischen angesetzter Ersatztermin gewinnt.
5. Sonst: `offen`.

> **⚠ Die Grenze zur Ablage liegt NICHT im Status — Schritt 2 und die zweite Hälfte von
> Schritt 4 sind genau deshalb da.** Der Termin-Lebenszyklus aus 0032 hat bewusst keinen
> neuen `status`-Wert bekommen (§3): Eine Absage steht in `cancelled_at` + `cancel_outlook`,
> ein No-Show ohne Antwort in `no_show_resolution` — `status` bleibt in beiden Fällen `offen`
> bzw. der Show-Status stehen. Ohne die beiden Prüfungen landeten diese Zeilen als
> `offen`/`no_show` in der Arbeitsmenge, und **genau das ist einmal passiert**: Ein „abgesagt
> ohne Aussicht" stand täglich gold in „Zu tun" *und* gleichzeitig in der Ablage. Die eine
> Seite sagte „aus dem Funnel gefallen", die andere „nerve ihn heute", und es gab keinen
> Handgriff, der das aufgelöst hätte — außer die Zeile ein zweites Mal auf Tot zu setzen.
>
> Einen elften Zustand „ausgeschieden" gibt es dafür bewusst nicht: Die zehn sind wörtlich die
> Liste des Auftraggebers, und beide Fälle haben in seinen Worten längst einen Namen — beim
> Erstgespräch „Tot", beim Closing „Kein Close". Beide stehen ohnehin genau so in der Ablage
> unter „Ausgeschieden" und werden vom Recycling später wieder hervorgeholt.
>
> **Für Auswertungen heißt das:** Wer die Arbeitsmenge in SQL nachbaut, muss `cancel_outlook`
> und `no_show_resolution` mit abfragen. Ein Nachbau, der nur `status` und `appointment_at`
> liest, liefert systematisch zu viele Zeilen — und zwar genau die, die in der Ablage liegen.

**Die Absage schlägt das Datum — und das ist kein Detail.** `cancelAppointment` setzt
`cancelled_at` und lässt `appointment_at` unangetastet (0032 gibt der Absage eigene Spalten,
damit sie aus dem Show-Quoten-Nenner fällt, §3). Unmittelbar nach einer Absage trägt die Zeile
deshalb eine Absage UND ein Datum in der Zukunft — man sagt ja ab, BEVOR der Termin ist. Wer
nur auf das Datum sieht, hält einen abgeräumten Termin für „versorgt" und nervt den Menschen
nie wieder.

Der naheliegende Ausweg trägt nicht: „Ist das Datum jünger als die Absage?" ist **immer
wahr** — verglichen würden ein Ereignis- und ein Entscheidungszeitpunkt, und der Termin liegt
definitionsgemäß hinter seiner Absage. Aus den beiden Spalten allein ist „abgesagt, altes
Datum steht noch drin" von „abgesagt, danach neu terminiert" **nicht** zu unterscheiden.
Deshalb entscheidet ein drittes Feld, und zwar eines, das es dafür schon gab: **`revived_at`**
sagt ausdrücklich „die Absage ist überholt". Gesetzt wird es beim Ansetzen eines neuen Termins
(`setNeuerTermin`, `src/app/actions/followUpStamp.ts`) — bis zum Rückbau schrieb es nur
`reviveDropout()` aus der Ablage (§3).

**Die Arbeitsmenge** („Zu tun") sind genau drei Zustände, und alle drei bedeuten dasselbe —
es steht kein Termin:

| Zustand | Bedeutung |
|---|---|
| `offen` | nie einer gewesen, abgesagt, oder vorbei ohne Eintrag |
| `no_show` | er kam nicht, und niemand hat neu terminiert |
| `show` | er kam, und danach ist nichts passiert — auch das ist „in der Luft": ein Erstgespräch ohne Ergebnis und ohne Folgetermin führt von allein nirgendwohin |

`verlegt` ist bewusst **nicht** dabei (er ist versorgt), die sechs Ergebnis-Zustände ebenso
wenig — die beenden den Vorgang oder schieben ihn eine Stufe weiter, wo er seine eigene Zeile
hat. „Bei Offen liegt jemand in der Luft. Bei Verlegt ist er versorgt."

**Nachbau in SQL** (Setting; für Closing `call_at` statt `appointment_at`, `gewonnen`/
`verloren` statt der vier Setting-Endzustände):

```sql
-- Die Arbeitsmenge der Liste: Zeilen ohne stehenden Termin und ohne Ergebnis.
-- Die Reihenfolge der Bedingungen entspricht den fünf Schritten oben.
select sc.id, sc.lead_name, sc.company
from setting_calls sc
where sc.status not in ('dead', 'unqualifiziert', 'qualifiziert', 'closing_gelegt')
  -- Schritt 2: abgesagt ohne Aussicht = aus dem Funnel. KEIN Status sagt das.
  and not (sc.cancelled_at is not null
           and sc.cancel_outlook = 'ohne_aussicht'
           and sc.revived_at is null)
  -- Schritt 4: No-Show, auf den nie eine Antwort kam — ebenfalls aus dem Funnel.
  and sc.no_show_resolution is distinct from 'ohne_antwort'
  and not (                                    -- Schritt 3: „verlegt" = es steht ein Termin
        sc.appointment_at is not null
    and (sc.cancelled_at is null or sc.revived_at is not null)
    and (sc.appointment_at at time zone 'Europe/Berlin')::date
        >= (now() at time zone 'Europe/Berlin')::date
      );

-- „Gold": davon alles, was heute noch nicht gestempelt wurde (Migration 0041).
--   and (sc.follow_up_last_contacted_at is null
--        or (sc.follow_up_last_contacted_at at time zone 'Europe/Berlin')::date
--            < (now() at time zone 'Europe/Berlin')::date)

-- Und das ist alles. Die Seite lässt NICHTS WEITERES weg: Hier stand einmal
-- ein zusätzlicher Altersschnitt (§5.5) — er ist gestrichen. Wer diese Abfrage
-- gegen den Bildschirm hält, bekommt dieselbe Menge.
```

Die Reihenfolge im Nachbau ist nicht beliebig: Schritt 2 steht **vor** Schritt 3, weil eine
abgesagte Zeile ihr altes Datum behält, und Schritt 4 **nach** Schritt 3, damit ein inzwischen
angesetzter Ersatztermin den alten No-Show-Ausgang schlägt.

## 2. Workspace- & Sichtbarkeitsmodell

- Ein **Workspace = eine Organisation = ein Kunden-Mandant.** Ein User hat genau **eine** Mitgliedschaft (`workspace_members`) — das ist eine harte Annahme: `getAccessContext()` würde bei zwei Mitgliedschaften den Nutzer aussperren (Redirect `/onboarding`, wo `bootstrap_workspace` mit `'Already in a workspace'` abbricht). Die Umzugsfunktion löscht die alte Mitgliedschaft deshalb, statt eine zweite anzulegen.
- **Plattform-Admins (`platform_admins`, Migration 0025)** stehen *oberhalb* der Organisation: Simon und Kevin dürfen jede Organisation lesen und dort schreiben, sind aber **in keiner Kunden-Organisation Mitglied**. Sonst erschienen sie im Team-Dashboard und in der Datensicht-Auswahl des Kunden — und umgekehrt.
  - Technisch: `is_platform_admin()` (SECURITY DEFINER, `stable`) + je eine zusätzliche permissive RLS-Policy `<tabelle>_platform_admin` auf 20 Tabellen (17 aus Migration 0025, `phone_call_attempts` aus 0028, `message_templates` aus 0031, `reminder_touches` aus 0032). Die bestehenden `can_access_*`-Helfer bleiben unangetastet.
  - **`can_manage_org_settings(workspace_id)`** (Migration 0031) ist der benannte Helfer für Organisations-Einstellungen: Owner mit `data_scope='workspace'` **oder** Plattform-Admin. Er schließt eine Lücke, die vorher offen stand — die App prüfte `role='owner' && data_scope='workspace'` (`access.can_switch_view`), die RLS aber nur `role='owner'`: Ein Owner mit `data_scope='own'` war in der Oberfläche gesperrt, hätte per direktem PostgREST-Aufruf aber schreiben dürfen. `pipeline_settings`, `cascade_steps` und die Org-Ebene von `message_templates` hängen daran; `is_platform_admin()` steckt bereits darin, deshalb brauchen `pipeline_settings`/`cascade_steps` keine eigene Admin-Policy.
  - Die 9 Metrik-RPCs sind über einen einzigen Zweig in `rpc_effective_user` org-übergreifend — keine RPC musste dafür geändert werden. `recycle_tasks` und `dropout_lists` (0033) folgen demselben Muster, damit sind es elf.
  - **`profiles.is_super_admin` ist NICHT dieses Flag.** Die Spalte existiert live, wird von keiner Zeile Code gelesen und ist als Berechtigung unbrauchbar, weil `profiles_update_own` jedem Nutzer erlaubt, seine eigene Profilzeile zu ändern. Ein Trigger aus Migration 0025 friert sie ein.
- **Aktive Organisation:** `AccessContext.workspace_id` meint die *aktive* Organisation, nicht zwingend die eigene. Für einen Plattform-Admin steuert der Cookie `pt_active_workspace_id` (8 h, httpOnly) den Wechsel; in fremder Org werden `role='owner'` und `data_scope='workspace'` synthetisiert, damit alle Owner-Gates greifen. `is_foreign_org` schaltet die roten Warnbanner. Ein Org-Wechsel löscht immer den Datensicht-Cookie.
- **`workspace_id` beim INSERT immer explizit setzen.** Die BEFORE-INSERT-Trigger leiten es sonst aus der Mitgliedschaft ab — was für einen Plattform-Admin in einer Kunden-Org die falsche Organisation wäre. Seit Migration 0025 wirft der Trigger in genau diesem Fall, statt still zu raten. Ausnahme: `contacts` und `phone_leads` erben es korrekt von ihrer Elternliste.
- Zwei unabhängige Achsen auf `workspace_members`:
  - `role`: `owner` | `member` → Admin-Rechte (Team-Dashboard `/team`, Nutzerverwaltung, Owner-Auswahl beim Import).
  - `data_scope`: `workspace` | `own` → Datensichtbarkeit (`own` sieht nur eigene Daten; RLS + RPCs erzwingen das).
- **Owner-Zuordnung von Listen: `owner_name` hat Vorrang vor `created_by_user_id`** (`list_owned_by_user()` in SQL, `buildOwnScope()` in `src/lib/access.ts`). Ein Admin kann eine Liste FÜR ein Mitglied anlegen (owner_name = Mitglied, created_by = Admin) — die Zahlen zählen dann beim Mitglied. `owner_name` matcht auf `profiles.username`.
  - **Der Inhaber muss Mitglied der aktiven Organisation sein** — geprüft in `resolveListOwner()` (`src/app/actions/phone.ts`), und `owner_name` kommt dort aus `profiles`, nie aus dem Formular. Ein Plattform-Admin ist in einer Kunden-Org **kein** Mitglied; sein Name als `owner_name` macht die Liste heimatlos: Sie erscheint auf `/telefon` unter einer Person, die es dort nicht gibt, ihre Leads zählen in **keiner** `rpc_phone_*` mit (`list_owned_by_user()` findet den Namen nicht), und sobald eine Datensicht aktiv ist, fällt sie aus dem Personenfilter. Genau das verlangt auch die `owner_name`-Invariante in §8. Der Import-Dialog erzwingt die Auswahl deshalb, sobald der Anmeldende selbst kein Mitglied ist — die frühere Bedingung `users.length > 1` griff ausgerechnet bei der Ein-Personen-Kundenorganisation nicht und fiel still auf den Admin zurück.
  - **Lesen und Schreiben müssen dieselbe Regel benutzen.** `/telefon` filterte die Übersicht über `created_by_user_id`, die Detailseite `/telefon/[listId]` über `owner_name` — eine Liste konnte dadurch in der Übersicht fehlen *und* beim direkten Aufruf 404 liefern, obwohl sie existiert. Beide laufen jetzt über `ownScopeFilter()`. Die Detailseite lädt zusätzlich ungefiltert und prüft die Zuordnung in JS (`matchesOwnScope()`), um „gibt es hier nicht" (404) von „gibt es, aber die Datensicht zeigt woandershin" (Erklärseite) zu trennen; gefiltert abgefragt sind beide Fälle dieselbe leere Antwort.
- **Personen-Zuordnung von Terminen: `assigned_user_id`, nicht `created_by_user_id`.** `setting_calls` und `closing_calls` haben **kein** `owner_name`; stattdessen trägt jede Zeile genau EINE zuständige Person in `assigned_user_id`. Maßgeblich für **jede** Auswertung ist `coalesce(assigned_user_id, created_by_user_id)` — in SQL wörtlich so, im Code `personOf()` / `personIn()` (`src/lib/personResolution.ts`).
  - **Zwei Spalten, zwei Bedeutungen:** `created_by_user_id` = Audit („wer hat geklickt"), immer die real angemeldete Person. `assigned_user_id` = Fachlichkeit („wem gehört der Termin"). Warum das getrennt gehört: Bis Migration 0028 landete in `created_by_user_id` die eingestellte *Datensicht* statt des Anmeldekontos — wer mit der Datensicht eines Kollegen arbeitete, schrieb sämtliche Termine auf ihn. Zusätzlich entsteht ein Closing ausschließlich über „Qualifiziert" im Setting, wurde also faktisch immer von derselben Person angelegt.
  - **Gesetzt wird beim Anlegen, nie beim Lesen** (`src/app/actions/appointments.ts`, `createClosingFromSetting`): LinkedIn/Telefon → Owner der **Quellliste** (`owner_name` hat Vorrang vor `created_by_user_id`, `ownerUserIdOfList`), manuell → der Anlegende, Closing → erbt vom Setting. Bestandsdaten per Backfill in 0028 nach derselben Reihenfolge (bestehende `call_assignees`-Zeile → Owner der Quellliste → Ersteller der Quellliste → Ersteller des Termins). Deshalb braucht keine Auswertung Quellketten-Joins.
  - Umverteilen von Hand: `setAssignee()` (`src/app/actions/assignees.ts`), nur für `role='owner'` mit `data_scope='workspace'`. `null` = „Niemand" — die Auswertung fällt dann auf den Ersteller zurück.
  - **RLS kennt die Zuweisung:** `setting_calls_scoped_member` / `closing_calls_scoped_member` prüfen `created_by_user_id` **oder** `assigned_user_id`. Ohne diesen zweiten Zweig verschwände ein Termin, den ein Admin FÜR ein Mitglied mit `data_scope='own'` anlegt, aus dessen Sicht komplett.
  - In fremder Organisation bleibt `assigned_user_id` NULL: Ein Plattform-Admin ist dort kein `workspace_members`-Eintrag, seine `user_id` wäre eine Zuweisung über die Org-Grenze.
- **`call_assignees` ist tot.** Die Tabelle existiert weiter (0026/0027 fassen sie an) und enthält Alt-Zeilen, wird aber von keiner Zeile Code mehr gelesen oder geschrieben. Für Auswertungen nicht verwenden — sie beschreibt den Stand vor 0028.
- Persönliches Dashboard `/` = genau eine Person; Team-Dashboard `/team` = workspace-weit (nur `role='owner'` mit `data_scope='workspace'`). Admins können per Cookie die Datensicht eines Mitglieds einnehmen.
  - `/team` beantwortet **eine** Frage: „wie läuft die Woche". Es trägt genau zwei Sektionen — Wochenduell (inkl. Verlauf der letzten 10 Wochen) und Team-Vergleich —, und **alle** Zahlen liegen im selben Fenster: die laufende Woche Mo–So, oben abgeschnitten bei heute. Vorher standen dort drei Fenster nebeneinander (Woche für DMs/Quoten, 30 Tage für Telefon, all-time für Umsatz), wodurch die Karten untereinander nicht vergleichbar waren. Die frühere Funnel-Sektion ist entfernt: Sie zeigte Bestandszahlen über den gesamten Datenbestand neben lauter Wochenzahlen. Tiefenanalyse gehört nach `/analyse` — dort steht sie in genau einer Zählweise (§5.1).
- **Zwei geschachtelte Umschalter:** Der Org-Umschalter (rot, nur Plattform-Admins) wechselt die *Organisation*, die Datensicht (orange) wechselt die *Person* innerhalb der aktiven Organisation. Rot steht über Orange — äußere Grenze zuerst.
- **Organisation anlegen:** Seit Migration 0034 hängt ein AFTER-INSERT-Trigger `workspaces_seed_defaults` auf `workspaces` und ruft `seed_workspace_defaults()` — eine `pipeline_settings`-Zeile und 21 `cascade_steps` (16 aktiv, 5 abgeschaltete Mail-Stufen). **Seit dem Rückbau ist nur noch die erste Hälfte davon in Gebrauch:** `pipeline_settings` trägt weiterhin das Verschiebe-Kontingent und die Recycling-Fristen, die 21 Kaskadenstufen liest niemand mehr (§3). Der Trigger legt sie trotzdem an, und das ist Absicht — ihn zu ändern hieße, 0034 anzufassen, und die ist eingefroren; eine neue Migration nur dafür brächte nichts ein außer 21 nicht angelegten Zeilen je neuer Organisation. Die Invariante in §8 erwartet sie deshalb weiterhin, jetzt als **Einspiel-Kontrolle statt als Funktionsprüfung**. Bewusst ein Trigger statt einer Ergänzung in `bootstrap_workspace()` **und** `platform_create_workspace()`: Ein Kunde entsteht über den einen Pfad, ein anderer über den anderen — ein Trigger deckt beide ab und zusätzlich jeden künftigen, ohne dass jemand daran denken muss. Textzeilen legt er bewusst **keine** an (§1, Begriff „Vorlage"). Bestehende Organisationen wurden in 0034 nachgezogen.
- **Organisation löschen:** `preview_delete_workspace()` / `platform_delete_workspace()` (Migration 0027, UI unter `/admin/org/[id]`). An `workspaces` hängen inzwischen **19 Fremdschlüssel mit `on delete cascade`** (15 plus `message_templates`, `pipeline_settings`, `cascade_steps`, `reminder_touches`) — ein `delete` nimmt den kompletten Datenbestand der Organisation mit, ohne Undo. **Historie — die Vorschau zählte lange weniger, als gelöscht wird:** Die Fassung aus 0027 nannte 13 Tabellen und kannte weder `phone_call_attempts` (0028) noch die vier neuen; gelöscht wurden sie trotzdem. Eine Löschvorschau, die weniger nennt als sie löscht, ist gefährlicher als gar keine. **Migration 0036 hat das behoben:** `counts` trägt jetzt **18 Tabellen** (die 13 plus `phone_call_attempts`, `message_templates`, `pipeline_settings`, `cascade_steps`, `reminder_touches`); zusammen mit `workspace_members`, das die Vorschau getrennt unter `members` führt, sind das genau die 19 Kaskaden. Die Verifikation dazu ist bewusst kein Abzählen, sondern eine `pg_constraint`-Abfrage: Sie listet jede Tabelle mit `on delete cascade` auf `workspaces`, die **nicht** als Schlüssel in `counts` vorkommt — und wird damit von selbst wieder rot, sobald jemand eine neue Tabelle anhängt. `platform_delete_workspace()` blieb unverändert; sie vergleicht die Vorschau-`counts` gegen `p_expected` und übernimmt die neuen Schlüssel automatisch. Die Funktion verweigert, solange noch Mitglieder da sind (sonst blieben verwaiste Accounts zurück: Mitgliedschaft kaskadiert weg, Login bleibt), und bei der eigenen Organisation; die UI verlangt zusätzlich das Abtippen des Namens.
- **Nutzer verschieben:** `preview_move_user()` / `admin_move_user_to_workspace()` (Migration 0026, über **0036** und **0038** auf dem aktuellen Stand, UI unter `/admin/org/[id]`). Der Umzug stempelt `workspace_id` auf inzwischen **17 Tabellen** um (16 reine `workspace_id`-Stempel plus die Mitgliedschaft selbst) und kappt Kanten, die über die neue Org-Grenze zeigen (Termin ohne Quellkontakt, Closing ohne Setting, Smart View ohne Ordner) — genullt, nicht blockiert, weil `lead_name`/`company` als Snapshot vorliegen. Besitz-Ermittlung ausschließlich in `move_user_scope()`, damit Vorschau und Umzug nie auseinanderlaufen.
  - **Was 0036 nachgezogen hat:** die persönlichen `message_templates` (`user_id = <umziehender>`, Org-Standards mit `user_id is null` bleiben stehen) und die `reminder_touches` an den mitziehenden Terminen. Die zurückgebliebene Vorlage war dabei der leiseste Fehler: Die Vorrangkette ersetzt den fehlenden Text lautlos durch den Org-Standard — der Nutzer sieht keinen Fehler, sondern einen anderen Text. Die **Reihenfolge im Umzug ist tragend**: Die beiden neuen Stempel laufen NACH dem Mitgliedschaftswechsel, sonst entwertete `reminder_touches_ws_guard` die Erinnerungen des Umziehenden reihenweise, weil er in der Zielorganisation noch kein Mitglied war. Neu ist außerdem eine Vorbedingung: Liegen in der Zielorganisation schon persönliche Vorlagen desselben Nutzers, bricht der Umzug ab — `uq_message_templates_user (workspace_id, user_id, template_key)` aus 0031 kollidierte sonst mitten im Schreiben. (`performance_targets` und `followup_templates` haben dieses Problem nicht: Ihre Unique-Keys führen `workspace_id` gar nicht.) Erinnerungen, die an Terminen der ALTEN Organisation hängen, werden vor dem Umzug *superseded* statt gelöscht — die Erledigungs-Historie speist die „Erinnerungs-Disziplin" (§5.1); die Vorschau meldet sie als eigenen Warncode `reminder_touch_superseded`.
  - **Was 0038 nachgezogen hat — und was als einzige Lücke bleibt.** `phone_call_attempts` (0028) zog bis dahin **nicht** mit: Telefonlisten und Leads wanderten, das Anruf-Log blieb in der alten Organisation liegen und war damit doppelt unerreichbar — in der neuen fehlte die Historie zu sichtbaren Leads, in der alten stand Historie zu Leads, die es dort nicht mehr gibt. 0038 stempelt sie mit, und zwar **am Lead entlang, nicht an der Liste**: `list_id`/`owner_name` sind Snapshots des Anrufzeitpunkts (§3), über sie gezählt fehlten ausgerechnet die Anwahlen der in eine Routing-Liste weitergezogenen Leads. Die Snapshots selbst bleiben unangetastet; der Restfall — Anwahl in der neuen Organisation, Listen-Snapshot in der alten — erscheint als Vorschau-Warnung `attempt_list_snapshot_split` und ist eine bewusst offen gelassene Produktentscheidung, keine Panne. **Einen Backfill gibt es nicht:** Anwahlen aus Umzügen VOR 0038 bleiben liegen, weil nirgends steht, welcher Lead damals mit wem umgezogen ist — die Invariante in §8 nennt die Zahl, korrigiert wird sie höchstens von Hand.
  - **Die eine Lücke, die mit Ansage bleibt:** `move_user_scope()` ist von 0036 und 0038 bewusst **nicht** angefasst — ein weiterer OUT-Parameter wäre eine Signaturänderung, und ihre bestehenden Ausgaben reichen. Sie ermittelt den Besitz an Terminen deshalb weiterhin über `created_by_user_id`: Ein Termin, der dem Umziehenden nur *zugewiesen* ist, bleibt zurück.
  - Der Guard-Trigger `assigned_user_guard` (0028) greift bei `update of workspace_id` — und seit 0040 zusätzlich beim INSERT (`setting_calls_assigned_guard_ins` / `closing_calls_assigned_guard_ins`) sowie bei `update of assigned_user_id` — und nullt eine Zuweisung, die über die neue Grenze zeigen würde; sein Pendant `reminder_touches_ws_guard` (0032, seit 0039 ebenfalls zusätzlich als `reminder_touches_ws_guard_ins` beim INSERT) *supersedet* statt zu nullen, damit die Erledigungs-Historie erhalten bleibt. Zurückbleibende Zeilen fasst keiner von beiden an — deshalb die Invarianten in §8.
- **Wichtig für MCP-Auswertungen:** `execute_sql` läuft direkt auf Postgres **an RLS vorbei** — man sieht alle Daten. Personenfilter daher immer explizit setzen: bei Listen-Daten (LinkedIn/Telefon) über `lists.owner_name` / `phone_lists.owner_name` (Vorrang) bzw. `created_by_user_id`, bei `setting_calls`/`closing_calls` über `coalesce(assigned_user_id, created_by_user_id)` — jeweils auf `profiles.username` gejoint.

## 3. Tabellen-Glossar

### LinkedIn-Funnel

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `lists` | LinkedIn-Pitch-Listen. `name`, `owner_name` (Besitzer, matcht `profiles.username`), `created_by_user_id`, `pitch_text` (Vorlage), `fu1_text`/`fu2_text`/`fu3_text` (Nachfass-Sequenz der Liste, `{name}`-Platzhalter), `archived_at`. |
| `contacts` | 1 Zeile = 1 gepitchter LinkedIn-Kontakt. `list_id` → `lists` (Trigger setzt `workspace_id`). Kernfelder: `name`, `company`, `pitched_at` (date), `answered` (bool), `answer_category` (§4), `answer_text`, `follow_up_number` (0–3), `next_follow_up_at` (date), `appointment_set` (bool), `appointment_at` (timestamptz), `meet_link`, `linkedin_url`, `target_group` (Freitext-Zielgruppe, Achse „Zielgruppe" im Vergleich), `setting_call_id` → `setting_calls`, `blocked_at` (timestamptz — Lead hat uns auf LinkedIn blockiert; App nullt `next_follow_up_at`, RPCs schließen blockierte zusätzlich aus). Recycling (Migration 0033, **dieselben sechs Spalten auf allen vier Ursprungstabellen**): `next_recycle_at` (date, gesetzt sobald FU3 ohne Antwort abgeschlossen wird — dafür ruft **`updateContact`** `schedule_recycle('linkedin', …)`; der zweite Schreibpfad `advanceLinkedInFollowUp` lag im Nachfassen-Board und ist mit dessen LinkedIn-Sektion gefallen, die Kadenz gehört an die Liste), `recycle_attempt_count`, `recycle_excluded_at` (permanentes Opt-out = Sperrliste, unabhängig von `blocked_at`), `recycle_last_contacted_at`, `recycle_responded_at` (**ohne diesen Zeitstempel gibt es keine Wiederbelebungsquote** — und damit keine Grundlage, die Wartezeiten begründet zu ändern), `recycle_reason_code`. CHECK: `recycle_excluded_at` und `next_recycle_at` schließen sich aus. Legacy-CRM: `stage_id` → `pipeline_stages`, `deal_value`, `deal_closed`, `deal_lost_reason`, `meeting_notes`, `custom_fields` (jsonb). |
| `pipeline_stages` | Legacy-CRM-Stufen je Liste mit `probability_pct` (0–100) und `exclude_from_followup`. Defaults beim Anlegen: Neu 10 %, Gespräch 30 %, Angebot 60 %, Verhandlung 80 %, Gewonnen 100 %, Verloren 0 %. In der aktiven Tracking-UI kaum genutzt — **nicht** die „Termin-Wahrscheinlichkeit" des Setting-Flows (die gibt es nicht als Prozentwert). |

### Telefon-Funnel

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `phone_lists` | Telefonlisten. `list_kind`: `akquise` (Import) \| `rueckruf` \| `nicht_erreicht` — die beiden Routing-Listen existieren je Owner genau einmal (Leads werden bei entsprechendem Outcome physisch dorthin verschoben). `owner_name`, `created_by_user_id`. Seit Migration 0029: `script_text` (Gesprächsleitfaden dieser Liste), `script_label` (**Testarm** des A/B-Tests — die Gruppierungsachse; zehn Importlisten mit demselben Label sind ein Arm mit belastbarer Fallzahl), `target_group` (Listen-Default der Ziel-Branche, wird beim Import auf jeden Lead gestempelt). Alle drei freies `text` ohne CHECK: Skriptvarianten und Zielbranchen entstehen laufend neu, ein Enum wäre eine Migration pro Test. |
| `phone_leads` | 1 Zeile = 1 Firma/Lead. `first_call_at` (date, Tag des **Erstkontakts** — beim ersten Anruf gesetzt und danach nie wieder; §1), `decider_name`, `company`, `phone`, `status` (§4), `call_attempt` (1–3, denormalisiertes Maximum aus `phone_call_attempts`), `gatekeeper_reached`, `gatekeeper_attempts` (1–2), `decider_reached` (bool, „durchgestellt bekommen"), `pitch_delivered` (bool, „Pitch kam durch" — §4), `answer_sentiment`, `callback_at` (timestamptz, Rückruf-Fälligkeit), `appointment_set`/`appointment_at`, `mailbox`, `target_group` (Branche, beim Import gestempelt — je Lead maßgeblich), `script_label` (**Testarm, beim Import am LEAD festgeschrieben**, Migration 0030 — s. u.), `script` (Alt-Feld je Lead, als Testachse unbrauchbar), Begründungen: `no_transfer_reason`, `no_pitch_reason`, `no_appointment_reason`. Recycling (Migration 0033, die sechs Spalten s. `contacts`): `next_recycle_at` wird bei `status='dead'` über `setPhoneLeadOutcome` → `schedule_recycle('telefon', …)` gesetzt. |
| `phone_call_attempts` | **Anruf-Ereignis-Log: 1 Zeile = 1 Wählversuch** (Migration 0028). `lead_id` → `phone_leads`, `called_at` (timestamptz), `attempt_no` (≥ 1, serverseitig vergeben), `kind` / `outcome` (§4), Snapshots des Gesprächs: `mailbox`, `gatekeeper_reached`, `decider_reached`, `pitch_delivered`, `notes`. `list_id` + `owner_name` sind **Snapshots der Liste zum Zeitpunkt des Anrufs** — Leads wandern bei Rückruf/Nicht-erreicht physisch in eine Routing-Liste, ein Join über die *aktuelle* Liste schriebe die Historie rückwirkend um. `source`: `app` \| `backfill`. **Achtung: die Tabelle startet leer** — es gibt bewusst keinen Backfill (`first_call_at` ist ein Datum ohne Uhrzeit und kennt nur den ersten Anruf, `call_attempt` war manuell gesetzt). Vor dem Deploy-Datum von 0028 existiert also keine Anruf-Historie; geschrieben wird ausschließlich in `logCallAttempt` (`src/app/actions/phoneAttempts.ts`, fail-soft), gelesen im Telefon-Tab an genau zwei Stellen (`src/lib/phoneAttemptsData.ts`): der Leitkachel **Anwahlen** samt Sparkline und der Sektion „Nachfassen oder neue Leads?" — die einzigen Auswertungen des Bereichs, in denen derselbe Lead mehrfach zählt. Liegt der Zeitraum vor dem Log-Start, zeigt die Kachel „—" statt 0: leer heißt hier „gab es damals noch nicht", nicht „niemand hat telefoniert". |
| `csv_imports` | Protokoll der Telefon-Importe (`row_count`, `imported_count`, `duplicate_count`, `phone_list_id`). `phone_list_id` wird beim Löschen der Liste genullt — eine Zeile ohne Liste heißt „Import fand statt, Liste ist weg", nicht „Import fehlgeschlagen". |

**CSV-Import-Mapping** (`parsePhoneCsv`, `src/lib/phone-csv.ts`): Zugeordnet wird über **exakte** Spaltenkopf-Gleichheit (normalisiert: trimmen, Mehrfach-Leerzeichen, case-insensitiv) — Google-Maps-Scraper-Codes (`qBF1Pd`, `UsdlK`, `lcr4fd href`) **und** deutsche Klartext-Namen. Teilstring-Suche wäre hier falsch: Eine Liste mit „Name" (Firma) neben „GF Name" (Entscheider) träfe sonst zweimal dieselbe Spalte. Gefüllt werden `company`, `phone`, `website`, `decider_name`, `email` und optional `target_group`. **E-Mails werden zusätzlich ohne Spaltenkopf erkannt** (Regex) — die einzige Ausnahme von „nur per Header", weil eine Zeichenkette mit `@` und Punkt-TLD mit keinem anderen Feld verwechselbar ist; ein Personen- oder Branchenname ist das sehr wohl, deshalb gibt es für die keine Heuristik. `art`/`kategorie` werden **nicht** als Branche gemappt: Google Maps füllt das je Eintrag verschieden („Autowäsche" vs. „Dienst für professionelle Autopflege") und erzeugte zwei Zielgruppen für dieselbe Branche — die Branche setzt der Import-Dialog einmal für die ganze Datei.

**Der Testarm gehört an den LEAD, nicht an die Liste** (Migration 0030). Migration 0029 hatte `script_label` nur an `phone_lists` eingeführt — das trägt nur, solange ein Lead in seiner Liste bleibt, und genau das tut er nicht: `setPhoneLeadOutcome` verschiebt ihn bei „Rückruf" und „Nicht erreicht" physisch in die Routing-Liste des Owners, und die hat kein Label. Aus jedem Arm verschwänden damit ausgerechnet die schlechten Ausgänge, während Termine und tote Leads in der Akquise-Liste bleiben — jeder Arm sähe besser aus als er ist, und weil die Abwanderung je Skript unterschiedlich stark ausfällt, wären die Arme auch untereinander nicht mehr vergleichbar. Der Import stempelt das Label deshalb auf jeden Lead; `updatePhoneListScript` zieht es nachträglich auf die Leads durch, die noch in der Liste liegen. **Für Auswertungen gilt `phone_leads.script_label`**; `phone_lists.script_label` ist nur Rückfall für Bestandsleads, die ihre Liste nie verlassen haben (so liest es auch der Telefon-Tab). Bereits abgewanderte Altbestände bekamen im Backfill nichts und laufen bewusst als „ohne Testarm" (§8). Dieselbe Umzugsfestigkeit hat `phone_leads.target_group` von Anfang an.

### Termin-Funnel (Setting → Closing)

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `setting_calls` | Termin + Qualifizierungsgespräch. Person: `assigned_user_id` (zuständige Person, **die Auswertungsachse** — §2), `created_by_user_id` (Audit: wer angelegt hat). Herkunft: `source_type` (§4), `source_detail` (Freitext, trägt den echten Ursprung — die Analyse schlüsselt danach auf, sofern gesetzt), `source_contact_id` → `contacts`, `source_phone_lead_id` → `phone_leads`. Termin: `appointment_at` (timestamptz), `meet_link` (bei `meeting_kind='link'`), `phone` (Rufnummer bei `meeting_kind='telefon'`, Migration 0029 — nullable und ohne CHECK, die Pflicht sitzt im Formular; bewusst am Termin statt am Lead, weil `phone_leads.phone` die Firmenzentrale ist und LinkedIn-/manuelle Termine gar keine Lead-Zeile haben), `meeting_kind` (`link` \| `telefon` \| NULL = Altbestand), `call_at` (date, Gesprächstag). WhatsApp-Kanal (Migration 0032): `wa_phone` (persönliche WhatsApp-Nummer des Entscheiders — **nicht** dieselbe wie `phone`, das ist die Einwahlnummer bei `meeting_kind='telefon'`; wird HIER im Setting-Call eingesammelt, weil erst dort echtes Vertrauen besteht), `wa_consent_at` (Zeitstempel der dokumentierten Einwilligung — nach deutschem UWG Pflicht für WhatsApp-Kontakt zu kalten Leads, auch B2B; **wird seit dem Produktivstart aus der NUMMER abgeleitet, nicht mehr per Häkchen erfasst** — `withWaConsentDerived()` in `src/app/actions/settingCalls.ts` stempelt ihn beim Speichern einer Nummer und räumt ihn mit ihr weg. Grund: Wer seine persönliche Nummer im Erstgespräch genau dafür herausgibt, hat eingewilligt; das zweite Feld daneben fragte dasselbe noch einmal und blieb in der Praxis leer — und eine Nummer ohne Stempel schaltete die WhatsApp-Spur lautlos ab, weil `resolveFollowUpChannel` beides verlangt. **Für Auswertungen heißt das: `wa_consent_at is not null` ist praktisch deckungsgleich mit `wa_phone is not null`** und misst keine eigene Erfassungsdisziplin), `wa_refused_at` (dokumentierte Verweigerung „will keine Nummer rausgeben" — nur so lässt sich eine bewusste Ablehnung von einer Erfassungslücke unterscheiden; CHECK: nur OHNE `wa_phone`, und `wa_consent_at` nur MIT einer Nummer). **Die drei WhatsApp-Spalten sind mit dem Rückbau eingefroren**: Ihr einziger Zweck war der Kanal der Closing-Erinnerungen (`resolveFollowUpChannel` in `src/lib/reminderCascade.ts` — Datei gelöscht), und mit ihm ist auch das Pflichtfeld-Gate im Setting-Editor entfallen (Entscheidung E10: „ohne Nummer kein Closing"). Kein Formular schreibt sie mehr; `withWaConsentDerived()` in `src/app/actions/settingCalls.ts` steht noch, bekommt aber keinen Patch mit `wa_phone` mehr. Gelesen werden sie weiterhin an genau zwei Stellen: als Kontaktweg und als Warnung im Lead-Dossier (§5.3). Für Auswertungen: Die Werte beschreiben den Bestand bis zum 10. September 2026 und wachsen nicht mehr. **⚠ Offener Punkt (O1 in `ENTSCHEIDUNGEN.md`): Es gibt keinen Löschweg mehr.** Kein Formular schreibt die drei Spalten — aber es gibt auch keines, das sie leert. Widerruft ein Lead seine Einwilligung oder verlangt er die Löschung seiner Nummer, ist das heute nur per Migration oder direktem `UPDATE` zu erfüllen. Bei einer personenbezogenen Kontaktnummer mit dokumentierter Einwilligung ist das die unangenehmste Lücke, die der Rückbau hinterlässt. Nachfass-Stempel (Migration 0041, **auf beiden Termin-Tabellen gleich**): `follow_up_last_contacted_at` (timestamptz, NULL = „noch nie") und `follow_up_last_contacted_by_user_id` (uuid → `auth.users`, `on delete set null`) — s. u. Termin-Lebenszyklus (Migration 0032, s. u.): `cancelled_at`, `cancel_reason_code`, `cancel_reason`, `cancel_outlook`, `reschedule_count`, `last_reschedule_at`, `no_show_resolution`, `revived_at`, `revived_from_setting_call_id`/`revived_from_closing_call_id`, `disqualify_reason_code`, `disqualify_reason`. Qualifizierung: `show_status` (`show`/`no_show`), `has_budget_8k`, `branche`, `sole_decider`/`can_decide_now`/`clear_need` (bool), `ist_pain` (1–10), `warmth` (1–10), `soll_ziel`, `script_answers` (jsonb, Setting-Skript-Blöcke). Ergebnis: `status` (§4), `follow_up_due` (date, Wiedervorlage), `no_show_count` (zählt No-Shows über Neuterminierungen hinweg — **kein** Nenner der Show-Quote mehr, siehe §5; die Analyse liest es nur noch für die Fußnote der Status-Verteilung „wie viele Termine hatten mehr als einen No-Show"), `closing_scheduled`/`closing_at`. Recycling (Migration 0033, die sechs Spalten s. `contacts`): `next_recycle_at` wird über `schedule_recycle('setting', …)` gesetzt — bei `status='dead'`, bei `unqualifiziert` (eigene, längere Frist) und bei einer Absage `ohne_aussicht`. |
| `closing_calls` | Abschlussgespräch. `setting_call_id` → `setting_calls`. Person: `assigned_user_id` (erbt beim Anlegen vom Setting), `created_by_user_id` (Audit). `call_at` (timestamptz, Termin inkl. Uhrzeit), `meet_link`, `show_status` (§4), `status` (§4), Deal: `closed` (bool), `deal_volume` (numeric, €), `payment_type` (Freitext, UI: „Einmal"/„Raten"), `signature_received`, `contract_start` (date), `lost_reason_code` (zehn feste Codes, §4 — **das zählbare Feld**), `lost_reason` (Freitext daneben, optionaler Kontext), `follow_up_due` (date — wird weiter geschrieben und im Closing-Editor sowie im Dossier weiter gelesen, steuert aber keine Arbeitsliste mehr, §1). `follow_up_due_at` (timestamptz, Migration 0032 — war der präzise Nachfass-Zeitpunkt für die Erinnerungs-Kaskade; mit ihr hat er seinen Hauptzweck verloren. `withFollowUpDateSynced()` in `src/app/actions/closingCalls.ts` hält ihn weiterhin synchron zu `follow_up_due`, damit die beiden Felder nicht auseinanderlaufen. **Ein Leser ist ihm geblieben**: Das Dossier bevorzugt ihn für das Ereignis „Nachfass-Kontakt vereinbart" (`follow_up_due_at ?? follow_up_due`) — er trägt die Uhrzeit, das Datum daneben nicht). `onboarding_at` (date, Migration 0032 — Tag des Software-Onboardings nach einem gewonnenen Deal; ohne Angabe bewusst NULL statt eines geratenen Datums). Nachfass-Stempel (Migration 0041): `follow_up_last_contacted_at`, `follow_up_last_contacted_by_user_id` — dieselben zwei Spalten wie am Setting. Termin-Lebenszyklus (Migration 0032): `cancelled_at`, `cancel_reason_code`, `cancel_reason`, `cancel_outlook`, `reschedule_count`, `last_reschedule_at`, `no_show_resolution`, `revived_at` — dieselben Spalten wie am Setting, **ohne** `revived_from_*` und ohne Disqualifikationsgrund (dafür hat das Closing `lost_reason_code`). Recycling (Migration 0033, die sechs Spalten s. `contacts`): `next_recycle_at` wird bei `status='verloren'` über `schedule_recycle('closing', …)` gesetzt, die Wartezeit hängt am `lost_reason_code` (§5). |
| `call_assignees` | **Historisch, nicht mehr in Gebrauch.** Alte Multi-Zuweisung (`entity_type` = `setting_call`\|`closing_call`, `entity_id`, `user_id`). Seit Migration 0028 ersetzt durch `assigned_user_id`; wird weder gelesen noch geschrieben (§2). |

**Der Termin-Lebenszyklus bekam eigene Spalten, KEINEN neuen `status`-Wert** (Migration 0032).
`status` speist Show-Quote, Quali-Quote, Trichter, `terminMeta.outlineFor` und die
Vergleichsseite — ein sechster Wert („abgesagt") zwänge jede dieser Definitionen zu einer
Entscheidung. Eigene Felder lassen einen abgesagten Termin dagegen über `show_status is null`
korrekt aus dem Show-Quoten-Nenner fallen, statt als No-Show zu zählen. Konsequenz für
Auswertungen: **Eine Absage ist an `cancelled_at`/`cancel_outlook` zu erkennen, nie am
Status** — wer nur `status` liest, hält einen abgesagten Termin für „offen". Dieselbe
Konsequenz hat eine Kehrseite, die `schedule_recycle()` ausdrücklich abfängt: Weil kein
Statuswechsel das Ende des Vorgangs markiert, muss die Wiedervorlage bei
`cancel_outlook='ohne_aussicht'` eigens eingeplant werden, sonst verschwände der Lead in
der Ablage und käme nie wieder heraus.

Fünf Regeln, die man beim Nachrechnen kennen muss:
- **`reschedule_count` zählt NUR Verschiebungen durch den Lead** (`postponeAppointment(byLead=true)`).
  Der Kalender-Drag und die interne Umplanung des Verkäufers zählen nicht — sonst misst der
  Zähler die Disziplin des eigenen Teams statt der Verbindlichkeit des Leads. Ein Ersatztermin
  nach No-Show zählt ebenfalls nicht (er läuft über `rescheduleSetting`). Der Knopf „Termin"
  der Arbeitsliste zählt aus demselben Grund ebenfalls nicht: Er läuft über `rescheduleSetting`
  bzw. `updateClosingCall`, nicht über `postponeAppointment`.
- **`pipeline_settings.max_reschedules` ist eine Warnung, keine Sperre** — über dem Kontingent
  meldet die Action `warn:'limit'`, die Oberfläche lässt bestätigen und schlägt die Ablage
  „abgesagt ohne Aussicht" vor. **Es hat den Rückbau bewusst überlebt**, obwohl es in derselben
  Konfigurationszeile steht wie die gefallene Kaskade: Es ist kein Kaskaden- und kein
  Recycling-Feld, sondern steuert genau die Unterscheidung, auf der die neue Arbeitsfläche
  steht — „liegt in der Luft" gegen „ist versorgt". Wäre es mit dem Erinnerungs-Modul gefallen,
  verschwänden die Warnung in `postponeAppointment` und die Lebenszyklus-Leiste, beide lautlos,
  weil ein fehlender Hinweis kein Fehler ist. Es liegt seit dem Rückbau in
  `src/app/actions/pipelineSettings.ts` (vorher in `actions/reminders.ts`, gelöscht).
- **`no_show_resolution` ist per CHECK an `show_status='no_show'` gebunden.** Wandert der
  Show-Status weg, muss der Ausgang mitgehen — die App nullt ihn dafür in
  `withNoShowResolutionCleared()`, sonst weist Postgres das ganze UPDATE ab.
- **Der Nachfass-Stempel ist ein AUDIT-Feld, keine Zuständigkeit** (Migration 0041).
  `follow_up_last_contacted_by_user_id` steht in der Bedeutung von `created_by_user_id` („wer
  hat geklickt", immer `access.user.id` — die real angemeldete Person, **nicht** die
  eingestellte Datensicht; genau diesen Fehler hatte `created_by_user_id` bis 0028). Wem der
  Termin gehört, steht unverändert in `assigned_user_id`, und **nur das** bleibt die
  Personenachse jeder Auswertung (§2). Warum es die zweite Spalte überhaupt gibt: „Eine Liste
  je Person" heißt nicht „nur eine Person schreibt hinein" — ein Owner mit Team-Sicht arbeitet
  über die Datensicht die Liste eines Kollegen ab, ein Plattform-Admin arbeitet in einer
  fremden Organisation. Zu dritt ist „hast du den angerufen oder ich?" die Frage, die täglich
  anfällt. **Kein Paar-CHECK** zwischen Zeitstempel und Person, obwohl `reminder_touches` einen
  hat: Der ist dort mit `on delete set null` auf derselben Spalte kombiniert, und die beiden
  Klauseln widersprechen einander — beim Löschen eines Nutzers verletzt genau dieses UPDATE den
  CHECK. Der mögliche Zustand „Zeitstempel ohne Person" ist deshalb erlaubt und richtig: Er
  heißt „wurde nachgefasst, der Kollege ist weg".
- **`revived_at` wird von ZWEI Pfaden geschrieben** — seit dem Rückbau. Der erste ist
  `reviveDropout()`
  (`src/app/actions/revive.ts`, Knopf „Neuen Termin ansetzen" in `/ablage`). Der zurückgeholte
  Vorgang bleibt dabei **terminal**: Sein `status` wird nicht angefasst, sonst veränderte eine
  Rückholung rückwirkend die Quoten eines abgeschlossenen Zeitraums (§5). Der zweite Anlauf ist
  immer eine NEUE `setting_calls`-Zeile — auch wenn der Vorgänger ein Closing war —, die über
  `revived_from_setting_call_id` bzw. `revived_from_closing_call_id` zurückzeigt. Drei
  Eigenschaften, die man beim Nachrechnen kennen muss:
  **(a)** Das UPDATE setzt `revived_at` und räumt `next_recycle_at` + `recycle_reason_code` in
  **einer** Anweisung — „zurückgeholt UND zur Wiedervorlage eingeplant" kann es deshalb nicht
  geben (das ist die Invariante aus §8, nicht nur eine App-Konvention).
  **(b)** Das `.is('revived_at', null)` im selben Statement ist die **Sperre gegen ein zweites
  Zurückholen**: Zwei gleichzeitige Klicks erzeugen keine zwei Nachfolger, der zweite bekommt
  „Inzwischen steht der neue Termin bereits."
  **(c)** Scheitert der Insert des Nachfolgers, werden alle drei Felder zurückgeschrieben —
  `revived_at` allein genügte nicht, der Vorgang wäre sonst lautlos aus jeder Wiedervorlage
  verschwunden. Für Auswertungen heißt das: `revived_at is null` trennt jetzt wirklich
  („noch nicht zurückgeholt"), und die Riegel in `schedule_recycle()`/`recycle_tasks()` greifen
  tatsächlich.
  **Der zweite Pfad ist neu und arbeitet anders: `setNeuerTermin()`**
  (`src/app/actions/followUpStamp.ts`, Knopf „Termin" in der Arbeitsliste). Er legt **keine**
  neue Zeile an, sondern terminiert die vorhandene neu und stempelt `revived_at` nur, um die
  Absage für überholt zu erklären — ohne dieses dritte Signal bliebe ein neu terminierter Lead
  für immer in der Arbeitsmenge stehen (§1, „Die Absage schlägt das Datum"). Gestempelt wird
  **nur beim ersten Mal** (`.is('revived_at', null)` macht aus dem UPDATE ein Claim, zwei
  gleichzeitige Klicks holen die Zeile nur einmal zurück); danach ist der Zeitpunkt Historie.
  Zwei Eigenschaften dieses Pfads muss kennen, wer Bestandsdaten liest:
  **(a) Der Stempel wird zurückgenommen, wenn das Schreiben des Datums scheitert** — und nur
  der selbst gesetzte. Ohne diesen Schritt passierte die Zeile ab dem fehlgeschlagenen Klick
  den Absage-Riegel, galt über ihr altes Datum als „Verlegt" und verschwand lautlos aus
  Arbeitsliste UND Recycling (`recycle_tasks` verlangt `revived_at is null`) — während der
  Nutzer eine Fehlermeldung sah und glaubte, es sei nichts passiert. Jede Fehlerbehandlung
  führt deshalb in den Zustand „bleibt Arbeit", nie in „ist versorgt".
  **(b) Eine bereits ERSCHIENENE Zeile bekommt nur ein neues Datum, keinen Reset.** Welche
  Action das Datum schreibt, entscheidet die erfasste Tatsache und nicht die Termin-Art:
  `rescheduleSetting` (der Ersatztermin-Weg nach einem No-Show) setzt Status und `show_status`
  zurück — das darf es, weil der No-Show in `no_show_count` erhalten bleibt. Ein
  `show_status='show'` steht dagegen in keiner zweiten Spalte; der Reset wäre eine **Löschung**,
  und weil die Zeile über `settingEffDate` zugleich in den Monat des neuen Termins wandert,
  verlöre die Show-Quote eines abgeschlossenen Zeitraums ihren Zähler (§5). Für einen
  erschienenen Lead läuft der Knopf deshalb über `moveSettingAppointment` — genau das, was der
  Closing-Zweig (`updateClosingCall`) ohnehin tut.
  Konsequenz für Auswertungen: **`revived_at` bedeutet seither zweierlei** —
  „es gibt eine Nachfolgezeile" (Ablage-Pfad, dann zeigt `revived_from_*` auf den Vorgänger)
  oder „dieselbe Zeile hat einen neuen Termin bekommen" (Listen-Pfad, dann gibt es keine
  Nachfolgezeile). Wer Rückholungen zählt, muss über `revived_from_setting_call_id`/
  `revived_from_closing_call_id` gehen, nicht über `revived_at`.
  Nicht verwechseln mit der früheren Ablage-Liste „Abgesagt, Ersatztermin steht aus": Die
  fragte `cancel_outlook='neuer_termin'` **und** `revived_at is null` ab; sie ist mit dem
  Rückbau aus der Oberfläche verschwunden, weil genau diese Zeilen jetzt in der Hauptliste
  stehen (§1). Die RPC kennt den Zweig weiter (`dropout_lists('ersatztermin_offen')`), **die
  App fragt ihn nirgends mehr ab** — auch der Navigations-Zähler nicht, der genau daran hing
  und mit ihr gefallen ist (§5.4). Wer per SQL auswertet, bekommt den Zweig unverändert.

### Vorlagen, Kaskade & Recycling-Konfiguration

Ersetzt die früheren Tabellen `reminder_settings` und `recycle_settings` (Historie: Sie
standen in der nie eingespielten ersten Fassung von 0031/0032 und existieren **nicht**).
Ihre Offsets liegen in `cascade_steps`, ihre Texte in `message_templates`, der Rest
in `pipeline_settings`.

> **⚠ Vier dieser fünf Tabellen liest seit dem Rückbau niemand mehr.** Sie existieren
> unverändert, tragen ihre Zeilen weiter und werden von Löschvorschau und Nutzer-Umzug
> weiter mitgeführt — aber **kein Anwendungscode liest oder schreibt sie**:
>
> | Tabelle | Status | Was mit ihrem Leser passiert ist |
> |---|---|---|
> | `template_catalog` | eingefroren, **31 Zeilen** | Vorlagen-Bibliothek `src/lib/messageTemplates.ts` gelöscht |
> | `message_templates` | eingefroren, wächst nicht mehr | Vorlagen-Editor und `actions/messageTemplates.ts` gelöscht |
> | `cascade_steps` | eingefroren, **21 Zeilen je Organisation** (der Seeding-Trigger legt sie weiter an, §2) | Kaskaden-Rechner `src/lib/cascadeEngine.ts` und das Kaskaden-Panel am Termin gelöscht |
> | `reminder_touches` | eingefroren, wächst nicht mehr | Erinnerungs-Modul `actions/reminders.ts`, Board und Analyse-Blöcke gelöscht; niemand ruft mehr `apply_reminder_touches()` |
> | `pipeline_settings` | **lebendig** | wird weiter gelesen und geschrieben — s. u. |
>
> **Warum sie stehen bleiben, statt zu fallen.** Es ist dieselbe Linie, aus der schon
> `call_assignees` (§2) und `followup_templates` (§3) noch dastehen: Was fällt, ist der Code,
> der eine Tabelle liest, nicht die Zeile, die schon dasteht. Ein `drop table` wäre eine
> eigene Migration mit vier Kaskaden-Fremdschlüsseln, zwei RLS-Paaren und je einem Eintrag in
> Löschvorschau und Umzug — Risiko ohne Gegenwert, denn eine ungelesene Tabelle kostet nichts
> außer Plattenplatz. Und ein zweiter Grund, der wichtiger ist: **Die Zeilen sind Daten.**
> `reminder_touches` trägt die Erledigungs-Historie von zwei produktiven Tagen, und ein
> Wiedereinstieg (in welcher Form auch immer) beginnt sinnvollerweise mit dem Blick darauf,
> was damals erledigt wurde und was nicht.
>
> **Für Auswertungen heißt das:** Diese vier Tabellen beantworten die Frage „was war zwischen
> dem 8. und dem 10. September 2026" — sonst nichts. Eine Kennzahl darauf ist ab dem
> Deploy-Datum des Rückbaus konstant und sinkt danach nie wieder; wer aus ihr auf heutiges
> Verhalten schließt, liest ein abgeschlossenes Experiment als laufenden Betrieb.

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `template_catalog` | **Eingefroren (§ Kasten oben).** Katalog der Nachrichtenarten (Migration 0031), **31 Zeilen**. `template_key` (PK), `label`, `group_key` (`setting`\|`closing`\|`followup`\|`no_show`\|`kein_close`\|`recycling`\|`linkedin`\|`aufgaben`), `placeholders` (text[]), `sort_order`, `is_mail`. Bewusst **ohne Textkörper** — die Auslieferungstexte stehen ausschließlich in `TEMPLATE_DEFAULTS` (`src/lib/messageTemplates.ts`), damit SQL und TypeScript nicht auseinanderlaufen und eine Textverbesserung jeden Kunden erreicht, der den Text nie angefasst hat. Bei jedem Einspielen abgeglichen (`on conflict do update`), Zeilen werden nie gelöscht, damit kein FK ins Leere zeigt. Lesbar für jedes angemeldete Konto, schreibbar für niemanden — er ändert sich nur mit einer Migration. Keine Gruppe `mail`: Eine Mail-Stufe gehört fachlich zu Erstgespräch bzw. Closing, die Unterscheidung trägt `is_mail`. |
| `message_templates` | **Eingefroren (§ Kasten oben).** Die **abweichenden** Texte (Migration 0031). `workspace_id`, `user_id` (**NULL = Standard der Organisation**, gesetzt = persönliche Übersteuerung), `template_key` → `template_catalog`, `subject` (nur für Mail-Vorlagen), `body` (CHECK: nicht leer), `updated_by_user_id`. Zwei partielle Unique-Indizes trennen die beiden Ebenen ohne zweite Tabelle; `workspace_id` steht auch im persönlichen Index — `followup_templates` (0011) hat nur `unique(user_id, fu_number)` und wird dadurch beim Nutzer-Umzug mehrdeutig. **Keine `channel`-Spalte:** ein Text je Stufe gilt für WhatsApp, LinkedIn und Telefon gleichermaßen; die Karte ist eine Kopier-Werkbank. Eine Zeile entsteht erst beim bewussten Ändern, ein geleertes Feld löscht sie wieder. RLS: Org-Ebene über `can_manage_org_settings()`, die eigene Zeile immer gegen `auth.uid()` — **nicht** gegen die eingestellte Datensicht, sonst überschriebe ein Owner mit aktiver Datensicht unbemerkt den Text eines Kollegen. |
| `pipeline_settings` | **Lebendig.** **Eine** Konfigurationszeile je Organisation (Migration 0032, PK = `workspace_id`) — ersetzt `reminder_settings` UND `recycle_settings`: ein Seeding-Schritt, ein RLS-Paar, eine Kartengruppe in den Einstellungen statt zweier. Termin-Disziplin: `max_reschedules` (1–5, Default 2), `reminder_horizon_days` (1–60, Default 7 — **wirkungslos seit dem Rückbau**, es gab nur einen Leser: den Vorausblick von `/erinnerungen`). Recycling **zweistufig in der Datenbank, flach in der Oberfläche** (s. u.): fünf Ursprungs-Defaults mit den Konzept-Fristen (`days_default_closing_lost` 28, `days_default_setting_disqualified` 56, `days_default_phone_dead`/`_setting_dead`/`_linkedin_exhausted` je 100) und daneben neun Verlustgrund-Werte, die sie übersteuern (`days_timing` 75, `days_preis`/`days_kein_bedarf` 105, `days_entscheider` 150, `days_wettbewerb`/`days_vertrauen` 270, `days_ghosting_breakup` 14 / `days_ghosting` 180, `days_sonstiges` 120). `max_attempts` (1–5, Default 2) deckelt die Versuche, **wirkt weiter, hat aber kein Bedienelement** — das Feld in `/settings` ist auf Entscheidung des Auftraggebers wieder gefallen, der gespeicherte Wert bleibt unangetastet (der Schreibpfad liest die Zeile vor jedem Upsert vollständig und schreibt sie vollständig zurück, §5). Ändern lässt er sich nur noch per SQL. Alle Tages-Spalten bewusst `not null`. Für `falsche_zielgruppe` und `kein_fit` gibt es **keine** Spalte — sie bekommen nie ein Datum. Lesen: jedes Mitglied. Schreiben: `can_manage_org_settings()`, UI unter `/settings` (`src/app/actions/pipelineSettings.ts`, seit dem Rückbau eine eigene Datei — vorher lag der Schreibpfad im gelöschten Erinnerungs-Modul). |
| `cascade_steps` | **Eingefroren (§ Kasten oben).** Die Stufen der neun Kaskaden je Organisation (Migration 0032). PK `(workspace_id, cascade_kind, step_no)`. `cascade_kind` (§4), `step_no` (1–5), `trigger_event` (`scheduled`\|`created`\|`no_show`\|`no_close`), `anchor` (`before_appointment`\|`after_appointment`), `offset_minutes` (≥ 0), `requires_no_response`, `enabled`, `template_key` → `template_catalog`. **Zeile statt Spalte**, weil die Stufenzahl je Kaskade verschieden ist (Setting-Mail 2, Closing-Mail 3) und eine Stufe abschaltbar sein muss. **Minuten statt Stunden**, damit „3 Tage vorher" (4320) und „1 Stunde vorher" (60) in einer Einheit liegen. **Anker + nicht-negativer Offset statt vorzeichenbehafteter Minuten**: derselbe Ausdrucksumfang, aber eine Erinnerung NACH dem Termin lässt sich in einer Vor-Termin-Kaskade gar nicht erst formulieren (CHECK: `trigger_event='scheduled'` ⇔ `anchor='before_appointment'`). Die Reihenfolge der Stufen prüft die Oberfläche beim Speichern, nicht ein CHECK — sie ist ein zeilenübergreifender Zustand. **In der Oberfläche gar nicht mehr sichtbar**: `PipelineSettingsCard` zeigte die 21 Stufen als Leseliste, der Rückbau hat sie entfernt. |
| `reminder_touches` | **Eingefroren (§ Kasten oben).** Ein fälliger Touch je Zeile (Migration 0032, **v2** — die polymorphe Fassung mit `touch_type` gibt es nicht mehr). **Echte Fremdschlüssel** statt polymorpher `entity_id`: `setting_call_id` / `closing_call_id` (je `on delete cascade`), dazu `entity_type` (`setting`\|`closing`\|`closing_followup`) und `entity_id` als **generierte Spalte** (`coalesce(setting_call_id, closing_call_id)`, stored). Ein direkter DB-Delete oder ein vergessener Aufrufpfad nimmt die Touches damit mit, statt Karteileichen zu hinterlassen, die kein Invarianten-Check findet. Stufe: `touch_kind` (`cascade`\|`chain`\|`sofort`), `cascade_kind`, `step_no` (≥ 0; der `sofort`-Touch liegt kollisionsfrei auf 0), `requires_no_response`, `template_key` (**Snapshot** — eine später umbenannte Stufe schreibt die Historie nicht um). `assigned_user_id` ist ebenfalls ein **Snapshot** nach der `personOf()`-Regel, per BEFORE-INSERT-Trigger `reminder_touches_require_assignee` Pflicht (die Spalte bleibt trotzdem nullable: `deleteUser` räumt nicht vor, ein NOT NULL bräche die Nutzerverwaltung, ein `on delete cascade` löschte die Historie). `due_at`/`appointment_at` (timestamptz), `channel` (`linkedin`\|`telefon`\|`whatsapp`\|`mail`\|NULL) + `channel_locked`, `outcome` (§4), `done_at`/`done_by_user_id` (per CHECK ein Paar), `done_note`, `snoozed_until`, `superseded_at` (Soft-Delete — die Erledigungs-Historie bleibt zählbar). Höchstens ein aktiver Touch je `(entity_type, entity_id, cascade_kind, step_no)`: `unique index … where superseded_at is null` — die Kaskade steht bewusst IM Schlüssel, sonst kollidierte Stufe 1 der Nachrichten-Spur mit Stufe 1 der Mail-Spur desselben Termins. |

Die beiden folgenden Regeln beschreiben **den eingefrorenen Bestand**, nicht laufendes
Verhalten — sie stehen hier, damit die Zeilen in `reminder_touches` lesbar bleiben:

**Kanal: Snapshot für die Auswertung, live für die Anzeige.** `reminder_touches.channel` hielt
fest, was zum Erzeugungszeitpunkt galt; die Karte löste beim Rendern neu auf, damit eine
nachträglich erfasste WhatsApp-Einwilligung noch wirkte. `channel_locked` merkte eine bewusste
Nutzerwahl und schaltete das Nachlösen ab. Wer die Bestandszeilen nach Kanälen auswertet, liest
die Spalte (den Snapshot) — was der Nutzer damals auf dem Bildschirm sah, kann davon abweichen.

**`outcome` entwertete nur Ketten, nie geplante Stufen.** Wurde auf einem `chain`-Touch
„antwort" eingetragen, wurden die noch offenen Folgestufen mit `requires_no_response`
superseded — wörtlich der Pfeil „keine Antwort" aus dem Konzept. Bei einer Vor-Termin-Kaskade
passierte das bewusst NICHT: Eine Bestätigung auf Stufe 1 ließ Stufe 2 und 3 fällig, weil der
Meeting-Link aus Stufe 3 auch nach einer Zusage rausgehen sollte. **Konsequenz für den
Bestand:** Ein `superseded_at` ohne `done_at` heißt „entwertet", nicht „versäumt" — und ab dem
Deploy des Rückbaus wird gar nichts mehr entwertet, offene Touches bleiben für immer offen
stehen. Sie sind kein Rückstand, sondern ein Standbild.

### Sonstiges

| Tabelle | Zweck |
|---|---|
| `profiles` | `user_id` ↔ `username` (Login + Owner-Matching). |
| `workspaces` / `workspace_members` | Team + Mitgliedschaft (`role`, `data_scope`, Invite-Code). |
| `performance_targets` | Ziele je User: `channel` (`linkedin`\|`telefon`) × `period` (`daily`\|`weekly`) × `metric` (`pitches`\|`calls`\|`appointments`). App-Defaults ohne Eintrag: LinkedIn 20/Tag, 100/Woche; Telefon 40/Tag, 200/Woche (`src/lib/targets.ts`). |
| `followup_templates` | **Abgelöst und von der App nicht mehr gelesen — die Tabelle steht trotzdem noch da.** FU-Textvorlagen je User (`fu_number` 1–3). Migration 0034 hat die Zeilen nach `message_templates` (`linkedin_fu_1..3`) übernommen; die Vorrangkette ist seither `lists.fuN_text` > persönlich > Organisation > Auslieferungstext (`resolveTemplate`, §1). Seit dem Deploy liest **keine Zeile Anwendungscode** die Tabelle mehr: `src/app/actions/templates.ts` ist gelöscht, und mit dem Rückbau ist auch ihr Nachfolger `message_templates` ohne Leser (§ Kasten oben) — es gibt in der App überhaupt keine Nachrichtenvorlage mehr außer den FU-Texten an der LinkedIn-Liste. Angefasst wird sie nur noch von den Lifecycle-RPCs — Umzug und Löschvorschau stempeln bzw. zählen sie weiter, deshalb steht ihr Label in `COUNT_LABELS` (`src/lib/lifecycleLabels.ts`). Sie **bleibt trotzdem stehen** (Muster `call_assignees`): Ein `drop table` wäre gefahrlos möglich, braucht aber eine eigene Migration (**0042** aufwärts, §7) und bringt außer einem aufgeräumten Schema nichts ein. Für Auswertungen nicht mehr verwenden: Ihre Zeilen sind ein eingefrorener Stand von vor 0034.<br>**⚠ Offener Punkt (O2 in `ENTSCHEIDUNGEN.md`):** Die 0034 übernommenen persönlichen FU-Texte sind damit **über keine Oberfläche mehr erreichbar** — weder in der Quell- noch in der Zieltabelle. Im Ergebnis harmlos (die Listen-Texte sind der praktisch genutzte Weg und unberührt), aber es ist ein stiller Verlust: Der Nutzer sieht keinen Fehler, sondern einen anderen Text. Zu entscheiden ist, ob die persönliche Ebene eine kleine Oberfläche zurückbekommt oder als endgültig abgelöst gilt. |
| `list_views` | **Smart Views** — gespeicherte, filter-definierte Sichten auf LinkedIn-Kontakte, beliebig verschachtelbar. `parent_id` → `list_views` (Selbstreferenz, `on delete cascade`), `name`, `sort_order`, `filters` (jsonb), `owner_name`/`created_by_user_id` wie bei `lists`. **`filters is null` = reiner Ordner** (gruppiert nur), `filters` gesetzt = Ansicht, die zu einer Kontaktmenge auflöst. Besitzt nichts: Kontakte bleiben an ihrer Liste. Filter-Schema und Query-Aufbau ausschließlich in `src/lib/listViews.ts` (`parseViewFilters`, `viewFilterOps`), UI unter `/ansicht/[viewId]` und im Sidebar-Baum. |
| `organic_lists` / `organic_posts` | Organic-Social-Tracker (Posts, Impressions, `content_type`: educational/motivational/entertaining/bts/other). UI ist abgeklemmt (alte Routen leiten um), Daten existieren ggf. noch. |

## 4. Status-/Enum-Werte (DB-Wert ↔ UI-Label)

**`phone_leads.status`**: `aktiv` „Aktiv" · `rueckruf` „Rückruf" · `nicht_erreicht` „Nicht erreicht" · `termin` „Termin" · `dead` „Dead"/„Toter Lead"
**`phone_leads.gatekeeper_reached`**: `ja` · `nein` · `direkt` (direkt zum Entscheider durchgekommen)
**`phone_leads.answer_sentiment`**: `positiv` · `neutral` · `negativ` (Reaktion im Telefonat — nicht verwechseln mit `contacts.answer_category`)
**`phone_leads.decider_reached` vs. `pitch_delivered`** (beide `boolean | null`): `decider_reached` = der Entscheider war am Apparat, `pitch_delivered` = der Pitch kam auch durch. Bis Migration 0028 war das **dasselbe Feld**: Der Call-Modus beschriftete den Schalter „Entscheider gepitcht?", speicherte ihn aber als `decider_reached` — die RPCs zählten ihn als „Entscheider erreicht", beide Kennzahlen waren dadurch identisch. Der Backfill hat `pitch_delivered = decider_reached` gesetzt (Bestandsdaten meinen faktisch „gepitcht"); `decider_reached` blieb stehen, weil gepitcht ⊆ erreicht. **Die beiden Zahlen spreizen sich erst mit Daten nach dem Deploy** — davor liefern sie zwangsläufig dieselbe Menge.

**`phone_call_attempts.kind`** (Topf des Anrufs, beantwortet „lohnt Nachfassen oder lieber neue Leads scrapen?"): `erstanruf` (erster Versuch bei diesem Lead) · `folgeanruf` (erneuter Versuch ohne Verabredung) · `rueckruf` (terminierter Zweitanruf, Lead stand auf `status='rueckruf'`). Abgeleitet in `logCallAttempt`, nicht vom Nutzer gewählt.
**`phone_call_attempts.outcome`** (1:1 die Outcome-Buttons im Call-Modus): `termin` · `rueckruf` · `nicht_erreicht` · `dead` · `kein_ergebnis`
**`phone_call_attempts.source`**: `app` (echtes Ereignis) · `backfill` (nachträglich synthetisiert — bisher nirgends erzeugt, hält nur die Tür offen, damit erfundene Ereignisse später von echten trennbar bleiben).

**`setting_calls.status`**: `offen` „Offen" · `no_show` „Nicht erschienen" · `qualifiziert` „Qualifiziert" · `closing_gelegt` „Closing gelegt" · `unqualifiziert` „Unqualifiziert" · `dead` „Dead"
Historie: Alt-Wert `disqualifiziert` wurde per Migration 0018 zu `unqualifiziert` migriert. Outcome-Logik: `no_show` → Wiedervorlage (Vorschlag +1 Tag) + `no_show_count`++ (**die No-Show-Kette ist mit dem Rückbau entfallen**, `createNoShowTouch()` gelöscht); `unqualifiziert` → Wiedervorlage (Vorschlag +7 Tage) **und weiterhin nur MIT `disqualify_reason_code`** — Status und Grund schreibt `setSettingOutcome` unverändert in EINEM UPDATE; `dead` → Recycling-Datum, **ohne Grundcode** (das ist der Weg, den der Knopf „Tot" der Arbeitsliste nimmt); `qualifiziert` → Closing wird angelegt, Status wird `closing_gelegt`. Show-Quote: `show_status` (`show`/`no_show`); bei `offen`/`dead` bewusst NULL — und bei einem **abgesagten** Termin ebenfalls, siehe Termin-Lebenszyklus weiter unten.
**Der DB-seitige Zwang entfällt mit Migration 0041.** Der Trigger `setting_calls_require_disqualify_reason` aus 0035 wird dort entfernt (§7): Ein Pflichtfeld, dessen Formular verschwindet, ist kein Qualitätsanspruch mehr, sondern eine Sperre gegen die eigene App. Die App-Regel bleibt trotzdem stehen — `setSettingOutcome` verlangt den Grund weiter, weil die Detailseite ihn weiter anbietet. Fürs Nachrechnen: **Ab 0041 dürfen neue Zeilen wieder ohne Grund entstehen**; eine wachsende Zahl in der entsprechenden Abfrage aus §8 ist ab dann kein Defekt mehr, sondern nur noch die Auskunft, wie oft niemand einen Grund angegeben hat.
**Achtung: `qualifiziert` wird vom UI nicht mehr vergeben.** Ein Klick auf „Qualifiziert" legt sofort das Closing an und schreibt `closing_gelegt` (`setSettingOutcome` → `createClosingFromSetting`); wird ein Closing gelöscht, fällt das Setting auf `offen` zurück, nicht auf `qualifiziert`. Der Wert steht also nur noch in Bestandszeilen. Konsequenz für Auswertungen: Die Kennzahl „Zu Closing geschickt" (`closing_gelegt` ÷ `qualifiziert` + `closing_gelegt`, §5) liegt bei aktuellen Daten fast immer bei 100 % — sie kann erst wieder trennen, wenn der Zwischenschritt „qualifiziert, aber noch kein Closing gelegt" in der Oberfläche erreichbar ist.

**`setting_calls.source_type`** — die Kanal-Registry (`src/lib/channels.ts`) ist die einzige Quelle für Schlüssel, Label, Farbe und Volumen-Flag; der CHECK aus Migration 0029 kennt dieselbe Liste. Fünf Werte sind wählbar, drei bleiben für Bestandszeilen gültig:

| DB-Wert | Label | wählbar | Filter `?quelle=` | eigenes Akquise-Volumen |
|---|---|---|---|---|
| `linkedin` | LinkedIn | ja | ja | `contacts` („DMs") |
| `telefon` | Telefon | ja | ja | `phone_leads` („Erstkontakte") |
| `social_media` | Social Media | ja | ja | — (Funnel beginnt beim Termin) |
| `ads` | Ads | ja | ja | — |
| `sonstige` | Sonstige | ja | ja | — |
| `inbound` | Inbound | nein (Altwert) | nein | — |
| `website` | Website | nein (Altwert) | nein | — |
| `manuell` | Manuell (ohne Angabe) | nein (Altwert) | ja | — |

Warum die Altwerte bleiben: Der CHECK gilt auch für UPDATEs auf ganz anderen Spalten — sie zu streichen hieße, dass sich kein alter Termin mehr bearbeiten ließe. Neu vergeben werden sie nicht mehr (`normalizeSource` in `src/app/actions/appointments.ts`). **Alle fünf wählbaren Kanäle sind filterbar**: Social Media, Ads und Sonstige standen anfangs auf `false` („ein Filter lohnt erst, wenn es Zeilen gibt") — das war die falsche Reihenfolge, denn buchen ließen sich diese Quellen bereits, nur der Filter, mit dem man die entstandenen Zeilen wiedergefunden hätte, fehlte. Eine Quelle ohne Treffer zeigt eine leere Auswertung; das ist ein beantworteter Blick, kein Fehler. `manuell` ist als einziger Altwert ebenfalls filterbar, weil dort der Großteil des historischen Volumens liegt. Migration 0029 hat `manuell` **nur bei eindeutigem Freitext** umgedeutet: `source_detail ~* '(\mads\M|\mwerbung\M|werbeanzeige|\manzeigen?\M)'` → `ads` (zuerst, weil „Facebook Ads" beide Muster trifft und der bezahlte Kanal gewinnen muss; `ads` nur mit Wortgrenzen, sonst träfe es jedes „Leads"), danach `~* '(insta|social|facebook|tiktok)'` → `social_media`. Der Rest steht weiter auf `manuell` und heißt im UI „Manuell (ohne Angabe)" — eine ehrliche Restkategorie statt geratener Statistik. Ein unbekannter Wert (neuerer Client, Fremddaten) wird in der App als „Sonstige" beschriftet, nicht roh angezeigt.
Zusätzlich zum Kanal trägt **`source_detail`** den echten Ursprung als Freitext („Social Selling", „Empfehlung Meier"). Genau **zwei** Auswertungen lösen ihn auf, beide **primär nach `source_detail`** und nur ohne Freitext zurück auf den Kanal (case-insensitiv zusammengefasst, angezeigt wird die zuerst gesehene Schreibweise): „Quelle des Termins" im Setting-Tab und „Je Quelle" im Funnel-Tab (§5.1). Ohne diesen Schritt läge der Großteil der manuell gebuchten Termine in einer Sammelzeile, die im Umsatz-Ranking oben steht und nichts erklärt — „Empfehlung" und „Bestandskunde" sind zwei Quellen, nicht eine. Der Donut „Quellen-Split" daneben bleibt auf Kanal-Ebene. Unterschied der beiden Schlüssel: Der Funnel nimmt den Kanal in den Schlüssel auf (`d:<kanal>:<freitext>`), weil sein Quellenfilter auf Kanal-Ebene arbeitet — derselbe Freitext unter zwei Kanälen ergibt dort zwei Zeilen, im Setting-Tab eine.

**`setting_calls.has_budget_8k`**: `ja` · `nein` · `unklar` — **`branche`**: `agentur` · `coach` · `consultant` · `sonstiges` — **`ist_pain`**, **`warmth`**: 1–10
**`setting_calls.meeting_kind`**: `link` · `telefon` · NULL (nur Altbestand — die dritte Option „Ohne" gibt es nicht mehr, §1).

**Termin-Lebenszyklus (Migration 0032, beide Termin-Tabellen soweit nicht anders vermerkt):**
- **`cancel_reason_code`**: `kein_neuer_termin` „Will keinen neuen Termin" · `krank` · `familiaer` „Familiär" · `beruflich` · `preis` „Preis" · `sonstiges`. Freitext daneben: `cancel_reason`. Der Code wird von der Server-Action verlangt und von der Lebenszyklus-Leiste am Termin abgefragt (`AppointmentLifecycleBar`, unverändert). **Der DB-seitige Zwang aus 0035 fällt mit Migration 0041** (Trigger `setting_calls_require_cancel_reason` / `closing_calls_require_cancel_reason` werden entfernt, §7) — dieselbe Begründung wie beim Disqualifikationsgrund oben. Die beiden **Triggerfunktionen bleiben absichtlich stehen**, mit einem `STILLGELEGT mit 0041`-Vermerk: In ihnen steckt nicht die Regel — die ist trivial —, sondern die Bauart, die Bestandszeilen verschont (OLD/NEW-Vergleich statt CHECK). Wer sie löscht, leitet das beim Wiederanhängen neu her und baut vermutlich den CHECK nach, den 0035 ausdrücklich vermieden hat.
- **`cancel_outlook`**: `ohne_aussicht` „Ohne Aussicht auf einen neuen Termin" · `neuer_termin`. CHECK: `cancelled_at` und `cancel_outlook` sind ein Paar (beide oder keins). Die beiden Werte trennen zwei Ablage-Listen, die nicht zusammenfallen dürfen: totes Ende vs. offener Ersatztermin.
- **`no_show_resolution`**: `antwort` · `ohne_antwort` · `ersatztermin`. CHECK: nur bei `show_status='no_show'`. `ohne_antwort` ist der einzige saubere Auslöser für die Ablage-Ansicht „No-Show ohne Antwort" — vorher war dieser Fall von „noch nicht nachgefasst" nicht zu unterscheiden.
- **`setting_calls.disqualify_reason_code`** (nur Setting; ein Closing hat dafür `lost_reason_code`): `geld` · `kein_budget` · `kein_bedarf` · `falscher_zeitpunkt` · `kein_entscheider` · `falsche_zielgruppe` · `keine_zusammenarbeit` · `sonstiges`. Zwei davon bekommen nie ein Recycling-Datum: `keine_zusammenarbeit` ist die rote Notiz „kein weiteres Kontaktieren!" (die App setzt zusätzlich `recycle_excluded_at`, also die **Sperrliste**), `falsche_zielgruppe` ist schlicht der falsche Fit (dort wird nur ein bereits gesetztes Datum geräumt). Freitext daneben: `disqualify_reason`.

**Die folgenden vier Wertelisten beschreiben EINGEFRORENE Spalten** (§3): Sie stehen live und
tragen ihre Zeilen, aber kein Code vergibt seit dem Rückbau noch einen dieser Werte. Sie
bleiben hier, damit der Bestand aus zwei produktiven Tagen lesbar ist — und damit niemand die
Spalten für unbenutztes Beiwerk hält und wegräumt.

**`cascade_steps.cascade_kind`** (neun Kaskaden): `setting_msg` „Setting — Nachrichten" · `setting_mail` · `closing_msg` · `closing_mail` · `followup_msg` „Nachfass-Kontakt" · `closing_kickoff` „Nach der Qualifizierung" · `no_show_setting` · `no_show_closing` · `kein_close` „Kein Abschluss" (Labels standen in `CASCADE_KIND_LABELS`, `src/lib/cascadeEngine.ts` — gelöscht). Die fünf **Mail-Stufen wurden ausgeliefert, aber mit `enabled=false`** (Phase 2, nie begonnen). Die 21 geseedeten Zeilen je Organisation entstehen weiterhin beim Anlegen einer Organisation (§2), werden aber von niemandem gelesen.
**`cascade_steps.trigger_event`**: `scheduled` (geplant vor dem Termin) · `created` (beim Anlegen, nur `closing_kickoff`) · `no_show` · `no_close`. **`anchor`**: `before_appointment` · `after_appointment`.

**`reminder_touches.entity_type`**: `setting` · `closing` · `closing_followup` (der vereinbarte Nachfass-Kontakt eines Closings im Status `nachfassen`, nicht das Closing-Gespräch selbst).
**`reminder_touches.touch_kind`** (ersetzte das frühere `touch_type` mit `offset_1..3`/`no_show`): `cascade` (geplante Stufe vor dem Termin) · `chain` (Stufe einer Kette nach einem Ereignis) · `sofort` (Ersatz-Touch, wenn der Termin für jede geplante Stufe zu kurzfristig war — `step_no = 0`, `due_at` = Erzeugungszeitpunkt). WELCHE Stufe es ist, steht in `cascade_kind` + `step_no`, nicht im Typ. CHECK: bei `touch_kind='cascade'` muss `due_at <= appointment_at` sein; `sofort` ist davon ausgenommen.
**`reminder_touches.channel`**: `linkedin` · `telefon` · `whatsapp` · `mail` · NULL (kein Kanal ableitbar — Quelle ohne Vorlaufkanal wie `ads`/`sonstige`, oder ein Closing ohne Setting-Bezug). Aufgelöst wurde er in `resolveCascadeChannel()`/`resolveFollowUpChannel()` (`src/lib/reminderCascade.ts`, **Datei gelöscht**): WhatsApp nur, wenn `setting_calls.wa_phone` **und** `wa_consent_at` gesetzt waren; bei `wa_refused_at` fiel der Kanal auf den Akquise-Kanal des Settings zurück. `channel_locked` = die Person hatte den Kanal bewusst gewählt. **Einen Kanal-Begriff gibt es im Nachfassen heute nicht mehr** — der Nachfass-Stempel hält bewusst nicht fest, wie kontaktiert wurde (§1).
**`reminder_touches.outcome`**: `antwort` · `keine_antwort` · `bestaetigt` · `abgesagt` · `verschoben` · NULL (nicht erledigt oder ohne Angabe abgehakt).

> **Was von der Kaskaden-Bibliothek übrig ist: nichts.** `src/lib/reminderCascade.ts`,
> `src/lib/cascadeEngine.ts` und `src/lib/messageTemplates.ts` sind gelöscht, ebenso
> `src/app/actions/reminders.ts` (Erzeugen, Entwerten, Lesen, Erledigen, Rückgängig), das
> Kaskaden-Panel am Termin und das Erinnerungs-Board. Aus `src/lib/recycleCadence.ts` sind
> `RECYCLE_REASON_HINTS` und `renderRecycleTemplate()` mitgefallen — sie füllten `{anlass}` in
> einer Recycling-Vorlage, und Vorlagen gibt es nicht mehr. Geblieben sind dort genau zwei
> Dinge mit einem echten Verbraucher: der Ursprungs-Typ `RecycleOrigin` und
> `RECYCLE_REASON_LABELS`, das der Ablage die beiden Codes `dead` und `fu_exhausted`
> beschriftet, die keine andere Grund-Familie kennt.
>
> **Ein einziges Stück ist vorher umgezogen statt mitzufallen:** das Verschiebe-Kontingent
> `max_reschedules`. Es lag im Erinnerungs-Modul, gehört aber nicht zur Kaskade — hätte es sie
> begleitet, wären die Verschiebe-Warnung in `postponeAppointment` und die Anzeige in der
> Lebenszyklus-Leiste lautlos verschwunden (§3).

**`closing_calls.status`**: `offen` „Offen" · `gewonnen` „Gewonnen" · `verloren` „Verloren" (erzwingt `lost_reason_code`, **nicht** mehr den Freitext) · `nachfassen` „Nachfassen" (erzwingt `follow_up_due`)
**`closing_calls.lost_reason_code`** (CHECK aus Migration 0029, in 0032 auf **zehn** Werte erweitert): `preis` „Preis" · `timing` „Timing" · `kein_bedarf` „Kein Bedarf" · `entscheider` „Entscheider" · `wettbewerb` „Wettbewerb" · `vertrauen` „Vertrauen" · `ghosting` „Ghosting" · `falsche_zielgruppe` „Falsche Zielgruppe" · **`kein_fit` „Kein Fit"** (neu in 0032) · `sonstiges` „Sonstiges" (Labels: `CLOSING_LOST_REASON_LABELS`, `src/lib/types.ts`).
Warum zusätzlich zum Freitext: „zu teuer", „Preis", „Budget nicht da" sind drei Zeilen mit je Häufigkeit 1 — zählbar wird der Grund erst über den Code. **Code = Statistik, Freitext = Gedächtnis**; `lost_reason` bleibt daneben bestehen und ist seit 0029 optional. `falsche_zielgruppe` ist der einzige Code, der nicht das Closing bewertet, sondern die Stufe davor: Er macht messbar, wer falsch qualifiziert — ohne ihn verschwände der Fall unter `kein_bedarf`. `kein_fit` ist das Closing-Pendant zu „Zusammenarbeit macht keinen Sinn": nicht der Lead war falsch, das Gespräch hat gezeigt, dass es nicht passt — der zweite Code neben `falsche_zielgruppe`, der nie ein Recycling-Datum bekommt. Die Erweiterung ist rein additiv, Bestandszeilen bleiben gültig. **Fallstrick 1 (alt):** Migration 0029 hat **alle** Bestandszeilen mit `status='verloren'` auf `sonstiges` gesetzt (bewusst kein Rate-Mapping aus dem Freitext) — sie sind von Hand nachzupflegen. Bis dahin ist die Verteilung eine Aussage über das Deploy-Datum, nicht über die Einwände. Zeilen ohne Code führt der Closing-Tab getrennt als „Ohne Angabe", statt sie nach `sonstiges` zu buchen.
**Fallstrick 2 (neu, seit dem Rückbau — wichtiger als der erste):** Der Knopf **„Tot"** der Arbeitsliste schreibt bei einem Closing `status='verloren'` **mit `lost_reason_code='sonstiges'`** (`markTerminDead`, `src/app/actions/followUpStamp.ts`). Der Grundkatalog ist Teil des Überbaus, der gefallen ist; die Liste fragt keinen Grund mehr ab. Das ist bewusst keine Notlüge, sondern die zutreffende Angabe — „kein bestimmter Grund erfasst", dieselbe Bedeutung wie im 0029-Bestand. Der praktische Gewinn ist das Recycling: `schedule_recycle()` wählt für `sonstiges` den konservativen Mittelwert (120 Tage), während ein direktes `update ... set status='verloren'` den Lead ohne jede Wiedervorlage verschwinden ließe. **Konsequenz für die Auswertung: Der Anteil `sonstiges` wächst ab jetzt strukturell**, und zwar genau um die Leads, die über die Liste beendet werden. Eine Verlustgrund-Verteilung misst damit zunehmend, auf welchem WEG ein Deal beendet wurde (Detailseite mit Grundauswahl vs. Listen-Knopf), nicht mehr nur, woran er scheiterte. Wer Einwände auswerten will, sollte den Zeitraum vor dem Rückbau nehmen oder die Zeilen über die Detailseite nachpflegen.

**Derselbe Code entscheidet seit Migration 0033 zusätzlich die Recycling-Wartezeit** — und zwar **serverseitig in `schedule_recycle()`**, nicht im App-Code (Werte in `pipeline_settings`, §3): `timing`/`preis`/`kein_bedarf` kurz (75–105 Tage), `entscheider` 150, `wettbewerb`/`vertrauen` 270, `ghosting` zweistufig (14 Tage Breakup-Touch, dann 180), `sonstiges`/ohne Code ein konservativer Mittelwert (120), `falsche_zielgruppe` und `kein_fit` **nie** — Letzteres hält ein CHECK auf `closing_calls` zusätzlich fest, nicht nur eine App-Regel. Die RPC `recycle_tasks` (§5) liefert als `reason` den gespeicherten `recycle_reason_code`, ersatzweise den `lost_reason_code`; bei `origin='telefon'`/`'setting'` steht dort `dead`, bei `origin='linkedin'` `fu_exhausted` — beides keine DB-Enums, nur die beiden Ursprüngen zugeordneten Grund-Token der App.

> **⚠ Die Staffelung steht weiter in der Datenbank — sie wird nur nicht mehr eingestellt.**
> Das ist die eine Stelle, an der „flaches Recycling" (§1) missverstanden werden kann.
> `schedule_recycle()` ist **eingefroren** (0033) und sucht sich die Wartezeit unverändert aus
> einer von **vierzehn** Spalten aus, je nach Ursprung UND Verlustgrund. Was der Rückbau
> geändert hat, sitzt eine Ebene darüber: In `/settings` steht nur noch **ein** Feld
> „Recycling — Wartezeit (Tage)", und es schreibt **alle vierzehn Spalten mit derselben Zahl**
> (`RECYCLE_COLUMNS`, `src/components/settings/PipelineSettingsCard.tsx`). Ein Feld, das nur
> eine Spalte schriebe, wäre eine Behauptung: In der Oberfläche stünde eine Frist, in der
> Datenbank gälte für drei der vier Ursprünge und jeden Verlustgrund weiter die alte
> Staffelung — sichtbar nirgends.
> **Fürs Nachrechnen folgt daraus zweierlei:** (1) Solange in einer Organisation niemand
> gespeichert hat, gelten weiterhin die geseedeten, gestaffelten Werte (28–270 Tage); erst der
> erste Klick auf Speichern ebnet sie ein. Die Karte sagt das an Ort und Stelle, indem sie die
> gespeicherte Spanne nennt. (2) `recycle_reason_code` bleibt gesetzt und bleibt **das
> maßgebliche Feld** — der Grund verschwindet nicht, nur seine Wirkung auf die Frist.

**Der Grund kommt aus der Zeile, nicht vom Client.** Die frühere Fassung schickte ihn als Argument mit — womit sich per direktem POST jede beliebige Wartezeit auslösen ließ. `schedule_recycle()` liest ihn selbst, prüft zusätzlich den Status und gibt `null` zurück, wenn der Vorgang gar nicht (mehr) terminal ist. `recycleIntervalDays()`/`computeNextRecycleAt()` und `DEFAULT_RECYCLE_SETTINGS` in `src/lib/recycleCadence.ts` sind schon mit 0033 entfallen; die `{anlass}`-Ableitung `RECYCLE_REASON_HINTS` ist mit dem Rückbau gefolgt (sie füllte einen Vorlagen-Platzhalter). Aus der Datei wirken nur noch `RecycleOrigin` und `RECYCLE_REASON_LABELS`. `tests/recycleCadence.test.ts` prüft die eine Regel, die dabei nicht verloren gehen durfte — „`falsche_zielgruppe`/`kein_fit` bekommen nie ein Datum" — am Text der eingefrorenen Migration 0033, also dort, wo sie lebt.
**`closing_calls.show_status`** (`show`/`no_show`, bei `offen` NULL): wird beim Eintragen eines Ergebnisses **abgeleitet** — ein Ergebnis setzt voraus, dass das Gespräch stattgefunden hat, also schreibt `setClosingOutcome` `show`, sofern noch nichts erfasst ist (ein bewusst gesetztes `no_show` bleibt stehen). Analog zu `setSettingOutcome`. Migration 0028 hat das für Bestandsdaten nachgezogen. **Fallstrick:** Echte Closing-No-Shows der Vergangenheit sind nicht rekonstruierbar — die Closing-Show-Quote springt dadurch auf ~100 % und sinkt erst mit neuen Daten.

**`contacts.answer_category`** (Freitext, DB-Wert = deutsches Label, kein Constraint):
- Aktuell wählbar: `Positiv` · `Neutral` · `Negativ`
- Legacy in Bestandsdaten: `Interessiert`, `Kein Interesse`, `Zu teuer`, `Falsches Timing`, `Bereits Lösung`, `Kein Budget`, `Falsche Zielgruppe` (Definition: `src/lib/categories.ts`)

**`contacts.follow_up_number`** (FU-Stufe): **NULL** = noch kein Follow-up, 1–3 = FU1–FU3. Achtung: der CHECK erlaubt nur `null` oder `1,2,3` — eine **0 steht nie in der DB**. Wer auf „noch kein Follow-up" filtert, braucht `is null`; ein `in (0)` findet nichts, und `in (…)` trifft NULL grundsätzlich nicht. Fälligkeits-Intervalle: nach Pitch +3 Tage → FU1, danach +5 → FU2, danach +7 → FU3, danach Ende. Der Rhythmus steht an genau **einer** Stelle: `nextFollowUpAfter()` (`src/lib/followup.ts`), geschlüsselt nach der gerade *abgeschlossenen* Stufe. **Seit dem Rückbau gibt es nur noch EINEN Schreibpfad**: das Listen-Board (`calcNextFollowUp`/`updateContact`, `src/app/actions/contacts.ts`). Es kennt beide Anker und wählt zwischen ihnen — *heute*, wenn eine FU-Stufe gerade neu erledigt wurde (sonst läge die nächste Stufe bei älteren Leads sofort in der Vergangenheit), sonst *Pitch-Datum*, damit ein unabhängiger Feld-Edit den Nachfass-Termin nicht verschiebt. Der zweite Pfad `advanceLinkedInFollowUp` lag im Nachfassen-Board und ist mit dessen LinkedIn-Sektion gefallen. In Bestandsdaten stecken noch Fälligkeiten aus einer Zeit davor, als dieser Pfad mit der Stufe *davor* rechnete (nach FU1 nur +3 statt +5) und nach FU3 noch eine Fälligkeit setzte — je nachdem, wo ein Follow-up erledigt wurde, stand eine andere Wiedervorlage in der Zeile. Ausschluss aus dem FU-Flow: `answered=true` oder `appointment_set=true` oder FU3 erreicht oder `blocked_at` gesetzt (Lead hat uns blockiert).

## 5. RPCs = maßgebliche Metrik-Definitionen

Die Dashboards rechnen nicht frei, sondern über diese SECURITY-DEFINER-RPCs — für konsistente Auswertungen deren Semantik übernehmen. Alle nehmen `p_workspace_id` + optional `p_effective_user_id` (NULL = workspace-weit; bei `data_scope='own'` serverseitig auf den Aufrufer erzwungen).

**Welche RPC nach dem Rückbau noch aufgerufen wird — die Kurzfassung.** Keine RPC wurde
geändert oder gelöscht; geändert hat sich nur, wer sie ruft:

| RPC | Ruft die App sie noch? |
|---|---|
| die 8 Metrik-RPCs (`rpc_*`) | **ja**, unverändert |
| `recycle_tasks` | **ja** — `/nachfassen` (`loadRecycleTasks`) und der eine Navigations-Zähler, beide mit denselben Schnitten (§5.4) |
| `dropout_lists` | **ja** — nur `/ablage` (`src/app/actions/dropout.ts`), und nur fünf ihrer sechs Werte |
| `schedule_recycle`, `recycle_attempt` | **ja** — jeder Aufruf wurde beim Rückbau einzeln geprüft und bleibt: keiner erzeugte einen Touch, alle vier planen eine Wiedervorlage |
| `seed_workspace_defaults` | **ja**, über den Trigger — legt aber zur Hälfte Zeilen an, die niemand liest (§2) |
| `nachfassen_tasks` | **nein — kein Aufrufer mehr.** Die Seite hat sie in Welle 2 verloren, der Navigations-Zähler in der Nachbesserung (§5.4) |
| `apply_reminder_touches` | **nein — kein Aufrufer mehr.** Mit dem Erinnerungs-Modul ist der einzige weggefallen |

Angefasst wird trotzdem keine von ihnen: Alle liegen in eingefrorenen Migrationen (0030–0037),
und ein `drop function` für eine Anzeigefrage wäre der falsche Preis — er nähme Grants und
Abhängigkeiten einer produktiv erreichbaren Funktion mit. Für Auswertungen sind sie damit
unverändert benutzbar, `nachfassen_tasks` und `apply_reminder_touches` eingeschlossen; man muss
nur wissen, dass ihr Ergebnis auf keiner Seite mehr steht. **Zwei RPCs ohne jeden Aufrufer sind
kein Versehen, sondern der Normalzustand nach einem Rückbau** — dieselbe Linie, aus der die vier
Tabellen stehen bleiben (§3): Was fällt, ist der Code, der etwas ruft, nicht das Gerufene.

| RPC | Liefert | Semantik-Details |
|---|---|---|
| `rpc_owner_day_metrics(ws, from, to, user?)` | je `owner_name`+Tag: `dms`, `answers`, `appts` | Tag = `coalesce(pitched_at, created_at::date)`; Owner über `lists.owner_name` (Vorrang) |
| `rpc_owner_week_counts(ws, from, to, user?)` | je Owner+Tag: `cnt` Pitches | Basis des Wochenduells |
| `rpc_appt_rate(ws, user?)` | `total_dms`, `total_appts` | **all-time**, ohne Zeitraum |
| `rpc_appointments_booked(ws, from, to, user?)` | je `user_id`+Tag: `cnt` **gelegte** Termine | Stichtag = `setting_calls.created_at`, gebucketet über den **Berlin**-Kalendertag; Person = `coalesce(assigned_user_id, created_by_user_id)`. Deckt alle Quellen ab (LinkedIn, Telefon, manuell). Einzige Definition von „gelegt" für persönliches Dashboard und Team-Dashboard — s. Abgrenzung unten |
| `rpc_followup_alerts(ws, today, user?)` | `due_soon` (heute…+3 Tage), `overdue` | nur offene FU-Kandidaten (Ausschlüsse s. §4, inkl. `blocked_at is null`) |
| `rpc_phone_owner_metrics(ws, from, to, user?)` | je Owner: `calls`, `gatekeeper_reached`, `decider_reached`, `appointments`, `callbacks`, `dead` | **`calls` = Erstkontakte** (Firmen mit `first_call_at`), **nicht** Anwahlen (§1) — Wählversuche stehen nur in `phone_call_attempts`. **Achtung: nur `calls` ist zeitraumgefiltert** (`first_call_at between`), die übrigen Spalten sind all-time-Zählungen. Personenfilter über `list_owned_by_user()` — `owner_name` hat Vorrang |
| `rpc_phone_day_metrics(ws, from, to, user?)` | wie oben, aber je Owner+**Tag** | Tag = `coalesce(first_call_at, created_at::date)`; `calls` zählt nur Leads mit `first_call_at is not null` (wieder: Erstkontakte); für Zeitraum-Analysen diese RPC nutzen. Personenfilter wie oben |
| `rpc_phone_list_counts(ws, user?)` | Status-Counts je Telefonliste | Personenfilter über `list_owned_by_user()` |
| `nachfassen_tasks(ws, today, now, user?)` | fällige Aufgaben (Union) | 4 Zweige: ① LinkedIn-FU (`next_follow_up_at <= today`, Ausschlüsse §4) ② Telefon-Rückruf (`status='rueckruf'`, `callback_at <= now`) ③ Closing (`status='nachfassen'`, `follow_up_due <= today`) ④ Setting (`status in ('no_show','unqualifiziert')`, `follow_up_due <= today`). Personenfilter: ①② über `list_owned_by_user()`, ③④ über `coalesce(assigned_user_id, created_by_user_id)`. **Signatur und Verhalten unverändert seit 0030** — weder der Nachfassen-Umbau noch der Rückbau haben sie angefasst.<br>**⚠ Die RPC liefert vier Zweige, und sie hat KEINEN Aufrufer mehr.** Zweig ① (LinkedIn) wurde schon vor dem Rückbau app-seitig verworfen; mit dem Rückbau sind ②③④ in die Terminliste gewandert (② in deren Rückruf-Reiter, ③④ in die Arbeitsmenge, §1), und `/nachfassen` ruft die Funktion nicht mehr auf. Der Navigations-Zähler tat es noch eine Weile — das war die Ursache dafür, dass das Badge 14 zeigte und die Seite darunter zwei Karten; auch er liest sie inzwischen nicht mehr (§5.4). In der Datenbank ist nichts geändert: Wer per SQL auswertet, bekommt unverändert alle vier Zweige. **Für eine Auswertung ist sie damit die bequemste Quelle für „was wäre heute fällig", aber keine Beschreibung dessen, was jemand sieht.** |
| `recycle_tasks(ws, today, user?)` | fällige Recycling-Versuche (Union, **v2** aus Migration 0033) | 4 Zweige über die „toten Enden" (§1). **Jeder Zweig prüft zusätzlich den STATUS** — das ist der Unterschied zur ersten Fassung, die nur auf das Datum sah: ein Lead, der auf anderem Weg wiederbelebt oder gewonnen wurde, tauchte dort Monate später als Aufgabe auf. LinkedIn: `next_recycle_at <= today`, `blocked_at is null`, `answered is not true`, `appointment_set is not true`, **`follow_up_number = 3`** · Telefon: `status='dead'` · Setting: `status in ('dead','unqualifiziert')` **oder** `no_show_resolution='ohne_antwort'` **oder** `cancel_outlook='ohne_aussicht'`, dazu `revived_at is null` · Closing: `status='verloren'`, `revived_at is null`. Alle vier zusätzlich `recycle_excluded_at is null` **und `recycle_responded_at is null`**. Liefert `reason` (`recycle_reason_code`, ersatzweise `lost_reason_code`/`sonstiges`), `reason_note`, `attempt_count`, `last_contacted_at`. Personenfilter wie bei `nachfassen_tasks`. **Eigene RPC statt Erweiterung von `nachfassen_tasks`**: eine geänderte `RETURNS TABLE`-Signatur verlangt `DROP FUNCTION` statt `CREATE OR REPLACE` — zwei stabile RPCs sind das kleinere Risiko als ein Drop mit Grants/Abhängigkeiten einer produktiv genutzten Funktion. **Seit dem Rückbau ist sie die einzige Quelle von `/nachfassen`** — `getNachfassenTasks()` mischt nichts mehr und schneidet nichts mehr weg (§5.5), sondern sortiert sie nach Fälligkeit und schlägt für die beiden Lead-Ursprünge die Liste nach. **Was diese RPC liefert, steht damit 1:1 auf dem Bildschirm.** |
| `dropout_lists(ws, list, user?)` | Zeilen einer der sechs Ablage-Listen (Migration 0033) | `list` ∈ `abgesagt` · `ersatztermin_offen` · `disqualifiziert` · `kein_close` · `no_show_ohne_antwort` · `gesperrt` (unbekannter Wert → Exception). Abgeleitet aus dem Zeilenzustand, **keine eigene Tabelle** (§1). Fünf Listen kennen nur `setting_calls`/`closing_calls`; **`gesperrt` deckt alle vier Recycling-Tabellen ab** (auch `contacts` und `phone_leads` — „Endgültig sperren" ist im Nachfassen-Board für alle vier Ursprünge anklickbar) und **setzt den Personenfilter bewusst außer Kraft**: `v_user := null`, die Liste liefert immer org-weit. Die Spalte `list_id` ist nur bei den beiden Lead-Ursprüngen gefüllt (sie haben keine Detailseite, der Verweis führt zur Liste); bei Terminen bleibt sie NULL.<br>**⚠ Die RPC ist unverändert, die App fragt seit dem Rückbau nur noch fünf der sechs Werte ab.** `/ablage` ruft sie je Ansicht mehrfach auf und legt die Ergebnisse entdoppelt zusammen: „Ausgeschieden" = `disqualifiziert` + `kein_close` + `abgesagt` + `no_show_ohne_antwort` (in **dieser Reihenfolge** — sie ist die Vorrangkette beim Entdoppeln, weil derselbe Termin in mehreren Quellen stehen kann und vorn stehen soll, was den aussagekräftigsten Grund mitbringt), „Gesperrt" = `gesperrt`. **`ersatztermin_offen` fragt niemand mehr ab** — der Zustand gehört in die Hauptliste, nicht ins Archiv (§1); der Navigations-Zähler, der genau an diesem Zweig hing, ist mit ihm gefallen (§5.4). Er bleibt in der RPC und ist per SQL unverändert abrufbar. |
| `schedule_recycle(ws, origin, entity_id, today?)` | das gesetzte `next_recycle_at` oder `null` (Migration 0033, Zugriffsprüfung 0037) | Bestimmt die Wartezeit **serverseitig** und schreibt `next_recycle_at` + `recycle_reason_code` in die Ursprungszeile. Grund UND Status kommen aus der Zeile, nie vom Aufrufer. Gibt `null` zurück (und schreibt nichts), wenn: keine `pipeline_settings`-Zeile existiert · der Vorgang ausgeschlossen/wiederbelebt/nicht terminal ist · der Grund nie recycelt wird · `recycle_attempt_count >= max_attempts`. **Fasst den Versuchszähler NICHT an** — die alte Fassung setzte ihn bei jedem Aufruf auf 0 und startete den Deckel neu. Prüft seit 0037 die Mitgliedschaft selbst (`workspace_members` oder Plattform-Admin). |
| `recycle_attempt(ws, origin, entity_id, today?)` | neuer `recycle_attempt_count` (Migration 0033, Zugriffsprüfung 0037) | Erhöht den Zähler, setzt `recycle_last_contacted_at` und nullt `next_recycle_at`, sobald der Deckel erreicht ist — alles in **EINER** Anweisung. Vorher wurde gelesen, gerechnet und zurückgeschrieben: zwei parallele Klicks auf „Nochmal versucht" verbrannten zwei von zwei erlaubten Versuchen. Prüft seit 0037 die Mitgliedschaft selbst — und zwar **vor** der Prüfung des `origin`-Arguments: Wer nicht zur Organisation gehört, soll nicht einmal erfahren, welche Ursprünge es gibt. **Setzt unterhalb des Deckels KEINE neue Fälligkeit** — der alte `next_recycle_at` bliebe stehen, und der liegt per Definition schon in der Vergangenheit. Die nächste Wartezeit plant deshalb `markRecycleContacted` (`src/app/actions/recycle.ts`) direkt danach über `schedule_recycle()` ein; ohne diesen zweiten Aufruf stünde dieselbe Karte am nächsten Tag wieder da, und die zweite Ghosting-Stufe (`days_ghosting` statt `days_ghosting_breakup`) wäre unerreichbar, weil sie `recycle_attempt_count > 0` verlangt. |
| `apply_reminder_touches(ws, entity_type, entity_id, cascade_kind, rows)` | **Kein Aufrufer mehr** (Migration 0032, Prüfungen aus 0039) | Entwertete die offenen Touches einer Kaskade (`superseded_at = now()`) und legte die übergebenen neu an — in **EINEM** Funktionskörper, weil zwei Statements gegen einen partiellen Unique-Index bei zwei dicht aufeinanderfolgenden Auslösern (Umterminieren plus Ergebnis) den Insert scheitern ließen; der Aufruf war fail-soft, der Termin stand danach ganz ohne Kaskade da. Prüft Mitgliedschaft, Termin-Zugehörigkeit und Zuweisung selbst (0039). **Mit dem Rückbau ist ihr einziger Aufrufer gefallen** — `tests/rueckbauKern.test.ts` sichert die ABWESENHEIT jedes Aufrufs, nicht das Verhalten eines einzelnen; die stärkere Fassung, weil sie auch einen künftigen Weg zurück erwischt. Die Funktion selbst bleibt stehen (eingefroren in 0032/0039). |
| `seed_workspace_defaults(ws)` | void (Migration 0034) | Legt `pipeline_settings` + 21 `cascade_steps` an, idempotent (`on conflict do nothing`), **ohne** Textzeilen. Läuft automatisch über den AFTER-INSERT-Trigger auf `workspaces` (§2). |

**Jede schreibende RPC prüft die Zugehörigkeit selbst — seit Migration 0037 auch die beiden
Recycling-Funktionen.** `schedule_recycle()` und `recycle_attempt()` liefen bis dahin als
`security definer` und filterten zwar auf das übergebene `p_workspace_id`, verifizierten aber
nicht, dass der Aufrufer dort Mitglied ist: Zwei UUIDs — eine fremde Organisation und eine
Zeilen-ID daraus — genügten, um in einer fremden Organisation `next_recycle_at` zu setzen oder
einen Versuchszähler hochzudrehen. Lesen ließ sich dabei nichts (beide geben nur ein Datum bzw.
eine Zahl zurück), der Schaden war also begrenzt, die Lücke trotzdem unnötig. 0037 stellt beiden
Funktionskörpern denselben Block voran, den `apply_reminder_touches()` seit 0032 trägt —
**wörtlich derselbe**, damit es für schreibende RPCs genau ein Muster gibt und nicht zwei, die
auseinanderlaufen:

```sql
if not exists (select 1 from public.workspace_members wm
               where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid())
   and not public.is_platform_admin() then
  raise exception 'Kein Zugriff auf diese Organisation';
end if;
```

Der `is_platform_admin()`-Zweig ist Pflicht, kein Beiwerk: Ein Plattform-Admin ist in einer
Kunden-Organisation bewusst **kein** `workspace_members`-Eintrag (§2) — ohne ihn wäre der
Org-Umschalter genau hier tot. Die beiden **lesenden** RPCs aus 0033, `recycle_tasks()` und
`dropout_lists()`, bekommen bewusst nichts: Sie laufen über `rpc_effective_user`, das für
Nicht-Mitglieder ohnehin `Not a workspace member` wirft.
**Fürs Nachrechnen ändert das nichts:** `execute_sql` im MCP läuft als `postgres`, `auth.uid()`
ist dort NULL — beide Funktionen scheitern also, und zwar auch in der eigenen Organisation. Sie
sind Schreibpfade und gehören nicht in eine Auswertung.

**Personenfilter der Telefon-RPCs:** Die drei `rpc_phone_*`-RPCs und der Telefon-Zweig von `nachfassen_tasks` filtern über `list_owned_by_user()` — genau wie die LinkedIn-RPCs seit Migration 0015. Bis 0028 filterten sie stattdessen über `created_by_user_id` und ignorierten damit den `owner_name`-Vorrang: Eine Telefonliste, die ein Admin FÜR ein Mitglied angelegt hatte, zählte in der *Gruppierung* beim Mitglied, im *Personenfilter* aber beim Admin — das Mitglied sah seine eigenen Zahlen nicht. Wer alte Zahlen nachrechnet, muss diesen Bruch einkalkulieren.

**Drei Definitionen von „Termin" — nicht vermischen.** Die häufigste Verwechslungsquelle im ganzen Datenmodell. Dieselbe Person, derselbe Zeitraum, drei verschiedene Zahlen — alle drei korrekt, weil sie verschiedene Fragen beantworten:

| Definition | Frage | Stichtag / Quelle | Wo sie erscheint |
|---|---|---|---|
| **gelegt** | Wie viele Termine hat die Person in diesem Zeitraum **gebucht**? (Aktivität) | `setting_calls.created_at`, Berlin-Tag → `rpc_appointments_booked` | Kachel „Termine gelegt" auf `/` und `/team`; auf `/` folgen auch die Setting-Kopfzahlen diesem `created_at`-Fenster. Der **LinkedIn-Tab** nutzt dieselbe Definition, rechnet sie aber in JS (`berlinDateISO(created_at)` + `source_type='linkedin'`), weil die RPC keinen Listen-Filter kennt |
| **absolut** | Welche Termine **finden** in diesem Zeitraum statt? | `settingEffDate(r)` = `coalesce(appointment_at (Berlin-Tag), call_at, created_at (Berlin-Tag))`, analog `closingEffDate` | Übersicht-, Setting-, Closing- und Funnel-Tab, die Vergleichsseite (`src/lib/analyse.ts`) und der Kalender `/termine`. Der Funnel-Tab nimmt zusätzlich **zweierlei** heraus — abgesagte Termine und alles nach **heute** — und zeigt deshalb für denselben Zeitraum weniger Termine als Setting-Tab, Übersicht und Kalender (§5, „Die eine benannte Ausnahme") |
| **Pitch-Kohorte** | Wie viele der in diesem Zeitraum **gepitchten** Kontakte haben irgendwann einen Termin bekommen? (Konversion) | `contacts.appointment_set is true`, Tag = Pitch-Tag (in SQL: `rpc_owner_day_metrics.appts`) | Terminquote auf `/` und `/team` (appts / dms, Zielband 3–7 %) sowie Listen-Ranking und Umsatz je Liste im LinkedIn-Tab. **Nicht** mehr im Funnel-Tab: dessen sechs Stufen kommen inzwischen alle aus `setting_calls`/`closing_calls` — vorher trug die Stufe „Termine" die RPC-Spalte `appts`, die Stufe daneben gezählte Setting-Zeilen, zwei Definitionen in einem Trichter. Die RPCs liefern dort nur noch die Nenner der Wert-Kacheln (DMs, Antworten, Erstkontakte, Entscheider) |

Warum das auseinanderfällt: Ein Termin, der am 3. gebucht und für den 20. gelegt wurde, zählt in „gelegt" zum 3., in „absolut" zum 20. Wird er umterminiert, wandert er in „absolut" mit (`rescheduleSetting` fasst nur `appointment_at` an), in „gelegt" nicht — das ist gewollt, sonst verschöbe eine Umbuchung rückwirkend die Aktivitätszahl. Die Pitch-Kohorte wiederum hängt an `contacts` und kennt manuell gebuchte Termine gar nicht; sie misst die Güte der Pitches, nicht die Menge der Termine. Für „wie viel hat X getan" ist **gelegt** die richtige Zahl, für Kalender/Auslastung **absolut**, für Konversionsquoten die **Kohorte**.

Kennzahl-Definitionen der UI:
- **Antwortquote** = answers / dms; **Terminquote** = appts / dms (Zielband 3–7 %). Auf `/` und `/team` die Pitch-Kohorte (s. o.), im LinkedIn-Tab dagegen gelegte Termine ÷ Pitches des Zeitraums — bewusst zwei verschiedene Mengen (§5.1).
- **Termine gelegt** = `rpc_appointments_booked`, Σ `cnt` im Zeitraum.
- **Umsatz** = Σ `closing_calls.deal_volume` where `status='gewonnen'`. Der Stichtag hängt vom Ort ab: Im Analyse-Bereich `closingEffDate` (§5 „absolut"), auf `/team` das Fenster der laufenden Woche über `call_at` (Fallback `created_at`), begrenzt auf **heute** — Umsatz aus der Zukunft gibt es nicht. Bis Runde 1 stand dort eine all-time-Summe neben lauter Wochenzahlen.
- **Wochenduell-Sieg** = strikt mehr Pitches als jede andere Person (geteiltes Maximum = Unentschieden).
- **Der Trichter** (Funnel-Tab, der einzige Termin-Trichter des Analyse-Bereichs) hat sechs Stufen, alle aus `setting_calls`/`closing_calls`: Termine Setting → Shows Setting → Qualifiziert → Termine Closing → Shows Closing → Gewonnen, mit dem Umsatz als Abschlusskarte. Verknüpfung Setting↔Closing über `setting_call_id`; Kanal und Zielgruppe erbt das Closing von seinem Setting. Die Akquise-Stufen davor (DMs/Erstkontakte, Antworten/Entscheider) sind **keine** Trichterstufen mehr, sondern nur noch die Nenner der Wert-Kacheln — sie kommen aus den Tages-RPCs und zählen eine andere Grundgesamtheit.
  Nicht zu verwechseln mit dem **Akquise-Trichter des Telefon-Tabs** (Erstkontakte → Gatekeeper → Entscheider → Pitch → Termine, zugeklappt am Ende des Tabs, zusätzlich je Person). Er teilt mit dem Termin-Trichter keine einzige Stufe: Er endet dort, wo der andere anfängt, und zählt Leads statt Terminen. „Genau ein Trichter" gilt also für den **Termin**-Funnel — der ist es, den zwei verschiedene Zählweisen kaputtmachen würden.
- **Umsatz je Stufe** (Wert-Kacheln des Funnel-Tabs) = Umsatz des Kanals ÷ DMs bzw. Erstkontakte · Antworten bzw. Entscheider · Settings · Closings. Ohne Basis `null` („—"), nie 0.

#### Die fünf Quoten des Termin-Funnels

Sie stehen in keiner RPC — die Tabs rechnen sie aus `setting_calls`/`closing_calls`. Zähler **und Nenner** gehören zur Definition; wer nur den Zähler übernimmt, bekommt eine andere Zahl als die UI.

| Kennzahl | Zähler | Nenner | Warum dieser Nenner |
|---|---|---|---|
| **Show-Quote (Setting)** | `show_status='show'` | Termine mit **erfasstem** `show_status` (`show` + `no_show`) | Datensatz-Ebene. Der frühere Nenner nutzte `no_show_count` und mischte damit EREIGNISSE (Wiederholungs-No-Shows, teils von **vor** dem Zeitraum) mit DATENSÄTZEN; ein neuterminierter, später erschienener Termin drückte die Quote dauerhaft. Noch offene Termine bleiben aus Zähler **und** Nenner, sonst läse sich jeder laufende Zeitraum wie ein Einbruch. Übersicht, Setting-Tab, Quellen-Matrix des Funnels und Vergleichsseite rechnen identisch. |
| **Quali-Quote** | `show_status='show'` **und** `status in ('qualifiziert','closing_gelegt')` | Shows | Misst die Lead-Qualität: Wie viele der Erschienenen überstehen die Qualifizierung? |
| **Zu Closing geschickt** | Show **und** `status='closing_gelegt'` | Qualifizierte (`qualifiziert` + `closing_gelegt`, jeweils mit Show) | Misst die Konsequenz des Setters, nicht die Lead-Qualität: Von den Terminen, die überhaupt eine Chance hatten, wie viele landen wirklich in einem Closing? No-Shows und Unqualifizierte stehen damit gar nicht erst im Nenner. **Liegt derzeit fast immer bei 100 %** — Grund siehe §4 (`qualifiziert` wird nicht mehr vergeben). |
| **Show-Quote (Closing)** | `closing_calls.show_status='show'` | alle Closing-Termine **ohne die abgesagten** (`cancelled_at is null`) | Termine ohne Angabe bleiben bewusst im Nenner — sonst maß die Quote, wer das Häkchen gesetzt hat. Genau **eine** Menge kommt heraus: die abgesagten. Eine Absage lässt `status` und `show_status` unangetastet (§3) und zählte im vollen Nenner wie ein No-Show; die Quote sank damit mit jeder erfassten Absage, ohne dass sich am Vertrieb etwas geändert hätte — ein abgesagter Termin ist kein „ohne Angabe", er hat nachweislich nicht stattgefunden. Zweiter Fallstrick: `show_status` wird beim Eintragen eines Ergebnisses abgeleitet (§4), die Quote steht deshalb nahe 100 % und wird erst mit neu erfassten No-Shows aussagekräftig. Gerechnet wird ausschließlich in `closingShowRate()` (`src/lib/analyse.ts`); die Vergleichsseite nutzt dafür die Messgröße `closing_not_cancelled` als Nenner. |
| **Abschlussrate (Win-Rate)** | `status='gewonnen'` | **Shows** des Closings | Der frühere Nenner „gewonnen + verloren" wirft jeden noch offenen Deal heraus und schönt systematisch: Ein Zeitraum ohne einen einzigen Verlust stand auf 100 %, obwohl zehn Termine unentschieden lagen. |

**Diese Nenner gelten überall gleich** — Übersicht, Fach-Tabs, die Quellen-Matrix des Funnels und die Vergleichsseite (§5.2) rechnen dieselbe Kennzahl gleich. Eine Zahl, die davon abhängt, wo man sie liest, zerstört das Vertrauen in alle anderen; deshalb liegt die Setting-Show-Quote überall auf den entschiedenen Terminen, die Closing-Show-Quote überall auf den nicht abgesagten und die Abschlussrate überall auf den Closing-Shows. **Die beiden Show-Quoten haben also verschiedene Nenner, und das ist Absicht:** Am Erstgespräch ist `show_status` eine eigenständige Erfassung, am Closing wird er aus dem Ergebnis abgeleitet (§4) — ein Nenner aus erfassten Feldern misst dort die Erfassungsdisziplin statt des Ergebnisses.

> **⚠ Die eine benannte Ausnahme: Der Funnel-Tab zählt TERMINE anders — aus ZWEI Gründen,
> nicht aus einem.** Das ist der häufigste „die Software rechnet falsch"-Verdacht im ganzen
> Analyse-Bereich, weil beide Ausschlüsse einzeln plausibel sind und zusammen fast nie jemand
> auf dem Zettel hat. Für denselben Zeitraum, dieselbe Person, denselben Filter zeigt der
> Funnel weniger Settingtermine als Übersicht, Setting-Tab und Kalender, und zwar weil er
> nacheinander zwei Mengen wegnimmt:
>
> 1. **Abgesagte Termine** (`cancelled_at is not null`, Entscheidung K5). Ein Termin, der nie
>    stattgefunden hat, stünde in jeder Durchlassquote als garantierte Null — ab dem Tag, an
>    dem die Absage-Erfassung anlief, wäre jede Quote gesunken, ohne dass sich am Vertrieb
>    etwas geändert hätte.
> 2. **Alles nach heute** (`toEff = min(bis, heute)`, Berlin-Tag). Ein Termin, der erst noch
>    bevorsteht, kann keine Show, keine Qualifizierung und kein Closing haben.
>
> **Die Absagequote erklärt nur den ersten Teil der Differenz.** In einem abgeschlossenen
> Zeitraum ist sie die ganze Differenz — dort gilt „Termine im Trichter + Absagen = Termine im
> Setting-Tab", und genau dafür hat sie ihren Nenner (alle Termine, abgesagte eingeschlossen,
> s. u.). In einem **laufenden** Zeitraum kommen die noch anstehenden Termine hinzu, und die
> Rechnung geht ohne sie nicht auf. Wer nur einen der beiden Ausschlüsse kennt, rechnet nach,
> kommt nicht hin und misstraut anschließend allen Zahlen der Seite.
>
> Die Oberfläche sagt beides an Ort und Stelle: `zeitgrenzeInfo` und `absagenInfo` stehen in
> **jeder** Funnel-Sektion mit Trichterstufen, die Meta-Zeile trägt „· nur bis heute" und „·
> ohne N Absagen" (Letzteres immer, auch bei null Absagen — es beschreibt die Definition, nicht
> den Befund). Übersicht und Setting-Tab erklären die Differenz von ihrer Seite aus.
> Umgekehrt gilt: **Auf die Quoten wirkt sich keiner der beiden Ausschlüsse aus.** Weder eine
> Absage noch ein noch offener Termin bekommt ein `show_status`; beide fallen aus den Nennern
> oben ohnehin heraus. Es geht ausschließlich um die MENGE „Termine".

**Zwei Ursachen-Schnitte weichen bewusst ab** und sagen es an Ort und Stelle:
- „Welches Kriterium sagt den Abschluss voraus?" (Setting-Tab) rechnet die Closing-Quote je Kriterium gegen die **Erschienenen**, nicht gegen die Qualifizierten. Gefragt ist ja, ob das Kriterium den Weg *durch* die Qualifizierung ins Closing vorhersagt — dann gehört die Qualifizierung in den Nenner. Δ ist der Abstand beider Quoten (Ja vs. Nein) in Prozentpunkten; „unklar" beim Budget bleibt außen vor, weil es keine Aussage ist.
- „Wie lange dauert der Abschluss?" (Closing-Tab) rechnet die Win-Rate gegen **entschiedene** Deals (gewonnen + verloren), weil ein noch offener Deal über seine endgültige Dauer nichts aussagt (§5.1).

**Telefon-Quoten** sind Kohorten-Quoten: Nenner ist immer `calls` = **Erstkontakte** des Zeitraums (Leads mit `first_call_at`, RPC-Ebene), Zähler der heutige Stand genau dieser Leads (Lead-Ebene) — ein Termin, der erst nächste Woche zustande kommt, zählt rückwirkend auf die Woche des Erstkontakts. Das gilt auch für die **Mailbox-Quote** = Leads mit `mailbox=true` ÷ Erstkontakte des Zeitraums — der frühere Nenner „Leads mit gesetztem Mailbox-Feld" maß die Erfassungsdisziplin, nicht das Ergebnis. Nicht verwechseln mit dem **Mailbox-Anteil** in der Sektion „Nachfassen oder neue Leads?": Der zählt **Anwahlen** aus `phone_call_attempts` (Ereignisse), nicht Leads — dieselbe Frage auf der anderen Zählebene (§1).

#### Die Absagequote (Funnel-Tab, Sektion „Absagen")

Sie existiert **genau einmal** — als Zahl nur im Funnel-Tab; Übersicht und Setting-Tab
verweisen textlich darauf, rechnen sie aber nicht nach. Zwei getrennte Töpfe, weil Setting-
und Closing-Absagen verschiedene Grundgesamtheiten haben; eine gemeinsame Quote mischte zwei
Nenner.

| Kennzahl | Zähler | Nenner | Warum dieser Nenner |
|---|---|---|---|
| **Absagequote Setting** | `setting_calls.cancelled_at is not null` | **ALLE** Settingtermine des Fensters, abgesagte eingeschlossen | Der einzige ehrliche Nenner: Eine Absage kann jeden geplanten Termin treffen. Nur so gilt „Termine im Trichter + Absagen = Termine im Setting-Tab" — die Quote ist damit genau die **Brücke** zwischen den beiden Zahlen, die sich zwischen den Tabs unterscheiden. Der naheliegende Show-Quoten-Nenner („Termine mit erfasstem Ergebnis") wäre hier **strukturell** falsch: Ein abgesagter Termin bekommt nie ein `show_status` und stünde nie in seinem eigenen Nenner — die Quote läge konstant bei 0 %. |
| **Absagequote Closing** | `closing_calls.cancelled_at is not null` | alle Closingtermine des Fensters | wie oben |
| **Ohne Aussicht / Neuer Termin** | `cancel_outlook = 'ohne_aussicht'` bzw. `'neuer_termin'` | — (reine Mengen über beide Termin-Arten) | „Ohne Aussicht" heißt: kein Ersatztermin in Sicht, der Lead geht in die Ablage und später ins Recycling. „Neuer Termin" heißt: verschoben, die Kaskade startet neu. |
| **Tabelle „Warum abgesagt wurde"** | je `cancel_reason_code` | Anteil an der Summe der Absagen (nicht an allen Terminen) | Gruppiert wird über den **Code**, nie über `cancel_outlook` — dieselbe Regel wie bei `lost_reason_code` (§4). Zeilen ohne Code stehen getrennt als „Ohne Angabe", statt nach `sonstiges` gebucht zu werden. Setting- und Closing-Absagen fallen hier in **eine** Tabelle: Der CHECK ist derselbe. |

**Der Nenner ist NICHT die volle Setting-Tab-Menge.** Er sitzt *innerhalb* der Funnel-Grenzen
und übernimmt deren Schnitte: Termine ohne auflösbare Person, Termine außerhalb
`[von, min(bis, heute)]` und alles außerhalb des Quellenfilters fehlen. Nur der
Absagen-Ausschluss selbst gilt hier nicht — `addCancel()` läuft im Code bewusst eine Zeile
**vor** dem `if (r.cancelled_at) continue;`. Beide Töpfe zählen zudem immer auf dem eigenen
Termindatum, also in **Periodensicht**, unabhängig vom Zählweise-Umschalter: Eine Absage ist
ein Ereignis des Termins, nicht seiner Kohorte.

> **⚠ Die Absagequote einer laufenden Periode reift nach — das ist eine Eigenschaft, kein
> Fehler.** Ein Termin wird nach seinem **Plandatum** einsortiert (`settingEffDate`), nicht
> nach dem Tag, an dem die Absage ausgesprochen wurde. Eine heute abgesagte Sitzung, die für
> den 20. des nächsten Monats stand, erscheint deshalb erst im nächsten Monat — die Quote des
> laufenden Zeitraums steigt danach noch, ohne dass sich rückwirkend etwas „geändert" hätte.
>
> Das ist bewusst so entschieden: **Die gesamte App ordnet Termine nach ihrem Datum ein**
> (§5, „absolut"). Eine zweite Zeitachse allein für Absagen hätte eine Zahl geschaffen, die
> sich anders verhält als jede andere auf derselben Seite — man könnte Absagen dann nicht mehr
> gegen die Termine desselben Balkens halten, und in derselben Sektion stünden Zähler und
> Nenner auf verschiedenen Kalendern. Praktische Konsequenz: **Für einen Vergleich über die
> Zeit abgeschlossene Perioden nehmen.** Der laufende Monat ist bei der Absagequote genauso
> unfertig wie bei der Show-Quote — nur fällt es hier später auf, weil die Nachreifung Wochen
> statt Stunden dauert.
>
> Zweite Datenlage-Grenze an derselben Stelle: Es gibt **keinen Backfill** für `cancelled_at`.
> Der Tab ermittelt deshalb die älteste je erfasste Absage (über beide Tabellen, ohne Zeitraum-
> und Personenfilter) und zeigt für Zeiträume davor „—" statt 0 — leer heißt „gab es damals
> noch nicht", nicht „niemand hat abgesagt". Dasselbe Muster wie beim Anruf-Log (§3).

#### Die Recycling-Kennzahlen (Übersicht-Tab, Sektion „Lohnt das Recycling?")

`src/components/analyse/RecycleSection.tsx`, zugeklappt am Ende der Übersicht — die einzige
Auswertung, die beantwortet, ob die Wiedervorlage überhaupt etwas bringt. Sie hat den Rückbau
**gekürzt überlebt**, und das war eine bewusste Entscheidung: Die Wiederbelebungsquote ist die
einzige Zahl, die begründet, ob die eine verbliebene Frist richtig steht. Ohne sie wäre auch
eine flache Frist reine Gefühlssache.

| Kennzahl | Zähler | Nenner | Zeitachse |
|---|---|---|---|
| **Kontaktiert** | — | — | Zeilen mit `recycle_last_contacted_at` (Berlin-Tag) im Zeitraum. Das ist die **Kohorte** der Sektion. |
| **Reaktionen** | `recycle_responded_at is not null` | — | heutiger Stand, gebucht auf den Tag des Versuchs |
| **Wiederbelebungsquote** („Wiederbelebt") | Reaktionen | Kontaktierte | **Kohorten-Quote wie die Telefon-Quoten:** Der Zeitraum schneidet den *letzten Versuch*, der Zähler ist der heutige Stand genau dieser Leads. Eine Antwort, die erst nächste Woche kommt, zählt rückwirkend auf die Woche des Versuchs. |
| **Gesperrt** | `recycle_excluded_at` im Zeitraum | — | **eigenes Datum**, bewusst außerhalb der Quote: Eine Sperre ist kein gescheiterter Versuch, sie ist eine Entscheidung. Hängt als einzige Kachel **nicht** am Datenlage-Anker — der kommt aus dem ersten Versuch, eine Sperre entsteht aber ohne jeden Versuch (bei einem Kontaktverbot setzt die App sie sofort). |
| **Warten aktuell** | `next_recycle_at is not null` | — | Stand von **heute**, ohne Zeitraumfilter — „wie viel liegt gerade in der Wiedervorlage". Steht als Fußnote, nicht als Kachel. |

**Eine** Tabelle mit drei Spalten (Kontaktiert · Reaktionen · Wiederbelebt), gruppiert **je
Ursprung** (LinkedIn · Telefon · Erstgespräch · Closing). Personenachse wie überall
zweigleisig: LinkedIn/Telefon über den Listen-Owner, Setting/Closing über `personOf()` (§5.1).
Datenlage-Anker und `available`-Rückfall wie beim Anruf-Log: Fehlt Migration 0033, sagt die
Sektion das, statt wie „niemand recycelt" auszusehen.

> **Drei Kennzahlen sind mit dem Rückbau gefallen.** Zwei davon maßen die **Staffelung**, und
> die gibt es in der Oberfläche nicht mehr: die zweite Tabelle **„Je Grund"** (Schlüssel
> `<ursprung>:<grund>`) und die **Verteilung der Versuche** (1 · 2 · 3+) — Letztere diente
> ausschließlich dazu, Deckel und erstes Intervall gegeneinander zu justieren, und justiert
> wird nicht mehr: Die Frist gilt für alle vier Ursprünge gleich, und der Deckel ist eine Zahl
> zwischen 1 und 5, die man einstellt statt sie aus einer Verteilung abzulesen. Was bleibt, ist
> der **Ursprung**: Ob ein totes Telefonat oder ein verlorenes Closing die besseren
> Wiederbelebungen liefert, ist auch bei EINER Frist eine Entscheidung wert (die Arbeitszeit
> gehört dorthin, wo die Antworten herkommen).
>
> **Die dritte, „Am Deckel", ist eine LÜCKE und keine Aussage — der Unterschied ist wichtig.**
> Hier stand zwischenzeitlich die Begründung „es gibt keinen Deckel". Die war falsch:
> `recycle_attempt()` (0033, eingefroren) nullt bei `recycle_attempt_count >= max_attempts` das
> `next_recycle_at`, `recycleBlockedReason()` sperrt daraufhin „Jetzt wieder anschreiben", und
> die Ablage zeigt je Karte „1 von 2". Der Deckel wirkt und ist die härteste Grenze des
> Recyclings — er lässt einen Lead endgültig verschwinden. **Einstellbar ist er nicht** (mehr):
> Das Feld in `/settings` ist gefallen, der Wert steht fest bei dem, was gespeichert ist
> (ausgeliefert 2). Die Kachel
> fehlt trotzdem, und zwar aus einem Grund, der mit ihm nichts zu tun hat: `loadRecycleData()`
> lädt `recycle_attempt_count` nicht mehr, `AnalyseRecycleRow` führt das Feld nicht, und
> `max_attempts` käme aus einer zweiten Abfrage. Ohne beides wäre „Am Deckel" **geraten**.
> **Wer die Zahl braucht, rechnet sie per SQL** (Muster bei den Beispiel-Auswertungen); sie
> fehlt im Analyse-Bereich, nicht in der Datenbank.

### 5.1 Analyse-Bereich (`/analyse`, sechs Tabs)

Sechs Tabs, jeder mit genau einer Zuständigkeit — dieselbe Zahl steht nirgends zweimal:

| Tab | Trägt | Zuständig für (steht nur hier) |
|---|---|---|
| **Übersicht** | Matrix **Kennzahl × Kanal × Gesamt** („Kanäle im direkten Vergleich": Akquise-Volumen · Settingtermine · Show-Quote · Quali-Quote · Closingtermine · Umsatz), „Fortschritt im Zeitraum", Personen-Tabelle, **„Lohnt das Recycling?"** (Wiederbelebungsquote je Ursprung, zugeklappt am Ende — §5) | der Kanalvergleich in einem Blick **und** die Recycling-Wirkung. **Kein Trichter** — den gibt es genau einmal, im Funnel-Tab; zwei optisch gleiche Trichter mit verschiedenen Zählweisen beschädigen beide |
| **LinkedIn** | 6 Kennzahlen (DMs · Antwortquote · Antworten mit Stimmungs-Balken · Termine gelegt · Terminquote · Block-Quote), „Vergleich" (nur bei mehr als einer sichtbaren Person), „Fortschritt", Consistency, Follow-ups (Kaskade + „Zusatz durch FU an Umsatz"), „Wird konsequent nachgefasst?", „Wer hängt hinterher?", „Listen im Vergleich" | alle LinkedIn-Kennzahlen. Die früheren Tabs „Follow-ups" und „Listen" sind hier aufgegangen; `?tab=followup`/`?tab=listen` fällt still auf „uebersicht" zurück |
| **Telefon** | 11 Kennzahlen in drei Blöcken (Volumen · Durchkommen · Terminquoten & Rückruf), „Vergleich" (Personen ohne Telefon-Aktivität im Zeitraum werden ausgeblendet und in der Fußnote gezählt), „Nachfassen oder neue Leads?" (Anruf-Log), „Fortschritt", A/B nach Skript und Branche, Gatekeeper-Weg, Versuchszähler, Abbruch-Gründe (drei Untertabellen), Akquise-Trichter | die Ereignis-Ebene (**Anwahlen**, §1) und die A/B-Achsen |
| **Setting** | 4 Kennzahlen (Termine · Show-Quote · Qualifiziert · Zu Closing geschickt), „Vergleich", „Fortschritt im Zeitraum", „Termine im Verlauf", Quellen-Donut, „Quelle des Termins"; alles Weitere unter „Mehr Auswertungen" (Zeitfenster · Termin-Art · Branche · Kriterien · Budget · Qualität · Status) | die Qualifizierungs-Schnitte |
| **Closing** | 6 Kennzahlen (Closing-Termine · Show-Quote · Abschlussrate · Umsatz pro Meeting · Ø-Deal · Umsatz), „Vergleich", „Fortschritt im Zeitraum", Top-Einwände, Matrix Einwand × Person; „Mehr Auswertungen" („Umsatz im Verlauf" · Win/Loss · Geschwindigkeit · Deal-Größen · Vertrag · Zahlungsarten) | Verlustgründe. **Keine Quellen-Tabelle mehr** — Herkunft rechnet der Funnel-Tab als einziger bis zum Umsatz durch |
| **Funnel** | Wert-Kacheln je Kanal, „Wo kommt der Umsatz her?", der **Trichter** („Funnel Gesamt"), „Fortschritt", Matrix „Je Quelle", **„Absagen"** (zwei Absagequoten + Tabelle „Warum abgesagt wurde", zugeklappt unter dem Trichter — §5) | der einzige Termin-Trichter, die einzige Quellen-Auswertung bis zum Umsatz **und** die einzige Stelle mit einer Absagequote. Die Sektion sitzt bewusst hier: Der Funnel ist der Tab, der Absagen ausschließt — die Zahl darf nicht verschwinden, sie muss sichtbar werden |

**Zwei Konventionen gelten auf allen sechs Tabs** (und auf der Vergleichsseite):

- **„Fortschritt" ist nicht „Verlauf".** Jeder Tab führt eine kumulative Fortschritts-Sektion (`CumulativeProgressChart`): aufsummierter Stand über den Zeitraum, mit der Vorperiode als Vergleichslinie. Sie beantwortet „liegen wir vorn oder hinten" — die Frage, mit der man die Seite öffnet, und deshalb steht sie oben. Die Sektionen mit „… im Verlauf" (Setting, Closing) sind etwas anderes: bucketierte Perioden-Werte, jeder Balken für sich. Wer die kumulative Kurve als Perioden-Chart liest, sieht überall Wachstum.
- **Sektionen sind einklappbar, Erklärungen stehen hinter dem Info-Icon.** Alles unterhalb der Kennzahlen-Reihe läuft über `AnalyseSection` mit `collapsible`; die meisten Sektionen starten zugeklappt (`defaultOpen={false}`) — der Tab öffnet mit Kennzahlen und Fortschritt, den Rest holt man sich. Die Begründungstexte stecken in `InfoPopover` statt dauerhaft im Fließtext. Wichtig für die Umsetzung: `AnalyseSection` ist eine Server Component, das `info`-Element darf **keinen** Handler tragen — `preventDefault`/`stopPropagation` sitzen im Client-Teil `InfoPopover`, sonst bricht das Prerendering (was hier lange unbemerkt blieb, weil alle Analyse-Seiten `force-dynamic` sind).

> **„Erinnerungs-Disziplin" gibt es nicht mehr — beide Blöcke sind mit der Kaskade gefallen.**
> Sie standen zugeklappt im Setting- und im Closing-Tab und beantworteten „wer hakt seine
> Erinnerungen ab" (je Person) und „welcher Touch wirkt am stärksten" (je Kaskaden-Stufe, gegen
> die Show-Quote). Beide lasen `reminder_touches`, und die füllt seit dem Rückbau keine
> Oberfläche mehr: Die Quote wäre ab dem Deploy-Datum konstant und danach für jeden neuen
> Termin eine Division durch null. Mitgefallen sind der Loader `loadReminderTouches()` und die
> Touch-Aggregation in `src/lib/analyse.ts`.
>
> **Für Auswertungen bleibt die Zählweise gültig — sie beschreibt jetzt einen Bestand.** Wer
> die zwei produktiven Tage nachrechnen will: Gezählt wurden nur Touches, die entweder erledigt
> **oder** nicht superseded sind (`done_at is not null or superseded_at is null`) — eine
> Neuterminierung macht einen offenen Touch obsolet, aber ein VORHER erledigter bleibt ein
> echtes Stück Disziplin. Der Personen-Block zählte jeden fälligen Touch (alle `touch_kind`, im
> Closing-Tab auch die des Nachfass-Kontakts), der Stufen-Block nur, was VOR dem Gespräch lag:
> `chain`-Stufen raus, im Closing-Tab zusätzlich `entity_type='closing_followup'` — ein Touch,
> der erst nach dem Termin entsteht, kann dessen `show_status` nicht erklären; und der
> Nachfass-Kontakt trägt **dieselbe `entity_id`** wie das Closing, ein Closing mit beiden
> Kaskaden zählte sonst doppelt. Gruppiert wurde über `cascade_kind` + `step_no`, nicht über
> die Stufennummer allein: Nachrichten- und Mail-Spur tragen beide eine „Stufe 1". Das
> SQL-Muster dazu steht weiter unten bei den Beispiel-Auswertungen.
>
> **Die Warnung, die diese Sektion hinterlässt, gilt weiter für jeden Loader:** Bis zu einer
> Nachbesserung stand hier die alte Spalte `touch_type`; PostgREST wies die *gesamte* Abfrage
> ab, ein `.catch(… → [])` machte daraus eine leere Liste, und beide Blöcke waren dauerhaft und
> **unbemerkt** leer. Daher das `available`-Muster (s. u.) — ein Fehler darf nie wie „nichts
> passiert" aussehen.

Filter in der URL: `tab`, `range`/`von`/`bis`, `g` (Granularität, auf allen Tabs — auch der Funnel bucketet), `users`, `quelle` (Setting/Funnel; Wertebereich = `filterable` in der Kanal-Registry, §4), `reife` (nur LinkedIn), `listen` (nur LinkedIn, kommaseparierte `lists.id`, syntaktisch UUID-geprüft und zusätzlich gegen die real sichtbaren Listen abgeglichen), `modus` (nur Funnel, Default `kohorte`). Beim Tabwechsel werden die Parameter gelöscht, die auf dem Zieltab nichts bewegen — ein Filter ohne Bedienelement filterte sonst unsichtbar weiter. Einen Parameter `min` (Mindest-DMs) gibt es **nicht**: Die Grenze für das Listen-Ranking steht fest bei 10 DMs (`MIN_LIST_DMS`) — bei 3 von 5 DMs steht in der Antwortquote 60 %, und ein Regler, mit dem man Rauschen einschalten kann, hilft niemandem. Der Auf-/Zuklapp-Zustand der Filterleiste steht bewusst **nicht** in der URL (er ändert keine Zahl), sondern im localStorage; die aktiven Filter stehen als Satz im zugeklappten Kopf. Parsing ausschließlich in `parseAnalyseParams` (`src/lib/analyse.ts`), Datenbeschaffung ausschließlich in `src/lib/analyseData.ts` — dort läuft **jede** Abfrage über `fetchAllRows`, weil PostgREST sonst still bei 1000 Zeilen abschneidet. Drei Stellen daneben, alle ebenfalls über `fetchAllRows`: die Auswahlliste des Listen-Filters (`analyse/page.tsx`), die Termin→Liste-Brücke (`LinkedInTab.tsx`) und das Anruf-Log (`src/lib/phoneAttemptsData.ts`, eigene Datei — es ist die einzige EREIGNIS-Quelle und fällt bei fehlender Migration 0028 auf `available: false` zurück, statt den Telefon-Tab abzuräumen).

**Zwei Loader mit `available`-Rückfall** folgen demselben Muster — sie geben `{ rows, available }` zurück, statt einen Fehler zu `[]` einzuebnen, weil sonst eine fehlende Migration genauso aussieht wie „nichts passiert": `loadCallAttempts` (0028) und `loadRecycleData` (0033). Der dritte, `loadReminderTouches` (0032), ist mit der „Erinnerungs-Disziplin" gefallen. Zwei Eigenheiten von `loadRecycleData`, die man beim Nachrechnen kennen muss: Es lädt **ohne Zeitraumfilter** — die Sektion trägt zwei Zeitachsen (`recycle_last_contacted_at` für die Kohorte, `recycle_excluded_at` für die Sperren) und braucht zusätzlich den ältesten Versuch als Anker gegen die Deploy-Datum-Falle. Und `pipeline_settings.max_attempts` wird dort **nicht mehr geladen** — mit der Kachel „Am Deckel" ist auch ihr eigener Abfragezweig entfallen.

Der LinkedIn-Tab rechnet **nicht** über `rpc_owner_day_metrics`, sondern über `loadContacts`: die RPC kennt keinen Listen-Parameter, ihre Zahlen wären bei aktivem Listen-Filter ungefiltert. **Termine** zählen dort als *gelegt* (`setting_calls.created_at` im Zeitraum, `source_type='linkedin'`), nicht als Kohorte — Zähler und Nenner der Terminquote sind damit bewusst verschiedene Mengen. Das Listen-Ranking bleibt dagegen auf der Pitch-Kohorte (`contacts.appointment_set`).

Abgeleitete Kennzahlen, die es so in keiner RPC gibt:
- **Follow-up-Kaskade** (`buildFuCascade`): Stufe = `coalesce(follow_up_number, 0)`. *Erreicht Stufe k* = Kontakte mit Stufe ≥ k; *Antwort auf Stufe k* = `answered = true` **und** Stufe = k. Trägt, weil der Flow das Nachfassen bei einer Antwort stoppt — es gibt **kein** Ereignis-Log je Follow-up und kein `answered_at`. Marginalquote = Antworten_k / Erreicht_k, kumuliert = Σ Antworten ≤ k / Pitches.
- **Kohorten-Reife** (`reife=reif`): nur Pitches, die mindestens `FU_MATURITY_DAYS` (15 = 3+5+7) zurückliegen. Ohne diesen Schnitt drücken frische Pitches jede späte Stufenquote.
- **Nachfass-Disziplin je Stufe** (LinkedIn-Tab): *Fällig gewesen* für Stufe k = Kontakte, die Stufe k erreicht haben, **plus** die, die auf Stufe k−1 hängen und noch im Flow sind (nicht geantwortet, kein Termin, nicht blockiert); *Erledigt* = Gesendet ÷ Fällig gewesen. Wer geantwortet hat, einen Termin hat oder blockiert hat, steht bewusst nicht im Nenner — dort soll gar nicht mehr nachgefasst werden. Die Personen-Tabelle daneben („Wer hängt hinterher?") ist eine **Momentaufnahme von heute** über alle Pitches des Zeitraums, für die der Kohorten-Filter absichtlich nicht gilt: überfällig ist überfällig. „Ø Verzug" = Tage seit Fälligkeit, gemittelt über die überfälligen Kontakte.
- **Stimmung** (`sentimentOf`): `answer_category` → positiv/neutral/negativ; Legacy-Werte werden gemappt (Interessiert → positiv, Falsches Timing → neutral, Kein Interesse / Zu teuer / Kein Budget / Bereits Lösung / Falsche Zielgruppe → negativ). Der Stimmungs-Balken im LinkedIn-Tab rechnet gegen **alle** Antworten und führt unkategorisierte als eigenes Segment „Ohne Kategorie" — gegen die kategorisierten gerechnet sähe auch der saubere 100 %, der nichts pflegt.
- **„Zusatz durch FU an Umsatz"** (LinkedIn-Tab, Follow-up-Block): Σ gewonnener Umsatz der Kohorte, dessen Kontakt mindestens FU1 erreicht hat, plus sein Anteil am Kohorten-Umsatz. Grundgesamtheit ist dieselbe Kohorte wie die Kaskade (also mit `reife`-Schnitt), Verknüpfung über `contacts.setting_call_id`. **Kein Inkrementalwert** — es gibt keine Kontrollgruppe von Kontakten, die man absichtlich nicht nachgefasst hat; die Zahl ist eine Obergrenze, kein Beweis. Die früheren Prozent-Varianten (Anteil an Antwort- und Terminquote) sind entfallen: Eine Kennzahl, deren eigener Info-Text erklärt, dass sie nichts belegt, ändert keine Entscheidung. Beim Umsatz ist das anders — „ohne Nachfassen wären X € nicht entstanden" ist die eine Größe hier, aus der eine Handlung folgt.
- **Umsatz je Liste**: `contacts.setting_call_id` → `closing_calls` mit `status='gewonnen'`. Manuell gebuchte Termine haben keinen Quellkontakt und tauchen dort nicht auf.
- **Funnel-Zählweise** (`modus`, nur Funnel-Tab): `kohorte` (Default) — Grundgesamtheit sind die Termine des Zeitraums, ihre Closings zählen dazu, egal wann sie stattfanden; Person, Quelle und Bucket kommen dabei vom Setting, sonst risse eine Zeile auseinander (Termin bei A, Abschluss bei B). Nur so sind die Prozentwerte zwischen den Stufen echte Durchlaufquoten. `periode` — jede Stufe zählt auf ihrem eigenen Stichtag („was ist in diesem Zeitraum passiert"); Termine und Closings stammen dann aus verschiedenen Mengen und „Show → Closing" kann über 100 % gehen. Vorher war der Kohorten-Abgleich an den Quellenfilter gekoppelt und setzte bei „alle Quellen" zwei unabhängige Mengen ins Verhältnis.
- **Der Funnel-Tab nimmt ZWEI Mengen weg — Zeitgrenze UND Absagen.** Die vollständige Begründung samt Nachrechen-Falle steht in §5 („Die eine benannte Ausnahme"); hier die Mechanik:
  - **Zeitgrenze `toEff = min(bis, heute)`** (Berlin-Tag): Ein Termin, der erst noch ansteht, kann keine Show, keine Qualifizierung und kein Closing haben — er stünde als garantierte Null in jeder Durchlassquote und machte den laufenden Monat umso schlechter, je weiter er noch vor einem liegt. `toEff` gilt durchgehend: für beide Tages-RPCs (`p_to`), für die Bucket-Bildung, für die Periodensicht der Closings und für die Meta-Zeile („· nur bis heute"). Ein Closing zählt zusätzlich nie über heute hinaus, auch nicht in der Kohortensicht — dort wäre sein Datum sonst unbegrenzt.
  - **Absagen `cancelled_at`** (Entscheidung K5): Der Ausschluss ist bewusst keine benannte Konstante, sondern zweimal dieselbe Zeile im Code (`if (r.cancelled_at) continue;`) — direkt hinter dem Zähler der Absagequote, damit die beiden Reihenfolgen nicht auseinanderlaufen können. Benannt sind nur die Erklärungen: `zeitgrenzeInfo` und `absagenInfo` stehen in jeder Sektion mit Trichterstufen.
  - **Deshalb zeigt der Funnel für denselben Zeitraum weniger Termine als Setting-Tab und Übersicht**, wo „Termine im Zeitraum" bewusst die volle Menge inklusive der anstehenden und der abgesagten ist (Kapazitätsfrage statt Konversionsfrage). Der Kalender `/termine` blendet ebenfalls nichts aus (§1).
- **Umsatz je Stufe** (Wert-Kacheln des Funnel-Tabs): kanalrein. Der Umsatz wird über `setting_calls.source_type` des zugehörigen Settings auf den Kanal zurückgeführt. Die Kacheln **folgen dem Quellenfilter**: ohne Filter stehen die beiden Kanäle mit eigenem Akquise-Volumen (LinkedIn, Telefon) nebeneinander, mit Filter nur der gewählte — für einen Kanal ohne eigenes Volumen bleiben die zwei Kacheln „Umsatz pro Setting" und „pro Closing". Genau **eine** Sektion folgt ihm nicht und sagt das in ihrer Meta-Zeile: „Wo kommt der Umsatz her?" teilt den **Gesamt**umsatz auf LinkedIn · Telefon · Andere Quellen auf — mit gesetztem Filter bliebe eine Aufteilung mit einem Summanden, und „Gesamt" wäre nicht mehr das Gesamt. Unter „Andere Quellen" steht alles ohne LinkedIn- oder Telefon-Herkunft (manuell, Ads, Social, Inbound, Website, Closings ohne Setting); nur so summieren sich die Kanäle auf den Gesamtumsatz. Zähler und Nenner der Kacheln liegen zwangsläufig in verschiedenen Kohorten — die DM, aus der im August ein Deal wurde, ging im Juni raus: **Perioden-Kennzahl**, kein Stückpreis.
- **Quellen-Matrix „Je Quelle"** (Funnel-Tab): fünf Spalten — Termine · Show-Quote · Closings · Gewonnen · Umsatz, gruppiert nach `source_detail` (sonst Kanal, §4), sortiert nach Umsatz. Genau **eine** Prozentzahl, und die hat den bekannten Nenner (entschiedene Termine); die Durchlaufquoten zwischen den Stufen stehen im Trichter darüber, wo sie hingehören. Ab 8 Quellen sammelt eine Zeile „Übrige Quellen" den Rest ein — bewusst eine Sammelzeile statt einer Mindestmenge, weil eine Mindestmenge ausgerechnet die Quelle mit einem Termin und einem 20.000-€-Deal verschluckte. Closings ohne verknüpftes Setting stehen als eigene Zeile „Ohne Setting-Bezug" (kein Fehler: direkt angelegt oder beim Org-Umzug gekappt) und wandern nie in die Sammelzeile. Anteilsbalken und Gesamtzeile rechnen über genau die sichtbaren Zeilen.
- **Kanalspalten können weniger ergeben als „Gesamt"** (Kanal-Matrix der Übersicht): Ein Closing ohne `setting_call_id` hat keinen Kanal und zählt nur in der Gesamtspalte, statt einem Kanal angedichtet zu werden. Der Erklärtext der Sektion nennt die Zahl, sobald sie größer als 0 ist.
- **Vorlaufzeit** (Setting) = `appointment_at − created_at` in Tagen, gegen die Show-Quote. **Abschluss-Geschwindigkeit** (Closing) = Closing-Tag − Setting-Tag, gegen die Win-Rate — mit dem abweichenden Nenner aus §5. Ohne verknüpftes Setting gibt es keine Dauer; die Meta-Zeile nennt, wie viele Closings die Auswertung überhaupt tragen.
- **Consistency** (LinkedIn-Tab): Aktive Tage ÷ **Arbeitstage** Mo–Fr im Zeitraum, gerechnet nur bis **heute** — sonst zählte ein laufender Monat seine Zukunft als Lücke, und jedes Wochenende drückte die Quote. Ein Tag zählt ab **einer** DM als aktiv; die strengere Spalte daneben ist „Ziel erreicht" (Tage mit ≥ Tagesziel aus `performance_targets`, ohne Eintrag 20 DMs), dazu „Ø DMs/aktiver Tag". Der Zähler selbst steht als Unterzeile („17 von 22 Arbeitstagen"), nicht als eigene Spalte: Zähler und Quotient desselben Bruchs sind keine zwei Kennzahlen. Pitches an Wochenenden fallen hier heraus, stecken in den Kennzahlen oben aber drin. Eine **Streak** gibt es nicht mehr — sie war auf die Arbeitstage des gewählten Zeitraums gedeckelt, bei „Diese Woche" also nie größer als 5, und dieselbe Person hatte je nach Filter eine andere Serie. `performance_targets` wird im Analyse-Bereich nur noch hier gelesen; einen Soll/Ist-Abgleich in der Übersicht gibt es nicht.
- **A/B-Achsen** (Telefon-Tab): Skript-Arm und Zielgruppe sind derselbe Schnitt über dieselbe Kohorte, nur andere Gruppierung. Beide Achsen sind Freitext und werden normalisiert (trimmen, Mehrfach-Leerzeichen einkochen, case-insensitiv zusammenfassen). Der Skript-Arm kommt vom **Lead** (`phone_leads.script_label`), die Liste ist nur Rückfall (§3); die Branchen-Achse liest ebenso `phone_leads.target_group` vor `phone_lists.target_group`. Nenner sind die **Erstkontakte** des Arms (nur Leads mit `first_call_at`) — ein importierter, nie angerufener Lead darf den Arm nicht verwässern. Arme unter `MIN_AB_CALLS` (20) werden ausgeblendet, Leads ohne Label bekommen **keine** Sammelzeile, sondern werden in der Fußnote gezählt: „Ohne Angabe" wäre sonst der größte Balken.
- **Kanäle ohne eigenes Akquise-Volumen** (Ads, Social Media, Sonstige) zeigen auf der Volumen-Stufe `CHANNEL_NO_VOLUME` („—"), nie 0 — eine 0 läse sich wie ein toter Kanal und zöge jede daraus gerechnete Quote ins Absurde. DMs und Erstkontakte werden **nie** addiert („Kontaktpunkte" gibt es nicht): zwei Tätigkeiten mit völlig verschiedenen Quoten, deren Summe eine Zahl ohne Einheit wäre. In der Kanal-Matrix der Übersicht trägt die Volumen-Zeile deshalb „nicht addierbar" statt einer Gesamt-Zahl. Addiert wird erst ab dem Termin, wo beide Kanäle dasselbe Objekt erzeugen (`setting_calls`).
- **Zwei Personenachsen laufen nebeneinander:** DMs/Erstkontakte kommen aus den RPCs und hängen am Listen-Owner (`list_owned_by_user()`: `owner_name` hat Vorrang, `created_by_user_id` greift nur ohne Namen). Termine/Closings hängen an `personOf()` = `assigned_user_id ?? created_by_user_id` (§2). Zeilen ohne auflösbare Person landen sichtbar in der Sammelzeile „Ohne Zuordnung", statt verworfen zu werden — sonst zeigte der Funnel weniger Termine an, als es gibt.

Beispiel-Auswertungen (Muster):

```sql
-- Termine GELEGT je Person diese Woche (Stichtag = Anlage des Setting-Calls).
-- Personenachse ist die Zuweisung, der Ersteller greift nur ersatzweise —
-- ein Join direkt auf created_by_user_id liefert andere Zahlen als die UI.
select p.username, count(*) as termine
from setting_calls sc
join profiles p on p.user_id = coalesce(sc.assigned_user_id, sc.created_by_user_id)
where (sc.created_at at time zone 'Europe/Berlin')::date
      >= date_trunc('week', now() at time zone 'Europe/Berlin')::date
group by 1 order by 2 desc;

-- Umsatz je Person (gewonnene Closings), gleiche Personenachse
select p.username, sum(cc.deal_volume) as umsatz
from closing_calls cc
join profiles p on p.user_id = coalesce(cc.assigned_user_id, cc.created_by_user_id)
where cc.status = 'gewonnen'
group by 1 order by 2 desc nulls last;

-- LinkedIn-DMs je Owner in einem Zeitraum (owner_name-Vorrang!)
select coalesce(l.owner_name, '—') as owner, count(*) as dms
from contacts c join lists l on l.id = c.list_id
where coalesce(c.pitched_at, c.created_at::date) between '2026-07-01' and '2026-07-31'
group by 1 order by 2 desc;

-- Show-Quote der Termine, die IM Zeitraum stattfinden ("absolut").
-- Nenner sind nur Termine mit erfasstem Ergebnis — nicht no_show_count, und
-- nicht alle Termine (offene liegen sonst wie No-Shows im Nenner).
select count(*) filter (where show_status = 'show') as shows,
       count(*) filter (where show_status is not null) as entschieden,
       round(100.0 * count(*) filter (where show_status = 'show')
             / nullif(count(*) filter (where show_status is not null), 0), 1) as show_pct
from setting_calls
where coalesce((appointment_at at time zone 'Europe/Berlin')::date,
               call_at,
               (created_at at time zone 'Europe/Berlin')::date)
      between '2026-07-01' and '2026-07-31';

-- Verlustgründe: IMMER über lost_reason_code gruppieren, nie über den
-- Freitext. Bestandszeilen stehen alle auf 'sonstiges' (Migration 0029) —
-- eine dominante 'sonstiges'-Zeile heißt „noch nicht nachgepflegt".
select coalesce(lost_reason_code, '— ohne Angabe') as grund, count(*)
from closing_calls where status = 'verloren'
group by 1 order by 2 desc;

-- A/B: Terminquote je Skript-Arm. Der Arm steht AM LEAD (Migration 0030) —
-- über phone_lists.script_label gruppiert fehlten die abgewanderten Leads.
select coalesce(pl.script_label, '— ohne Testarm') as arm,
       count(*) filter (where pl.first_call_at is not null) as calls,
       count(*) filter (where pl.appointment_set is true) as termine
from phone_leads pl
group by 1 order by 2 desc;

-- Absagen je Grund. NICHT über status filtern: eine Absage lässt status und
-- show_status bewusst unangetastet (§3, Termin-Lebenszyklus) — wer auf
-- status filtert, findet keine einzige.
select cancel_reason_code, cancel_outlook, count(*)
from setting_calls where cancelled_at is not null
group by 1,2 order by 3 desc;

-- Wer verschiebt? reschedule_count zählt NUR Verschiebungen durch den Lead.
select p.username,
       count(*) filter (where sc.reschedule_count > 0) as leads_mit_verschiebung,
       max(sc.reschedule_count) as maximum
from setting_calls sc
join profiles p on p.user_id = coalesce(sc.assigned_user_id, sc.created_by_user_id)
group by 1 order by 2 desc;

-- HISTORISCH: Erinnerungs-Disziplin von Hand. Der Analyse-Block dazu ist mit
-- dem Rueckbau gefallen, die Tabelle steht noch und wächst nicht mehr (§3) —
-- diese Abfrage beschreibt also einen abgeschlossenen Bestand, keinen Betrieb.
-- Gruppiert über cascade_kind + step_no, NICHT über die Stufennummer allein —
-- Nachrichten- und Mail-Spur tragen beide eine "Stufe 1".
-- Superseded, aber erledigte Touches zählen mit — eine Neuterminierung darf
-- die Quote nicht drücken.
select rt.cascade_kind, rt.step_no,
       count(*) as touches,
       count(*) filter (where rt.done_at is not null) as erledigt
from reminder_touches rt
where rt.done_at is not null or rt.superseded_at is null
group by 1,2 order by 1,2;

-- Fällige Recycling-Versuche über alle vier Ursprünge: IMMER über die RPC,
-- nie über next_recycle_at allein — der Status-Riegel je Zweig (§5) ist der
-- Unterschied zwischen "wieder einen Versuch wert" und "längst gewonnen".
select origin, reason, count(*)
from recycle_tasks('<workspace>', current_date)
group by 1,2 order by 3 desc;

-- Absagequote wie im Funnel-Tab: Nenner sind ALLE Termine des Fensters,
-- abgesagte eingeschlossen (§5). Der Show-Quoten-Nenner wäre hier strukturell
-- falsch — ein abgesagter Termin bekommt nie ein show_status.
-- ACHTUNG: Der Termin zählt auf seinem PLANdatum, nicht am Tag der Absage.
-- Eine heute ausgesprochene Absage für nächsten Monat erscheint erst nächsten
-- Monat; die Quote eines laufenden Zeitraums reift also nach.
select count(*) filter (where cancelled_at is not null) as absagen,
       count(*) as termine,
       round(100.0 * count(*) filter (where cancelled_at is not null)
             / nullif(count(*), 0), 1) as absage_pct
from setting_calls
where coalesce((appointment_at at time zone 'Europe/Berlin')::date,
               call_at,
               (created_at at time zone 'Europe/Berlin')::date)
      between '2026-07-01' and '2026-07-31';

-- Wiederbelebungsquote des Recyclings (Übersicht-Tab, §5). Kohorten-Quote:
-- Der Zeitraum schneidet den LETZTEN VERSUCH, der Zähler ist der heutige
-- Stand genau dieser Leads. 'gesperrt' zählt bewusst NICHT als gescheiterter
-- Versuch — eine Sperre ist eine Entscheidung, kein Ausgang.
select count(*) as kontaktiert,
       count(*) filter (where recycle_responded_at is not null) as reaktionen,
       round(100.0 * count(*) filter (where recycle_responded_at is not null)
             / nullif(count(*), 0), 1) as wiederbelebt_pct
from closing_calls
where (recycle_last_contacted_at at time zone 'Europe/Berlin')::date
      between '2026-07-01' and '2026-07-31';

-- „Am Deckel" — die Kennzahl, die im Analyse-Bereich FEHLT (§5). Sie fehlt
-- dort, weil der Loader recycle_attempt_count nicht mehr lädt und max_attempts
-- eine zweite Abfrage kostete; der Deckel selbst WIRKT unverändert:
-- recycle_attempt() (0033) nullt beim Erreichen next_recycle_at, der Lead
-- verschwindet endgültig aus der Wiedervorlage. Genau deshalb lohnt die Zahl.
-- Join auf pipeline_settings, nicht gegen eine feste 2: Der Wert steht je
-- Organisation in der Zeile (CHECK 1-5) und kann von der Auslieferung
-- abweichen — die Oberfläche zeigt ihn nirgends mehr, geändert wird er per SQL.
select count(*) as am_deckel
from closing_calls cc
join pipeline_settings ps on ps.workspace_id = cc.workspace_id
where cc.recycle_attempt_count >= ps.max_attempts
  and cc.recycle_responded_at is null
  and cc.recycle_excluded_at is null;

-- Fälligkeit aus nachfassen_tasks: due_at ist timestamptz, trägt aber
-- überwiegend TAGE (§6). Ein gecastetes `date` steht auf 02:00 Berlin — roh
-- gegen now() verglichen wäre ab zwei Uhr morgens alles überfällig. Nur der
-- Telefon-Zweig trägt eine echte Uhrzeit.
-- ACHTUNG seit dem Rückbau: KEIN Zweig dieser RPC steht noch auf einer Seite
-- (§5). Sie liefert weiter korrekt; ihr Ergebnis ist aber die Frage "was WÄRE
-- fällig", nicht "was steht auf dem Bildschirm". Die Arbeitsmenge der
-- Terminliste hat eine ganz andere Definition (§1).
select source, count(*) filter (
         where case when source = 'telefon' then due_at < now()
                    else (due_at at time zone 'Europe/Berlin')::date
                         < (now() at time zone 'Europe/Berlin')::date end
       ) as ueberfaellig, count(*) as faellig
from nachfassen_tasks('<workspace>', current_date, now())
group by 1 order by 3 desc;

-- Nachfass-Disziplin der Arbeitsliste (Migration 0041). Der Stempel hält NUR
-- den letzten Kontakt — es gibt keine Historie und keine Quote, nur "wie viele
-- offene Vorgänge hat heute schon jemand angefasst".
-- follow_up_last_contacted_by_user_id ist ein AUDIT-Feld: Es sagt, WER geklickt
-- hat, nicht wem der Termin gehört. Für jede Personenachse gilt weiter
-- coalesce(assigned_user_id, created_by_user_id) — §2.
select count(*) filter (
         where (follow_up_last_contacted_at at time zone 'Europe/Berlin')::date
               = (now() at time zone 'Europe/Berlin')::date
       ) as heute_gestempelt,
       count(*) filter (where follow_up_last_contacted_at is null) as nie_kontaktiert,
       count(*) as termine
from setting_calls;
```

### 5.2 Serienvergleich (`/analyse/vergleich`)

Eigenständige Seite neben den sechs Tabs: beliebig viele Serien (max. 6 — so viele validierte Slots hat die kategoriale Palette) in einem Chart plus Gegenüberstellungs-Tabelle. Gerechnet wird auf dem Server; der Zustand liegt vollständig in der URL. Eine Serie ist ein `s`-Parameter im Format `s=<kennzahl>;<dimension>=<wert>;…` (Werte prozentcodiert, damit Listennamen mit `;`/`=` die Struktur nicht sprengen); ohne `s` läuft die Startbelegung „Termine × LinkedIn" gegen „Termine × Telefon". Zeitraum, Granularität und Personenrecht kommen aus demselben `parseAnalyseParams`.

Drei Bausteine, jeder mit genau einer Aufgabe:

| Datei | Rolle |
|---|---|
| `src/lib/compare/model.ts` | Die flache **Faktenzeile**: ein Berlin-Tag, fünf Dimensionen (`person` · `kanal` · `liste` · `zielgruppe` · `skript`), ein Bündel vorberechneter Messgrößen (`MeasureKey`). |
| `src/lib/compare/facts.ts` | Der **Mapper**: bildet `contacts`, `phone_leads`, `setting_calls` und `closing_calls` auf dieselbe Faktenzeile ab. Dadurch liegen Zähler und Nenner einer quellenübergreifenden Kennzahl („Umsatz pro DM") im selben Bucket unter derselben Person, ohne dass irgendwo gejoint werden muss. |
| `src/lib/compare/metrics.ts` | Die **Registry**: eine Kennzahl = eine Zeile aus Zähler, optionalem Nenner, Gruppe (`LinkedIn` · `Telefon` · `Setting` · `Closing` · `Wert`) und Format (`int`/`pct`/`eur`). Fehlt der Nenner, ist es eine Menge, sonst ein Verhältnis. Die Gruppe ist der Gruppenkopf im Dropdown — bei 32 Kennzahlen der Unterschied zwischen Auswahl und Suche, und sie trennt die drei gleichnamigen „Termine…"-Kennzahlen nach ihrer Quelle. Der `key` steht in geteilten Links und darf nie umbenannt werden. Dieselbe Datei kennt zusätzlich die **Quelltabelle** jeder Messgröße (`MEASURE_SOURCE`) und leitet daraus strukturell leere Kombinationen ab (s. u.). |

Regeln, die dort gelten und die man beim Nachrechnen kennen muss:
- **Die Personenachse ist immer eine `user_id`**, nie ein Name: LinkedIn/Telefon lösen über den Listen-Owner auf (`owner_name` vor `created_by_user_id`), Termine über `personOf()`. Ein `owner_name`, der zu keinem Mitglied der aktiven Organisation gehört, fällt bewusst auf `null` und **nicht** auf den Ersteller zurück — sonst schriebe man das Volumen dem Admin zu, der die Liste angelegt hat, und der `owner_name`-Vorrang wäre ausgehebelt.
- **Der Tag einer Zeile ist derselbe wie in den Tabs** (`contactDay`, `phoneLeadDay`, `settingEffDate`, `closingEffDate`) — sonst zählte der Vergleich anders als der Tab daneben.
- **`null` in einer Dimension** heißt „nicht anwendbar oder nicht auflösbar": Die Zeile zählt in jeder ungefilterten Serie mit und fällt aus jeder Serie heraus, die auf diese Dimension filtert — dieselbe Logik wie „Ohne Zuordnung" in den Tabs.
- **Kanal und Zielgruppe eines Closings kommen vom Setting** (über `setting_call_id`); ohne diese Kette landete jeder Umsatz unter „ohne Kanal" und „Umsatz pro DM" wäre nicht kanalrein.
- **Die Listen-Achse mischt beide Welten:** LinkedIn-Listen unter ihrer `lists.id`, Telefonlisten präfixiert als `tel:<phone_lists.id>` — über den Namen fielen die je Owner gleichnamigen Routing-Listen zusammen. Die Zielgruppen-Achse führt `contacts.target_group`, `phone_leads.target_group` und `setting_calls.branche` zusammen (Schlüssel = Rohwert, damit ein Deep-Link stabil bleibt).
- **Quoten-Gesamtwerte sind gewichtet** (Σ Zähler ÷ Σ Nenner), nicht der Mittelwert der Perioden-Quoten — sonst zählte ein Tag mit einem Termin so viel wie einer mit vierzig. Ein Bucket ohne Nenner ist eine **Lücke**, keine 0. „Ø je Periode" gibt es deshalb nur für Mengen.
- Die Wert-Kennzahlen (`umsatz_pro_dm`, `_call`, `_termin`, `_closing`) sind **Perioden-Kennzahlen**: Der Deal aus dem August stammt aus einer DM vom Juni. Zähler und Nenner liegen im selben Fenster, aber nicht in derselben Kohorte.
- **Beschriftungs-Fallstrick:** Die Registry nennt die Messgröße `calls` weiterhin „Anwahlen" (ebenso „Termine aus Anwahlen", „Umsatz pro Anwahl"). Gezählt werden dort — wie überall sonst — **Erstkontakte**, also Leads mit `first_call_at`; der Vergleich liest `phone_call_attempts` gar nicht, eine Anwahl-Kennzahl im Sinne von §1 gibt es auf dieser Seite nicht. Beim Nachrechnen zählt die Messgröße, nicht das Label.
- Die fünfte Dimension trägt bewusst den **Skript-Testarm** statt einer zweiten Quellen-Achse: „Kanal" *ist* die Quelle (dieselbe Spalte `source_type`), und der Testarm ist die einzige Achse, für die es sonst gar keine Auswertung gäbe. Er kommt wie im Telefon-Tab vom **Lead** (`phone_leads.script_label`, Migration 0030), die Liste ist nur Rückfall für Bestandsleads — über die Liste gelesen fielen ausgerechnet die abgewanderten (also schlecht ausgegangenen) Leads aus ihrem Arm (§3).
- **Strukturell leere Kombinationen werden erkannt, nicht angeboten.** Jede Messgröße stammt aus genau einer Quelltabelle (`MEASURE_SOURCE`), und jede Quelltabelle trägt nur einen Teil der fünf Achsen (`SOURCE_DIMS`, Spiegel von `facts.ts`): LinkedIn-Zeilen tragen Kanal `linkedin` und eine LinkedIn-Liste, Telefon-Zeilen Kanal `telefon`, eine Telefonliste und den Testarm; Setting- und Closing-Zeilen tragen weder Liste noch Testarm und jeden Kanal. Daraus fällt `filterConflict()` heraus — „DMs × Kanal Telefon", „Umsatz pro Anwahl × Kanal LinkedIn" oder „Anwahlen × LinkedIn-Liste" stehen im Dropdown sichtbar, aber gesperrt, mit dem Grund als Hinweiszeile; eine gesetzte Kombination erzeugt eine Warnzeile unter der Serie statt eines leeren Diagramms mit dem Rat „Zeitraum vergrößern", der hier nie hilft. Geprüft wird gegen **alle** Quellen einer Kennzahl, nicht nur gegen den Zähler: ein Bruch ohne Nenner ist genauso leer wie einer ohne Zähler. `person` und `zielgruppe` stehen nicht in `SOURCE_DIMS`, weil alle vier Quellen sie setzen.
- **Eine neue Kennzahl braucht einen Eintrag in `MEASURE_SOURCE`** — der `Record<MeasureKey, MetricSource>` ist vollständig getippt, eine fehlende Zeile ist ein Compile-Fehler und keine stille Fehleinschätzung. Insgesamt kostet eine neue Kennzahl: ein Feld in `MeasureKey` (model.ts), eine Zeile im passenden Mapper-Block (facts.ts), eine Zeile in `MEASURE_SOURCE` und eine Zeile in `METRICS`. Aggregation, Chart, Tabelle und URL bleiben unberührt.
- **Die Absage-Kennzahlen der Vergleichsseite rechnen wie der Funnel — die Termin-Menge dagegen nicht.** Drei neue Schlüssel: `absagen` (Menge), `absagequote` (`setting_cancelled ÷ settings`) und `closing_absagequote` (`closing_cancelled ÷ closings`), Nenner jeweils **alle** Termine des Fensters, abgesagte eingeschlossen — dieselbe Begründung wie im Funnel-Tab (§5). Der abgesagte Termin bleibt hier aber **in `settings` stehen**: Die Vergleichsseite zählt Termine in der ABSOLUTEN Definition (Kapazität), wie Setting-Tab und Übersicht. Nur der Funnel-Tab schließt Absagen aus, weil er Konversion misst. Die Absage steht deshalb als eigene Messgröße daneben, statt eine der beiden Zählweisen still zu erzwingen — wer die Funnel-Menge nachbauen will, zieht `absagen` selbst ab (und bekommt trotzdem eine andere Zahl, weil der Funnel zusätzlich bei heute schneidet).
- **Genau eine Quote nimmt die Absagen doch aus ihrem Nenner: `closing_showquote`** (`closing_shows ÷ closing_not_cancelled`, §5). Das ist keine zweite Zählweise für Termine, sondern die Nenner-Definition der Show-Quote Closing, die im Closing-Tab genauso lautet — sie stand hier eine Zeit lang auf `closings` und lieferte dadurch dieselbe Kennzahl auf zwei Seiten mit zwei Zahlen. Weil die Registry nur Zähler und Nenner kennt und nicht subtrahieren kann, ist `closing_not_cancelled` eine eigene Messgröße; `closings` bleibt daneben unverändert die absolute Termin-Menge.

### 5.3 Lead-Dossier (`/lead/[kind]/[id]`)

Die Akte **eines** Leads über alle vier Ursprungstabellen hinweg — Verlauf, Kontaktwege,
Steckbrief, Notizen. Sie beantwortet die eine Frage, die vorher keine Seite beantwortete:
„Was ist mit diesem Menschen bisher passiert?" Bis dahin lag die Antwort verteilt auf
Kontaktzeile, Lead-Zeile, Erstgespräch, Closing, Anruf-Log und Erinnerungen, und niemand sah
sie zusammen.

`kind` ∈ **`contact` · `phone_lead` · `setting` · `closing`** (`isDossierEntityKind()`, Pfade
ausschließlich über `dossierPath()`). Logik in `src/lib/leadDossier.ts` (reine Bibliothek,
testbar ohne DB), Datenbeschaffung in `src/app/actions/leadDossier.ts`.

**Das Dossier ist ein Nachschlagewerk, kein Zählwerk.** Es taucht in keiner Auswertung auf,
liefert keine Summen und keine Quoten; die einzige Zahl mit Einheit ist das Deal-Volumen eines
gewonnenen Closings, und die steht als *ein Steckbrief-Feld*, nicht als Aggregat. Das ist die
Voraussetzung dafür, dass die nächste Eigenschaft ungefährlich bleibt.

#### Lead-Identität in zwei Stufen — die wichtigste Eigenschaft des Dossiers

Ein Lead hat in dieser Datenbank keine ID. Er hat bis zu vier Zeilen in vier Tabellen, und ob
sie denselben Menschen meinen, ist mal beweisbar und mal nur wahrscheinlich. Das Dossier
trennt beides **strikt** und mischt es nie:

**Stufe 1 — belegt (`confidence: 'belegt'`).** Zusammengeführt wird ausschließlich über echte
Fremdschlüssel, per Breitensuche in **beide** Richtungen über genau vier Kanten:

```
contacts.setting_call_id            → setting_calls.id
setting_calls.source_contact_id     → contacts.id
setting_calls.source_phone_lead_id  → phone_leads.id
closing_calls.setting_call_id       → setting_calls.id
```

Ergebnis ist der **Kern** (`collectCore()` → `DossierCore`). Jede Kante trägt eine
Begründung im Klartext mit (`via`, z. B. „Quelle des Erstgesprächs
(`source_phone_lead_id`)."), die in der Oberfläche als Tooltip am Chip hängt: Wer fragt,
warum zwei Zeilen zusammengehören, bekommt die Spalte genannt, nicht ein Achselzucken.

**Stufe 2 — vermutet (`confidence: 'vermutet'`).** Alles, was denselben **normalisierten
Firmennamen** trägt, aber über keinen Fremdschlüssel erreichbar ist. `normalizeCompany()`
senkt auf Kleinschreibung, ersetzt Satzzeichen durch Leerzeichen, kocht Mehrfach-Leerzeichen
ein, trimmt — und gibt unter **drei Zeichen `null`** zurück: Kürzer ist ein Firmenname kein
Unterscheidungsmerkmal mehr. **Rechtsformen werden bewusst NICHT abgeschnitten**
(„Meier GmbH" ≠ „Meier AG") — das Wegkürzen führte zwei verschiedene Firmen zusammen, und
eine falsche Zusammenführung ist schlimmer als eine fehlende. Verglichen wird nur gegen die
Firmennamen **des Kerns**, nie gegen die des Anrufers oder der Liste.

**Und jetzt das Entscheidende: Vermutetes zählt nirgends mit.** Der Ausschluss ist keine
Disziplinfrage an der Anzeige, sondern **ein struktureller Riegel an genau einer Stelle** —
`buildDossier()` filtert *zuerst* alle Eingabelisten auf den Kern herunter und rechnet
danach ausschließlich auf den gefilterten Arrays:

```ts
const contacts = input.contacts.filter((c) => core.contactIds.has(c.id));
const leads    = input.phoneLeads.filter((l) => core.leadIds.has(l.id));
…
const attempts = input.attempts.filter((a) => core.leadIds.has(a.lead_id));
```

Zeitleiste, „Steht an", „Zuletzt kontaktiert", Notizen, Warnungen, Steckbrief, Kontaktwege,
die Mitglieder-Liste und ihr Zähler — alles hängt an diesen Arrays. `suspected` wird als
**letztes** berechnet und ist ein eigenes Feld neben dem Ergebnis, kein Teil davon. Ein
Anruf bei der Firma, der einem anderen Gesprächspartner galt, kann die Zeitleiste also nicht
verunreinigen und „Zuletzt kontaktiert" nicht künstlich verjüngen; genau das prüft
`tests/leadDossier.test.ts` als Gegenprobe.

In der Oberfläche steht Vermutetes in einem **abgesetzten amberfarbenen Kasten unterhalb** der
belegten Mitglieder, mit eigenem Badge („· Vermutung") und dem Satz „nicht eingerechnet. Ob es
dieselbe Person ist, sagt kein Feld; zwei Menschen derselben Firma sind zwei
Gesprächspartner." Zwei Vertrauensgrade nebeneinander in einer Liste wären genau die Art
Vermischung, vor der die Trennung schützen soll.

**Für Auswertungen heißt das:** Der Firmenname ist im ganzen Datenmodell **kein**
Verknüpfungsschlüssel. Wer per SQL über `company` joint, baut die Vermutungsstufe nach — und
zwar ohne den Riegel, der sie im Dossier harmlos macht.

#### Was das Dossier sonst noch trägt

- **Abschnitte in der Reihenfolge eines Telefonats**, nicht in der der Datenbank: Wer ·
  Warnungen (blockiert, WhatsApp verweigert, dauerhaft gesperrt) · Zuletzt kontaktiert ·
  Kontaktwege (zum Kopieren) · Steckbrief · Belegt zusammengehörig (+ Vermutungskasten) ·
  Steht an · Verlauf · Notizen & Gesprächsinhalte.
- **Fünf Ereignisquellen** in der Zeitleiste (`DossierEventSource`): `linkedin` · `telefon` ·
  `setting` · `closing` · `recycling`. Geschätzte Zeitpunkte tragen ein
  sichtbares `≈` — vor allem die FU-Stufen, für die es **kein** Ereignis-Log gibt (§5.1);
  eine geratene Uhrzeit als Tatsache darzustellen wäre hier besonders teuer, weil daneben
  echte Zeitstempel stehen.
- **Die sechste Quelle `erinnerung` ist gefallen — und an ihre Stelle tritt „Nachgefasst".**
  `reminder_touches` wird vom Dossier **nicht mehr gelesen**: Eine Zeitleiste, die aus einer
  eingefrorenen Tabelle liest, zeigte zuerst dauerhaft dasselbe und dann dauerhaft nichts.
  Ersatz ist der Nachfass-Stempel (`follow_up_last_contacted_at`, Migration 0041) als Ereignis
  **„Nachgefasst"** an der Setting- bzw. Closing-Zeile, mit `contactedLead: true` — ohne das
  zeigte „Zuletzt kontaktiert" bei einem täglich bearbeiteten Lead das Datum seines letzten
  Termins, also ein Datum von vor Wochen. Es ist im neuen Ablauf der **häufigste** Kontakt
  überhaupt. **Nur der letzte:** Die Spalte hält einen Zeitpunkt, keine Historie — wer dreimal
  nachgefasst hat, hinterlässt eine Zeile, nicht drei. Die Karte sagt das dazu („frühere
  Nachfass-Kontakte hält die App nicht fest"), statt einen einzelnen Eintrag wie den
  vollständigen Verlauf aussehen zu lassen.
- **Doppelzählung vermieden:** Der „Erstkontakt" aus `phone_leads.first_call_at` erscheint nur,
  wenn das Anruf-Log für diesen Lead leer ist — sonst stünde derselbe erste Wählversuch zweimal
  in der Leiste.
- **Fail-soft in Stufen:** Vier Abfragerunden. Runde 4 (`phone_call_attempts`, `profiles`) darf
  scheitern, ohne die Seite mitzunehmen — die Zeitleiste wird dann dünner, nicht die Seite
  weiß. Fehlt eine ganze Migration, unterscheidet die Leerseite ausdrücklich „Dossier nicht
  verfügbar" von „Kein Lead unter dieser Adresse". `profiles` wird in derselben Abfrage für
  **zwei Rollen** geholt: die zuständige Person eines Termins UND wer zuletzt gestempelt hat —
  das kann derselbe sein, muss aber nicht; in einem Dreier-Team hakt ab, wer gerade Zeit hat.
- **⚠ Das Dossier hängt hart an Migration 0041.** `SETTING_COLUMNS`/`CLOSING_COLUMNS`
  (`src/app/actions/leadDossier.ts`) selektieren die beiden Stempel-Spalten **namentlich**;
  fehlt eine, weist PostgREST die ganze Abfrage ab und die Seite meldet „Dossier nicht
  verfügbar" (Muster 0029/0032, §7). Das ist bewusst so gewählt statt einer eigenen,
  fail-soft nachgeladenen Abfrage: Die kostete eine Runde mehr für zwei Spalten, die ohnehin
  an Zeilen hängen, die hier schon gelesen werden. **Die Terminliste macht es genau umgekehrt**
  und lädt mit `select("*")` — dort wäre eine leere Seite der teurere Fehler (§7).
- **Bekannte Grenze:** Das Dossier benutzt **kein** `fetchAllRows` (§5.1). Der
  Firmennamen-Vorfilter läuft als `ilike` gegen `contacts` und `phone_leads` und unterliegt
  damit der PostgREST-Standardgrenze — bei einem sehr häufigen Firmennamen kann die
  **Vermutungsliste** still unvollständig sein. Der Kern ist davon nicht betroffen (er wird
  über IDs geladen), und weil Vermutetes ohnehin nirgends mitzählt, kostet das eine Anregung,
  keine Zahl.
- **Erreichbar** ist es aus `/ablage` und `/nachfassen` — jeweils als Overlay
  (`LeadDossierSheet`), nicht als Absprung, damit die Arbeitsliste nicht verloren geht. **Auf
  dem Bildschirm heißt es „Details"**, nicht „Dossier" (Knopf `LeadDossierLink`, Overlay-Titel
  „Details zum Lead") — „Dossier" ist der Name im Code und in diesem Dokument, im Board
  erklärte er niemandem, was hinter dem Knopf steckt. Die
  globale **Suche verlinkt es bisher nicht**; sie kennt dieselben vier `kind`-Werte, führt aber
  weiter auf Listen- und Detailseiten.

### 5.4 Navigations-Zähler (`src/lib/navCounts.ts`)

**Ein** Zähler, an `/nachfassen`. Er trägt `{ total, overdue }`; überfällige Einträge färben das
Badge amber.

**Aus drei wurden zwei wurden einer** — und die Reihenfolge, in der sie fielen, ist die
Geschichte des Rückbaus im Kleinen:

| Badge | wann | warum |
|---|---|---|
| `/erinnerungen` | Welle 1 | Ein Zähler auf `reminder_touches` zählte danach eine Tabelle, die keine Oberfläche mehr füllt: erst dauerhaft dieselbe Zahl, dann dauerhaft 0 — beides ist eine Aussage über nichts |
| `/ablage` | Nachbesserung | Er zählte `dropout_lists('ersatztermin_offen')` — die eine Ablage-Liste mit offener Handlung. Genau die hat der Rückbau aus der Ablage entfernt (§1): Ein Lead, der abgesagt hat und noch keinen Ersatz trägt, ist kein Archiv-Eintrag, sondern der Normalfall der Arbeitsliste. Das Badge zeigte damit eine Zahl aus einer Menge, die es in der Oberfläche nicht mehr gab, und führte auf eine **disjunkte** Ansicht |
| `/nachfassen` | — | bleibt |

**Umgehängt wurde der Ablage-Zähler nicht, sondern gestrichen.** Beide verbliebenen
Ablage-Ansichten sind Aktenschränke, die über Monate wachsen und nie auf null gehen — „ein
Badge auf einem Archiv, das nie auf null geht, ist eine Mahnung ohne Adressat".

**Und `/termine` hat bewusst KEINEN bekommen**, obwohl dort seit dem Rückbau die meiste Arbeit
liegt. Sein Gold ist aus Zustand, Absage, Nachfass-Stempel und Berliner Tagesgrenze
**abgeleitet** (§1). Die Navigation müsste dafür entweder dieselben Zeilen laden, die die Seite
lädt — auf **jeder** Seite —, und oberhalb des 500er-Fensters trotzdem schweigen, oder die
Regel ein zweites Mal als PostgREST-Filter formulieren. Genau dagegen gibt es
`src/lib/dranRegel.ts`. Dazu kommt das Argument, das den Ausschlag gibt: `/termine` ist die
Fläche, die man ohnehin öffnet; ein Badge spricht für eine Seite, die man sonst nicht aufmacht.

**Die Zahl steht an drei Orten**, alle aus derselben Quelle: an der
Zeile in der Seitenleiste, als Summe am zugeklappten Blockkopf (s. u.) und auf den
**Quicklink-Kacheln des Dashboards** (`src/components/dashboard/QuickLinks.tsx` — drei Kacheln
für den Block „Meine Arbeit": Termine · Nachfassen · Ablage, davon trägt **eine** ein Badge;
„Termine" steht seit dem Rückbau an erster Stelle, weil die Terminliste die zentrale
Arbeitsfläche ist). Der Anlass war, dass
die Seitenleiste seither vollständig zugeklappt startet — ohne die Kacheln wäre der Überblick
über offene Arbeit hinter zwei Klicks verschwunden. Geladen wird trotzdem **einmal**:
`getNavCounts()` (`src/lib/navCountsData.ts`) ist eine argumentlose, per React `cache()`
memoisierte Hülle, die sich Layout und Dashboard teilen. Argumentlos deshalb, weil `cache()`
über Argument-*Identität* schlüsselt — ein je Aufrufer frisch gebauter Supabase-Client ergäbe
zwei Einträge und keinen Gewinn. Eigene Datei deshalb, weil `navCounts.ts` von der Seitenleiste
(einer Client Component) importiert wird und ein Wert-Import von `@/lib/access` dort
`next/headers` ins Client-Bundle zöge; dieselbe Trennung wie `analyse.ts` ↔ `analyseData.ts`.
Nebeneffekt, der genauso zählt: `dueRefNow()` ist eine echte Uhr — zwei getrennte Läufe könnten
auf zwei gleichzeitig sichtbaren Flächen zwei verschiedene Zahlen zeigen.

**Seit der Neugliederung der Seitenleiste** (fünf benannte Blöcke; `/termine`, `/nachfassen`
und `/ablage` stehen zusammen im Block „Meine Arbeit") gibt es die Zahl an **zwei** Stellen:
an der einzelnen Zeile wie bisher, und als Summe am **zugeklappten Blockkopf**. Die Summe
bildet `sumNavCounts()` (`src/components/Sidebar.tsx`) — dieselbe Funktion, die auf Mobil
den Punkt am Menü-Knopf des `MobileHeader` speist. Ihre `null`-Regel ist bewusst eine
Stufe weicher als die des Einzelzählers: `null` bleibt `null`, solange **kein** Zweig eine
Zahl hat; liefert nur ein Teil, wird die **Teilsumme** gezeigt. Das ist kein Bruch mit der
Doktrin unten, sondern ihre Anwendung auf eine andere Frage — an der Zeile hieße eine
Teilzahl „so viel liegt dort an" und wäre falsch, am Blockkopf heißt sie „hier liegt
etwas an", und welcher Zweig schweigt, steht aufgeklappt eine Zeile darunter. Die
Bündel-Form `NavCounts` bleibt aus demselben Grund, obwohl nur ein Zweig darin steht:
Seitenleiste, Quicklink-Streifen und mobiler Menü-Punkt nehmen sie entgegen, und der nächste
Zähler soll sich einhängen können, ohne drei Signaturen zu drehen.

Drei Eigenschaften, die man kennen muss, bevor man die Badge-Zahl gegen die Seite hält:

- **`null` heißt „nicht ermittelbar", nicht „null Aufgaben".** Schlägt die Abfrage fehl
  (fehlende Migration, RLS) oder fehlt die exakte Zahl, verschwindet das Badge — es behauptet
  keine beruhigende 0. Ein `(count ?? 0)` hätte die fehlende Auskunft stillschweigend als
  „nichts fällig" verbucht: genau die halbe Wahrheit, gegen die schon der Fehlerfall steht.
- **Der Zähler ist strikt persönlich** (`effective_user_id ?? user.id`), auch für einen Owner
  mit Team-Sicht — dieselbe Regel, nach der die Terminliste ihre Vorgabe-Menge schneidet (§1).
  Die frühere Ausnahme („`/ablage` zählt org-weit") ist mit dem Ablage-Badge entfallen.
- **✔ Badge und Seite sind deckungsgleich.** Beide lesen **dieselbe** RPC (`recycle_tasks`),
  mit denselben Parametern, und **keines von beiden legt noch einen Schnitt darüber** (§5.5).
  Die Deckungsgleichheit war eine Zeit lang eine Zusicherung („beide schneiden gleich"); seit
  dem Fall des Altlasten-Schnitts ist sie trivial — es gibt schlicht nur eine Menge.

> **Das war eine bewusste Abkehr von der alten Regel — und die Begründung gehört dazu.**
> Bis hierher galt: „Das Badge zählt mehr, die Seite erklärt die Differenz in derselben Zeile."
> Diese Regel war vertretbar, solange die Differenz genau **eine** benannte Menge war
> (ausgeblendete LinkedIn-Altlasten). Nach Welle 2 war sie es nicht mehr: Der Zähler las
> weiterhin **beide** RPCs, während die Seite drei ihrer Zweige an die Terminliste abgegeben
> hatte — das Badge zeigte 14, die Seite darunter zwei Karten. Eine Zahl, die sich nur noch
> mit einem Absatz erklären lässt, ist keine Zahl mehr, sondern genau die Mahnung ohne
> Adressat, über die sich der Auftraggeber beschwert hat.
>
> **Daraus folgt die Pflicht für den nächsten Umbau, und sie gilt in BEIDE Richtungen:** Die
> Quellenliste des Zählers ist an die der Seite gebunden. Ein Badge, das weniger zählt als die
> Seite darunter, ist genauso falsch wie eines, das mehr zählt — nur fällt es später auf.
> `src/lib/navCounts.ts` schreibt diese Pflicht ausdrücklich in den Code.
>
> **Der 500er-Deckel trifft nur noch den Überfällig-Anteil.** `count: 'exact'` zählt vor dem
> Zeilenfenster (`ROW_CAP`) und ist damit die Gesamtzahl; über die Aufteilung fällig/überfällig
> entscheiden höchstens 500 geholte Zeilen. Das ist ungefährlich, weil aufsteigend nach
> Fälligkeit sortiert wird — die überfälligen stehen vorn, der Deckel greift erst, wenn jemand
> mehr als 500 überfällige Aufgaben mit sich herumträgt, und dann ist die genaue Zahl ohnehin
> nicht mehr die Nachricht.
>
> **HISTORISCH:** Hier stand ein eigener `null`-Fall für `count > rows.length` — „lieber kein
> Badge als eine zu kleine Zahl". Er hing am Altlasten-Schnitt: Geschnitten wurde erst nach dem
> Fenster, oberhalb des Deckels war die gefilterte Zahl also gar nicht mehr zu ermitteln. Ohne
> Schnitt ist `count` wieder die Wahrheit und wird genannt. **Die Doktrin dahinter gilt
> unverändert** und hat weiterhin einen Fall: Fehlt `count` ganz, gibt es kein Badge statt
> einer 0.

**Was Badge und Seite garantiert teilen, ist die Überfällig-Regel** — sie steht einmal in
`src/lib/dueState.ts` und wird von beiden gelesen (§6). Genau dafür wurde die Datei angelegt:
Eine Navigation, die eine Dringlichkeit behauptet, die die Seite daneben nicht kennt, ist
schlimmer als gar kein Badge. Gerechnet wird ausnahmslos auf **Tages**-Körnung:
`next_recycle_at` ist eine `date`-Spalte, nach ihrem Datentyp gelesen wäre ab 02:00 Berliner
Zeit alles überfällig — und weil die RPC ohnehin nur Fälliges liefert, wäre schlicht **alles**
überfällig (§6).

Betriebsverhalten: kein Caching über die Anfrage hinaus (der Zähler läuft im bestehenden
`Promise.all` des Layouts mit), aber eine harte **Frist von 1,5 s** — was länger braucht,
liefert `null` und damit kein Badge, statt das Layout aufzuhalten. Der Überfällig-Anteil wird
über höchstens 500 Zeilen ermittelt (nach Fälligkeit aufsteigend sortiert, überfällige stehen
also vorn). Eine „99+"-Kappung gibt es nicht.

### 5.5 Der Altlasten-Schnitt — **gefallen** (und warum der Abschnitt trotzdem bleibt)

**Es gibt keinen Altersschnitt mehr.** Was eine Aufgabenquelle liefert, steht auf dem
Bildschirm — auf `/termine` (Liste und Rückrufe), auf `/nachfassen` und im Badge daneben.
`src/lib/staleTasks.ts` ist gelöscht.

Dieser Abschnitt bleibt stehen, weil er zweimal gebraucht wird: von jedem, der eine ältere
Fassung dieses Dokuments oder einen älteren Commit liest und die Grenzen dort findet — und
von jedem, der die Idee noch einmal hat. Sie ist naheliegend, sie war einmal umgesetzt, und
sie ist entschieden.

**Was es war.** Zwischen Aufgabenquelle und Bildschirm lag ein zweiter Filter: Aufgaben,
deren letztes maßgebliches Datum lange zurücklag, wurden versteckt, gezählt, benannt und
waren über einen URL-Parameter zurückzuholen. Vier Grenzen, je Quelle eine — Telefon-Rückruf
14 Tage ab `callback_at`, Erstgespräch und Closing 30 Tage ab dem jüngsten Lebenszeichen
(`appointment_at` oder `follow_up_last_contacted_at`, je nachdem welches jünger war),
Recycling 90 Tage ab `next_recycle_at`.

**Warum es das gab.** Das Argument war gut und ist es immer noch: `/nachfassen` beantwortete
„was ist heute fällig?" und lieferte dafür alles aus, was jemals fällig geworden und nie
abgehakt worden ist — am ersten produktiven Tag 425 Aufgaben. Dieselbe Falle stellte die
Termin-Arbeitsliste unverdünnt: „Zu tun" schneidet nur nach ZUSTAND, bei 173 Erstgesprächen
und 50 Closings landet dort jede jemals angelegte Zeile ohne Ergebnis, alle gleichzeitig
gold. **Zweihundert goldene Zeilen sind dasselbe wie keine.**

**Warum er trotzdem gefallen ist.** Der Auftraggeber hat entschieden, und zwar wörtlich:

> „Eine Liste pro Person. Wer offen ist, wird **jeden Tag** kontaktiert. **Ohne Ausnahme, ohne
> Intervall-Logik.** Er verschwindet von der Liste, wenn er entweder neu terminiert ist oder
> als tot markiert wird. Nichts anderes nimmt ihn da runter."

Die Gegenrede lautete: Der Schnitt sei kein Intervall, er verzögere niemanden und lasse
niemanden aussetzen; er nehme nur heraus, woran seit einem Monat niemand mehr war, und er
löse sich selbst auf, weil jeder „Genervt"-Klick das Lebenszeichen erneuert. Das stimmt alles
— und trifft die Ansage trotzdem nicht: Der Satz zählt die Bedingungen abschließend auf, und
eine dritte Bedingung ist genau das, was „nichts anderes" ausschließt. Dazu kommt ein
praktisches Argument: Wer die Grenze streift, hat den Lead ja gerade **nicht** bearbeitet —
das ist nicht die Ausnahme, für die man eine Liste kürzt, sondern der Fall, für den es sie
gibt. Die Zahl wurde zwar genannt und war einen Klick entfernt, aber sie kostete den Nutzer
einen Handgriff, um seine eigene, unerledigte Arbeit wiederzusehen.

**Was NICHT gefallen ist** — die drei Schnitte, die weiter gelten und die man nicht mit dem
Altersschnitt verwechseln darf:

| Schnitt | Wo | Was er entscheidet |
|---|---|---|
| **Person / Organisation** | überall | „Eine Liste pro Person" — `personOf()` bei Terminen, der Listen-Owner bei Telefon/LinkedIn (§2) |
| **Ausschnitt „Zu tun · Verlegt · Alle"** | `/termine` | der abgeleitete ZUSTAND (`istInArbeitsmenge`, `src/lib/dranRegel.ts`) — also genau „neu terminiert oder tot", die beiden Bedingungen aus dem Satz oben |
| **Status-Riegel je Recycling-Zweig** | `recycle_tasks` | ob ein toter Lead überhaupt wieder ein Kandidat ist (§5) — er sitzt in der RPC, nicht in der Anzeige |

**Für Auswertungen heißt das:** Die Differenz zwischen „was die Datenbank liefert" und „was
auf dem Bildschirm steht" ist seither **auf beiden Flächen null bzw. auf genau einen
benannten Schnitt zurückgeführt**:

- `/nachfassen` = `recycle_tasks`, vollständig, nur nach Fälligkeit sortiert.
- Rückruf-Reiter = alle `phone_leads` mit `status='rueckruf'` und gesetztem `callback_at`.
- Arbeitsliste = die abgeleitete Arbeitsmenge (§1) — der einzige verbliebene Schnitt, und er
  steht als nachbaubare SQL-Fassung dort.

Der Navigations-Zähler (§5.4) zählt entsprechend ebenfalls ungeschnitten. Er war der Grund,
warum der Schnitt an **einer** Stelle stehen musste: Ein Badge, das weniger zählt als die Liste
darunter, ist derselbe Fehler wie eines, das mehr zählt. Diese Pflicht gilt unverändert — sie
hat nur nichts mehr zu koordinieren.

## 6. Zeit & Zeitzonen (Fallstricke für Auswertungen)

- **`date`-Spalten** (reine Kalendertage, kein TZ-Thema): `pitched_at`, `next_follow_up_at`, `first_call_at`, `setting_calls.call_at`, `follow_up_due`, `contract_start`, `closing_calls.onboarding_at` (Migration 0032 — der Onboarding-Tag hat keine Uhrzeit), `next_recycle_at` (contacts/phone_leads/setting_calls/closing_calls, Migration 0033 — Recycling ist Wochen/Monate-Kadenz, keine Uhrzeit-Präzision).
- **`timestamptz`-Spalten** (UTC in DB): `appointment_at` (contacts/phone_leads/setting_calls), `callback_at`, `closing_at`, `closing_calls.call_at`, `phone_call_attempts.called_at`, `wa_consent_at`/`wa_refused_at` (setting_calls, Migration 0032), `follow_up_due_at` (closing_calls, Migration 0032), der Termin-Lebenszyklus aus 0032 (`cancelled_at`, `last_reschedule_at`, `revived_at` auf beiden Termin-Tabellen), die drei Recycling-Zeitstempel aus 0033 (`recycle_excluded_at`, `recycle_last_contacted_at`, `recycle_responded_at` auf allen vier Ursprungstabellen), **`follow_up_last_contacted_at`** (Migration 0041, beide Termin-Tabellen — `timestamptz` und nicht `date`, weil die Arbeitsliste „habe ich den **heute schon** genervt?" beantwortet, also eine Frage *innerhalb* eines Tages; gebucketet wird trotzdem über den Berliner Kalendertag, das ist Sache der Anzeige), `reminder_touches.due_at`/`appointment_at`/`done_at`/`superseded_at`/`snoozed_until` (Migration 0032 — anders als die übrigen `_at`-Termin-Spalten hier UHRZEIT-präzise, weil die Kaskade genau darauf rechnete), alle `created_at`/`updated_at`.
- **Alle Termin-Spalten enthalten echtes UTC** — seit Migration `20260404000021_appointment_timezone_fix.sql`. Vorher schrieben die Terminpfade den rohen `datetime-local`-String (Berlin-Wandzeit) direkt in die `timestamptz`-Spalte, wodurch Termine um den UTC-Offset zu spät erschienen; `closing_calls.call_at` war die einzige Ausnahme mit korrektem UTC. Die Migration hat `setting_calls.appointment_at`/`closing_at`, `contacts.appointment_at`, `phone_leads.appointment_at`/`callback_at` DST-genau korrigiert (Sicherung liegt in `public._appt_tz_backup_20260727`).
- **Einzige Konvertierungsstelle im Code: `src/lib/apptTime.ts`** (`berlinInputToIso` / `isoToBerlinInput` / `berlinDateISO` / `toBerlinSlot` / `slotToIso` / `formatTermin`). Der Offset kommt aus `Intl` mit fester Zone `Europe/Berlin` und hängt damit **nicht** von der Server-Zeitzone ab (Vercel = UTC, lokal = Berlin) — genau daran war die alte Speicherung zerbrochen. Neue Schreibpfade müssen `berlinInputToIso()` verwenden, nie `new Date(input).toISOString()`.
- Die Analyse-Tabs **und** die Vergleichsseite bucketen über den **Berlin-Kalendertag** (`berlinDateISO`, `src/lib/analyse.ts`); die frühere UTC-Slice-Inkonsistenz an der Tagesgrenze ist damit weg. `rpc_appointments_booked` macht dasselbe in SQL (`(created_at at time zone 'Europe/Berlin')::date`) — sonst rutschte ein abends gebuchter Termin in den Vortag. Auch die Kachel „Termine gelegt" im LinkedIn-Tab rechnet über `berlinDateISO(created_at)`.
- **Zeitraumfilter auf `timestamptz` brauchen einen Tagespuffer.** PostgREST kann nicht in Berlin-Zeit schneiden, deshalb das Muster aus `loadCallAttempts` (`src/lib/phoneAttemptsData.ts`): in SQL grob mit einem Tag Luft nach beiden Seiten filtern (`gte from-1`, `lt to+2`), danach in JS exakt über `berlinDateISO` nachfiltern. Ohne den Puffer fehlten Randanrufe, ohne den Nachfilter lägen sie im falschen Tag — und der Rest des Tabs bucketet bereits nach Berlin.
- **`nachfassen_tasks.due_at` ist ein `timestamptz`, trägt aber überwiegend TAGE.** Die RPC presst fünf Quellen in eine Spalte, und vier davon sind in Wahrheit `date`-Werte, die sie nur castet. Ein `date` wird dabei zu Mitternacht UTC — in Berlin also **02:00 desselben Tages**. Wer die Spalte nach ihrem Datentyp liest, hält jedes Follow-up ab zwei Uhr morgens für überfällig; und weil die RPC ohnehin nur Fälliges liefert, wäre schlicht **alles** überfällig. Eine Dringlichkeit, die immer gilt, ist keine. Maßgeblich ist deshalb die **Körnung der Quelle**, nicht die Schreibweise des Werts: Nur der Telefon-Rückruf (`callback_at`) trägt eine verabredete Uhrzeit (`moment`), LinkedIn-Follow-up, Setting-/Closing-Wiedervorlage und Recycling haben den ganzen Tag Zeit (`day`) und werden erst am **Folgetag** überfällig. Die Regel steht an genau einer Stelle — `isOverdue(value, granularity, ref)` in `src/lib/dueState.ts` —, gelesen von der Seite *und* vom Navigations-Zähler (§5.4). Für SQL heißt das: `due_at` nie roh gegen `now()` halten, sondern gegen `(now() at time zone 'Europe/Berlin')::date`, außer beim Telefon-Zweig. **Seit dem Rückbau liest die RPC niemand mehr** (§5), und die beiden Körnungen liegen jetzt auf zwei getrennten Flächen: der Tages-Fall auf `/nachfassen` (`next_recycle_at`, ebenfalls eine `date`-Spalte — dieselbe Falle) und in der Arbeitsliste, der Minuten-Fall im Rückruf-Reiter (`callback_at`). Die Regel selbst ist unverändert.
- **Es gibt nur noch ZWEI Fälligkeits-Varianten — die dritte ist mit der Kaskade gefallen.** `src/lib/dueState.ts` kannte einen dritten Fall: den Sofort-Touch (`touch_kind='sofort'`), dessen `due_at` der Zeitpunkt seiner **Entstehung** war. Er entstand ja gerade deshalb, weil der Termin so kurzfristig gebucht wurde, dass keine geplante Stufe mehr davor lag; jede wertbasierte Regel hielt ihn eine Minute später für überfällig, obwohl niemand etwas versäumt hatte — maßgeblich war deshalb der **Termin** (Typ `DueSpec`, `reminderDueSpec(touch)`). Beides ist entfernt. **Seither gibt es keine Fälligkeit mehr, die sich nicht aus ihrem eigenen Wert beantworten ließe**, und `isOverdue(value, granularity, ref)` nimmt wieder ein blankes Körnungs-Wort. Wer den Bestand in `reminder_touches` per SQL auswertet, muss die alte Regel trotzdem kennen: `due_at` bei `touch_kind='sofort'` nie roh gegen `now()` halten, sondern `appointment_at` prüfen.
- **Die Arbeitsliste rechnet auf Berliner Kalendertagen, nicht auf Minuten.** Beide Fragen, aus denen sie besteht, sind Tagesfragen: „Steht ein Termin?" (`terminZustand`, Vergleich `Berlin-Tag(appointment_at) >= heute`) und „Habe ich den heute schon genervt?" (`istHeuteKontaktiert`, `berlinDateISO(stempel) === heute`). Ein Termin, der heute um 10:00 war, soll nicht ab 10:01 golden mahnen — dafür gibt es den No-Show-Eintrag. **Die einzige Ausnahme ist der Rückruf-Reiter:** Er entscheidet auf die Minute (`callback_at`, Körnung `moment`), weil dort eine mit dem Lead verabredete Uhrzeit steht.
- **Und dieses „heute" kommt vom SERVER, nicht aus dem Browser.** Die Terminliste ist eine Client Component, holt sich ihren Tag aber nicht selbst: `today` wird als Prop durchgereicht und ist der Berliner Kalendertag, den die Server-Seite über `berlinDateISO()` gebildet hat. Ein `localDateISO()` im Browser wäre gleich zwei Fehler in einem — der Server läuft auf Vercel in UTC und lieferte abends einen anderen Tag als der Client (Hydrations-Unterschied), und wer selbst nicht in Berlin sitzt, bekäme eine dritte Antwort. Beides schlüge unmittelbar auf die Gold-Regel durch, weil die den Nachfass-Stempel über Berlin bucketet. **Die Vorschrift dahinter gilt für jede datumsabhängige Anzeige-Regel:** Der Referenztag kommt immer vom Aufrufer, nie aus `new Date()` — ein Board voller Karten würde sonst mitten im Durchlauf den Tag wechseln, und zwei Zeilen mit demselben Datum fielen verschieden aus. (Sie stand einmal zusätzlich für den Altlasten-Schnitt da, §5.5; den gibt es nicht mehr, die Regel schon.)
- **Kontaktfrequenz: der Auslöser ist weg, die Sprechweise geblieben.** `CONTACT_GAP_WARN_DAYS = 3` entschied als reine Millisekunden-Differenz (`now − last < 3 · 86 400 000`), ob die Warnung erschien; die Warnung selbst ist mit der Kaskade gefallen (§1). `dayDiff()` / `lastContactLabel()` (`src/lib/contactGap.ts`) rechnen für den **Text** unverändert in **Berliner Kalendertagen** — „gestern 23:00" ist gestern, auch wenn es zwei Stunden her ist — und beschriften jetzt die Unterzeile der Arbeitsliste und „Zuletzt kontaktiert" im Dossier. Die beiden Zahlen waren absichtlich verschieden gemeint (Schwelle vs. Sprechweise); übrig ist die zweite.
- **Historisch: Kaskaden-Offsets rechneten in Berliner WANDZEIT, nicht in Millisekunden** (`shiftBerlinMinutes()`, `src/lib/cascadeEngine.ts` — Datei gelöscht). „1 Tag vorher" heißt für einen Menschen dieselbe Uhrzeit einen Tag früher; auf dem UTC-Zeitstempel gerechnet läge die Fälligkeit am Umstellungswochenende eine Stunde daneben. Der Weg war immer: ISO → Berliner Wandzeit → Kalenderarithmetik auf den Ziffern → `berlinInputToIso()` zurück nach UTC. Dieselbe Zone benutzt **`schedule_recycle()` unverändert** in SQL für „heute" (`(now() at time zone 'Europe/Berlin')::date`) — das ist der einzige Teil dieser Regel, der noch läuft. Die Buchungstag-Regel rechnete aus demselben Grund in Kalendertagen (`berlinLeadDays()`): Am Umstellungswochenende ist ein Tag 23 bzw. 25 Stunden lang — „24 Stunden entfernt" und „am nächsten Kalendertag" sind dort zwei verschiedene Aussagen, und nur die zweite meint der Mensch, der den Termin gebucht hat. Dieselbe Überlegung trägt heute den Tagesvergleich der Arbeitsliste.
- **Empfehlung für SQL:** `(spalte at time zone 'Europe/Berlin')::date` für die Tageszuordnung von `timestamptz`-Spalten. ISO-Wochen (Montag-basiert) mit `date_trunc('week', …)`.

**`Europe/Berlin` ist eine Produktgrenze, keine Einstellung.** Es gibt bewusst **keine
Zeitzone je Organisation und keine je Nutzer** — die Zone steht als Konstante an genau einer
Stelle (`src/lib/apptTime.ts`), in `rpc_appointments_booked`, in `schedule_recycle()` und in
jeder SQL-Empfehlung dieses Dokuments. Das ist eine Entscheidung, keine Auslassung: Sobald
zwei Organisationen in verschiedenen Zonen lägen, wären „Tag", „Woche" und damit *jede* Zahl
in §5 mandantenabhängig — Wochenduell, Consistency, Fortschritts-Kurven und der Tagesvergleich
der Arbeitsliste müssten alle dieselbe zusätzliche Achse tragen, und ein Vergleich über
Organisationen hinweg (Plattform-Admin-Sicht) verlöre seine gemeinsame Grundlage. Solange
alle Kunden im DACH-Raum arbeiten, kostet die feste Zone nichts und spart genau diese Achse.
**Die Software ist damit auf den DACH-Raum begrenzt.** Ein Kunde in einer anderen Zone ist
kein Konfigurations-, sondern ein Umbaufall: Er berührt jede Bucket-Funktion, beide
Termin-Definitionen aus §5, die Gold-Regel der Arbeitsliste und die Tagesgrenzen sämtlicher
RPCs.

## 7. Schema-Drift-Warnung

**Migrationen laufen in der Supabase-Konsole nicht zuverlässig vollständig.** Wird im Editor Text markiert, führt „Run" nur die Markierung aus — der Rest der Datei bleibt liegen, ohne Fehlermeldung. Zweimal nachgewiesen: Migration `…0027` hatte auf der Produktions-DB nur `preview_delete_workspace` angelegt, nicht `platform_delete_workspace` (nachgezogen am 9. September 2026; bis dahin scheiterte „Organisation löschen" im Admin-Bereich — was niemandem auffiel, weil man es erst im Ernstfall merkt). Dasselbe am 8. September bei `…0031`, wo `template_catalog` entstand, `message_templates` aber nicht. **Nach jedem Einspielen deshalb den Verifikationsblock am Dateiende fahren** — er steht genau dafür dort.

Der Migrationsordner ist fast, aber nicht 100 % vollständig:
- Migrationen `…000002` und `…000004` fehlen im Repo (Nummerierungslücke).
- Migration 0014 erwähnt explizit einen Alt-CHECK auf `answer_category` „aus der nicht im Repo vorhandenen Alt-Migration".

**Stand des Abgleichs (Juli 2026, vor dem Mandanten-Umbau):** Das Live-Schema wurde vollständig gegen den Migrationsordner geprüft (alle 18 Tabellen). Genau **zwei** Spalten existierten live ohne Migration:
- `lists.owner_name` — wird überall benutzt (RPCs, RLS-Backfill, UI). Nachgezogen in Migration `…0024_schema_reconcile.sql`.
- `profiles.is_super_admin` — verwaist, von keiner Zeile Code gelesen. Bewusst **nicht** in den Migrationsordner übernommen (eine frische DB soll sie nicht bekommen); Migration 0025 friert sie per Trigger ein. Siehe §2.

**Seit dem Nachfassen-Umbau kommen fünf Tabellen dazu** — `template_catalog`, `message_templates` (0031), `pipeline_settings`, `cascade_steps`, `reminder_touches` (0032). Sie stammen unmittelbar aus den Migrationen; geprüft wurden sie nach dem Einspielen über die Verifikationsblöcke am Ende jeder Datei (Katalog 31 Zeilen, je Organisation 21 Kaskadenstufen). Ein vollständiger Abgleich des Live-Schemas gegen den Migrationsordner steht seither aus. **0035–0040 legen keine Tabelle und keine Spalte an** — sie fassen ausschließlich Funktionen, Trigger und Ausführungsrechte an. **0041 legt keine Tabelle, aber vier Spalten an**: `follow_up_last_contacted_at` und `follow_up_last_contacted_by_user_id`, je zweimal (`setting_calls`, `closing_calls`). Der **Tabellen**stand ist damit weiterhin mit 0033 abgeschlossen, der **Spalten**stand nicht.

Konsequenz: Bei Unsicherheit über existierende Spalten das Live-Schema per MCP prüfen (`list_tables`), statt allein den Migrationen zu vertrauen.

**Nullable-Fallen bei Boolean-Filtern:** `contacts.answered` und `contacts.appointment_set` sind `boolean | null`, und **NULL ist der Normalfall** (frisch gepitcht = noch nichts passiert). Ein `= false` verliert damit die Mehrheit der Zeilen. Die gesamte App liest „nicht true" als Nein — so auch `isDueFollowUp` (`ListBoardV2`), der `nachfassen_tasks`-RPC und `viewFilterOps` (`src/lib/listViews.ts`). In SQL entsprechend `is not true` statt `= false`.

**Manuell auszuführende Migrationen:** `…0019`, `…0020`, `…0021`, `…0022` (pg_trgm-Suchindizes), `…0023` (`list_views`), `…0024` (Schema-Abgleich), `…0025` (`platform_admins`), `…0026` (Nutzer-Umzug), `…0027` (Organisation löschen), `…0028` (`fundament`: Zuweisung, Anruf-Log, RPC-Korrekturen), `…0029` (`analyse_umbau`: Quellen, Termin-Rufnummer, Verlustgrund-Codes, Telefon-Skripte), `…0030` (`script_label_snapshot`), `…0031` (`message_templates`), `…0032` (`reminder_cascade`), `…0033` (`lead_recycling`), `…0034` (`tenant_lifecycle`), `…0036` (`tenant_lifecycle_nachtrag`), `…0037` (`rpc_zugriffspruefung`), `…0038` (`umzug_anruflog`), `…0039` (`apply_touches_pruefung`) `…0040` (`schreibpfad_mandantengrenzen`) und `…0041` (`rueckbau_pflichtfelder_und_nachfass_stempel`) laufen nicht automatisch — sie müssen im Supabase-SQL-Editor ausgeführt werden. **Alles bis einschließlich 0040 ist eingespielt und damit eingefroren; 0041 ist es NICHT.** Der Ablauf im Einzelnen: 0031 bis 0034 am **8. September 2026** (Verifikation bestanden: Katalog 31 Einträge, je Organisation eine `pipeline_settings`-Zeile und 21 `cascade_steps`, davon 16 aktiv), 0036 und 0037 kurz darauf, **0035, 0038, 0039 und 0040 am 10. September 2026 zusammen mit dem Deploy** des Nachfassen-Umbaus auf `main`. **Die nächste Schema-Änderung nach 0041 braucht die Nummer 0042** — an keiner der Dateien 0031–0040 darf noch etwas geändert werden, auch nicht an einer, die „nur" eine Funktion neu schreibt: Wer sie ein zweites Mal einspielt, spielt dann etwas anderes ein, als beim ersten Mal lief. 0041 darf noch geändert werden, solange sie nirgends gelaufen ist — danach gilt für sie dasselbe.

Dass 0036 und 0037 vor 0035 eingespielt wurden, obwohl 0035 dazwischen liegt, war **kein Versehen**: Die drei sind voneinander unabhängig (keine berührt eine Tabelle), und 0035 war die einzige, die auf den Deploy warten musste — sie hätte die damals produktive App zerbrochen (s. u.). Die Nummer ist eine Reihenfolge im Ordner, keine Zwangsfolge beim Ausführen. Für 0041 gilt dasselbe, nur mit umgekehrtem Vorzeichen: Sie muss **vor** dem Code laufen, der zu ihr gehört.

Beim Einspielen zu beachten — **das gilt für 0041 genauso wie für alles davor**: Die Supabase-Konsole fährt ein ganzes Skript in einer Transaktion, ein Abbruch rollt die Datei also zurück. **Wird sie aber in Teilen ausgeführt (markierter Text im Editor), entsteht ein Halbzustand — ohne Fehlermeldung;** genau das ist bei 0031 einmal passiert. Deshalb: nichts markieren, „Run" auf die ganze Datei, danach den Verifikationsblock am Dateiende fahren.

### 0041 — offen, und die einzige Migration mit einem laufenden Deploy-Risiko

`…0041` (`rueckbau_pflichtfelder_und_nachfass_stempel`) begleitet den Rückbau und tut genau
zwei Dinge. Sie ist **beliebig oft ausführbar** (drei `drop trigger if exists`, zwei Kommentare
hinter einer Existenzprüfung, `add column if not exists`, `comment on column`) — kein
`drop function`, kein Backfill, keine Datenbewegung, keine Zeile wird umgedeutet.

**Teil 1 — die drei Pflichtfeld-Trigger aus 0035 fallen** (`setting_calls_require_cancel_reason`,
`closing_calls_require_cancel_reason`, `setting_calls_require_disqualify_reason`). Grundlage
für sie war „Code = Statistik, Freitext = Gedächtnis" (§4) — und die entfällt, wo der
Grundkatalog aus der Oberfläche verschwindet: Der Knopf „Tot" der Arbeitsliste beendet einen
Vorgang ohne jeden Grundcode. Ein Pflichtfeld, das kein Formular mehr anbietet, ist kein
Qualitätsanspruch, sondern eine Sperre gegen die eigene App. **Die beiden Triggerfunktionen
bleiben stehen** und bekommen einen `STILLGELEGT mit 0041`-Vermerk (§4) — der ist gleichzeitig
der Nachweis, dass die Datei ganz durchgelaufen ist und nicht nur bis zu den drei `drop`s.
**Was damit ausdrücklich aufhört:** Neue Absagen und Disqualifizierungen dürfen wieder ohne
Grund entstehen, und die drei Nachpflege-Zählungen in §8 dürfen wieder wachsen. Bestandszeilen
MIT Grund behalten ihn — kein `update`, kein Nullen.

**Teil 2 — der Nachfass-Stempel** (§3): `follow_up_last_contacted_at` + `_by_user_id` je
Termin-Tabelle. Vorbild ist `recycle_last_contacted_at` (0033): `timestamptz`, nullable, ohne
Default, ohne Backfill — ein Default `now()` behauptete für jeden Bestandstermin, er sei heute
nachgefasst worden, und die ganze Liste wäre am ersten Tag abgehakt. `on delete set null` auf
der Person, **kein Index** (der Stempel wird geschrieben und angezeigt, aber nicht gefiltert;
ein Index, den keine Abfrage benutzt, kostet bei jedem Schreiben — und ausgerechnet geschrieben
wird diese Spalte oft), **kein Paar-CHECK** (Begründung in §3).

> **⚠ WANN EINSPIELEN — die Regel ist einseitig: zu früh kostet nichts, zu spät zerbricht
> etwas.**
>
> **Teil 1 darf beliebig früh laufen.** Die produktive App schickt die Grundcodes ohnehin mit
> (`cancelAppointment` schreibt `cancelled_at` und `cancel_reason_code` in einem Statement,
> `setSettingOutcome` Status und Disqualifikationsgrund ebenso); ein entfernter Trigger nimmt
> ihr nichts weg, er hört nur auf, etwas zu verlangen, das sie freiwillig liefert. **Zu spät**
> zerbricht dagegen jeder Pfad, der aufhört, einen Grund mitzuschicken — nicht schleichend,
> sondern beim nächsten Klick, für alle.
>
> **Teil 2 muss vor dem Deploy gelaufen sein.** Solange die vier Spalten fehlen, gilt (Stand
> heute, siehe Kopf des Dokuments):
> * **Der Knopf „Genervt" schreibt nicht.** `markFollowUpContacted` erkennt den PGRST204 an der
>   Fehlermeldung und antwortet mit einem eigenen Satz („Der Nachfass-Stempel fehlt in der
>   Datenbank — Migration 0041 ist noch nicht eingespielt.") statt mit einer rohen
>   Postgres-Meldung. Jede Zeile der Liste leuchtet dauerhaft, weil „noch nie kontaktiert" die
>   einzig mögliche Antwort ist.
> * **Die Arbeitsliste selbst funktioniert trotzdem.** Sie lädt mit `select("*")` und bekommt
>   dann schlicht zwei Felder weniger; `undefined` heißt „noch nie nachgefasst". **Deshalb darf
>   die Termine-Seite NIE auf eine namentliche Spaltenliste umgestellt werden**, solange 0041
>   nicht überall läuft — eine fehlende benannte Spalte lässt PostgREST die *gesamte* Abfrage
>   abweisen (Muster 0029/0032), und die Seite wäre leer statt unvollständig.
> * **Das Lead-Dossier ist ganz aus.** Es selektiert die beiden Spalten **namentlich** und
>   meldet „Dossier nicht verfügbar" (§5.3). Das ist der teuerste der drei Effekte und der
>   Grund, 0041 nicht liegen zu lassen.
>
> **Die Verifikation hat eine eigene Falle**, die im Dateikopf ausgeschrieben steht: Weil diese
> Migration etwas WEGNIMMT, lautet die naheliegende Probe „das verbotene Statement läuft jetzt
> durch" — und ein UPDATE, dessen WHERE keine Zeile trifft, läuft ebenfalls durch. Ein Erfolg
> aus Untätigkeit ist von einem echten nicht zu unterscheiden. Deshalb endet dort jede
> dynamische Probe auf `returning` und muss **genau eine Zeile** liefern, jede hat eine
> Gegenprobe, die weiterhin scheitern muss (der Paar-CHECK aus 0032), und alles läuft in
> `begin; … rollback;`. Dieselbe Falle hatte 0037 in anderer Gestalt (§ unten).

**Zuletzt eingespielt, am 10. September 2026 zusammen mit dem Deploy — vier Dateien:**
- **`…0035`** (`pflichtfelder`) erzwingt per Trigger zwei Regeln, die bis dahin nur die Oberfläche einhielt: ein abgesagter Termin braucht einen `cancel_reason_code`, ein Erstgespräch mit `status='unqualifiziert'` einen `disqualify_reason_code`. **Warum sie als einzige auf den Deploy warten musste** (die Datei trägt die Warnung als Kopfblock und prüft beim Start per `raise exception`, dass 0032 vorhanden ist): Die davor produktive App schrieb `unqualifiziert` ohne Grundcode und wäre beim nächsten Klick an einer DB-Exception zerbrochen. Diese Vorbedingung ist mit dem Deploy erfüllt — `setSettingOutcome` schreibt Status und Grund in EINEM UPDATE (§4). Trigger statt CHECK, weil ein CHECK bei JEDEM Update der Zeile greift und damit jede Bestandszeile ohne Grund dauerhaft unbearbeitbar machte — ausgerechnet die, die nachgepflegt werden müssen (dieselbe Falle wie bei den `source_type`-CHECKs, §4). Die Trigger vergleichen deshalb OLD/NEW und werfen nur, wenn der schlechte Zustand **in diesem Statement neu entsteht**; sie hängen zudem an `update of <spaltenliste>`, ein Update auf Notizen oder Zuweisung löst sie gar nicht erst aus. Drei Trigger (`setting_calls_require_cancel_reason`, `closing_calls_require_cancel_reason`, `setting_calls_require_disqualify_reason`), zwei Funktionen, **kein Backfill** — die Bestandszeilen ohne Grund bleiben also stehen und bleiben nachpflegbar (§8). Nachgepflegt wird bewusst über die Oberfläche (`/ablage`), weil ein rohes `UPDATE` die Folgen des Grundes überspringt (Kontaktverbot bei `keine_zusammenarbeit`, Räumen eines geplanten Recycling-Datums bei `falsche_zielgruppe`).

- **`…0038`** (`umzug_anruflog`) schließt die letzte dokumentierte Umzugslücke: `phone_call_attempts` zieht beim Nutzer-Umzug mit (§2, bis dahin die benannte Ausnahme in §8 — die Abfrage steht dort weiter, jetzt aber nur noch für Altbestände aus Umzügen VOR 0038). Rein additiv — nur `create or replace` auf `preview_move_user()` und `admin_move_user_to_workspace()` bei unveränderter Signatur plus idempotente Grants, keine DDL. Der neue `counts`-Schlüssel `phone_call_attempts` stand bereits in `COUNT_LABELS` (`src/lib/lifecycleLabels.ts`), die neue Warnung `attempt_list_snapshot_split` bringt ihren Text aus der DB mit. `list_id`/`owner_name` bleiben bewusst unangetastet — sie sind Snapshots des Anrufzeitpunkts (§3). **Kein Backfill**, mit Begründung: Welcher Lead bei einem früheren Umzug mit welcher Person gegangen ist, steht nirgends — `move_user_scope()` rechnet den Besitz aus dem HEUTIGEN Stand, und genau den hat der Umzug verschoben. Ein Backfill müsste raten, und geraten würde an der einzigen Ereignis-Historie der App.
- **`…0039`** (`apply_touches_pruefung`) zieht in `apply_reminder_touches()` zwei Prüfungen nach, die dort seit 0032 fehlten: Der übergebene **Termin** muss zur Organisation gehören, und jede **Zuweisung** muss auf ein Mitglied ebendieser Organisation zeigen (bei `data_scope='own'` zusätzlich auf den Aufrufer selbst). Die Funktion ist `security definer` und läuft damit an der RLS vorbei — ihr WITH CHECK hätte beides abgewiesen, sie nicht. Erreichbar war die Lücke per direktem POST auf die RPC, Server Actions sind nicht der einzige Weg dorthin. Dieselbe Migration hängt `reminder_touches_ws_guard` zusätzlich als **BEFORE INSERT** ein; als reiner UPDATE-Trigger deckte er nur den Nutzer-Umzug ab. Signaturen unverändert (`create or replace`), Funktion des Triggers unverändert, beliebig wiederholbar. Sie war die einzige der vier mit einer **Reihenfolge-Bedingung nach hinten**: erst der App-Fix in `generateScheduled`/`generateChain` (kein Ersteller-Fallback in fremder Organisation) sorgt dafür, dass ein Plattform-Admin keine Zuweisung mehr schickt, die die neue Prüfung (c) abweisen würde — mit dem gemeinsamen Deploy war das erfüllt.
- **`…0040`** (`schreibpfad_mandantengrenzen`) schließt drei Schreibpfade, die die Mandantengrenze nicht zu Ende ziehen. **(1)** `schedule_recycle()` und `recycle_attempt()` prüfen seit 0037 die *Mitgliedschaft*, aber nicht den *Besitz* — beide sind `security definer`, ihr einziger Zeilenfilter ist `where id = … and workspace_id = …`, und der trennt Organisationen, nicht Kollegen. Ein Mitglied mit `data_scope='own'` konnte damit die Wiedervorlage eines Kollegen umdatieren oder (über den Versuchszähler, der beim Erreichen von `max_attempts` in derselben Anweisung `next_recycle_at` nullt) lautlos verschwinden lassen. Die neue Prüfung greift **nur** bei `data_scope='own'` und benutzt wörtlich die Prädikate des Personenfilters aus `recycle_tasks()` (`list_owned_by_user()` bzw. `coalesce(assigned_user_id, created_by_user_id)`) — sie kann deshalb keine Aufgabe blockieren, die die Oberfläche jemandem anzeigt. **(2)** `seed_workspace_defaults()` stand seit 0034 jedem angemeldeten Konto offen; sie überschreibt nichts (`on conflict do nothing`), legt aber per SQL abgeschaltete Kaskadenstufen einer fremden Organisation wieder an. Behoben durch Entzug des Ausführungsrechts (`revoke … from public` **und** `from authenticated`; `service_role` bekommt es ausdrücklich zurück) — es gibt keinen legitimen Aufruf aus der App, der einzige Aufrufer ist der Trigger `workspaces_seed_defaults`, und der braucht kein Grant. **(3)** `assigned_user_guard` (0028) hing nur an `before update of workspace_id`, deckte also allein den Nutzer-Umzug ab; ein direkter POST/PATCH auf `/rest/v1/setting_calls` konnte eine Zuweisung über die Org-Grenze setzen, weil die Policy schon über `created_by_user_id` erfüllt ist. Die Migration hängt denselben Trigger zusätzlich als **INSERT** ein und erweitert die Spaltenliste des UPDATE-Triggers auf `workspace_id, assigned_user_id`. Die Triggerfunktion selbst bleibt unangetastet (sie liest nur `new` und kennt kein `OLD`, arbeitet also auch beim INSERT korrekt), ebenso die Datei 0028 — die beiden Trigger werden unter demselben Namen ersetzt. Rein additiv und beliebig wiederholbar: `create or replace` auf zwei Funktionen mit unveränderter Signatur, zwei `revoke`, vier `drop trigger if exists` + `create trigger`; keine DDL auf Spalten, kein Backfill, keine Datenbewegung. Ihre Reihenfolge war **frei — vor ODER nach dem Deploy**, weil die Datei ausschließlich Prüfungen verschärft und der Oberfläche nichts wegnimmt. Der begleitende App-Fix (Vorprüfung in `scheduleRecycle`, `src/app/actions/recycle.ts`) ergänzt sie, war aber keine Voraussetzung — die App schützt den Weg durch die App, die Datenbank den direkten POST auf die RPC. Dass die beiden Besitzprüfungen wortgleich bleiben, prüft `tests/schreibpfadGrenzen.test.ts`.

**Kurz davor eingespielt — 0036 und 0037:**
- **`…0036`** (`tenant_lifecycle_nachtrag`) zieht `preview_move_user()`, `admin_move_user_to_workspace()` und `preview_delete_workspace()` auf die neuen Tabellen nach (§2): Löschvorschau 13 → **18** gezählte Tabellen, Umzug 14 → **16**, zwei neue Vorschau-Zähler und der Warncode `reminder_touch_superseded`. `move_user_scope()` bleibt bewusst unangetastet — ein weiterer OUT-Parameter wäre eine Signaturänderung. Ausschließlich `create or replace` plus idempotente Grants, keine DDL auf Tabellen — beliebig wiederholbar. Ihr Verifikationsblock ist der wertvollste Teil: Er vergleicht `pg_constraint` gegen die Schlüssel der Löschvorschau und schlägt damit von selbst wieder an, sobald jemand eine neue Tabelle an `workspaces` hängt. Bekannte, ausdrücklich offen gelassene Lücke: `phone_call_attempts` zieht weiter nicht mit dem Nutzer um.
- **`…0037`** (`rpc_zugriffspruefung`) stellt `schedule_recycle()` und `recycle_attempt()` denselben Mitgliedschafts-Block voran, den `apply_reminder_touches()` seit 0032 trägt (§5). Beide Signaturen bleiben byte-gleich zu 0033, deshalb `create or replace` statt `drop function` — ein Drop nähme die Grants einer produktiv aufgerufenen Funktion mit. Die lesenden RPCs `recycle_tasks()`/`dropout_lists()` bekommen nichts, sie hängen an `rpc_effective_user`. Rein additiv und wiederholbar. **Der Verifikationsblock hat eine eigene Falle**, die man kennen muss: Im SQL-Editor ist man `postgres`, `auth.uid()` ist NULL, und **beide** Aufrufe scheitern — das sähe wie ein bestandener Test aus und beweist nichts. Der Test läuft nur mit gesetzten JWT-Claims je Transaktion, und die Gegenprobe mit einer Plattform-Admin-UUID muss *bestehen*, sonst ist die org-übergreifende Arbeit ab hier tot.

**Die früheren Fassungen 0031 (`reminder_cascade`) und 0032 (`lead_recycling`) gibt es nicht mehr.** Sie waren auf keiner Datenbank eingespielt und wurden deshalb neu geschnitten statt durch Korrektur-Migrationen ergänzt; ihr Inhalt steckt jetzt in 0031–0034. Wer sie nachschlagen will, findet sie unter Commit `b145b35`. Ersatzlos entfallen sind dabei die Tabellen `reminder_settings` und `recycle_settings` — ihre Offsets liegen jetzt in `cascade_steps`, ihre Texte in `message_templates`, der Rest in `pipeline_settings`.

- **0028** ist bis auf zwei Stellen additiv: Sie ersetzt die RLS-Policies `setting_calls_scoped_member` / `closing_calls_scoped_member` destruktiv und schreibt vier RPCs per `create or replace` neu (Signaturen unverändert, Grants bleiben). Vor dem Ausführen prüfen, dass `call_assignees` keine Mehrfachzuweisung enthält — der Backfill kollabiert sie sonst auf eine Person.
- **0029** muss **vor** dem Deploy des zugehörigen Codes laufen. `src/lib/analyseData.ts` selektiert `setting_calls.phone`, `closing_calls.lost_reason_code` und `phone_lists.script_label`/`target_group` **namentlich** — eine fehlende Spalte lässt PostgREST die GESAMTE Abfrage abweisen, der Analyse-Bereich wäre dann leer statt unvollständig. Rein additiv (vier Spalten, ein erweiterter CHECK, ein neuer CHECK), aber mit zwei Backfills, die man kennen muss: die Regel-basierte Umdeutung von `source_type='manuell'` nach `ads`/`social_media` (§4) und `lost_reason_code='sonstiges'` auf **alle** verlorenen Bestandszeilen (§4). Beide sind bewusst konservativ — der Rest ist To-do-Liste, nicht Statistik. Verifikationsblock am Ende der Datei.
- **0030** ist rein additiv (`phone_leads.script_label` + Index) und setzt 0029 voraus. Der Backfill übernimmt das Label nur für Leads, die noch in einer Liste **mit** Label liegen; bereits in eine Routing-Liste abgewanderte Leads bekommen nichts — ihr ursprünglicher Arm ist nicht rekonstruierbar und wird als „ohne Testarm" ausgewiesen, statt einen Arm zu verfälschen.
- **0031** (`message_templates`) legt das Vorlagen-Fundament und ist Voraussetzung für 0032 und 0033 (`cascade_steps` verweist auf `template_catalog`). Rein additiv: der Helfer `can_manage_org_settings()`, die Tabellen `template_catalog` (31 abgeglichene Zeilen) und `message_templates`. **Kein Backfill der Texte** — die Auslieferungstexte bleiben in TypeScript (§1, Begriff „Vorlage"); die Übernahme der `followup_templates` erfolgt erst in 0034.
- **0032** (`reminder_cascade`) setzt 0031 voraus. Additiv, aber umfangreich: `pipeline_settings`, `cascade_steps`, `reminder_touches` **v2** (echte FKs, `touch_kind`/`cascade_kind`/`step_no`), die Lebenszyklus-Spalten auf beiden Termin-Tabellen, `wa_phone`/`wa_consent_at`/`wa_refused_at` am Setting, `onboarding_at` und `follow_up_due_at` am Closing, die RPC `apply_reminder_touches()` — und der auf zehn Werte erweiterte CHECK für `lost_reason_code` (`kein_fit`, §4). Die neuen CHECKs sind einzeln in einem `do $$`-Block angelegt, damit ein erneutes Einspielen nicht scheitert. **Kein Backfill** — die Kaskade gilt bewusst nur für Termine, die NACH dem Deploy angelegt/verschoben werden (sonst risse beim Rollout ein Schwall sofort überfälliger Erinnerungen auf). Die Migration muss **vor** dem Deploy des zugehörigen Codes laufen: `src/lib/analyseData.ts` selektiert **namentlich** (Muster 0029) sowohl `touch_kind`/`cascade_kind`/`step_no` auf `reminder_touches` als auch `cancelled_at`/`cancel_outlook`/`cancel_reason_code` auf **beiden** Termin-Tabellen. Die Folgen unterscheiden sich in der Härte: Bei den Touches bleiben nur die „Erinnerungs-Disziplin"-Blöcke leer und sagen das (`available`-Fallback, §5.1) — die drei Absage-Spalten hängen dagegen in `SETTING_COLUMNS`/`CLOSING_COLUMNS`, also in der **Hauptabfrage** des Analyse-Bereichs. Fehlt dort eine Spalte, weist PostgREST die ganze Abfrage ab und der Bereich ist leer statt unvollständig.
- **0033** (`lead_recycling`) setzt 0032 voraus (`pipeline_settings` trägt die Wartezeiten, die Lebenszyklus-Spalten speisen die Listen). Additiv: je **sechs** Recycling-Spalten auf `contacts`, `phone_leads`, `setting_calls`, `closing_calls` samt zwei CHECKs je Tabelle, der CHECK „`falsche_zielgruppe`/`kein_fit` bekommen nie ein Datum" auf `closing_calls`, die Funktionen `schedule_recycle()` und `recycle_attempt()`, `recycle_tasks` **v2** und `dropout_lists()`. Zwei Fehler der alten Fassung verschwinden hier strukturell: Das Recycling wurde nie zurückgenommen, wenn ein Lead auf anderem Weg zurückkam (jetzt sichern App-Code UND ein davon unabhängiger Status-Riegel in der RPC), und der Versuchszähler wurde gelesen-gerechnet-geschrieben (jetzt eine Anweisung). **Kein Backfill** — gilt nur für Zeilen, die NACH dem Deploy terminal werden. `recycle_tasks` und `dropout_lists` werden per `drop function` + `create` neu angelegt (geänderter Rückgabetyp), `nachfassen_tasks` bleibt unangetastet (§5).
- **0034** (`tenant_lifecycle`) setzt 0031 und 0032 voraus. `seed_workspace_defaults()` + AFTER-INSERT-Trigger auf `workspaces` (§2), Nachziehen aller bestehenden Organisationen und die **einzige Datenbewegung des ganzen Umbaus**: `followup_templates` → `message_templates` (`linkedin_fu_1..3`), nur für Zeilen mit Text und bestehender Mitgliedschaft. Die Quelltabelle bleibt stehen (§3). Bewusst ein Trigger statt Änderungen an `bootstrap_workspace()`/`platform_create_workspace()`: Ein Kunde entsteht über den einen Pfad, ein anderer über den anderen — ein Trigger deckt beide ab und zusätzlich jeden künftigen; damals kam hinzu, dass er das Verifikationsfenster vor dem Merge schonte.

## 8. Invarianten (nach jedem Nutzer-Umzug und nach jedem Backfill prüfen)

Alle Abfragen müssen `0` bzw. eine leere Menge liefern — mit **acht benannten Ausnahmen**, die etwas anderes erwarten: Kaskadenstufen je Organisation (21/16/3), Katalogumfang (31), die Zugriffsprüfung aus 0037 (genau 2 Funktionen), die Pflichtfeld-Trigger aus 0035 (**vor 0041 genau 3, nach 0041 genau 0** — s. u.), die beiden stillgelegten Triggerfunktionen (nach 0041 genau 2) und der Nachfass-Stempel (nach 0041 genau 2 Spalten), die INSERT-Guards aus 0039/0040 (genau 3) und der Altbestand `phone_call_attempts` aus Umzügen vor 0038. Sie decken genau die Fehler ab, die ein unvollständiger Umzug hinterlässt — die beiden Zuweisungs-Blöcke zusätzlich die eines unvollständigen Backfills aus 0028, die beiden Testarm-Blöcke die aus 0030 (dort mit einer benannten Altbestands-Ausnahme), die Kaskaden- und Recycling-Blöcke die aus 0032–0034, die letzten Blöcke die aus 0036–0040.

**Seit dem 10. September 2026 ist der zweite Zweck der wichtigere.** Umgezogen wird selten; eingespielt wurde zuletzt viel — und weil die Supabase-Konsole markierten Text ausführt und dabei **lautlos** Halbzustände hinterlässt (§7), sind mehrere dieser Abfragen in erster Linie **Einspiel-Kontrolle**. Sie sind jetzt zu fahren, nicht irgendwann: Alle Migrationen bis 0040 liegen live, und ein Halbzustand fällt sonst erst im Ernstfall auf (bei 0027 hat er ein halbes Jahr unbemerkt dagelegen).

> **⚠ Nach dem Rückbau: Ein Teil dieser Abfragen prüft nichts mehr, was noch entstehen kann.**
> Die Blöcke zu `reminder_touches` und `cascade_steps` beschreiben Tabellen, die **niemand mehr
> füllt** (§3). Ein Treffer dort kann seither nur noch zwei Ursachen haben: ein direkter
> SQL-Eingriff, oder ein Nutzer-Umzug, der Bestandszeilen zurückgelassen hat. **Sie bleiben
> trotzdem stehen, und zwar aus drei Gründen:**
> 1. Der Nutzer-Umzug (`admin_move_user_to_workspace()`, 0036) **stempelt `reminder_touches`
>    weiterhin um** — die Funktion ist eingefroren und weiß nichts vom Rückbau. Ein Umzug kann
>    hier also weiterhin einen Fehler erzeugen, und dann ist die Abfrage die einzige Stelle,
>    an der er auffällt.
> 2. Der Seeding-Trigger legt weiterhin 21 `cascade_steps` je neuer Organisation an (§2). Die
>    Verteilungs-Abfrage ist damit **Einspiel-Kontrolle für 0034**, nicht mehr Funktionsprüfung
>    für die Kaskade — sie wird rot, wenn der Trigger nicht greift, und das wäre weiterhin ein
>    echter Befund über eine kaputte Organisation.
> 3. Sie halten den **Bestand** lesbar. Löschte man sie, wüsste in einem halben Jahr niemand
>    mehr, welche Zusicherungen für die Zeilen in `reminder_touches` gelten.
>
> Jeder betroffene Block trägt unten den Vermerk **HISTORISCH**. Wer eine Nachpflege plant:
> Ein `delete` auf diesen Tabellen ist ausdrücklich **nicht** gemeint — die Zeilen sind Daten
> (§3), keine Karteileichen.

```sql
-- Keine Doppelmitgliedschaft (sperrt den Nutzer sonst aus, siehe §2)
select user_id, count(*) from workspace_members group by 1 having count(*) > 1;

-- Denormalisiertes workspace_id stimmt mit der Elternliste überein
select count(*) from contacts c join lists l on l.id = c.list_id where c.workspace_id <> l.workspace_id;
select count(*) from phone_leads p join phone_lists l on l.id = p.list_id where p.workspace_id <> l.workspace_id;
select count(*) from organic_posts o join organic_lists l on l.id = o.list_id where o.workspace_id <> l.workspace_id;

-- Keine Referenz zeigt über eine Org-Grenze
select count(*) from closing_calls cc join setting_calls sc on sc.id = cc.setting_call_id
  where cc.workspace_id <> sc.workspace_id;
select count(*) from setting_calls sc join contacts c on c.id = sc.source_contact_id
  where sc.workspace_id <> c.workspace_id;
select count(*) from setting_calls sc join phone_leads pl on pl.id = sc.source_phone_lead_id
  where sc.workspace_id <> pl.workspace_id;
select count(*) from list_views v where v.parent_id is not null
  and (select workspace_id from list_views p where p.id = v.parent_id) <> v.workspace_id;
select count(*) from call_assignees ca join workspace_members wm on wm.user_id = ca.user_id
  where wm.workspace_id <> ca.workspace_id;

-- Jeder Termin hat eine zuständige Person (direkt nach dem Einspielen von
-- 0028 zu prüfen). Eine NULL heißt: Der Backfill hat nichts gefunden — die
-- Zeile fällt dann auf created_by_user_id zurück, also auf das Audit-Feld, in
-- dem vor 0028 die eingestellte Datensicht stand. Einzige legitime NULL: ein
-- Termin, den ein Plattform-Admin in einer FREMDEN Organisation angelegt hat
-- (er ist dort kein Mitglied, siehe §2) — solche Zeilen einzeln ansehen.
select count(*) from setting_calls where assigned_user_id is null;
select count(*) from closing_calls where assigned_user_id is null;

-- assigned_user_id zeigt nur auf Mitglieder DERSELBEN Organisation. Der Guard
-- aus 0028 greift bei 'update of workspace_id', seit 0040 zusätzlich beim
-- INSERT und bei 'update of assigned_user_id'. Er deckt damit den direkten
-- POST ab — NICHT aber eine Zeile, die beim Nutzer-Umzug ZURÜCKBLEIBT (Besitz
-- wird über created_by_user_id ermittelt): die behält ihre Zuweisung auf den
-- inzwischen Ausgezogenen, und genau dafür steht diese Abfrage hier.
select count(*) from setting_calls sc where sc.assigned_user_id is not null
  and not exists (select 1 from workspace_members wm
                   where wm.user_id = sc.assigned_user_id and wm.workspace_id = sc.workspace_id);
select count(*) from closing_calls cc where cc.assigned_user_id is not null
  and not exists (select 1 from workspace_members wm
                   where wm.user_id = cc.assigned_user_id and wm.workspace_id = cc.workspace_id);

-- owner_name zeigt nur auf Mitglieder DERSELBEN Organisation
select l.workspace_id, l.owner_name from lists l where l.owner_name is not null
  and not exists (select 1 from workspace_members wm join profiles p on p.user_id = wm.user_id
                   where wm.workspace_id = l.workspace_id and p.username = l.owner_name);

-- Skript-Testarm überlebt den Umzug in eine Routing-Liste (Migration 0030).
-- Ein Lead wandert bei „Rückruf"/„Nicht erreicht" physisch in eine Liste OHNE
-- Label; sein Arm steht deshalb am Lead. Treffer heißen: Der Arm ist verloren
-- — und weil genau die schlechten Ausgänge dorthin wandern, sähe jedes Skript
-- besser aus als es ist. Einziger legitimer Treffer: Leads, die schon VOR 0030
-- abgewandert waren (ihr Arm war nie am Lead und ist nicht rekonstruierbar).
-- Sie zählen bewusst als „ohne Testarm"; für alles danach muss die Zahl 0 sein.
select count(*) from phone_leads pl
  join phone_lists l on l.id = pl.list_id
 where l.list_kind <> 'akquise' and pl.script_label is null;

-- Gegenprobe an der Quelle: In einer Akquise-Liste MIT Label darf kein Lead
-- ohne Arm liegen — sonst hat der Import (oder updatePhoneListScript) nicht
-- durchgestempelt, und der Arm verliert seine Fallzahl schon vor dem Umzug.
select count(*) from phone_leads pl
  join phone_lists l on l.id = pl.list_id
 where l.list_kind = 'akquise' and l.script_label is not null and pl.script_label is null;

-- ── HISTORISCH ab hier: reminder_touches und cascade_steps ────────────────
-- Diese Tabellen füllt seit dem Rückbau NIEMAND mehr (§3). Ein Treffer kann
-- nur noch zwei Ursachen haben: ein direkter SQL-Eingriff, oder ein
-- Nutzer-Umzug, der Bestandszeilen zurückgelassen hat — admin_move_user_to_
-- workspace() (0036) ist eingefroren, stempelt weiter um und weiß nichts vom
-- Rückbau. Die Abfragen bleiben deshalb stehen; sie halten außerdem lesbar,
-- welche Zusicherungen für den Bestand gelten. Ein `delete` auf diesen
-- Tabellen ist NICHT gemeint — die Zeilen sind Daten, keine Karteileichen.

-- HISTORISCH — Erinnerungs-Kaskade (Migration 0032): jeder aktive Touch hat
-- eine zuständige Person — die Erzeugung snapshotete immer assigned_user_id ??
-- created_by_user_id des Eltern-Termins (§3). Der Insert-Trigger
-- reminder_touches_require_assignee hält das für NEUE Zeilen fest; ein
-- Treffer hier heißt also: nachträglich genullt (gelöschter Nutzer).
select count(*) from reminder_touches where superseded_at is null and assigned_user_id is null;

-- HISTORISCH — Ein Touch zeigt auf GENAU EINEN Termin, passend zu seinem
-- entity_type. Die CHECKs aus 0032 halten das fest; die Abfrage findet, was
-- ein direkter SQL-Eingriff daran vorbei angelegt hat.
select count(*) from reminder_touches
 where (entity_type = 'setting') <> (setting_call_id is not null)
    or (entity_type in ('closing','closing_followup')) <> (closing_call_id is not null);

-- HISTORISCH — Der Touch liegt in derselben Organisation wie sein Termin. Der Guard
-- reminder_touches_ws_guard greift bei 'update of workspace_id,
-- assigned_user_id' (und seit 0039 zusätzlich beim INSERT) — beim
-- Nutzer-Umzug ZURÜCKBLEIBENDE Zeilen fasst er
-- nicht an (§2). Seit 0036 stempelt der Umzug die Touches der mitziehenden
-- TERMINE selbst um; ein Treffer heißt jetzt: ein Umzug von VOR 0036, oder
-- ein direkter SQL-Eingriff.
select count(*) from reminder_touches rt
  join setting_calls sc on sc.id = rt.setting_call_id
 where rt.workspace_id <> sc.workspace_id;
select count(*) from reminder_touches rt
  join closing_calls cc on cc.id = rt.closing_call_id
 where rt.workspace_id <> cc.workspace_id;

-- HISTORISCH — assigned_user_id eines aktiven Touches zeigt nur auf Mitglieder
-- DERSELBEN Organisation — dieselbe Regel wie bei setting_calls/closing_calls oben.
select count(*) from reminder_touches rt where rt.superseded_at is null
  and rt.assigned_user_id is not null
  and not exists (select 1 from workspace_members wm
                   where wm.user_id = rt.assigned_user_id and wm.workspace_id = rt.workspace_id);

-- Jede Organisation hat eine Konfigurationszeile (Migration 0034). NICHT
-- historisch: pipeline_settings ist lebendig (§3). Ein Treffer heißt, der
-- Seeding-Trigger hat nicht gegriffen — die Folge wäre eine Organisation, in
-- der schedule_recycle() immer NULL liefert, in der es also gar kein Recycling
-- gibt, und in der das Verschiebe-Kontingent auf die Spalten-Defaults fällt.
select count(*) from workspaces w
 where not exists (select 1 from pipeline_settings ps where ps.workspace_id = w.id);

-- HISTORISCH (aber weiterhin zu fahren) — dieselbe Frage für die
-- Kaskadenstufen. Sie liest niemand mehr, der Trigger legt sie trotzdem
-- weiter an (§2). Die Abfrage ist damit **Einspiel-Kontrolle für 0034** und
-- keine Funktionsprüfung mehr: Sie wird rot, wenn der Trigger nicht greift —
-- und das wäre weiterhin ein echter Befund über eine kaputte Organisation,
-- weil derselbe Trigger die pipeline_settings-Zeile darüber anlegt.
select count(*) from workspaces w
 where not exists (select 1 from cascade_steps cs where cs.workspace_id = w.id);
-- Erwartete Verteilung je Organisation: 21 Stufen, davon 16 aktiv, davon
-- 3 mit requires_no_response (no_show_setting_2, no_show_closing_2, kein_close_2).
select workspace_id,
       count(*) as gesamt,
       count(*) filter (where enabled) as aktiv,
       count(*) filter (where requires_no_response) as nur_ohne_antwort
  from cascade_steps group by 1;

-- HISTORISCH — Eine geplante Stufe hängt vor dem Termin, alles andere
-- reagiert auf ein Ereignis und liegt danach (CHECK aus 0032).
select count(*) from cascade_steps
 where (trigger_event = 'scheduled') <> (anchor = 'before_appointment');

-- Termin-Lebenszyklus (Migration 0032): Absage und Aussicht sind ein Paar.
select count(*) from setting_calls where (cancelled_at is null) <> (cancel_outlook is null);
select count(*) from closing_calls where (cancelled_at is null) <> (cancel_outlook is null);

-- Ein No-Show-Ausgang steht nur an einem Termin, bei dem niemand erschienen
-- ist — sonst beschreibt er nichts.
select count(*) from setting_calls where no_show_resolution is not null and show_status is distinct from 'no_show';
select count(*) from closing_calls where no_show_resolution is not null and show_status is distinct from 'no_show';

-- Recycling (Migration 0033): Ausschluss und Wiedervorlage schließen sich
-- gegenseitig aus — recycle_excluded_at ist "endgültig raus" (Sperrliste),
-- next_recycle_at ist "noch im Rennen". Seit 0033 hält das ein CHECK je
-- Tabelle fest; die Abfragen bleiben als Gegenprobe nach einem Backfill.
select count(*) from contacts where recycle_excluded_at is not null and next_recycle_at is not null;
select count(*) from phone_leads where recycle_excluded_at is not null and next_recycle_at is not null;
select count(*) from setting_calls where recycle_excluded_at is not null and next_recycle_at is not null;
select count(*) from closing_calls where recycle_excluded_at is not null and next_recycle_at is not null;

-- 'falsche_zielgruppe' und 'kein_fit' bekommen NIE ein Recycling-Datum (§4).
-- Ebenfalls per CHECK gesichert; ein Treffer hieße, der CHECK fehlt.
select count(*) from closing_calls
 where lost_reason_code in ('falsche_zielgruppe','kein_fit') and next_recycle_at is not null;

-- Dasselbe am Erstgespräch — hier gibt es KEINEN CHECK, die Regel steht nur
-- in schedule_recycle() und in setDisqualifyReason(). Diese Abfrage ist
-- deshalb die einzige Absicherung.
select count(*) from setting_calls
 where disqualify_reason_code in ('falsche_zielgruppe','keine_zusammenarbeit')
   and next_recycle_at is not null;

-- Der Deckel wird eingehalten: keine Wiedervorlage über max_attempts hinaus.
select count(*) from closing_calls cc join pipeline_settings ps on ps.workspace_id = cc.workspace_id
 where cc.next_recycle_at is not null and cc.recycle_attempt_count >= ps.max_attempts;

-- HISTORISCH — Vorlagen (Migration 0031): jeder template_key zeigt in den
-- Katalog, und beide Ebenen sind eindeutig (Org-Standard = user_id is null).
-- Die Katalog-Zeile bleibt trotzdem eine echte Einspiel-Kontrolle für 0031:
-- Bei genau dieser Migration ist der Halbzustand aus dem Editor schon einmal
-- passiert (§7) — template_catalog entstand, message_templates nicht.
select count(*) from message_templates mt
 where not exists (select 1 from template_catalog tc where tc.template_key = mt.template_key);
select workspace_id, template_key, count(*) from message_templates
 where user_id is null group by 1,2 having count(*) > 1;
select count(*) from template_catalog;  -- erwartet: 31

-- HISTORISCH — Eine PERSÖNLICHE Vorlage liegt nur in einer Organisation, in
-- der ihr Besitzer Mitglied ist (Migration 0036). Ein Treffer hieß: beim Umzug
-- zurückgeblieben — und das fiel niemandem auf, weil die Vorrangkette den
-- fehlenden Text lautlos durch den Org-Standard ersetzte (§2). Die
-- Vorrangkette gibt es nicht mehr; der Umzug stempelt aber weiter um.
select count(*) from message_templates mt where mt.user_id is not null
  and not exists (select 1 from workspace_members wm
                   where wm.user_id = mt.user_id and wm.workspace_id = mt.workspace_id);

-- Die Löschvorschau nennt JEDE Tabelle, die sie mitlöscht (Migration 0036).
-- Bewusst gegen den Katalog gerechnet statt abgezählt: Diese Abfrage wird von
-- selbst wieder rot, sobald jemand eine neue Tabelle an `workspaces` hängt —
-- eine Vorschau, die weniger nennt als sie löscht, ist gefährlicher als keine.
select c.conrelid::regclass as fehlt_in_der_vorschau
  from pg_constraint c
 where c.confrelid = 'public.workspaces'::regclass and c.confdeltype = 'c'
   and c.conrelid::regclass::text <> 'workspace_members'
   and not (preview_delete_workspace('<workspace>') -> 'counts')
             ? split_part(c.conrelid::regclass::text, '.', 2);

-- Das Anruf-Log zieht seit Migration 0038 mit dem Nutzer um (§2). Die Abfrage
-- misst deshalb nur noch ALTBESTAND: Anwahlen aus Umzügen von VOR 0038. Einen
-- Backfill gibt es bewusst nicht — welcher Lead damals mit wem gegangen ist,
-- steht nirgends, und geraten würde an der einzigen Ereignis-Historie der App.
-- Die Zahl darf also > 0 sein, aber sie darf nach einem Umzug NICHT WACHSEN.
-- Vorher notieren, hinterher vergleichen.
select count(*) from phone_call_attempts a
  join phone_leads pl on pl.id = a.lead_id
 where a.workspace_id <> pl.workspace_id;

-- Der Rest-Fall, den 0038 bewusst offen lässt: Anwahl in der neuen
-- Organisation, aber ihr LISTEN-Snapshot zeigt noch in die alte. list_id und
-- owner_name sind Snapshots des Anrufzeitpunkts (§3) und werden deshalb NICHT
-- mitgezogen; die Umzugsvorschau weist die Zeilen als 'attempt_list_snapshot_split'
-- aus. Ob sie genullt oder stehen gelassen werden, ist eine Produktfrage —
-- die Zahl gehört im Blick behalten, nicht automatisch auf null gebracht.
select count(*) from phone_call_attempts a
  join phone_lists l on l.id = a.list_id
 where a.workspace_id <> l.workspace_id;

-- Zugriffsprüfung der beiden schreibenden Recycling-RPCs (Migration 0037).
-- Erwartet: genau 2 Zeilen. Weniger heißt, die Migration lief nur zur Hälfte
-- durch (§7, Teil-Ausführung im Editor).
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('schedule_recycle','recycle_attempt')
   and pg_get_functiondef(p.oid) like '%Kein Zugriff auf diese Organisation%';

-- ── Einspiel-Kontrolle für 0035, 0039 und 0040 ─────────────────────────────
-- Diese drei ändern keine Tabelle und hinterlassen deshalb auch keine Spalte,
-- an der man sie sähe. Ein Halbzustand aus dem Editor (§7) ist hier besonders
-- teuer: Er sieht aus wie „alles in Ordnung", nimmt aber genau die Prüfung
-- weg, derentwegen die Datei geschrieben wurde.

-- Pflichtfeld-Trigger (0035). Erwartet: VOR 0041 genau 3, NACH 0041 genau 0.
-- Die Erwartung dreht sich mit dem Einspielen von 0041 um — das ist Teil 1
-- jener Datei, und die Zahl 0 ist danach das BESTANDENE Ergebnis, nicht ein
-- verlorener Trigger.
select tgname from pg_trigger
 where not tgisinternal
   and tgname in ('setting_calls_require_cancel_reason',
                  'closing_calls_require_cancel_reason',
                  'setting_calls_require_disqualify_reason');

-- DIE GEGENPROBE ZU 0041, ohne die die 0 oben nichts beweist: Wären die beiden
-- Triggerfunktionen gelöscht, lieferte die Abfrage darüber ebenfalls 0 — aus
-- dem falschen Grund. 0041 lässt sie ausdrücklich stehen (in ihnen steckt die
-- Bauart, die Bestandszeilen verschont) und vermerkt das am Funktionskörper.
-- Erwartet NACH 0041: genau 2 Zeilen, beide mit `t`.
select p.proname,
       obj_description(p.oid, 'pg_proc') like 'STILLGELEGT mit 0041%' as vermerkt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('require_cancel_reason', 'require_disqualify_reason');

-- Der Nachfass-Stempel (0041, Teil 2). Erwartet NACH 0041: genau 2 Zeilen,
-- je `timestamp with time zone` / `YES`. Verglichen wird gegen das VORBILD
-- recycle_last_contacted_at derselben Tabelle — die Konvention ist der Punkt,
-- nicht das bloße Vorhandensein (Migration 0041, Verifikation A3/A4).
select f.table_name, f.data_type, f.is_nullable
  from information_schema.columns f
  join information_schema.columns r
    on r.table_schema = f.table_schema and r.table_name = f.table_name
   and r.column_name = 'recycle_last_contacted_at'
 where f.table_schema = 'public'
   and f.table_name in ('setting_calls', 'closing_calls')
   and f.column_name = 'follow_up_last_contacted_at'
   and (f.data_type, f.is_nullable) = (r.data_type, r.is_nullable);

-- Die INSERT-Guards, die als reine UPDATE-Trigger nur den Nutzer-Umzug
-- abdeckten (0039 für die Erinnerungen, 0040 für die Zuweisung). Erwartet:
-- genau 3. Fehlt einer, steht der direkte POST auf PostgREST wieder offen.
select tgname from pg_trigger
 where not tgisinternal
   and tgname in ('reminder_touches_ws_guard_ins',
                  'setting_calls_assigned_guard_ins',
                  'closing_calls_assigned_guard_ins');

-- seed_workspace_defaults() darf weder von PUBLIC noch von 'authenticated'
-- ausführbar sein (0040, Teil 2) — sie legt sonst per SQL abgeschaltete
-- Kaskadenstufen einer FREMDEN Organisation wieder an. Erwartet: leere Menge.
-- Der einzige legitime Aufrufer ist der Trigger workspaces_seed_defaults, und
-- der braucht kein Grant. Gelesen wird die ACL direkt, weil PUBLIC keine Rolle
-- ist, nach der sich has_function_privilege() fragen ließe: Ein ACL-Eintrag,
-- der mit '=' beginnt, IST der PUBLIC-Eintrag. Der `revoke from public` ist
-- dabei der eigentliche Schritt — Postgres grantet EXECUTE auf eine neue
-- Funktion per Vorgabe an PUBLIC, ein `revoke from authenticated` allein nähme
-- nur den ausdrücklichen Grant weg und ließe den geerbten stehen.
select acl.eintrag from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral unnest(coalesce(p.proacl, '{}')) as acl(eintrag)
 where n.nspname = 'public' and p.proname = 'seed_workspace_defaults'
   and (acl.eintrag::text like '=%' or acl.eintrag::text like 'authenticated=%');
```

**Zwei Regeln, drei Zählungen — und sie dürfen NICHT null sein. Was sie messen, ändert sich
mit 0041.** Sie waren nie ein Defekt-Test, aber ihre Bedeutung dreht sich:

| | vor 0041 | nach 0041 |
|---|---|---|
| Was die Zahl ist | eine **Arbeitsliste, die nur nach unten geht** | eine **Auskunft**: wie oft niemand einen Grund angegeben hat |
| Kann sie wachsen? | **nein** — die Trigger aus 0035 verhindern jeden neuen Fehlzustand | **ja**, und das ist die Entscheidung, nicht ihr Nebenschaden |

**Vor 0041** galt: Die Trigger aus 0035 sind eingespielt (§7), aber sie vergleichen OLD und NEW
und werfen nur, wenn der schlechte Zustand in diesem Statement NEU entsteht. Neue Fehlzustände
kann es deshalb nicht geben; die Bestandszeilen bleiben stehen — und sind bewusst weiterhin
**bearbeitbar**. Genau dafür sind es Trigger und kein CHECK: Ein CHECK griffe bei jedem Update
der Zeile und machte ausgerechnet die Zeilen dauerhaft unbearbeitbar, die nachgepflegt werden
müssen.

**Nach 0041** fallen die drei Trigger (§7), und damit dürfen die Zahlen wieder wachsen. Das ist
ausdrücklich gewollt: Der Knopf „Tot" der Arbeitsliste beendet einen Vorgang ohne jeden
Grundcode, und ein Pflichtfeld, dessen Formular verschwunden ist, wäre eine Sperre gegen die
eigene App. **Die drei Zahlen sollten deshalb unmittelbar vor dem Einspielen von 0041 einmal
notiert werden** — sonst hält später jemand den Anstieg für einen Defekt. Migration 0041 sagt
das in ihrem Verifikationsblock (Abschnitt D) ebenfalls.

Zuletzt gemessen (vor 0041): **52 unqualifizierte Erstgespräche ohne `disqualify_reason_code`.**
Für Auswertungen heißt das in beiden Zuständen dasselbe: Eine Aufschlüsselung nach
Disqualifikationsgrund beschreibt nur den Teil der Erstgespräche, der zwischen dem
10. September und dem Einspielen von 0041 entstanden oder von Hand nachgepflegt worden ist —
dieselbe Vorsicht wie bei `lost_reason_code`, wo Migration 0029 alle Bestandszeilen auf
`sonstiges` gesetzt hat (§4), und dieselbe wie beim Listen-Knopf „Tot", der beim Closing
strukturell `sonstiges` erzeugt (§4, Fallstrick 2). Wer die Verteilung zeigt, muss die Zeilen
ohne Code getrennt als „Ohne Angabe" führen, nicht unter `sonstiges` verbuchen.

```sql
select count(*) from setting_calls where cancelled_at is not null and cancel_reason_code is null;
select count(*) from closing_calls where cancelled_at is not null and cancel_reason_code is null;
select count(*) from setting_calls where status = 'unqualifiziert' and disqualify_reason_code is null;
```

Nachpflegen bitte **über die Oberfläche** (`/ablage`), nicht per rohem `UPDATE`: Ein direktes
Statement überspringt die Folgen des Grundes — das Kontaktverbot bei `keine_zusammenarbeit`
und das Räumen eines bereits geplanten Recycling-Datums bei `falsche_zielgruppe` (§4).

Zusätzlich als UI-Gegenprobe in der eigenen Organisation: `/team` zeigt nur eigene Mitglieder · Datensicht-Auswahl ohne fremde Namen · `/termine` ohne fremde Termine (in **beiden** Reitern — Arbeitsliste und Kalender — und in der Vorgabe `?wer=mein` zusätzlich ohne die Termine der Kollegen) · Suche nach einem fremden Lead liefert 0 Treffer · Sidebar ohne fremde Listen · `/nachfassen` ohne fremde Recycling-Karten. Die frühere Zeile „`/erinnerungen` ohne fremde Karten" ist entfallen: Die Route leitet nach `/termine` um (§1). **Die Ablage-Sperrliste ist dabei die eine bewusste Ausnahme**: Sie zeigt auch gesperrte Vorgänge fremder Personen derselben Organisation (nie einer fremden Organisation) — wer dort nur die eigenen sieht, hat den `v_user := null`-Zweig in `dropout_lists()` verloren.

## 9. Datenauswertung per MCP

**Für Datenauswertung: den Supabase-MCP (read-only, `execute_sql` / `list_tables`) nutzen, mit obigem Glossar als Kontext.** RLS greift dort nicht — Personen-/Zeitraumfilter immer explizit in die Query schreiben (§2, §5). Der MCP funktioniert nur, wenn `SUPABASE_ACCESS_TOKEN` vor dem Start von Claude Code in der Umgebung gesetzt ist (siehe README, Abschnitt „Supabase MCP").
