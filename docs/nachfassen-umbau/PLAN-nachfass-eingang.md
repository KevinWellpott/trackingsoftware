# Umsetzungsplan: der Nachfass-Eingang

Stand: 27. November 2026 · Status: **geplant, nichts gebaut** · Vorgänger:
`ENTSCHEIDUNGEN.md`, Nachtrag „Der Rückbau“ (11.09.2026) und Nachtrag vom 27.11.2026.

> **In einem Satz:** `/nachfassen` wird der eine Ort, an dem jeder jeden Tag sieht, wen er
> heute nerven muss. Dort stehen Termine ohne nächsten Schritt, Telefon-Rückrufe und fällige
> Recycling-Leads. Jeder offene Vorgang trägt ein Datum **„Nächster Kontakt am“**, und jeder
> Kontakt wird mit Ergebnis protokolliert.

---

## 1. Warum das heutige Konzept nicht trägt

Das Konzept nach dem Rückbau lautet: „Wer offen ist, wird jeden Tag kontaktiert“, mit einem
Stempel „Genervt“ als einziger Spur. In der Praxis funktioniert das nicht. Live-Daten vom
27.11.2026, über alle Organisationen zusammengezählt, ohne Namen:

| Befund | Zahl | Was er bedeutet |
|---|---|---|
| Erstgespräche „in der Luft“ (heutiges „Zu tun“) | **299**, dazu **97** Closings | Die Liste ist zu lang, um sie täglich abzuarbeiten. Bei der größten Organisation sind **108 von 161** älter als 30 Tage. |
| „Genervt“-Stempel überhaupt gesetzt | **28** Termine, davon **1** in den letzten 7 Tagen | Der Knopf wird praktisch nicht benutzt. Gold leuchtet überall, also leuchtet nichts. |
| Recycling-Versuche je eingetragen | **7** | Bei rund 3.200 wartenden Leads. Die Seite steht abseits und hat keinen Anlass, sie zu öffnen. |
| Telefon-Rückrufe überfällig | Bei den drei größten Kunden **50 von 76**, **44 von 60** und **16 von 18**; viele seit mehr als 14 Tagen | Die Rückrufe stehen in einem Reiter, den niemand von selbst aufmacht. |

Daraus folgen vier Ursachen:

1. **Es gibt keine Priorisierung über die Zeit.** „Jeden Tag“ heißt: Alles ist gleich
   dringend. Wer gestern nicht erreicht wurde und wer vor drei Wochen abgesagt hat, stehen
   gleich hell da.
2. **Die Arbeit ist auf drei Orte verteilt:** Termine → Liste, Termine → Rückrufe und
   `/nachfassen` (nur Recycling). Keiner davon beantwortet allein die Frage „Wen muss ich
   heute nerven?“.
3. **Es gibt kein Gedächtnis.** Ein Stempel sagt „zuletzt am …“, aber nicht „schon der
   vierte Versuch, nie erreicht“. Damit fehlt die Grundlage für die wichtigste Entscheidung
   beim Nachfassen: weitermachen oder aufgeben?
4. **Altlasten werden mitgeschleppt.** Ein Altersschnitt ist entschieden abgelehnt
   (`data-model.md` §5.5). Für den Bestand gab es dafür aber keinen Ersatz.

---

## 2. Wie große CRM-Systeme das lösen

| System | Wie es Nachfassen organisiert | Übernehmen | Bewusst nicht |
|---|---|---|---|
| **HubSpot** | Aufgaben mit Fälligkeitsdatum. Der Sales Workspace zeigt in der Übersicht „heute fällig · überfällig · morgen fällig“. Aufgaben-Queues lassen sich am Stück abarbeiten („back to back“). Workflows und Sequenzen erzeugen die Aufgaben. | Die Gliederung Heute / Überfällig / Demnächst und das Abarbeiten am Stück. | Sequenzen, Vorlagen und Workflow-Builder |
| **Salesforce** (Sales Engagement) | Kadenzschritte landen in einer Work Queue bzw. To-do-Liste. Ein Kadenzziel pausiert oder endet automatisch, wenn sich ein Feld ändert (z. B. Status → unqualifiziert). Recycling ist meist ein eigener Status mit Warteschlange und Haltefrist von 30–60 Tagen. | Raus aus der Liste nur über einen Zustandswechsel. Recycling als Haltefrist, danach eine normale Aufgabe. | Kadenz-Editor und Stufenlogik |
| **Pipedrive** | Jeder Deal soll eine nächste Aktivität haben; ohne eine ist er sichtbar markiert. „Rotting“ färbt Deals rot, die je Stufe X Tage nicht angefasst wurden. | „Ohne nächsten Schritt“ ist ein Warnzustand. Altfälle werden erkannt statt still mitgeschleppt. | Rotting-Tage je Stufe (das wäre wieder Stufenlogik) |
| **Close** | **Ein Eingang** für alles: fällige Aufgaben, Follow-up-Erinnerungen, verpasste Anrufe. Dazu Erinnerungen an Deals, die länger als üblich in einem Status hängen. Einträge lassen sich auf ein Datum vertagen („snooze“). Smart Views als gespeicherte Filter. | Der Eingang als Startseite der Arbeit und Vertagen auf ein Datum. | KI-Entwürfe und Mail-Integration (vertagt, `MODUL-mailversand.md`) |

**Die sechs Prinzipien, die in allen vier Systemen stecken:**

1. **Ein Eingang statt vieler Seiten.** Man öffnet morgens genau eine Ansicht.
2. **Jeder offene Vorgang hat einen nächsten Schritt mit Datum.** Hat er keinen, ist das ein
   Warnzustand und gilt als sofort fällig.
3. **Erledigen heißt in einem Schritt: protokollieren und das nächste Datum setzen.** Dabei
   ist ein Vorschlag vorbelegt.
4. **Einträge verschwinden nur über einen Zustandswechsel** (neuer Termin, tot, gewonnen),
   nie über Zeit.
5. **Recycling ist eine Wartezeit, danach eine normale Aufgabe im selben Eingang.** Es ist
   keine eigene Welt.
6. **Altlasten werden aktiv gesichtet**, nicht ausgeblendet.

Quellen: [HubSpot Task Queues](https://knowledge.hubspot.com/tasks/use-task-queues),
[HubSpot Prospecting Workspace](https://knowledge.hubspot.com/prospecting/use-the-prospecting-workspace),
[Salesforce Trailhead: Cadences](https://trailhead.salesforce.com/content/learn/modules/standard-cadences-for-sales-engagement/manage-cadences-for-your-organization),
[GitLab Lead Lifecycle (Recycle-Queues)](https://handbook.gitlab.com/handbook/marketing/marketing-operations/lead-lifecycle/),
[Pipedrive Rotting](https://support.pipedrive.com/en/article/the-rotting-feature),
[Close Inbox](https://help.close.com/docs/inbox),
[Close Reminders-Tab](https://close.com/changelog/inbox-improvements).

---

## 3. Entscheidungen (27.11.2026, Simon)

| # | Frage | Entscheidung |
|---|---|---|
| N1 | Was steht im Eingang? | **Termine ohne nächsten Schritt + Telefon-Rückrufe + fällige Recycling-Leads.** LinkedIn-Follow-ups bleiben im Listen-Board (rund 3.000 fällige Altzeilen würden den Eingang fluten). Nach FU3 erschöpfte LinkedIn-Kontakte kommen trotzdem über das Recycling herein. |
| N2 | Wann taucht ein Lead wieder auf? | **„Nächster Kontakt am“-Datum je Vorgang.** Nach jedem Kontakt ein Klick: morgen / in 2 Tagen / nächste Woche / Datum, mit einem vorbelegten Vorschlag. Ohne Datum ist der Vorgang sofort fällig. Ersetzt „jeden Tag“. |
| N3 | Wird jeder Kontakt festgehalten? | **Ja, mit Ergebnis.** Jeder Klick ist ein Eintrag (Ergebnis Pflicht, Kanal und Notiz optional). Daraus entstehen der Hinweis „Versuch 4“, der Vorschlag „aufgeben?“ und eine ehrliche Auswertung. |
| N4 | Was passiert mit dem Altbestand? | **Einmal sichten.** Ein Aufräum-Modus beim Start: Altfälle stehen gesammelt da, je Zeile (und als Sammelaktion) „nochmal versuchen / aufgeben / sperren“. Danach startet der Eingang sauber. |

### Abgrenzung zum Rückbau: Warum das nicht die alte Kaskade ist

Der Geschäftspartner hat die Kaskade abgelehnt („ein Produkt für zwanzig Setter, wir sind zu
dritt“). Dieser Plan führt davon **nichts** zurück:

| Kaskade (gefallen) | Nachfass-Eingang (neu) |
|---|---|
| 9 Kaskadenarten, 21 Stufen je Organisation, konfigurierbar | Keine Stufen. Ein Datum je Vorgang, vom Menschen gesetzt. |
| 31 Vorlagen, Vorrangkette, Platzhalter | Keine Texte |
| Kanal wird abgeleitet, WhatsApp-Einwilligung als Bedingung | Kanal ist optional und eine reine Angabe |
| Das System erzeugt Touches im Voraus | Das System erzeugt **nichts**. Ein Eintrag entsteht nur, wenn ein Mensch klickt. |
| Eigene Seite `/erinnerungen` neben `/nachfassen` | **Weniger** Orte als heute: drei werden zu einem |

Was neu dazukommt, ist genau eine Tabelle (ein Protokolleintrag je Klick) und die
Wiederbelebung einer Spalte, die schon existiert (`follow_up_due`). Die Daten in §1 zeigen,
dass die flache Regel nicht genutzt wird. Ein Datum je Vorgang ist das Minimum, mit dem eine
Liste über die Zeit abarbeitbar wird.

---

## 4. Das Zielbild

### 4.1 Die Seite `/nachfassen` (auf dem Bildschirm „Nachfassen“)

```
┌ Nachfassen ─────────────────────────────────── [Mein ▾]  [▶ Abarbeiten] ┐
│  Überfällig 12 · Heute 9 · Diese Woche 23 · Heute erledigt 6            │
│                                                                          │
│  [Fällig]  [Demnächst]  [Wartet]  [Aufräumen 108]       Alle·Termine·Rückrufe·Recycling │
│                                                                          │
│  ── Ergebnis fehlt (3) ─────────────────────────────────────────────────  │
│  Max Muster · Muster GmbH   Closing gestern 14:00 – kein Ergebnis      [Ergebnis eintragen] │
│                                                                          │
│  ── Überfällig (12) ────────────────────────────────────────────────────  │
│  ● Anna Beispiel · Beispiel AG   [Erstgespräch · No-Show]               │
│    Versuch 3 · zuletzt vor 4 Tagen (Kevin, nicht erreicht)  📞 💬 in    │
│                       [Kontakt eintragen ▾] [Termin] [Aufgeben] [Details] │
│  ● Firma XY                       [Rückruf · heute 10:30]   …          │
│                                                                          │
│  ── Heute (9) ──────────────────────────────────────────────────────────  │
│  ● Tom Test · Test KG             [Recycling · Verloren: Preis · 1 von 2] │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Reiter:**
  - **Fällig** (Vorgabe): überfällig + heute.
  - **Demnächst**: die nächsten 7 Tage, zum Vorausplanen.
  - **Wartet**: alles mit einem Datum später, also vollständig. Damit lässt sich prüfen,
    dass nichts verloren geht.
  - **Aufräumen**: Altbestand (§4.5). Der Reiter verschwindet, sobald er leer ist.
- **Quellen-Filter:** Alle · Termine · Rückrufe · Recycling. **Personenachse** wie heute in
  der Terminliste: `mein` als Vorgabe, `alle` nur für Owner mit Team-Sicht.
- **Kopfzahlen** wie in der Übersicht des HubSpot Sales Workspace. „Heute erledigt“ kommt aus
  dem Protokoll und ist bewusst sichtbar: Es ist die einzige Zahl, die beim Abarbeiten steigt.
- **Gruppe „Ergebnis fehlt“:** Termine, deren Zeitpunkt vorbei ist und die kein Ergebnis
  tragen. Sie stehen getrennt, weil die Handlung eine andere ist (eintragen statt nerven).
  Diese Gruppe schließt nebenbei die Erfassungslücke aus dem Live-Test vom 26.11. (13 von 20
  Closings ohne Ergebnis).
- **Gold heißt künftig „fällig“** (Datum ≤ heute), nicht mehr „heute noch nicht gestempelt“.
  Die Farbe bleibt `DRAN_TONE`.

### 4.2 Die drei Quellen und ihr Fälligkeitsdatum

Es gibt **keine neue Datumsspalte.** Jede Quelle hat ihr Fälligkeitsdatum schon:

| Quelle | Wer gehört hinein | „Nächster Kontakt am“ | Körnung |
|---|---|---|---|
| **Termin** (Setting/Closing) | Abgeleiteter Zustand `offen` · `no_show` · `show` (`terminZustand()`, unverändert), dazu Closing im Status `nachfassen` | **`follow_up_due`** (date, auf beiden Tabellen vorhanden, heute schon in Detailseiten und Dossier). Ist es `null`, gilt der Vorgang als **sofort fällig** und trägt den Hinweis „kein nächster Schritt“. | Tag |
| **Rückruf** | `phone_leads.status='rueckruf'` | `callback_at` | **Minute** (verabredete Uhrzeit, bleibt wie in `isOverdue(…, "moment")`) |
| **Recycling** | Was `recycle_tasks()` liefert (vier Ursprünge, Status-Riegel unverändert) | `next_recycle_at` | Tag |

`follow_up_due` bekommt damit wieder eine steuernde Bedeutung. Das ist der eine Punkt, an dem
`data-model.md` umgeschrieben werden muss (§1, der Warnkasten „`follow_up_due` steuert keine
Arbeitsliste mehr“).

Rückrufe und Termine mit unterschiedlicher Körnung stehen in **einer** Liste. Das hat R4
seinerzeit verhindert. Gelöst wird es über die Anzeige: Ein Rückruf zeigt die Uhrzeit
(„heute 10:30“) und wird ab der Minute golden. Ein Termin zeigt den Tag. Sortiert wird nach
Fälligkeit, ein Rückruf mit Uhrzeit vor 10:30 steht also vor den Tagesaufgaben. Die zwei
Begriffe stehen in verschiedenen Chips, nicht in derselben Spalte.

### 4.3 Kontakt eintragen: das Herzstück

Ein Klick auf **„Kontakt eintragen“** öffnet ein kleines Popover ohne Seitenwechsel:

```
Ergebnis:   (●) Nicht erreicht   ( ) Erreicht / Antwort
Kanal:      Anruf · WhatsApp · Mail · LinkedIn · SMS     (optional, merkt sich die letzte Wahl)
Nächster Kontakt:  [Morgen] [2 Tage] [1 Woche] [📅 Datum]   ← Vorschlag vorbelegt
Notiz:      ______________________                     (optional)
                                              [Speichern]  (Enter)
```

- **Vorschlag für den nächsten Kontakt**, eine Konstante, keine Einstellung:
  - Nicht erreicht → **nächster Werktag**
  - Erreicht, ohne Termin → **in 3 Werktagen**
  - Wochenenden werden übersprungen.
- **Ein Speichern schreibt in einem Zug:**
  1. Ein Protokolleintrag (§5).
  2. Das Fälligkeitsdatum der Quelle: `follow_up_due` bzw. `next_recycle_at`; bei einem
     Rückruf ein neues `callback_at`.
  3. Den bestehenden Stempel `follow_up_last_contacted_at`/`_by_user_id` weiter mit, damit
     Dossier und Termin-Mails unverändert funktionieren.
  4. Beim Recycling zusätzlich `recycle_attempt()` (der Deckel bleibt wirksam).
- **Rückrufe** benutzen statt des Popovers die vorhandenen Ergebnis-Knöpfe des Call-Modus
  (Termin / Rückruf / Nicht erreicht / Kein Termin / Dead). Sie protokollieren bereits in
  `phone_call_attempts`; ein zweites Protokoll für dieselbe Anwahl gäbe doppelte Zahlen.
- **Rückgängig** wie heute auf `/nachfassen` (Toast mit „Rückgängig“, `undoNachfassenTask`
  wird erweitert).
- Die drei weiteren Knöpfe gibt es schon und sie werden nur umgehängt:
  - **Termin** → `setNeuerTermin` (Termin) bzw. `reviveDropout` (Recycling)
  - **Aufgeben** → `markTerminDead` (das löst `schedule_recycle()` aus, der Lead kommt nach
    der Wartezeit von selbst wieder)
  - **Details** → `LeadDossierSheet`

  Jede dieser Handlungen schreibt ebenfalls einen Protokolleintrag mit der passenden `folge`,
  damit der Verlauf lückenlos ist.

### 4.4 „Versuch 4“ und der Vorschlag zum Aufgeben

- Der Versuchszähler je Vorgang zählt die Einträge mit `ergebnis='nicht_erreicht'` **seit dem
  letzten `erreicht`** bzw. seit Eintritt in die Arbeitsmenge. Er wird gerechnet, nicht
  gespeichert.
- Ab **5 Versuchen in Folge ohne Erreichen** (Konstante `AUFGEBEN_AB_VERSUCHEN`, analog
  `NICHT_ERREICHT_LIMIT`) zeigt die Zeile den Hinweis „5× nicht erreicht. Aufgeben? Kommt in
  X Tagen über das Recycling wieder“, mit Ein-Klick-Knopf.
- **Es ist ein Vorschlag, keine Automatik.** Nichts verschwindet ohne Klick. Das ist die
  Grenze zu „Intervall-Logik“: Die App rät nur, der Mensch entscheidet.

### 4.5 Aufräumen: der Altbestand beim Start

- **Altfall** heißt: Der Vorgang ist zum Stichtag `NACHFASSEN_START` (Konstante = Tag des
  Livegangs) fällig, sein letztes Lebenszeichen (Termin, Stempel oder Rückruf-Zeitpunkt) liegt
  mehr als **14 Tage** vor dem Stichtag, **und** seit dem Stichtag hat ihn niemand angefasst.
  Das wird abgeleitet, keine Spalte. Sobald jemand handelt, ist er kein Altfall mehr.
- Altfälle stehen **nur** im Reiter „Aufräumen“, nicht in „Fällig“. Damit startet der erste
  Tag mit einer realistischen Liste.
- Je Zeile und als **Sammelaktion** (Häkchen + „Ausgewählte …“):
  - **Nochmal versuchen**: Fällig heute oder an einem gewählten Datum. Der Vorgang wandert
    nach „Fällig“.
  - **Aufgeben**: tot, Recycling plant die Wiedervorlage.
  - **Sperren**: Sperrliste, nie wieder.
- Der Reiter zeigt einen Fortschritt („noch 108 von 108“) und verschwindet, wenn er leer ist.
  **Dass das kein versteckter Altersschnitt ist:** Altfälle sind sichtbar und gezählt, und
  der Reiter verlangt eine Entscheidung. Weggefiltert wird nichts.
- Rückrufe, die mehr als 14 Tage überfällig sind, laufen genauso durch das Aufräumen.

### 4.6 Wann ein Vorgang von selbst fällig wird

| Ereignis | Neues Verhalten | Heute |
|---|---|---|
| No-Show eingetragen (Setting/Closing) | `follow_up_due = heute` | +1 Tag |
| Abgesagt mit Aussicht „neuer Termin“ | `follow_up_due = heute` | — (wird über den Zustand sofort golden) |
| Termin vorbei ohne Ergebnis | Gruppe „Ergebnis fehlt“, ab dem Folgetag | Zustand `offen`, golden |
| Erschienen ohne Ergebnis (`show`) | `follow_up_due = nächster Werktag` | golden |
| Closing → Status „Nachfassen“ | Datum Pflicht wie heute (`follow_up_due`) | unverändert |
| Neuer Termin gelegt | Raus aus dem Eingang (Zustand `verlegt`), `follow_up_due = null` | unverändert |
| Tot / verloren | Raus, `schedule_recycle()` plant die Wiedervorlage | unverändert |
| Recycling-Datum erreicht | Erscheint als Recycling-Eintrag „heute“ | eigene Seite, gleich |

### 4.7 Was mit `/termine` passiert

Die Terminliste wird wieder eine **Terminliste**. Es gibt danach keine zweite Definition von
„du bist dran“.

- Ausschnitt **„Zu tun“** entfällt → `?zeit=zu_tun` leitet nach `/nachfassen` um.
- Reiter **„Rückrufe“** entfällt → `?view=rueckruf` leitet nach `/nachfassen?quelle=rueckruf`
  um.
- Bleiben: Liste mit **Erinnerung Setting · Erinnerung Closing · Alle**, sowie der Kalender.
  Die zwei Termin-Erinnerungen (1 Tag / 1 Stunde vorher) bleiben dort, weil sie eine andere
  Frage beantworten: „Bekommt jeder seine Erinnerung?“
- Vorgabe-Ansicht von `/termine` wird „Erinnerung“ oder der Kalender (Detailfrage O3).

---

## 5. Datenmodell

**Eine Migration** (Nummer: die nächste freie. Auf `main` liegt 0047, 0048 ist im
Live-Test-Plan vom 26.11. vorgesehen, also voraussichtlich **0049**). Rein additiv.

### 5.1 Neue Tabelle `nachfass_kontakte`

```sql
create table public.nachfass_kontakte (
  id                  uuid primary key default gen_random_uuid(),
  -- Genau EIN Bezug (CHECK unten). Echte FKs statt polymorpher entity_id,
  -- on delete cascade — Muster reminder_touches / termin_mails.
  setting_call_id     uuid references public.setting_calls(id) on delete cascade,
  closing_call_id     uuid references public.closing_calls(id) on delete cascade,
  contact_id          uuid references public.contacts(id)      on delete cascade,
  phone_lead_id       uuid references public.phone_leads(id)   on delete cascade,
  quelle              text not null check (quelle in ('termin','recycling')),
  ergebnis            text not null check (ergebnis in ('nicht_erreicht','erreicht')),
  folge               text not null default 'naechster_kontakt'
                      check (folge in ('naechster_kontakt','termin','aufgegeben','gesperrt','ergebnis')),
  kanal               text check (kanal in ('anruf','whatsapp','mail','linkedin','sms','sonstiges')),
  notiz               text,
  naechster_kontakt_am date,           -- Snapshot: was beim Klick gesetzt wurde
  created_by_user_id  uuid references auth.users(id) on delete set null,  -- AUDIT
  created_at          timestamptz not null default now(),
  check (num_nonnulls(setting_call_id, closing_call_id, contact_id, phone_lead_id) = 1)
);
create index on public.nachfass_kontakte (setting_call_id, created_at desc);
create index on public.nachfass_kontakte (closing_call_id, created_at desc);
create index on public.nachfass_kontakte (contact_id, created_at desc);
create index on public.nachfass_kontakte (phone_lead_id, created_at desc);
create index on public.nachfass_kontakte (created_by_user_id, created_at desc); -- „Heute erledigt“, Analyse
```

Die Entwurfsentscheidungen dahinter:

- **Kein `workspace_id`**, wie bei `termin_mails` (0045). Die Zeile folgt ihrem Eltern-Vorgang
  über den FK. Damit müssen Nutzer-Umzug und Löschvorschau (0036) **nicht** angefasst werden,
  und die `pg_constraint`-Invariante aus §8 bleibt grün, weil kein neuer FK auf `workspaces`
  zeigt.
- **RLS über den Eltern-Vorgang:** `select`/`insert` nur, wenn der Aufrufer die Elternzeile
  sehen darf (`exists (select 1 from setting_calls where id = setting_call_id)`, unter RLS des
  Aufrufers; dasselbe für die drei anderen FKs). Plattform-Admin über die Eltern-Policies.
  **Kein** `update`/`delete` für `authenticated`. Rückgängig läuft über eine Server Action mit
  Besitzprüfung (eigener Eintrag, jünger als 10 Minuten).
- **`created_by_user_id` ist Audit** in der Bedeutung von `created_by_user_id` an Terminen:
  `access.user.id`, nie die Datensicht. Die Personenachse bleibt die Zuweisung (§2).
- **Rückrufe protokollieren weiter in `phone_call_attempts`.** Deshalb kennt `quelle` keinen
  Wert `rueckruf`.
- **Kein Backfill.** Leer heißt „gab es damals noch nicht“ (Muster 0028/0033). Der Stempel
  aus 0041 bleibt als denormalisierter „letzter Kontakt“ bestehen.

### 5.2 Keine weiteren Schema-Änderungen

- `follow_up_due` (beide Termin-Tabellen), `callback_at` und `next_recycle_at` existieren.
- `schedule_recycle()` / `recycle_attempt()` / `recycle_tasks()` bleiben eingefroren und
  unverändert.
- Verifikationsblock am Dateiende:
  - CHECK „genau ein Bezug“ greift (Probe mit zwei FKs muss scheitern, mit `returning` und
    in `begin … rollback`).
  - Ein `insert` als fremdes Mitglied muss scheitern.
  - Es zeigt kein neuer FK auf `workspaces`.

---

## 6. Module

| # | Modul | Dateien | Inhalt |
|---|---|---|---|
| M1 | **Regel-Bibliothek** (rein, testbar) | `src/lib/nachfassRegel.ts` (neu) | Typ `NachfassEintrag` (Quelle, Fälligkeit, Körnung, Gruppe `ergebnis_fehlt`/`nachfassen`/`aufraeumen`, Versuche, letzter Kontakt). Funktionen: `faelligkeitVon()`, `gruppeVon()`, `istAltfall(e, NACHFASSEN_START)`, `versucheInFolge(kontakte)`, `vorschlagNaechsterKontakt(ergebnis, today)` mit Werktagslogik in Berliner Kalendertagen, Sortierung. Nutzt `terminZustand()` und `isOverdue()` und baut sie nicht nach. Dazu `tests/nachfassRegel.test.ts`. |
| M2 | **Migration** | `supabase/migrations/2026040400004X_nachfass_kontakte.sql` | §5, mit Verifikationsblock. Einspielen **vor** dem Deploy (Muster 0029). Zu früh ist folgenlos. |
| M3 | **Loader** | `src/lib/nachfassenData.ts` (neu), ersetzt `getNachfassenTasks()` | Drei Abfragen über `fetchAllRows`: Termin-Kandidaten (Status-Vorfilter, Zustand in JS), Rückrufe, `recycle_tasks()`. Dazu eine Abfrage auf `nachfass_kontakte` für die geladenen IDs (Versuche, letzter Eintrag) und Profile für die Namen. Personenschnitt wie die Terminliste (`erinnererOf`) bzw. Listen-Owner. Memoisiert per React `cache()` für Seite **und** Badge. |
| M4 | **Server Actions** | `src/app/actions/nachfassKontakt.ts` (neu) | `kontaktEintragen()` (§4.3, ein Durchlauf, fail-closed: Scheitert das Datum, wird der Eintrag zurückgenommen), `aufgeben()`, `sperren()`, `sammelAktion(ids, aktion)` für das Aufräumen, `rueckgaengig()`. Bestehende Actions werden wiederverwendet (`setNeuerTermin`, `markTerminDead`, `reviveDropout`, `excludeFromRecycle`, `markRecycleContacted`). |
| M5 | **Board** | `src/components/nachfassen/NachfassenBoard.tsx` (Neubau), `KontaktPopover.tsx`, `AufraeumenListe.tsx` | §4.1–4.5. Tastatur: `j`/`k` Zeile, `e` eintragen, `t` Termin, `Enter` speichern. |
| M6 | **Auslöser** | `actions/settingCalls.ts`, `actions/closingCalls.ts`, `actions/appointments.ts` (Absage) | Die Tabelle in §4.6: No-Show und Absage „neuer Termin“ setzen `follow_up_due = heute`. Erschienen ohne Ergebnis setzt den nächsten Werktag. |
| M7 | **Terminliste bereinigen** | `components/termine/viewState.ts`, `TermineList.tsx`, `termine/page.tsx` | §4.7: `zu_tun` und `rueckruf` entfernen samt Umleitungen. `istZuTun`/`istTerminDran` in `dranRegel.ts` aufräumen. Die Gold-Regel der LinkedIn-Liste (`istKontaktDran`) bleibt unberührt. |
| M8 | **Navigations-Zähler** | `src/lib/navCounts.ts`, `navCountsData.ts` | Liest **denselben** Loader wie die Seite. Badge = überfällig + heute, ohne Aufräumen. Bindungspflicht aus §5.4 bleibt: Das Badge zählt nie etwas anderes als die Seite. Frist 1,5 s und `null`-Regel unverändert. Die Quicklink-Kachel „Termine“ verliert ihren Arbeitslisten-Charakter, „Nachfassen“ rückt nach vorn. |
| M9 | **Dossier** | `src/lib/leadDossier.ts`, `actions/leadDossier.ts` | Jeder Protokolleintrag wird ein Ereignis „Nachgefasst · nicht erreicht · Anruf“ in der Zeitleiste. Der Hinweis „frühere Kontakte hält die App nicht fest“ entfällt für Kontakte ab dem Livegang. |
| M10 | **Auswertung** (Welle 2) | `components/analyse/…`, `lib/analyseData.ts` | Übersicht-Tab, Sektion „Wird konsequent nachgefasst?“: Kontakte je Person und Woche, Anteil der am Fälligkeitstag erledigten Einträge, Erreichquote je Versuch (1., 2., 3. …), Termine aus Nachfassen. Loader mit `available`-Rückfall. |
| M11 | **Abarbeiten-Modus** (Welle 2) | `components/nachfassen/AbarbeitenModus.tsx` | Ein Lead groß, mit Kontaktwegen, letzter Notiz und Verlauf. Nach dem Speichern springt die Ansicht zum nächsten Lead (das „Start queue“ von HubSpot). |
| M12 | **Doku** | `docs/data-model.md` (§1, §3, §5.4, §5.5, §6), `ENTSCHEIDUNGEN.md` | Neue Tabelle, die neue Bedeutung von `follow_up_due`, die neue Quelle des Badges, eine Arbeitsliste statt zwei. SQL-Nachbau des Eingangs für Auswertungen. |

---

## 7. Reihenfolge und Rollout

**Voraussetzungen:**

- `feat/termin-mails` ist gemergt; dort ist `dranRegel.ts` uncommittet geändert, ein Konflikt
  wäre sicher.
- Die P1-Fixes aus dem Live-Test sind durch.
- Gebaut wird auf einem eigenen Branch von `main`.

**Welle 1 (Kern, sichtbar ab Tag 1):**

1. M1 Regel-Bibliothek + Tests
2. M2 Migration schreiben → **einspielen** → Verifikationsblock fahren (ganze Datei, nichts
   markieren, §7 in `data-model.md`)
3. M3 Loader, M4 Actions
4. M5 Board inkl. **Aufräumen** (gehört zwingend zu Welle 1, sonst ist der erste Tag eine
   160er-Liste)
5. M6 Auslöser, M7 Terminliste, M8 Badge
6. M12 Doku
7. Deploy. `NACHFASSEN_START` = Deploy-Tag.
8. **Erster Arbeitstag:** jede Person räumt ihren Altbestand ab (geschätzt 30–60 Minuten bei
   rund 160 Zeilen mit Sammelaktion).

**Welle 2 (nach ~2 Wochen Nutzung):** M9 Dossier, M11 Abarbeiten-Modus, M10 Auswertung,
Feinjustierung der Konstanten (Vorschläge, `AUFGEBEN_AB_VERSUCHEN`) anhand echter
Protokolldaten.

**Erfolgskriterien** (nach 4 Wochen, aus `nachfass_kontakte` messbar, was heute nicht geht):

- Pro Person und Arbeitstag ≥ 1 Protokolleintrag (heute: 1 Stempel in 7 Tagen, über alle
  Organisationen).
- „Überfällig“ bleibt dauerhaft unter etwa 10 je Person.
- Rückrufe > 14 Tage überfällig: 0.
- Recycling-Versuche je Woche > 0.

---

## 8. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Der Geschäftspartner sieht darin die Kaskade zurückkommen | Abgrenzung in §3 vorlegen. Kein Text, keine Stufe, keine Automatik, weniger Seiten als heute. Die Zahlen in §1 zeigen, dass die flache Regel nicht genutzt wird. |
| Das Datum wird nicht gepflegt, alles bleibt „sofort fällig“ | Der Vorschlag ist vorbelegt, Speichern ist ein Klick bzw. `Enter`. Der Zustand „kein nächster Schritt“ ist sichtbar markiert (Pipedrive-Prinzip). |
| Zwei Definitionen von „dran“ (Eingang vs. Terminliste) | M7 entfernt „Zu tun“ aus der Terminliste. Es gibt danach genau eine Arbeitsliste. |
| Badge und Seite laufen auseinander | Ein Loader, `cache()`, dieselben Schnitte. Ein Test sichert, dass der Badge-Pfad keine eigene Abfrage baut. |
| Layout-Kosten: Der Badge lädt mehr als heute | Die Mengen liegen im Hunderter-Bereich, gemeinsam memoisiert. Die Frist von 1,5 s bleibt. Wird es zu langsam, kommt eine Zähl-RPC, aber erst mit Messung. |
| `follow_up_due`-Altwerte (z. B. +7 Tage bei unqualifiziert) | Unqualifizierte sind nicht in der Arbeitsmenge (Zustand `nicht_qualifiziert`), ihr Altwert wirkt also nicht. Altwerte von No-Shows landen über `istAltfall` im Aufräumen. |
| Das Recycling füllt den Eingang schlagartig, wenn viele Fristen an einem Tag ablaufen | Recycling-Einträge sind ein eigener Quellen-Filter. Zurzeit sind 0 fällig; die Spitzen lassen sich über `next_recycle_at` vorab messen (SQL in M12). |

---

## 9. Offene Detailfragen (nicht blockierend, Empfehlung jeweils zuerst)

| # | Frage | Empfehlung |
|---|---|---|
| O1 | Telefon „Kein Termin“ (rund 2.400 Leads) bekommt heute **kein** Recycling-Datum (0033, Status-Riegel `dead`). Sollen sie nach X Tagen über das Recycling wieder in den Eingang? | Vorerst nein. Braucht eine neue Fassung von `schedule_recycle()`/`recycle_tasks()` (Migration) und vergrößert den Eingang stark. Nach Welle 2 anhand der Wiederbelebungsquote entscheiden. |
| O2 | Recycling-Anruf bei einem Telefon-Lead: zusätzlich eine Anwahl in `phone_call_attempts` schreiben? | Ja, bei Kanal = Anruf. Es ist ein echter Wählversuch, sonst fehlt er in „Anwahlen“. |
| O3 | Vorgabe-Ansicht von `/termine` nach dem Umbau: Kalender oder „Erinnerung“? | Kalender (Woche). Die Frage „wen muss ich nerven“ beantwortet ab jetzt `/nachfassen`. |
| O4 | Soll `/nachfassen` die Startseite nach dem Login werden? | Nein, Dashboard bleibt. Die Quicklink-Kachel „Nachfassen“ mit Badge steht an erster Stelle. |
| O5 | `AUFGEBEN_AB_VERSUCHEN` = 5? | Mit 5 starten, nach Welle 1 an der Erreichquote je Versuch prüfen. |
| O6 | Termin-Erinnerungen (1 Tag / 1 Stunde vorher) zusätzlich im Eingang? | Nein. Im Titan-Workspace laufen sie als Mail, sonst über Termine → Erinnerung. Im Eingang würden sie jeden Termin zweimal am Tag hineinholen. |
