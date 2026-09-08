# Zielplan — Nachfassen, Erinnerungs-Kaskade, Recycling und gesonderte Listen

Repo `D:\Tracking\trackingsoftware`, Branch `feature/erinnerungs-kaskade` (Commit `b145b35`), Stand 2026-09-08.
Grundlage: IST-STAND (8 schwere, 27 mittlere, 28 kleine Lücken), KONZEPT-Rekonstruktion (94 Knoten, 64 Kanten),
**vierzehn** Auftraggeber-Entscheidungen (11 Phase 1 + 3 Phase 2, `ENTSCHEIDUNGEN.md`), **dreizehn**
Entscheidungen zu den offenen Punkten der Plan-Kritik (`KRITIK-offene-punkte.md`) und `docs/data-model.md` §1–§8.

**Gerüst und Herkunft.** Die Jury steht 1:1:1. Deshalb wird nicht ein Entwurf übernommen, sondern die
jeweils belegte Stärke:

- **Fachmodell (Kaskaden + Ketten + „keine Antwort"-Verzweigung) aus Entwurf „konzepttreu".** Er ist der
  einzige, der die vier `keine Antwort`-Pfeile des Diagramms als Daten führt und der einzige, der den
  Konzeptsatz „abhängig vom Kanal … per WhatsApp oder LinkedIn" gegen den Code prüft.
- **Struktur und Rollout aus Entwurf „risiko".** Echte Fremdschlüssel statt polymorpher `entity_id`,
  Invarianten als CHECKs, EINE Diff-Funktion statt elf Auslösestellen, `schemaProbe`, `anchor` +
  nicht-negative Offsets, `onboarding_at`, Mail-Betreff als eigener Vorlagenschlüssel, und das
  Verifikationsfenster (Migration vor dem Merge).
- **Mandantenschicht aus Entwurf „mandanten".** Kein Seeding von Texten, `can_manage_org_settings()`,
  Vorlagen-Auflösung gegen den **Absender** statt den Betrachter, die gesonderten Listen als
  RPC-Sicht statt als Parallel-Tabelle, Absage-Modell mit `cancel_outlook`, und die Regel, Abweichungen
  von bindenden Vorgaben ausdrücklich zu benennen.

Fünf Entscheidungen sind gegen mindestens einen Entwurf gefallen und in §3/§5 einzeln begründet:
Verschiebe-Zähler zählt den expliziten Lead-Anlass (nicht den Kalender-Drag), `assigned_user_id` bleibt
nullable mit Insert-Trigger, `followup_templates` wird nicht gedroppt, Pflichtfeld-Trigger kommen nach
dem Deploy, und die neun Verlustgrund-Wartezeiten bleiben bestehen (Entscheidung E8 wörtlich).

---

## 0. Getroffene Entscheidungen

Dieser Abschnitt ist die **Referenz beim Umsetzen**. Jede Zeile ist bindend; wo ein Modul davon abweicht,
muss es das ausdrücklich sagen. Kürzel: **E** = `ENTSCHEIDUNGEN.md` Phase 1, **P** = `ENTSCHEIDUNGEN.md`
Phase 2, **K** = Entscheidung zu einem offenen Punkt der Plan-Kritik.

### 0.1 Die 27 Entscheidungen

| # | Thema | Entscheidung | Wirkt in |
|---|---|---|---|
| **E1** | Vorlagen-Ebene | Org-Default plus persönliche Übersteuerung je Nutzer, Fallback auf den Org-Default (Vorbild `followup_templates`, 0011). | M2, M13 |
| **E2** | Umfang der Übersteuerung | **Alle** Nachrichtenarten: Termin-Erinnerungen, No-Show, Nachfassen, alle vier Recycling-Texte und LinkedIn FU1–FU3. | M1, M2, M13 |
| **E3** | Migrationen | 0031/0032 werden **direkt umgebaut**, nicht durch Korrektur-Migrationen ergänzt — sie sind nirgends eingespielt. | M0, M2–M4 |
| **E4** | Versand | Bleibt manuell: fertiger Text, Kopieren, Erledigt-Häkchen. Kein Auto-Versand über WhatsApp oder LinkedIn. | M10, M14 |
| **E5** | Kaskaden-Konfiguration | Getrennte Kaskaden mit je eigenen Stufen, Offsets und Texten statt eines Offset-Tripels für alles. | M3, M13 |
| **E6** | Verschieben | Ab der 3. Verschiebung eine Warnung, die aktiv bestätigt werden muss, plus Vorschlag „auf die gesonderte Liste (abgesagt ohne Aussicht)". | M6 |
| **E7** | Gesonderte Listen | Eigener Navigationsbereich mit je einer Ansicht: Abgesagt ohne Aussicht · Disqualifiziert · Kein Close · No-Show ohne Antwort. | M11 |
| **E8** | Recycling-Fristen | Konzept-Fristen als Default (Disqualifiziert 8 Wochen, Kein Close 4 Wochen); die feinere Staffelung je Verlustgrund **bleibt** und übersteuert den Default. | M9 |
| **E9** | No-Show-Ende | Ein eingetragener Ersatztermin startet die volle Kaskade automatisch neu. | M6, M7 |
| **E10** | Telefonnummer Qualifiziert→Closing | Pflichtfeld mit begründeter Ausnahme: ohne Nummer kein Closing, außer aktiv „will keine Nummer rausgeben" → LinkedIn als Fallback. | M8 |
| **E11** | Altlasten | Alle acht als „Hoch" eingestuften Lücken (H1–H8) werden im selben Zug behoben. | M5, M9, M10, M12, M13, M20 |
| **P12** | Mail-Spur | **Vertagt auf Phase 2.** Der Kern enthält sie nicht; das Datenmodell muss sie ohne Umbau andocken lassen. Bauplan liegt separat vor (`MODUL-mailversand.md`, 15 Arbeitspakete, 4–6 Wochen). | §7, M21 |
| **P13** | Zeitsteuerung | `pg_cron` in Supabase, **nicht** Vercel Cron (keine Tarif-Abhängigkeit). Für den Kern voraussichtlich nicht nötig — Fälligkeiten sind beim Seitenaufruf berechenbar; als Fundament für Phase 2 einplanen. | §7, M21 |
| **P14** | Einwilligung | „Wir brauchen kein Opt-In." Bewusst gegen den Befund entschieden; betrifft ausschließlich Phase 2. Risiko: LG Köln 81 O 88/21 stuft Terminbestätigung und -erinnerung als Werbung nach § 7 Abs. 2 Nr. 2 UWG ein — es trägt die Kundenorganisation als Versender. | §7 |
| **K1** | Kaskaden-Abbruch bei Antwort | **Findet nicht statt.** Keine Abbruchlogik, alle Stufen bleiben fällig. Gelöst wird stattdessen das UI-Problem: `/erinnerungen` gruppiert **nach Termin** statt nach Touch — eine Karte je Termin, die Stufen als Zeitleiste darin, plus Sammelaktion „ganze Kaskade abhaken". | M10 (§5.2) |
| **K2** | Absage mit Aussicht | Fünfte Ablage-Ansicht **„Abgesagt — Ersatztermin ausstehend"** (`cancel_outlook='neuer_termin'`). | M11 (§5.3) |
| **K3** | Kontaktfrequenz | Keine harte Unterdrückung. **Weiche Warnung** auf der Karte, wenn für denselben Lead in den letzten Tagen bereits ein `done_at` existiert (feste Konstante, nicht konfigurierbar). Die **Termin-Kaskade ist ausgenommen** — drei Kontakte in drei Tagen sind dort gewollt. Die Anzeige „zuletzt kontaktiert vor X Tagen" kommt mit dem Lead-Dossier (M15, zweite Welle). | M10, M11, M15, M16 |
| **K4** | Zeitzone | Bleibt fest `Europe/Berlin`. **Keine** Zeitzonen-Spalte, auch nicht vorsorglich. Die Beschränkung wird als **Produktgrenze** („nur DACH") in `docs/data-model.md` §6 festgeschrieben. | M3, M23, §10 |
| **K5** | Absagen in Kennzahlen | Der **Funnel-Tab** schließt Termine mit `cancelled_at is not null` aus; Übersicht, Kalender und „Termine im Zeitraum" behalten sie. Zusätzlich neue Kennzahl **„Absagequote"**. | M6 (Filter), M20, M23 |
| **K6** | Umfang | **Kern = M0–M14** plus die Rollout-Module M17, M19, M22. Zweite Welle = M15, M16, M18, M20, M23. Phase 2 = M21. **M13 wurde nachträglich in den Kern gezogen**, damit E1/E2 („pro Nutzer bearbeitbar") mit dem Kern tatsächlich eingelöst ist und nicht nur im Schema steht. Der Schnitt ist mit Aufwandssumme je Block auszuweisen (§0.2). | §0.2, §5, §8 |
| **K7** | *(entfällt)* | Ausdrücklich **nicht** Teil dieses Plans und in ihm auch nicht zu behandeln. | — |
| **K8** | Abwesenheit und Absender | **Mehrfachauswahl mit Umzuweisung** (`setAssignee`) in `/erinnerungen` plus **Personenfilter** in der Team-Ansicht. Die Karte weist aus, über welches Konto geschrieben werden muss („über LinkedIn-Konto von X"), und warnt, wenn Listen-Owner und zugewiesene Person auseinanderfallen. **Kein** Vertretungsfeld, **kein** neues Schema. | M10, M14 |
| **K9** | Kanalspezifische Texte | Es bleibt bei **einem** Text je Kaskadenstufe für alle Kanäle. **Keine** `channel`-Spalte in `message_templates`, auch nicht vorsorglich. | §4, §10 |
| **K10** | Rückweg aus der Ablage | „Zurückholen" legt einen **neuen Vorgang** an; die alte Zeile bleibt terminal, damit vergangene Kennzahlen unverändert bleiben. Kontaktverbote (`recycle_excluded_at`) werden **immer org-weit** angezeigt, unabhängig von der Datensicht — als eigene Sektion „Gesperrte Leads". | M11 (§5.3) |
| **K11** | Kurzfristige und vergangene Termine | Verhalten bleibt (nur Stufen mit Fälligkeit in der Zukunft entstehen), aber das Kaskaden-Panel **begründet entfallene Stufen im Klartext**. Passt keine Stufe mehr, entsteht ein einzelner **sofort fälliger Bestätigungs-Touch**. Kein Stauchen. | M3, M14 |
| **K12** | Nebenläufigkeit | `recycle_attempt_count` wird **serverseitig atomar** hochgezählt (`count = count + 1` im SQL-Update, kein Lesen-Rechnen-Schreiben). `done_by_user_id` erscheint auf der Karte, nach dem Erledigen wird revalidiert. **Kein** Optimistic Locking. | M9, M10 |
| **K13** | Closing verschieben | **Eine gemeinsame Action** `postponeAppointment(entityType, id, …)` für `setting_calls` und `closing_calls`; die unterschiedlichen Zeitspalten (`appointment_at` vs. `call_at`) werden intern aufgelöst. M6 nennt die betroffenen Closing-Aufrufpfade namentlich. | M6 |

### 0.2 Umfangsschnitt und Aufwand (Entscheidung K6)

Aufwandsskala, damit die Summen nachrechenbar sind: **S = 1–2 PT · M = 3–5 PT · L = 6–10 PT ·
XL = 12–18 PT**, 1 Personenwoche = 5 Personentage. Die Spannen sind Umsetzungszeit inklusive
Selbsttest, ohne Abstimmungsschleifen.

| Block | Module | Was danach steht | Aufwand |
|---|---|---|---|
| **Kern** | M0 bis M14 · dazu die drei Rollout-Module M17, M19, M22 (siehe Hinweis) | Das Diagramm des Auftraggebers ist vollständig als Daten abgebildet **und** auf dem Bildschirm sichtbar: Kaskaden und Ketten laufen, Verschieben/Absagen/Disqualifizieren sind erfasst, die Ablage steht, das Kaskaden-Panel sitzt in beiden Editoren, ein fehlendes Schema sieht nicht mehr aus wie „nichts fällig". Owner und Nutzer pflegen ihre Texte selbst (M13). Die acht Hoch-Lücken sind zu, bis auf H6 (Auswertung). | **84–137 PT ≈ 17–27 Personenwochen** |
| **Zweite Welle** | M15, M16, M18, M20, M23 | Lead-Dossier, `/nachfassen` v2, Navigation mit Badges, die gesamte Auswertung inkl. Absagequote und Recycling-Kennzahlen, die nachgezogene Doku. | **16–27 PT ≈ 3–6 Personenwochen** |
| **Phase 2** | M21 (Mail-Spur) | Automatischer Erinnerungs-Mailversand nach `MODUL-mailversand.md` (15 Arbeitspakete), Zeitsteuerung über `pg_cron`. Das Datenmodell des Kerns trägt sie bereits; es fällt **kein** Umbau an. | **4–6 Personenwochen** (Fremdschätzung aus `MODUL-mailversand.md`) |
| | | **Summe** | **24–39 Personenwochen** |

**Hinweis zu M17, M19 und M22.** Die Entscheidung K6 nennt sie in keinem der drei Blöcke. Sie werden
dem **Kern** zugeschlagen, weil der Kern ohne sie nicht auslieferbar ist, und das wird hier ausdrücklich
als Auslegung markiert:

- **M17** (Migration 0034, Mandanten-Lifecycle) legt `pipeline_settings` und die `cascade_steps` je
  Organisation an. Ohne sie hat eine **neue** Kundenorganisation keine Kaskade — der Kern funktioniert
  dann für Bestandskunden und für niemanden sonst.
- **M19** (Tests) läuft laut Plan ohnehin **modulbegleitend ab M1** und ist kein eigener Zeitblock am Ende.
- **M22** (Migration 0035, Pflichtfeld-Trigger) ist der Nachlauf von M6 und besteht aus zwei Triggern.

### 0.3 Drei Spannungen, die aus dem Umfangsschnitt folgen — offen benannt

Sie sind kein Einwand gegen K6, aber sie müssen vor dem Start bekannt sein, weil sie zwischen
Kern-Deploy und zweiter Welle **sichtbar** werden:

1. ~~**E1/E2 sind im Kern vorhanden, aber nicht bedienbar.**~~ **Aufgelöst.** Diese Spannung war der
   Grund, M13 nachträglich in den Kern zu ziehen (K6): die persönliche Übersteuerung lebt in
   `message_templates` (M2) und in der Auflösungskette (M1), und die Oberfläche dazu (M13) steht
   jetzt im selben Block. Damit ist E1/E2 mit dem Kern eingelöst statt erst mit der zweiten Welle.
   Preis: der Kern wächst um 12–18 PT.
2. **K5 und K6 kollidieren in der Reihenfolge.** Absagen werden im **Kern** erfasst (M6), aus dem
   Funnel ausgeschlossen werden sie erst in **M20 (zweite Welle)**. Dazwischen sinkt jede
   Durchlassquote des Trichters, ohne dass sich am Vertrieb etwas geändert hat — genau der
   Zahlensprung, vor dem `docs/data-model.md` §5 warnt. **Auflösung:** M6 liefert den einzeiligen
   Filter `cancelled_at is null` im Funnel-Tab als Vorab-Teil von M20 mit (in M6 eingepreist,
   +1–2 PT); Absagequote, Doku und die übrigen Auswertungen bleiben in der zweiten Welle.
3. **M23 (Doku) in der zweiten Welle trifft eine verbindliche Datei.** `docs/data-model.md` wird von
   `CLAUDE.md` geladen und ist Grundlage jeder MCP-Auswertung; nach dem Kern ist sie an rund einem
   Dutzend Stellen falsch. **Auflösung:** ein **Doku-Delta** ist Teil des Kerns und läuft in MS8 mit
   (§7 Migrationsliste, §3 neue Tabellen und Spalten, §8 neue Invarianten, §6 der Absatz zur
   Produktgrenze aus K4 — zusammen ca. 1 PT, in M17 eingepreist). Die vollständige Überarbeitung von
   §1, §4 und §5 bleibt M23.

---

## 1. Zielbild in zehn Sätzen

1. Jeder Setting- und Closing-Termin trägt sichtbar seine eigene Nachrichten-Kaskade — drei Stufen mit
   drei **verschiedenen** Texten (T-3 Tage / T-1 Tag / T-1 Stunde), fertig gerendert, mit aufgelöstem Kanal
   und Begründung, direkt oben im Termin-Layout statt versteckt auf einer zweiten Seite.
2. Der Nachrichtenkanal folgt dem Akquise-Kanal des Leads, wie das Konzept es zeichnet: WhatsApp, wenn
   Nummer und dokumentierte Einwilligung vorliegen, sonst LinkedIn — und wenn nichts ableitbar ist, wählt
   der Nutzer auf der Karte, statt einen Badge „Kanal frei wählen" ohne Auswahlmöglichkeit zu lesen.
3. Beim Übergang Qualifiziert→Closing sammelt die App zwingend eine Telefonnummer ein; wer sie nicht
   herausgeben will, wird als begründete Ausnahme dokumentiert und fällt auf LinkedIn zurück — ein
   Closing ohne einen der beiden Zustände gibt es nicht mehr.
4. No-Show und „kein Close" sind zweistufige Ketten mit echter Verzweigung: Stufe 2 wird nur fällig,
   wenn auf Stufe 1 keine Antwort kam, und „keine Antwort" auf der letzten Stufe legt den Lead
   automatisch auf die gesonderte Liste — „Ziel ist es eine klare Antwort zu erhalten" ist damit ein
   messbarer Zustand statt einer Notiz. Die **Vor-Termin-Kaskade** verzweigt bewusst **nicht** (K1).
5. Verschieben und Absagen sind erfasste Ereignisse: ab der dritten Verschiebung eine Warnung, die aktiv
   bestätigt werden muss, samt Vorschlag „Abgesagt ohne Aussicht"; jede Absage verlangt einen Grundcode,
   und die Gabelung „ohne Aussicht" versus „Ersatztermin ausstehend" entscheidet, in welcher Ablage-Ansicht
   der Lead landet — in **keinem** Fall verschwindet er lautlos.
6. **Fünf** gesonderte Listen (Abgesagt ohne Aussicht · Abgesagt — Ersatztermin ausstehend ·
   Disqualifiziert · Kein Close · No-Show ohne Antwort) liegen als eigener Navigationsbereich vor, jede
   mit erfasstem Grund, Freitext, Wiedervorlage-Datum und Kontaktverbot — abgeleitet aus dem
   Zeilenzustand, nicht als zweite Datenhaltung geführt; dazu die org-weite Sektion „Gesperrte Leads".
7. `/erinnerungen` zeigt **eine Karte je Termin** statt einer Karte je Nachricht: die Stufen als
   Zeitleiste, die fällige hervorgehoben, erledigte eingeklappt, eine Sammelaktion für die ganze Kaskade
   — aus neun Karten werden drei.
8. Jeder Nachfass-Anruf öffnet ein Lead-Dossier über sechs Quellen (Herkunft, Pitch, Anwahlen,
   Qualifizierungsantworten, Einwände, komplette Touch-Historie), damit der Anruf so persönlich wirkt,
   wie das Konzept es rot markiert verlangt (zweite Welle).
9. Alle Nachrichtentexte der App — Erinnerungen, No-Show, Kein-Close, Recycling, Telefon-Rückruf,
   Wiedervorlagen und LinkedIn FU1–FU3 — liegen in **einer** Tabelle mit **einem** Platzhalter-Dialekt und
   einer Vorrangkette Liste → Nutzer → Organisation → Auslieferungstext; jeder Nutzer darf jeden Text für
   sich übersteuern, und jede Karte zeigt, aus welcher Ebene ihr Text stammt.
10. Die acht schweren Lücken sind strukturell geschlossen: Recycling kann bei Wiederbelebung nicht mehr
    stehenbleiben, No-Show-Touches können nicht mehr als Zombies überleben, ein fehlendes Schema sieht
    nicht mehr aus wie „nichts fällig", und Formularfehler verschwinden nicht mehr wortlos.

---

## 2. Soll-Ist-Abgleich (Konzept-Elemente A–G)

| # | Konzept fordert | Heute vorhanden | Lücke | Modul |
|---|---|---|---|---|
| **A-1** | Setting-Eingang: Akquise-Kanal (Telefon/LinkedIn) bestimmt, ob die Nachrichten per **WhatsApp oder LinkedIn** gehen | `resolveCascadeChannel(source_type)` liefert für ein Telefon-Setting `telefon`, für alles außer LinkedIn/Telefon `null` (reminderCascade.ts:63-67) | Der Telefon-Lead bekommt „Anruf" statt WhatsApp — der Konzeptsatz ist unerfüllt und wurde bisher als erfüllt behandelt. Quellen ohne Vorlaufkanal haben gar keinen Kanal und keine Auswahl | **M4**, **M10** |
| **A-2** | Closing-Eingang: **IMMER** Telefonnummer einsammeln; Edge-Case „will keine Nummer" → LinkedIn als Fallback | `wa_phone`/`wa_consent_at` existieren als Spalten (0031:29-31), werden aber nirgends erzwungen; `createClosingFromSetting` verlangt nur ein Datum | Kein Pflicht-Gate, kein Feld für die dokumentierte Verweigerung — „Nummer fehlt noch" ist nicht von „will keine geben" unterscheidbar | **M8** |
| **A-3** | Closing-Eingang: **direkt eine WhatsApp-Nachricht im oder nach dem Meeting** | existiert nicht | Kein sofort fälliger Kickoff-Touch, kein Text dafür | **M4** (Kaskade `closing_kickoff`), **M8** |
| **B** | Drei Reminder vor dem Termin, beide Blöcke, mit **drei verschiedenen Texten** („steht noch wie geplant?" / „wird ein cooles Meeting" / „hier ist der Link") | Drei Offsets 72/24/1 h in `reminder_settings`, aber **ein** `template_setting_reminder` für alle drei Stufen (`templateFieldFor`) | Drei Stufen teilen sich einen Text — eine bisher unbemerkte Konzept-Abweichung. Kein `{link}`-Platzhalter, obwohl Reminder 3 wörtlich den Meet-Link schickt. Stufen nicht abschaltbar (CHECK strikt absteigend, 0031:68) | **M2**, **M3**, **M13** |
| **C** | Mail-Spur parallel: Setting T-1d/T-1h, Closing T-2d/T-1d/T-1h; Notiz „automatischer Versand über Google Workspace selbst" | existiert nicht | **Vertagt auf Phase 2 (P12).** Der Kern hält nur die Andockpunkte offen (§7). Die Konzept-Notiz ist zudem technisch nicht erfüllbar — Google Kalender sendet Gästen keine zeitgesteuerten Erinnerungsmails | **M21** (Phase 2) |
| **D-1** | Verschoben: max. 2×, danach „Meldung die aktiv umgangen werden muss" | Kein Zähler; `moveSettingAppointment` (Kalender-Drag) und `rescheduleSetting` (Ersatztermin) verschieben beide wortlos; für das **Closing** existiert gar keine Verschiebe-Action, nur `updateClosingCall` mit `call_at` im Patch | Regel nicht formulierbar, und auf der Closing-Seite fehlt jeder benannte Pfad (K13). Zusatzbefund: Der Kalender-Drag ist eine interne Umplanung und darf **nicht** zählen | **M6** |
| **D-2** | Abgesagt: **Grund MUSS erfasst werden**; „ohne Aussicht" → gesonderte Liste; berechtigter Grund (krank, familiär) → abwägen | Keine Absage im Datenmodell — ein abgesagter Termin bleibt `offen` oder wird `dead` | Kein Grundcode, kein Freitext, keine Gabelung, keine Liste. Der Zweig „mit Aussicht" bekommt eine **eigene** fünfte Ansicht (K2), statt aus allen Listen zu fallen | **M6**, **M11** |
| **E-1** | Setting SHOW → Erstgespräch | `setSettingOutcome` mit `show_status='show'` vorhanden | Nur: die geplanten Touches werden entwertet, kommen aber nach einer Rücknahme nie zurück (M1) | **M5** |
| **E-2** | NO-SHOW → sofort fragen → Nachfassen 1 → **keine Antwort** → Nachfassen 2 (1 Tag nach dem Meeting) → klare Antwort als Ziel → Ablauf von vorne | **Ein** sofortiger Touch (`createNoShowTouch`, reminders.ts:282-347), danach nichts | Zweite Stufe fehlt, die Bedingung „keine Antwort" fehlt, das Ende „klare Antwort erhalten" hat keinen Zustand, der Neustart bei Ersatztermin ist zufällig richtig (rescheduleSetting supersedet alles) | **M7**, **M11**, **M10** |
| **E-3** | DISQUALIFIZIERT → **genauer Grund erfassen** → gesonderte Liste → Nachfassen nach **8 Wochen mit dem damaligen Grund** → Ausnahme „Zusammenarbeit macht keinen Sinn" → nie wieder kontaktieren | `status='unqualifiziert'` ohne Grundfeld; Recycling bekommt nur `dead` ein Datum (settingCalls.ts:132), `unqualifiziert` nie | Grundfeld fehlt, 8-Wochen-Frist fehlt, Liste fehlt, der Grund erreicht den Nachfass-Text nicht, das Kontaktverbot hat nur beim Closing (`falsche_zielgruppe`) ein Pendant — und es ist heute nur für den sichtbar, dem der Lead gehört (K10) | **M6**, **M9**, **M11** |
| **E-4** | QUALIFIZIERT → Nummer einsammeln → WhatsApp direkt → Closing terminiert | siehe A-2/A-3 | siehe A-2/A-3 | **M8** |
| **F-1** | Deal geclosed → „korrekt eintragen: **Deal Größe, Software Onboarding**" | `deal_volume`, `payment_type`, `contract_start`, `signature_received` vorhanden | Kein Onboarding-Feld; zusätzlich bleibt ein gewonnener Deal im Recycling stehen (H1) | **M8**, **M9** |
| **F-2** | KEIN CLOSE → **Grund MUSS erfasst werden** → gesonderte Liste mit detaillierten Informationen → Nachfassen 1 → keine Antwort → Nachfassen 2 (1 Tag danach anrufen + Nachricht) → erneuter Anruf nach **4 Wochen** | `lost_reason_code` (9 Werte, 0029) plus Freitext vorhanden; kein Nachfassen, keine Liste; Recycling-Frist kommt aus der Grund-Staffelung, kein 4-Wochen-Default | Zweistufige Kette fehlt, Liste fehlt, Detail-Ansicht fehlt, Konzept-Frist fehlt als Default | **M7**, **M9**, **M11** |
| **F-3** | Closing NO-SHOW → direkt anrufen → Nachfassen 1 → keine Antwort → Nachfassen 2 → direkt danach Nachricht | ein sofortiger Touch; Rücknahme eines No-Shows entwertet ihn nicht (H3) | wie E-2 | **M5**, **M7** |
| **G-1** | „Dieser Punkt muss im **SETTING** Layout klar ersichtlich sein + die Nachricht + der Leadkanal" | `/erinnerungen` und `SettingCallEditor` wissen nichts voneinander | Der Editor zeigt weder Stufe, noch Text, noch Kanal, noch das Konto, über das geschrieben werden muss (K8) | **M14** |
| **G-2** | dasselbe wörtlich für das **CLOSING** Layout | wie G-1 | wie G-1 | **M14** |
| **G-3** | „SEHR DETAILLIERTE ANSICHT DAMIT DER ANRUF SO PERSÖNLICH WIE MÖGLICH WIRKT" | Recycling-Karte zeigt Name, Firma, Grund-Badge, Versuchszähler | Keine Herkunft, keine Anwahlen, keine Qualifizierungsantworten, keine Historie, kein „zuletzt kontaktiert" (K3) | **M15** (zweite Welle) |
| **E1/E2** | Org-Default + persönliche Übersteuerung für **alle** Nachrichtenarten inkl. LinkedIn FU1–FU3 | Vier Modelle nebeneinander, drei Platzhalter-Dialekte, `followup_templates` ohne Oberfläche (H5) | Keine Nutzer-Ebene für Erinnerungen/Recycling, drei Texte gar nicht editierbar, wirkende Vorlage unsichtbar. Modell im Kern, Bedienbarkeit in der zweiten Welle (§0.3 Punkt 1) | **M1**, **M2**, **M13** |
| **E7/K2** | Gesonderte Listen als eigener Navigationsbereich | existiert nicht | siehe D-2/E-3/F-2/E-2, plus die fünfte Ansicht und die org-weite Sperrliste | **M11** |

---

## 3. Zielschema

Migrationen 0031 und 0032 liegen auf keiner Datenbank (Entscheidung E3) und werden **inhaltlich ersetzt**,
nicht korrigiert. Neuer Schnitt in fünf Dateien, fachlich geordnet:

| Datei | Inhalt |
|---|---|
| `…0031_message_templates.sql` | Vorlagen-Katalog, `message_templates`, `can_manage_org_settings()` |
| `…0032_reminder_cascade.sql` | `pipeline_settings`, `cascade_steps`, `reminder_touches` v2, Termin-Lebenszyklus-Spalten, `apply_reminder_touches()` |
| `…0033_lead_recycling.sql` | Recycling-Spalten + CHECKs auf vier Tabellen, `schedule_recycle()`, `recycle_attempt()`, `recycle_tasks` v2, `dropout_lists()` |
| `…0034_tenant_lifecycle.sql` | `seed_workspace_defaults()`, Anbindung an `bootstrap_workspace`/`platform_create_workspace`, `move_user_scope`, `preview_delete_workspace`, Guard-Trigger, `followup_templates`-Backfill |
| `…0035_pflichtfelder.sql` | **NACH dem Deploy**: die Trigger, die Absage-/Disqualifikationsgrund erzwingen |

### 3.1 Was entfällt

| Objekt | Aktion | Definition | Begründung |
|---|---|---|---|
| `reminder_settings` | **entfällt** | wird in 0032 nicht mehr angelegt | Ein Offset-Tripel je Organisation kann Entscheidung E5 (getrennte Kaskaden mit eigenen Stufen) nicht tragen; der CHECK `offset_1>offset_2>offset_3` (0031:68) macht jede Stufe unabschaltbar (N17). Offsets → `cascade_steps`, Texte → `message_templates`, Rest → `pipeline_settings`. Mit ihr verschwinden M14 (zu lockere RLS) und die Hälfte von M22 |
| `recycle_settings` | **entfällt** | geht in `pipeline_settings` auf; die vier Textspalten wandern nach `message_templates` | Eine Konfigurationszeile je Organisation statt zweier: ein Seeding-Schritt, ein RLS-Paar, eine Settings-Kartengruppe. Für einen Kunden ohne Vorwissen ist das der Unterschied zwischen einem und zwei Bildschirmen |
| `reminder_touches.touch_type` | **entfällt** | ersetzt durch `touch_kind` + `cascade_kind` + `step_no` (s. u.) | `offset_1\|offset_2\|offset_3\|no_show` ist die Aufzählung des alten Modells und kennt weder Mail-Spur noch die zweistufigen Ketten. Nebeneffekt: die dreifach kopierte Konstante `OFFSET_TOUCHES` (N8) hat kein Gegenstück mehr |
| `reminder_touches.entity_id` (polymorph) | **entfällt** | ersetzt durch echte FKs + generierte Spalte (s. u.) | M17: Karteileichen werden unmöglich statt unwahrscheinlich |
| `followup_templates` | **bleibt vorerst** | Backfill nach `message_templates` in 0034; Lesepfade werden umgestellt; die Tabelle bleibt als toter Bestand stehen (Muster `call_assignees`) und wird erst nach verifiziertem Rollout in einer späteren Migration gedroppt | **Bewusste Abweichung von zwei Entwürfen.** Ein `drop table` vor dem Merge trifft das ausgelieferte `main`, das die Tabelle in `nachfassen.ts:114` ohne Fehlerprüfung liest — Nutzer mit eigenen FU-Texten bekämen im Fenster stillschweigend den Standardtext. Genau die Unsichtbarkeit, die M13 beheben soll |
| `DEFAULT_REMINDER_SETTINGS` / `DEFAULT_RECYCLE_SETTINGS` (TS) | **entfallen** | ersetzt durch `DEFAULT_CASCADE_STEPS` (Zahlen) und `TEMPLATE_DEFAULTS` (Texte) als jeweils einzige Quelle | M22: heute duplizieren die TS-Konstanten die SQL-DEFAULTs zeichengenau; eine Änderung nur in der SQL-Datei bliebe wirkungslos |
| „Kanal eingefroren beim Insert" | **entfällt als Verhalten** | `channel` bleibt Snapshot für die Analyse, die Anzeige löst live auf; `channel_locked` merkt eine bewusste Nutzerwahl | M5: nachträglich erfasste Einwilligung ändert heute nichts mehr an bestehenden Touches |
| `pipeline_settings.timezone` | **wird nicht angelegt** | — | **Entscheidung K4.** Die Zone bleibt fest `Europe/Berlin`; eine Spalte „vorsorglich mit Default" wäre eine Konfiguration, die nichts liest und die erste Fehlannahme beim nächsten Lesen produziert. Die Beschränkung wird stattdessen als Produktgrenze dokumentiert (§10, M23) |
| `message_templates.channel` | **wird nicht angelegt** | — | **Entscheidung K9.** Ein Text je Stufe für alle Kanäle. Eine nullable `channel`-Spalte hätte beide Unique-Indizes verlängert und die Vorrangkette um eine Stufe — für eine Unterscheidung, die der Auftraggeber nicht will |
| `pipeline_settings.min_contact_gap_days` | **wird nicht angelegt** | — | **Entscheidung K3.** Die Kontaktfrequenz wird gewarnt, nicht erzwungen; der Schwellwert ist eine Code-Konstante (`CONTACT_GAP_WARN_DAYS`), keine Kundeneinstellung. Eine konfigurierbare Sperre hätte Fälligkeiten verschoben und wäre mit „Reminder 3, eine Stunde vorher" kollidiert |

### 3.2 Neue und geänderte Objekte

| Objekt | Aktion | Definition | Begründung |
|---|---|---|---|
| `template_catalog` | **neu** | `template_key text PK` · `label text nn` · `group_key text nn` (`setting`\|`closing`\|`no_show`\|`kein_close`\|`recycling`\|`linkedin`\|`telefon`\|`mail`) · `placeholders text[] nn` · `sort_order int nn` · `is_mail boolean nn default false`. **Ohne** `body` | Der Katalog liefert Label, Platzhalter-Hilfe und Gruppierung für die Settings-Oberfläche und ist FK-Ziel für `message_templates`. Bewusst **ohne** Textkörper: die Auslieferungstexte stehen ausschließlich in `TEMPLATE_DEFAULTS` (TypeScript), damit eine Textverbesserung jeden Kunden erreicht, der sie nicht selbst überschrieben hat |
| `message_templates` | **neu** | `id uuid PK` · `workspace_id uuid nn → workspaces cascade` · `user_id uuid NULL → auth.users cascade` (NULL = Org-Default) · `template_key text nn → template_catalog` · `subject text` (nur `is_mail`) · `body text nn check (btrim(body) <> '')` · `created_at/updated_at` + `touch_updated_at`-Trigger · `updated_by_user_id`. Zwei partielle Unique-Indizes: `(workspace_id, template_key) where user_id is null` und `(workspace_id, user_id, template_key) where user_id is not null`; Index `(workspace_id, user_id)`. **Keine `channel`-Spalte (K9)** | Entscheidung E1 in einer Tabelle. `workspace_id` steht im persönlichen Unique-Index — `followup_templates` (0011:48) hat nur `unique(user_id, fu_number)`, daran hängt N27. `check (btrim(body) <> '')` schließt M23 auf DB-Ebene. `subject` trägt die Mail-Betreffzeile ohne zweite Tabelle und ist der erste der drei Mail-Andockpunkte (§7) |
| `can_manage_org_settings(p_workspace_id uuid)` | **neu** | `sql, stable, security definer, search_path=public`: `is_platform_admin() or exists (select 1 from workspace_members wm where wm.workspace_id = … and wm.user_id = auth.uid() and wm.role='owner' and coalesce(wm.data_scope,'workspace')='workspace')` | M14 an der Wurzel: heute prüft die App `role='owner' && data_scope='workspace'` (access.ts:146), die RLS nur `role='owner'` — ein Owner mit `data_scope='own'` ist in der UI gesperrt, dürfte per direktem PostgREST-Call aber schreiben. Ein benannter Helfer, den beide Seiten teilen, schließt die Lücke dauerhaft statt einmalig |
| `pipeline_settings` | **neu** | `workspace_id uuid PK → workspaces cascade` · `max_reschedules smallint nn default 2 check 1..5` · `reminder_horizon_days smallint nn default 7 check 1..60` · Recycling-Defaults je Ursprung: `days_default_closing_lost nn default 28`, `days_default_setting_disqualified nn default 56`, `days_default_phone_dead nn default 100`, `days_default_setting_dead nn default 100`, `days_default_linkedin_exhausted nn default 100` · die **neun bestehenden Verlustgrund-Wartezeiten** (`days_timing` 75, `days_preis` 105, `days_kein_bedarf` 105, `days_entscheider` 150, `days_wettbewerb` 270, `days_vertrauen` 270, `days_ghosting_breakup` 14, `days_ghosting` 180, `days_sonstiges` 120), alle `nn check > 0` · `max_attempts smallint nn default 2 check 1..5` · `updated_at` (mit Trigger, N19) · `updated_by_user_id`. **Keine** `timezone`- und keine `min_contact_gap_days`-Spalte (K4, K3) | Entscheidung E8 **wörtlich**: „die Konzept-Fristen werden Default, die feinere Staffelung je Verlustgrund **bleibt bestehen** und übersteuert den Default." Zwei Entwürfe machten die neun Spalten nullable — dann bleibt die Staffelung gerade nicht bestehen. Die Auflösung sitzt stattdessen in `recycleIntervalDays()`: Code-Wert → Ursprungs-Default. Für `falsche_zielgruppe` und `kein_fit` gibt es bewusst keine Spalte (nie Recycling). Die Settings-Karte zeigt die neun Werte hinter „Feinstaffelung je Verlustgrund" zugeklappt, damit ein neuer Kunde drei Zahlen sieht statt vierzehn |
| `cascade_steps` | **neu** | `workspace_id uuid nn → workspaces cascade` · `cascade_kind text nn check in ('setting_msg','setting_mail','closing_msg','closing_mail','followup_msg','closing_kickoff','no_show_setting','no_show_closing','kein_close')` · `step_no smallint nn check 1..5` · `trigger_event text nn check in ('scheduled','created','no_show','no_close')` · `anchor text nn check in ('before_appointment','after_appointment')` · `offset_minutes int nn check (offset_minutes >= 0)` · `requires_no_response boolean nn default false` · `enabled boolean nn default true` · `template_key text nn → template_catalog` · PK `(workspace_id, cascade_kind, step_no)` · CHECK `(trigger_event='scheduled') = (anchor='before_appointment')` | Entscheidung E5: neun Kaskaden mit je eigenen Stufen und Texten statt einem Tripel für alles. **Zeile statt Spalte**, weil die Stufenzahl variiert (Setting-Mail 2, Closing-Mail 3) und eine Stufe abschaltbar sein muss (N17). **Minuten statt Stunden**, damit `T-3 Tage` (4320) und `T-1 Stunde` (60) in einer Einheit liegen. **`anchor` + nicht-negativer Offset statt vorzeichenbehafteter Minuten**: derselbe Ausdrucksumfang, aber eine Erinnerung *nach* dem Termin in einer Vor-Termin-Kaskade ist gar nicht erst formulierbar — die Absicherung sitzt im Constraint, nicht im Editor-Code. **`requires_no_response`** ist wörtlich der Konzept-Pfeil „keine Antwort" zwischen Nachfassen 1 und 2 (viermal im Diagramm) und gilt **ausschließlich** für die Ketten, nie für `*_msg`/`*_mail` (K1). Die Reihenfolge ist **kein** Tabellen-CHECK: sie ist ein zeilenübergreifender Zustand und wird beim Speichern der ganzen Kaskade geprüft, wo die Meldung auch anzeigbar ist (H4) |
| `reminder_touches` | **neu geschnitten** | `id uuid PK` · `workspace_id uuid nn` · `created_by_user_id uuid → auth.users set null` · **`setting_call_id uuid → setting_calls(id) on delete cascade`** · **`closing_call_id uuid → closing_calls(id) on delete cascade`** · `entity_type text nn check in ('setting','closing','closing_followup')` · `entity_id uuid generated always as (coalesce(setting_call_id, closing_call_id)) stored` · CHECKs `(entity_type='setting') = (setting_call_id is not null)` und `(entity_type in ('closing','closing_followup')) = (closing_call_id is not null)` · **`touch_kind text nn check in ('cascade','chain','sofort')`** · `cascade_kind text nn` · `step_no smallint nn check (step_no >= 0)` · `requires_no_response boolean nn default false` · `template_key text nn` (Snapshot) · `assigned_user_id uuid → auth.users **on delete set null**` · `due_at timestamptz nn` · `appointment_at timestamptz nn` · `channel text check in ('linkedin','telefon','whatsapp','mail')` · `channel_locked boolean nn default false` · `outcome text check in ('antwort','keine_antwort','bestaetigt','abgesagt','verschoben')` · `done_note text` · `snoozed_until timestamptz` · `done_at`/`done_by_user_id` · `superseded_at` · `created_at` | Echte FKs statt polymorpher Spalte: ein direkter DB-Delete oder ein vergessener Aufrufpfad nimmt die Touches mit (M17). Die generierte `entity_id` hält Lesepfade und Unique-Index so kurz wie heute. `outcome` macht „Ziel ist es eine klare Antwort zu erhalten" zu einem Zustand und ist der einzige saubere Auslöser für die Liste „No-Show ohne Antwort". **`touch_kind='sofort'`** ist der Ersatz-Touch aus K11 (Termin zu kurzfristig für jede Stufe) und trägt `step_no = 0`. `template_key` als Snapshot, damit eine später umbenannte Stufe die Historie nicht rückwirkend umschreibt (Präzedenzfall `phone_call_attempts.owner_name`, docs §3) |
| `reminder_touches.outcome` bei `touch_kind='cascade'` | **dokumentiert, ohne Wirkung** | Ein gesetztes `outcome` auf einer Vor-Termin-Stufe wird gespeichert und angezeigt, **entwertet aber keine Folgestufe** | **Entscheidung K1.** Es gibt bewusst keine Abbruchlogik: eine Bestätigung auf Stufe 1 lässt Stufe 2 und 3 fällig werden, weil der Konzepttext von Reminder 3 („wollte dir noch einmal den Link durchschicken") auch nach einer Zusage gilt. Das dadurch entstehende Mengenproblem löst die Gruppierung nach Termin in `/erinnerungen` (§5.2), nicht das Datenmodell |
| `reminder_touches.assigned_user_id` | **Pflicht per Trigger, nicht per NOT NULL** | Spalte bleibt nullable mit `on delete set null`; BEFORE-INSERT-Trigger `reminder_touches_require_assignee` wirft bei NULL; zusätzlich Guard-Trigger `reminder_touches_assignee_guard` (before insert or update of `assigned_user_id`, `workspace_id`), der wirft bzw. supersedet, wenn die Person kein `workspace_members`-Eintrag derselben Organisation ist | **Bewusste Abweichung von zwei Entwürfen.** `NOT NULL references auth.users(id)` ohne ON-DELETE-Regel bricht die Nutzerverwaltung: `deleteUser` (workspace.ts:218) ruft `auth.admin.deleteUser()` direkt und räumt nichts vor; das ganze Repo hängt an `on delete set null` (0028:37/40 setzt `assigned_user_id` genau deshalb nullable). `on delete cascade` wäre die Alternative und löschte die Erledigungs-Historie, die `superseded_at` bewusst aufhebt. Der Trigger erzwingt die Invariante dort, wo sie zählt — bei der Erzeugung — und lässt das nachträgliche Nullen zu (M15) |
| Indizes auf `reminder_touches` | **neu/geändert** | Unique `(entity_type, entity_id, cascade_kind, step_no) where superseded_at is null` · `(workspace_id, assigned_user_id, due_at) where superseded_at is null and done_at is null` · `(entity_type, entity_id) where superseded_at is null` · `(workspace_id, cascade_kind, due_at)` | Der alte Unique-Index kennt keine Kaskade — mit Nachrichten- **und** Mail-Spur auf demselben Termin kollidierte Stufe 1 der einen mit Stufe 1 der anderen. Der `sofort`-Touch liegt mit `step_no = 0` kollisionsfrei daneben. Der zweite Index deckt die Hauptabfrage von `/erinnerungen` ab, die heute kein Index trägt (N15); er trägt auch die nach Termin gruppierte Sicht (§5.2), weil dort dieselbe Zeilenmenge geladen und erst in JS gruppiert wird |
| Konsistenz-CHECKs auf `reminder_touches` | **neu** | `(done_at is null) = (done_by_user_id is null)` · `superseded_at is null or done_at is null or done_at <= superseded_at` · `touch_kind='cascade' → due_at <= appointment_at` — **`touch_kind='sofort'` ist davon ausgenommen**, weil sein `due_at` der Erzeugungszeitpunkt ist und der Termin bereits näher liegen darf als jede Stufe (K11) | N16 |
| `setting_calls` / `closing_calls`: Absage | **neu** | `cancelled_at timestamptz` · `cancel_reason_code text check in ('kein_neuer_termin','krank','familiaer','beruflich','preis','sonstiges')` · `cancel_reason text` · `cancel_outlook text check in ('ohne_aussicht','neuer_termin')` · CHECK `(cancelled_at is null) = (cancel_outlook is null)` · CHECK `cancelled_at is null or cancel_reason_code is not null` **(erst in 0035)** | Konzept D: „Grund der Absage muss erfasst werden!" steht **vor** der Gabelung — der Grund wird in beiden Zweigen erfasst, nicht nur bei „ohne Aussicht". Code = Statistik, Freitext = Gedächtnis (Muster 0029). **Kein neuer `status`-Wert**: `status` speist Show-Quote, Quali-Quote, Trichter, `terminMeta.outlineFor` und die Vergleichsseite (docs §5) — ein sechster Wert zwänge jede dieser Definitionen zu einer Entscheidung, während eigene Felder einen abgesagten Termin mit `show_status is null` korrekt aus dem Show-Quoten-Nenner fallen lassen. **Beide Zweige haben eine Ablage-Ansicht** (K2), keiner fällt aus der Oberfläche |
| `setting_calls` / `closing_calls`: Verschieben | **neu** | `reschedule_count integer nn default 0 check >= 0` · `last_reschedule_at timestamptz` | Entscheidung E6. Gezählt wird **ausschließlich** der explizite Pfad „Lead hat verschoben" (`postponeAppointment`, für **beide** Tabellen dieselbe Action — K13), **nie** der Kalender-Drag und **nie** der Ersatztermin nach No-Show (Entscheidung E9: frischer Anlauf). Ein Entwurf hatte das exakt invertiert und hätte die interne Umplanung des Verkäufers gezählt |
| `setting_calls` / `closing_calls`: No-Show-Ende | **neu** | `no_show_resolution text check in ('antwort','ohne_antwort','ersatztermin')` · CHECK `no_show_resolution is null or show_status='no_show'` | Konzept E/F enden bei „Ziel ist es eine klare Antwort zu erhalten". Ohne dieses Feld ist die fünfte gesonderte Liste nicht ausdrückbar und Entscheidung E9 hinterlässt keine Spur |
| `setting_calls` / `closing_calls`: Rückholung | **neu** | Auf der **alten** Zeile: `revived_at timestamptz`. Auf der **neuen** Zeile (immer ein `setting_calls`-Eintrag): `revived_from_setting_call_id uuid → setting_calls(id) on delete set null` · `revived_from_closing_call_id uuid → closing_calls(id) on delete set null` · CHECK, dass höchstens eine der beiden gesetzt ist | **Entscheidung K10.** „Zurückholen" legt einen **neuen Vorgang** an, statt die terminale Zeile umzuschalten: ein von `verloren` auf `offen` gedrehtes Closing veränderte rückwirkend die Win-Rate eines abgeschlossenen Zeitraums — genau das, was docs §5 verbietet. Echte FKs statt einer polymorphen Referenz, aus demselben Grund wie bei `reminder_touches`. `revived_at` nullt zugleich `next_recycle_at` und wird zum vierten Filter in `recycle_tasks`, damit ein zurückgeholter Lead nicht doppelt in der Wiedervorlage steht |
| `setting_calls`: Disqualifikation | **neu** | `disqualify_reason_code text check in ('geld','kein_budget','kein_bedarf','falscher_zeitpunkt','kein_entscheider','falsche_zielgruppe','keine_zusammenarbeit','sonstiges')` · `disqualify_reason text` · Pflicht bei `status='unqualifiziert'` **als Trigger in 0035**, nicht als CHECK | Konzept E: „Der genaue Grund muss erfasst werden". `keine_zusammenarbeit` ist die rote Notiz „kein weiteres kontaktieren!" und setzt beim Speichern `recycle_excluded_at`. **Trigger statt CHECK**, weil ein CHECK jedes UPDATE auf Bestandszeilen mit `status='unqualifiziert'` blockierte (dieselbe Falle wie bei den `source_type`-Altwerten, docs §4) — und **in 0035 nach dem Deploy**, weil die laufende Produktion in `setSettingOutcome` genau dieses Update heute ohne Grundcode schreibt |
| `setting_calls.wa_phone` / `.wa_consent_at` / `.wa_refused_at` | **neu** | wie 0031, plus `wa_refused_at timestamptz` · CHECK `wa_refused_at is null or wa_phone is null` · CHECK `wa_consent_at is null or wa_phone is not null` | Entscheidung E10: „will keine Nummer rausgeben" ist eine dokumentierte Ausnahme, kein leeres Feld. Nur so kann der Kanal bewusst auf LinkedIn fallen, statt eine Erfassungslücke nicht von einer Verweigerung unterscheiden zu können (Konzept Bereich 4: „somit brauchen wir LinkedIn als Fallback!") |
| `closing_calls.onboarding_at` | **neu** | `date`, nullable | Konzept F nennt beim gewonnenen Deal ausdrücklich „Deal Größe / Software Onboarding". Die Deal-Größe existiert, das Onboarding-Datum nicht. Bewusst ein Datumsfeld plus Häkchen, keine Onboarding-Strecke |
| `closing_calls.follow_up_due_at` | **unverändert** | wie 0031 | trägt die Nachfass-Kaskade; App-seitig mit `follow_up_due` synchron (`withFollowUpDateSynced`) |
| `closing_calls.lost_reason_code` | **geändert** | CHECK um `kein_fit` erweitert | Closing-Pendant zu „Zusammenarbeit macht keinen Sinn"; zweiter Code neben `falsche_zielgruppe`, der nie ein Recycling-Datum bekommt. Rein additiv, Bestandszeilen bleiben gültig |
| Recycling-Spalten auf `contacts`/`phone_leads`/`setting_calls`/`closing_calls` | **neu, gehärtet** | `next_recycle_at date` · `recycle_attempt_count integer nn default 0 check >= 0` · `recycle_excluded_at timestamptz` · **neu** `recycle_last_contacted_at timestamptz` · **neu** `recycle_responded_at timestamptz` · **neu** `recycle_reason_code text` (Snapshot) · CHECK `recycle_excluded_at is null or next_recycle_at is null` · auf `closing_calls` zusätzlich CHECK `lost_reason_code not in ('falsche_zielgruppe','kein_fit') or next_recycle_at is null` · partieller Index `(workspace_id, next_recycle_at) where next_recycle_at is not null` | M16: die beiden Recycling-Invarianten aus docs §8 werden strukturell unverletzbar statt nur nachprüfbar. `recycle_responded_at` fehlt heute komplett — ohne diesen Zeitstempel gibt es keine Wiederbelebungsquote und damit keine Grundlage, die org-weiten Wartezeiten begründet zu ändern (M20). `recycle_last_contacted_at` ist zugleich die zweite Quelle der Kontaktfrequenz-Warnung aus K3, neben `reminder_touches.done_at`. `recycle_reason_code` als Snapshot behebt N7 (heute kommt der Grund vom Client) |
| `apply_reminder_touches(p_workspace_id, p_entity_type, p_entity_id, p_cascade_kind, p_rows jsonb)` | **neu** | `plpgsql, security definer, search_path=public`; supersedet in **einem** Funktionskörper alle aktiven Touches der Kombination und fügt danach `p_rows` ein; `grant execute to authenticated`; prüft die Org-Zugehörigkeit selbst | M8: heute sind Supersede und Insert zwei Statements gegen einen partiellen Unique-Index. Zwei dicht aufeinanderfolgende Auslöser (Reschedule + Outcome) lassen den ganzen Array-Insert scheitern, fail-soft heißt `console.error` — und der Termin steht ohne Kaskade da. Mit zwei Kaskaden je Termin wird das Fenster größer. Behebt zugleich N5 (Supersede ohne `workspace_id`-Filter) |
| `schedule_recycle(p_workspace_id, p_origin, p_entity_id, p_today date)` | **neu** | `plpgsql, security definer`; liest **Grund und Status serverseitig aus der Ursprungszeile**, respektiert `recycle_excluded_at` und `revived_at`, **verändert `recycle_attempt_count` nicht** (das tut nur `recycle_attempt()`), liest die Wartezeit aus `pipeline_settings` (Grund-Wert → Ursprungs-Default) | M3 (Zähler-Reset bei jedem Aufruf, Ausschluss ignoriert, recycle.ts:120) und N7 (Grund vom Client, jede Wartezeit auslösbar) verschwinden gemeinsam, sobald weder Grund noch Zählerlogik über die Aufrufstelle laufen |
| `recycle_attempt(p_workspace_id, p_origin, p_entity_id, p_today date)` | **neu** | `plpgsql, security definer`; **ein** Statement je Ursprungstabelle: `update … set recycle_attempt_count = recycle_attempt_count + 1, recycle_last_contacted_at = now(), next_recycle_at = case when recycle_attempt_count + 1 >= (select max_attempts …) then null else … end where id = … and workspace_id = … returning recycle_attempt_count` | **Entscheidung K12.** Der Zähler wird serverseitig atomar erhöht, statt gelesen, gerechnet und zurückgeschrieben zu werden (heutiges `markRecycleContacted`, recycle.ts:154-184). Zwei parallele Klicks auf „Nochmal versucht" verbrannten sonst zwei von zwei erlaubten Versuchen. Der `max_attempts`-Deckel wandert damit **in dieselbe Anweisung** wie die Erhöhung und wirkt nicht mehr nur im App-Code |
| `recycle_tasks(uuid, date, uuid)` | **geändert** | Je Zweig ein **Status-Guard**: closing `and cc.status='verloren'` · setting `and (sc.status in ('dead','unqualifiziert') or sc.no_show_resolution='ohne_antwort' or sc.cancel_outlook='ohne_aussicht')` · telefon `and pl.status='dead'` · linkedin `and c.answered is not true and c.appointment_set is not true and c.follow_up_number = 3`. Zusätzlich `recycle_responded_at is null` **und `revived_at is null`** (K10). `owner_name` für setting/closing über `join profiles on user_id = coalesce(assigned_user_id, created_by_user_id)` statt `null::text`. `reason` aus `recycle_reason_code`. Neue Spalten: `reason_note text`, `assigned_user_id uuid`, `last_contacted_at timestamptz` | H1 auf **zwei** Ebenen: der App-Code hält die Daten sauber (`clearRecycle`), die RPC ist der von der App unabhängige Riegel — eine der beiden Sicherungen wird immer irgendwann vergessen. Ohne Guard taucht ein gewonnener Deal Monate später als Recycling-Aufgabe auf (0032:213-250 gegen closingCalls.ts:183-202). N20 fällt mit ab. `reason_note` trägt „mit dem Grund der damaligen Disqualifikation" in den Nachrichtentext, `last_contacted_at` speist die Warnung aus K3 |
| `dropout_lists(p_workspace_id uuid, p_list text, p_effective_user_id uuid default null)` | **neu** | `plpgsql, stable, security definer`, `rpc_effective_user()` als erste Anweisung. `p_list in ('abgesagt','ersatztermin_offen','disqualifiziert','kein_close','no_show_ohne_antwort','gesperrt')`. Rückgabe: `entity_type, entity_id, lead_name, company, owner_name, assigned_user_id, reason_code, reason_text, dropped_at, next_recycle_at, recycle_attempt_count, excluded, revived_at, source_type, reschedule_count, no_show_count`. Bedingungen: abgesagt = `cancel_outlook='ohne_aussicht'` (beide Tabellen) · **ersatztermin_offen = `cancel_outlook='neuer_termin' and revived_at is null`** (beide Tabellen) · disqualifiziert = `setting_calls.status in ('unqualifiziert','dead')` · kein_close = `closing_calls.status='verloren'` · no_show_ohne_antwort = `no_show_resolution='ohne_antwort'` (beide Tabellen) · **gesperrt = `recycle_excluded_at is not null`** über alle vier Recycling-Tabellen. Personenfilter wie `nachfassen_tasks` — **mit genau einer Ausnahme: `p_list='gesperrt'` ignoriert ihn und liefert immer org-weit** | Entscheidung E7 und K2/K10: sechs Ansichten **aus dem vorhandenen Zeilenzustand abgeleitet**, nicht als Parallel-Tabelle. Eine eigene Tabelle wäre eine zweite Wahrheit neben `status`/`cancelled_at` und liefe beim ersten Statuswechsel auseinander — genau der Fehler, den `call_assignees` hinterlassen hat. Die Ausnahme beim Personenfilter ist Absicht und steht so in der Oberfläche: **ein Kontaktverbot, das nur sein Besitzer sieht, ist keines** — die nächste Person spricht den Lead sonst neu an und umgeht die rote Konzept-Notiz „kein weiteres kontaktieren!". Nebeneffekt, der die Ableitung trägt: die Listen sind am Tag 1 **automatisch gefüllt** (verlorene Closings und unqualifizierte Settings existieren bereits) und brauchen keine Erweiterung von `move_user_scope`/`preview_delete_workspace` |
| `seed_workspace_defaults(p_workspace_id uuid)` | **neu** | `plpgsql, security definer`, idempotent (`on conflict do nothing`): legt **eine** `pipeline_settings`-Zeile und die Default-`cascade_steps` an (Mail-Kaskaden mit `enabled=false`). Legt **keine** `message_templates`-Zeile an | Die Struktur muss als Zeilen existieren, weil der Editor Stufen einzeln an-/abschaltet und verschiebt. Die Texte dürfen es nicht: eine geseedete Kopie je Organisation friert den Auslieferungstext ein, erreicht keinen Bestandskunden mehr und macht den Quelle-Badge blind für „nie angefasst" vs. „bewusst geändert" |
| `bootstrap_workspace()` / `platform_create_workspace()` | **geändert** | `create or replace`, Signatur unverändert; beide rufen `perform public.seed_workspace_defaults(wid)` | M22: heute legt keiner der beiden Anlage-Pfade eine Settings-Zeile an. **Beide** anfassen — ein Kunde entsteht über den einen, ein anderer über den anderen |
| `move_user_scope()` / `admin_move_user_to_workspace()` | **geändert** | `create or replace`, Signatur unverändert. Zusätzlich umgestempelt: `message_templates` (`user_id = p_user_id`), `reminder_touches` über die mitziehenden Termin-Ids **und** über `assigned_user_id`. Termin-Besitz künftig über `coalesce(assigned_user_id, created_by_user_id)`. Zurückbleibende Touches werden per `superseded_at` **entwertet**, nicht verwaist gelassen | M18/N23: heute liefert `grep 'reminder\|recycle'` in 0026/0027 null Treffer. Die Umstellung der Besitz-Ermittlung ist Voraussetzung, nicht Beiwerk: ohne sie bliebe ein nur *zugewiesener* Termin zurück und der Guard entwertete sofort dessen Touches. **Verhaltensänderung an Kundendaten** — gehört in die Release-Notiz und in docs §2 |
| `preview_delete_workspace()` / `platform_delete_workspace()` | **geändert** | Vorschau zählt zusätzlich `message_templates`, `cascade_steps`, `reminder_touches`, `pipeline_settings` und das bisher fehlende `phone_call_attempts` | N23: die Vorschau nennt 13 Tabellen, gelöscht wird mehr. Eine Löschvorschau, die weniger nennt als sie löscht, ist gefährlicher als gar keine |
| RLS `pipeline_settings`, `cascade_steps` | **neu** | SELECT für jedes Mitglied; INSERT/UPDATE über `can_manage_org_settings(workspace_id)`; kein DELETE (Reset läuft als UPDATE auf die Seed-Werte, N18 damit als Entscheidung dokumentiert); `*_platform_admin` FOR ALL | siehe `can_manage_org_settings` |
| RLS `message_templates` | **neu** | SELECT: Mitglied **und** (`user_id is null` oder `can_access_owned_workspace_row(workspace_id, user_id)`) · FOR ALL Org-Zeilen: `user_id is null and can_manage_org_settings(workspace_id)` · FOR ALL eigene Zeilen: `user_id = auth.uid()` und Mitgliedschaft · platform_admin FOR ALL. **DELETE-Policy vorhanden** (leeren = löschen = eine Ebene höher fallen) | Der Owner besitzt den Standard, jeder Nutzer besitzt seine Übersteuerung. Fremde persönliche Texte sieht nur, wer sie im Supportfall erklären muss |
| `reminder_touches_ws_guard` | **neu** | before update of `workspace_id`: supersedet Touches, deren Zuständige die neue Org-Grenze nicht mitüberschreitet | Pendant zu `assigned_user_guard` (0028). Superseden statt nullen — eine Erinnerung an einen Termin in einer fremden Organisation ist nicht handelbar |

---

## 4. Vorlagen-Modell

### 4.1 Ein Modell, zwei Ebenen, eine Auflösung

`message_templates` trägt beide Ebenen in derselben Zeilenform: `user_id is null` = **Standard der
Organisation** (der Owner pflegt ihn), `user_id` gesetzt = **persönliche Übersteuerung** (jeder Nutzer
pflegt seine eigene). Zwei partielle Unique-Indizes trennen die Ebenen, ohne zwei Tabellen zu brauchen.
Vorbild ist `followup_templates` (Migration 0011) — mit `workspace_id` im persönlichen Unique-Index, den
das Original nicht hat (N27).

**Vorrangkette — genau eine Implementierung**, `resolveTemplate(key, ctx)` in
`src/lib/messageTemplates.ts`, Rückgabe `{ body, subject, source }`:

1. **Kontext** — `lists.fu1_text` / `fu2_text` / `fu3_text`, **ausschließlich** für die Keys
   `linkedin_fu_1..3` und nur, wenn nicht leer. Bleibt oben, weil dieser Text fachlich zum Pitch-Text
   derselben Liste gehört (docs §4, `followUpTextFor` nachfassen.ts:245-256). Das ist die **einzige**
   Ausnahme von der zweistufigen Kette und wird in der Oberfläche als solche beschriftet.
2. **Persönlich** — `message_templates` mit `user_id = <der Absender>`.
3. **Organisation** — `message_templates` mit `user_id is null`.
4. **Auslieferung** — `TEMPLATE_DEFAULTS[key]` in `src/lib/messageTemplates.ts`, die einzige Fundstelle
   der Standardtexte. Kein SQL-DEFAULT, kein Seeding: eine Zeile entsteht erst, wenn jemand einen Text
   bewusst ändert, und ein geleertes Textarea löscht sie wieder (Muster `setFollowupTemplate`,
   templates.ts:43-50). Damit kann die Doppelung SQL/TS (M22) nicht wieder auseinanderlaufen, und eine
   Textverbesserung wirkt sofort bei jedem Kunden, der den Text nicht selbst angefasst hat.

**Die Kette hat keine Kanal-Stufe (Entscheidung K9).** Ein Text je Stufe gilt für WhatsApp, LinkedIn und
Telefon gleichermaßen; eine `channel`-Spalte in `message_templates` wird auch nicht vorsorglich angelegt.
Wer für einen Kanal anders formulieren will, ändert den Text vor dem Absenden — die Karte ist eine
Kopier-Werkbank, kein Versandsystem (E4).

`source` wird bis in die UI durchgereicht und als Badge angezeigt („Text dieser Liste" / „Deine Vorlage" /
„Standard der Organisation" / „Auslieferungstext"). Damit ist M13 strukturell erledigt: eine wirkende
Vorlage kann nicht mehr unsichtbar sein. **Im Kern** zeigt der Badge zwangsläufig fast immer
„Auslieferungstext" — der Editor, mit dem die anderen drei Ebenen entstehen, ist M13 und damit zweite
Welle (§0.3 Punkt 1).

**Wer ist der Absender.** Nicht der Betrachter, sondern die zuständige Person: auf `/erinnerungen`
`reminder_touches.assigned_user_id` **des Touches**, auf `/nachfassen` und in den gesonderten Listen
`effective_user_id ?? user.id`. `getTemplateBundles(userIds[])` lädt eine `Map<userId, TemplateBundle>`
in **einer** Query (`user_id is null or user_id in (…)`); die Karte rendert gegen das Bundle ihres
Assignees. Heute rendert `ErinnerungenBoard` gegen ein einziges Settings-Objekt — ein Owner in der
Team-Ansicht sähe sonst seine eigenen Texte unter fremden Namen. Davon zu unterscheiden ist der
**Absender-Account** aus K8: über wessen LinkedIn-Konto die Nachricht faktisch rausgehen muss (§5.2).

**Wer darf schreiben.** `setOrgTemplate(key, body)` nur über `can_manage_org_settings` (App und RLS
wörtlich dasselbe Prädikat). `setOwnTemplate(key, body)` für jedes Mitglied, immer auf `auth.uid()` — **nicht**
auf `effective_user_id`, sonst überschreibt ein Owner mit aktiver Datensicht unbemerkt den Text eines
Kollegen (heutiges Verhalten in templates.ts:40). In fremder Organisation verweigert `setOwnTemplate`:
ein Plattform-Admin ist dort kein Mitglied, seine persönliche Zeile wäre heimatlos (dieselbe Begründung
wie „`assigned_user_id` bleibt NULL in fremder Org", docs §2).

### 4.2 Schlüssel-Katalog (~34 Keys)

| Gruppe | Keys |
|---|---|
| Erstgespräch | `setting_msg_1`, `setting_msg_2`, `setting_msg_3` |
| Erstgespräch (Mail) — *Phase 2, `enabled=false`* | `setting_mail_1`, `setting_mail_2` — je mit `subject` |
| Closing | `closing_kickoff`, `closing_msg_1`, `closing_msg_2`, `closing_msg_3` |
| Closing (Mail) — *Phase 2, `enabled=false`* | `closing_mail_1`, `closing_mail_2`, `closing_mail_3` — je mit `subject` |
| Nachfass-Kontakt | `followup_msg_1`, `followup_msg_2`, `followup_msg_3` |
| No-Show | `no_show_setting_1`, `no_show_setting_2`, `no_show_closing_1`, `no_show_closing_2` |
| Kein Close | `kein_close_1`, `kein_close_2` |
| Recycling | `recycle_linkedin`, `recycle_telefon`, `recycle_setting`, `recycle_closing` |
| LinkedIn | `linkedin_fu_1`, `linkedin_fu_2`, `linkedin_fu_3` |
| Aufgaben-Texte | `telefon_rueckruf`, `setting_wiedervorlage`, `closing_wiedervorlage` |

**Die Aufspaltung `setting_msg_1..3` statt eines `template_setting_reminder` ist Konzept-Pflicht, keine
Fleißarbeit.** Heute liefert `templateFieldFor()` für `offset_1/2/3` dasselbe Feld, während das Diagramm
drei unterschiedliche Texte zeigt („steht noch wie geplant?" / „wird ein cooles Meeting morgen um XY Uhr" /
„wollte dir noch einmal den Link durchschicken"). Das ist eine bisher unbemerkte Abweichung vom Konzept.
Die drei Aufgaben-Texte (`telefon_rueckruf`, `setting_wiedervorlage`, `closing_wiedervorlage`) sind heute
hartkodiert in `nachfassen.ts:167-176` und werden damit erstmals editierbar (Lesepfad im Kern über M1,
Editor in M16/M13 der zweiten Welle).

Die fünf `*_mail_*`-Keys stehen von Anfang an im Katalog, werden aber **im Kern weder angeboten noch
gerendert** — sie sind der zweite Mail-Andockpunkt (§7). Ein Key im Katalog ohne Zeile in
`message_templates` kostet nichts; nachträglich eingeführte Keys hingegen zwingen zu einer Migration
mitten in einer laufenden Vorlagen-Pflege.

### 4.3 Ein Platzhalter-Dialekt statt drei (H5)

Registry `PLACEHOLDERS`: `{vorname}` `{nachname}` `{name}` `{firma}` `{datum}` `{uhrzeit}` `{link}`
`{anlass}` `{notiz}` `{kanal}` `{absender}`.

- **`{name}` bleibt als dauerhafter Alias auf `{vorname}`.** Fällt er weg, rendern alle gespeicherten
  `lists.fuN_text` ihren rohen Platzhalter — bei echten Kundendaten sofort sichtbar, ohne Fehlermeldung.
  Das ist ein expliziter Testfall in M19, kein Kommentar.
- **`{link}` ist neu und Konzept-Pflicht**: Reminder 3 lautet wörtlich „wollte dir noch einmal den Link
  durchschicken = meets-link.de".
- **`{notiz}` ist neu**: trägt `cancel_reason` / `disqualify_reason` / `lost_reason` und macht
  „Nachfassen nach 8 Wochen **mit dem Grund** der damaligen Disqualifikation" wörtlich möglich — der Code
  allein wäre „mit der Kategorie".
- **Ersetzt wird case-insensitiv** über eine Lookup-Map; heute bleibt `{Vorname}` wörtlich stehen (M25/N9).
- **Leere optionale Platzhalter kollabieren zum Leerstring**, danach normalisiert der Renderer doppelte
  Leerzeichen und verwaiste Satzzeichen (`" ,"` → `","`, `" von ,"` → `","`). Damit ist N9 („Hallo dir
  von ,") ohne eine neue Vorlagen-Syntax gelöst — ein zusätzlicher `[[ … ]]`-Dialekt (Vorschlag aus einem
  Entwurf) vergrößerte genau die Oberfläche, die dieser Umbau zusammenzieht.
- **Unbekannte Token bleiben unangetastet**; `validateTemplate()` gibt sie zurück, und der Editor zeigt
  sie als Warnung („{Vornmae} kennt die App nicht") statt sie roh zu verschicken.

### 4.4 Was live wirkt und was eingefroren ist

Vorlagen werden bei **jedem** Rendern neu aufgelöst — eine geänderte Vorlage wirkt sofort auf jeden
offenen Touch (heutiges Verhalten, ErinnerungenBoard.tsx:70-78). Der Touch speichert nur den
`template_key`, nie den Text. **Offsets und Wartezeiten** wirken dagegen nur auf künftig erzeugte Touches
(M2) — das bleibt so, wird aber im Kaskaden-Editor als Satz hingeschrieben statt stillschweigend zu
gelten, und der Editor bietet den Knopf „Offene Kaskaden neu berechnen" (M13 — seit dem Nachtrag im Kern).

---

## 5. Module

### 5.1 Der Umfangsschnitt (Entscheidung K6, in der Fassung des Nachtrags)

Der Schnitt steht **vor** der Modulliste, weil er die Liste liest: dieselben 24 Module, drei Blöcke, und
jeder Block ist für sich auslieferbar. Aufwandsskala wie in §0.2 — **S = 1–2 PT · M = 3–5 PT ·
L = 6–10 PT · XL = 12–18 PT**, 1 Personenwoche = 5 Personentage. Die Spannen sind Umsetzungszeit
inklusive Selbsttest, ohne Abstimmungsschleifen.

> **Nachtrag zu K6 (verbindlich, ersetzt den Schnitt aus §0.2):** **M13 (`/settings` v2 + persönliche
> Vorlagen) liegt im Kern**, nicht in der zweiten Welle. Begründung des Auftraggebers: die ausdrückliche
> Anforderung „Nachrichten pro Nutzer bearbeitbar" wäre sonst nach dem Kern zwar im Datenmodell
> vorhanden, aber nicht bedienbar. **Damit ist die Spannung aus §0.3 Punkt 1 aufgelöst — E1 und E2 sind
> mit dem Kern eingelöst, nicht erst mit der zweiten Welle.** Die beiden übrigen Spannungen aus §0.3
> (Absagen im Funnel, Doku) bleiben unverändert bestehen.

| Block | Module | Aufwand | ≈ Personenwochen | Zustand am Ende des Blocks |
|---|---|---|---|---|
| **Kern** | M0 · M1 · M2 · M3 · **M13** · M4 · M5 · M6 · M7 · M8 · M9 · M10 · M11 · M12 · M14 · **M17 · M19 · M22** | **84–137 PT** | **17–27 PW** | Das Diagramm ist vollständig als Daten abgebildet, auf dem Bildschirm sichtbar **und konfigurierbar**. Kaskaden und Ketten laufen, Verschieben/Absagen/Disqualifizieren sind erfasst, die Ablage steht mit sechs Ansichten, das Kaskaden-Panel sitzt oben in beiden Editoren, ein fehlendes Schema sieht nicht mehr aus wie „nichts fällig", und **jeder Nutzer bearbeitet jeden Nachrichtentext für sich (E1/E2)**. H1, H2, H3, H4, H5, H7, H8 sind zu; **nur H6 (Auswertung) bleibt offen**. |
| **Zweite Welle** | M15 · M16 · M18 · M20 · M23 | **16–27 PT** | **3–6 PW** | Lead-Dossier (G-3), `/nachfassen` v2, Navigation mit Badges, die gesamte Auswertung inkl. Absagequote und Recycling-Kennzahlen (H6), nachgezogene Doku. |
| **Phase 2** | M21 | **20–30 PT** | **4–6 PW** | Automatischer Erinnerungs-Mailversand nach `MODUL-mailversand.md`, Zeitsteuerung über `pg_cron`. Fremdschätzung, nicht Teil dieser Kalkulation. |
| | | | **24–39 PW** | **Summe über alle drei Blöcke — unverändert gegenüber §0.2** |

**Wie die Kern-Summe zustande kommt** (damit sie nachrechenbar ist und nicht als Hausnummer gilt):
3 × S (M0, M12, M22) + 7 × M (M1, M3, M5, M8, M14, M17, M19) + 6 × L (M2, M4, M6, M7, M9, M11) +
2 × XL (**M10, M13**) = 84–137 PT. Zweite Welle: 1 × S (M18) + 3 × M (M15, M16, M23) + 1 × L (M20)
= 16–27 PT. Der Nachtrag verschiebt also genau die XL-Spanne von M13 (12–18 PT) vom zweiten Block in den
ersten; die **Gesamtsumme bleibt 24–39 Personenwochen**.

**M10 ist gegenüber jedem Vorentwurf von L auf XL angehoben**, weil K1, K8 und K12 drei Anforderungen in
dieselbe Oberfläche legen (Gruppierung nach Termin, Mehrfachauswahl mit Umzuweisung, Absender-Konto samt
Warnung) — Begründung in §5.2. Der Zusatz aus §0.3 Punkt 2 (der einzeilige Funnel-Filter
`cancelled_at is null` als Vorab-Teil von M20) liegt in M6 und drückt M6 an das obere Ende seiner Spanne,
statt die Summe zu verschieben.

**Drei Module gehören formal in keinen Block und werden dem Kern zugeschlagen** (§0.2, ausdrücklich als
Auslegung markiert): M17, weil eine **neue** Kundenorganisation ohne `seed_workspace_defaults` gar keine
Kaskade hat; M19, weil es modulbegleitend ab M1 läuft und kein Zeitblock am Ende ist; M22, weil es der
Zwei-Trigger-Nachlauf von M6 ist.

**Was der Umfangsschnitt zwischen den Blöcken sichtbar lässt** — die verbliebenen zwei Spannungen aus
§0.3 in einer Zeile: Absagen werden im Kern erfasst, aus dem Funnel erst mit M20 ausgeschlossen (deshalb
der Vorab-Filter in M6) · `docs/data-model.md` ist nach dem Kern an mehreren Stellen falsch (deshalb das
Doku-Delta in M17). Punkt 1 (E1/E2 nicht bedienbar) ist mit dem Nachtrag entfallen.

### 5.1.1 Modultabelle

Jedes Paket ist einzeln abschließbar und testbar. Spalte **Block**: `K` = Kern, `W2` = zweite Welle,
`P2` = Phase 2. Die Tabelle folgt der Modulnummer mit **einer** Ausnahme: **M13 steht direkt hinter M3**,
weil es die Oberfläche zu M2 (`message_templates`) und M3 (`cascade_steps`) ist und in dieser Reihenfolge
gebaut wird — die Nummer bleibt als stabiles Kürzel für Verweise erhalten.

| # | Block | Name | Zweck | Betroffene Dateien | Hängt ab von | Aufwand | Risiko |
|---|---|---|---|---|---|---|---|
| **M0** | K | Bestätigungsmessung, Test-Harness | Der Auftraggeber hat bestätigt, dass 0031 und 0032 auf **keiner** Datenbank eingespielt sind — Entscheidung E3 steht damit nicht mehr unter Vorbehalt. M0 schrumpft auf die **Gegenprobe**: sobald ein `SUPABASE_ACCESS_TOKEN` vorliegt, per MCP `list_tables` protokollieren, dass `reminder_settings`, `reminder_touches`, `recycle_settings`, `recycle_tasks` und die 12 Recycling-Spalten nirgends existieren. Parallel `vitest` + `vite-tsconfig-paths` + `npm test` aufsetzen und `supabase/tests/invarianten.sql` anlegen | MCP; `package.json`; `vitest.config.ts` (neu); `supabase/tests/invarianten.sql` (neu) | — | **S** | Kein Stopp-Kriterium mehr, aber die Messung bleibt Pflicht: sie ist billig, und der einzige Fall, in dem sie etwas findet (jemand hat die Datei manuell im SQL-Editor ausgeführt), wäre sonst erst in MS3 aufgefallen — mitten im Verifikationsfenster |
| **M1** | K | Vorlagen-Kern (Bibliothek) | `TEMPLATE_KEYS`, `TEMPLATE_DEFAULTS`, `PLACEHOLDERS`, `renderTemplate()`, `validateTemplate()`, `resolveTemplate()` — reine TypeScript-Bibliothek ohne DB-Zugriff, sofort mit Tests | `src/lib/messageTemplates.ts` (neu); ersetzt die Render-Teile von `reminderCascade.ts:143-153`, `recycleCadence.ts:174-184` und `followUpTextFor` (`nachfassen.ts:245-256`) | M0 | **M** | `{name}`-Alias ist Pflicht. Der Key-Katalog ist der Vertrag für Deep-Links und Migrationen und darf nie umbenannt werden (Muster `METRICS.key`, docs §5.2) |
| **M2** | K | Migration 0031 — `message_templates` | Katalog, Tabelle, RLS, `can_manage_org_settings()`; Server-Actions `getTemplateBundle(s)`, `setOrgTemplate`, `setOwnTemplate` | `…0031_message_templates.sql`; `src/app/actions/messageTemplates.ts` (neu); `src/app/actions/templates.ts` (umgestellt) | M1 | **L** | Größter Blast-Radius: jeder Nachrichtentext der App läuft danach durch eine Funktion. `followup_templates` wird gelesen und backfilled, **nicht** gedroppt. `getTemplateBundles(userIds[])` lädt in **einer** Query — sonst n+1 auf jeder Board-Seite |
| **M3** | K | Kaskaden-Konfiguration + Fälligkeit | Migration 0032 Teil 1: `pipeline_settings`, `cascade_steps`, Seed-Definition. `computeCascadeDueAts` rechnet über Berliner Wandzeit (`apptTime.ts`) statt reiner Millisekunden und liefert Stufen samt Key statt fester `offset_1..3`. **Entfallene Stufen werden begründet zurückgegeben**, nicht stumm weggelassen (K11) | `…0032_reminder_cascade.sql`; `src/lib/reminderCascade.ts`; `src/lib/apptTime.ts` (Helfer `berlinShiftMinutes`); `src/lib/dates.ts` | M2 | **M** | N2: die DST-Korrektur verschiebt Erwartungen an zwei Wochenenden im Jahr um eine Stunde — erster Testfall in M19. N8: die drei Kopien der Offset-Konstante werden auf eine gezogen. **K11:** Der Rückgabewert trägt `skipped: {step_no, reason}[]`, sonst kann M14 die Begründung nicht anzeigen |
| **M13** | **K** | `/settings` v2 + persönliche Vorlagen | Kaskaden-Editor (Stufen hinzufügen/entfernen/deaktivieren, Offsets als **Zeitschiene** statt nackter Zahlenfelder, Vorschau an einem Beispieltermin, Knopf „Offene Kaskaden neu berechnen"), Vorlagen-Editor (gruppiert, Quelle-Badge, Live-Vorschau mit und ohne Firma, Platzhalter-Prüfung, **Umschalter Organisation/Persönlich** inkl. LinkedIn FU1–FU3), Recycling-Karte mit drei Zahlen und der Feinstaffelung zugeklappt. **Alle Formulare geben Fehler sichtbar zurück** (`useActionState`) | `settings/page.tsx`; `settings/vorlagen/page.tsx` (neu); `CascadeEditor.tsx`, `TemplateEditor.tsx`, `TemplatePreview.tsx` (neu); `reminders.ts:84-94`; `recycle.ts:86-96` | M2, M3 (M9 nur für die Recycling-Karte) | **XL** | **Per Nachtrag zu K6 im Kern** — „Nachrichten pro Nutzer bearbeitbar" ist eine ausdrückliche Anforderung, und ein Modell ohne Oberfläche erfüllt sie nicht. Behebt H4 vollständig, den Rest von H5, M25, M27, N18, N26, N28 und **löst E1/E2 ein**. **Es ersetzt zugleich die beiden toten Formularkarten**, die durch den Wegfall von `reminder_settings`/`recycle_settings` entstünden (§5.4). **Vor dem Umbau** `node_modules/next/dist/docs/01-app` zu Server Actions / Form-Actions / `useActionState` lesen (AGENTS.md). 34 Vorlagen-Keys sind viel für einen Bildschirm — ohne Gruppierung, „Angepasst"-Badge und Filter „nur Abweichungen" wird die Seite unbenutzbar |
| **M4** | K | `reminder_touches` v2 + Kaskaden-Engine | Migration 0032 Teil 2 (neuer Schnitt, FKs, CHECKs, Indizes, Trigger, `apply_reminder_touches`) und der Umbau von `reminders.ts`: neun Kaskaden statt einer, Kanal **live** aufgelöst statt eingefroren, WhatsApp auch für Telefon-Leads, keine Erzeugung ohne zuständige Person, `touch_kind='sofort'` als Ersatz-Touch (K11) | `…0032_reminder_cascade.sql`; `src/app/actions/reminders.ts` | M3 | **L** | Der Insert-Trigger lässt Touches für Termine ohne org-interne Zuständigkeit gar nicht mehr entstehen. Das ist gewollt, muss aber sichtbar sein (M14), sonst ist es ein stiller Ausfall wie heute |
| **M5** | K | Auslöser vereinheitlichen | **Eine** Funktion `syncTouchesAfterAppointmentWrite(before, after)` vergleicht den Vorher/Nachher-Zustand eines Termins und leitet Supersede + Regeneration ab. Die elf verstreuten Auslöser rufen nur noch sie | `reminders.ts`; `settingCalls.ts`; `closingCalls.ts`; `appointments.ts`; `phone.ts`; `contacts.ts`; `assignees.ts` | M4 | **M** | Behebt H2, H3, M1, M4, M5, M7, M26, N21, N22 gemeinsam und macht die Fehlerklasse wiederholungssicher. Der Vorher-Zustand muss **vor** dem Update gelesen werden — `updateSettingCall` tut das heute gar nicht |
| **M6** | K | Verschieben, Absagen, Disqualifizieren | Migration 0032 Teil 3 (Lebenszyklus-Spalten). **Eine gemeinsame Action `postponeAppointment(entityType, id, …)` für beide Tabellen** (K13): sie löst `appointment_at` (Setting) gegen `call_at` (Closing) intern auf und lehnt ab der 3. Verschiebung ohne `{confirmed:true}` **serverseitig** ab, mit Vorschlag „Abgesagt ohne Aussicht". Dazu `cancelAppointment` (Pflicht-Grundcode + Gabelung `ohne_aussicht`/`neuer_termin`) und `disqualifySetting` (Pflicht-Grundcode, `keine_zusammenarbeit` setzt sofort `recycle_excluded_at`). **Mitgeliefert:** der einzeilige Filter `cancelled_at is null` im Funnel-Tab (§0.3 Punkt 2) | `…0032_reminder_cascade.sql`; `settingCalls.ts`; `closingCalls.ts`; `SettingCallEditor.tsx`; `ClosingCallEditor.tsx`; `TermineBoard.tsx`; `FunnelTab.tsx`; `src/lib/cancellation.ts` (neu) | M5 | **L** (oberes Ende) | **Die Closing-Seite hat heute keinen benannten Verschiebe-Pfad** — die beiden Stellen, die künftig `postponeAppointment('closing', …)` rufen müssen, heißen namentlich: (1) `updateClosingCall` mit `call_at` im Patch (`closingCalls.ts`), (2) der **Kalender-Drag in `TermineBoard.tsx`** (Closing-Zweig). **Der Zähler zählt nur den expliziten Lead-Anlass:** Der Kalender-Drag (`moveSettingAppointment`, einziger Aufrufer `TermineBoard.tsx:160`, und sein Closing-Pendant) zählt **nie**, der Ersatztermin nach No-Show (E9) auch nicht — beides ist interne Umplanung. Der Dialog fragt „Wer hat verschoben?" und nennt die Daten der bisherigen Verschiebungen |
| **M7** | K | Ketten: No-Show und Kein Close | Die zweistufigen Konzept-Ketten als echte Kaskaden mit `trigger_event`, `anchor='after_appointment'` und `requires_no_response`. Stufe 1 sofort, Stufe 2 einen Tag nach dem Meeting und **nur bei ausgebliebener Antwort**. „Antwort erhalten" beendet die Kette, „Keine Antwort" auf der letzten Stufe setzt `no_show_resolution='ohne_antwort'` und speist `dropout_lists` | `reminders.ts`; `settingCalls.ts`; `closingCalls.ts`; `src/components/erinnerungen/*` | M4, M6 | **L** | `requires_no_response` macht Fälligkeit zustandsabhängig und gilt **ausschließlich** hier, nie für `*_msg`/`*_mail` (K1). Wird `outcome` nicht gepflegt, füllt sich `/erinnerungen` mit Karteileichen — die Karte trägt deshalb **zwei gleichwertige Knöpfe** („Antwort erhalten" / „Keine Antwort"), kein Häkchen mit Zusatzoption |
| **M8** | K | Übergang Qualifiziert→Closing + Gewonnen-Erfassung | Ein Dialog sammelt Closing-Termin, WhatsApp-Nummer und dokumentierte Einwilligung; `createClosingFromSetting` gibt `{needsPhone:true}` zurück (Muster des bestehenden `{needsDate:true}`), „will keine Nummer rausgeben" setzt `wa_refused_at` und schaltet auf LinkedIn. Am Ende steht der fertige Kickoff-Text (`closing_kickoff`). Beim gewonnenen Deal zusätzlich `onboarding_at` | `settingCalls.ts`; `closingCalls.ts`; `SettingCallEditor.tsx:350-395`; `QualifiedHandoffDialog.tsx` (neu); `ClosingCallEditor.tsx` | M4 | **M** | `createClosingFromSetting` ist idempotent und wird auch von „Zum Closing →" ohne Datum aufgerufen (`settingCalls.ts:383-389`) — der neue Pflicht-Zweig darf diesen Auflöse-Pfad nicht blockieren. Serverseitig prüfen, nicht nur im Formular (Server Actions sind per direktem POST erreichbar) |
| **M9** | K | Recycling v2 | Migration 0033: Spalten + CHECKs auf vier Tabellen, `schedule_recycle()`, **`recycle_attempt()` mit atomarem Zähler (K12)**, `recycle_tasks` mit Status-Guards, `dropout_lists()`. App: `clearRecycle()` in **allen** Wiederbelebungspfaden, `markRecycleResponded` hebt den Lead sichtbar zurück in den Funnel, `recycleIntervalDays` mit Ursprungs-Defaults unter der bestehenden Grund-Staffelung (E8) | `…0033_lead_recycling.sql`; `src/app/actions/recycle.ts`; `src/lib/recycleCadence.ts`; Aufrufer in `closingCalls.ts:240`, `settingCalls.ts:132`, `phone.ts:351`, `nachfassen.ts:323`, `contacts.ts:206-215` | M6 | **L** | Behebt H1, M3, M10, M16, N7, N20. **K12 wörtlich:** `recycle_attempt_count` wird im SQL-`update` als `recycle_attempt_count + 1` erhöht, nicht gelesen-gerechnet-geschrieben; der `max_attempts`-Deckel sitzt in derselben Anweisung. **Reihenfolge zwingend:** die Schreibpfade müssen korrigiert sein, **bevor** die CHECKs laufen — sonst scheitert das erste „Verloren". Alle Recycling-Pfade sind fail-soft; ihre Fehlerbehandlung wechselt von `console.error` auf eine sichtbare Meldung |
| **M10** | K | `/erinnerungen` v2 — nach Termin gruppiert | **Ausführlich in §5.2.** Eine Karte je Termin statt je Touch, Stufen als Zeitleiste, Sammelaktion, Mehrfachauswahl mit Umzuweisung, Personenfilter, Absender-Konto, serverseitiges Zeitfenster, Berliner Buckets, Kanal live mit Begründung, Snooze, Deeplink | `erinnerungen/page.tsx`; `ErinnerungenBoard.tsx` (Neuschnitt); `TerminCard.tsx`, `TouchTimeline.tsx`, `BulkAssignBar.tsx` (neu); `reminders.ts:383-466`; `assignees.ts` | M4, M7, M12 | **XL** | Behebt H8, M6, M21, M24, N1, N6, N14, N24, N25 und trägt K1, K3, K8, K12. Der Deeplink (`wa.me?text=…`) ist **kein** Auto-Versand — er öffnet den Client mit vorbefülltem Text. Das muss unmissverständlich sein, sonst kollidiert es mit E4 |
| **M11** | K | Gesonderte Listen `/ablage` | **Ausführlich in §5.3.** Eigener Navigationsbereich mit **sechs** Ansichten (`?liste=abgesagt|ersatztermin-offen|disqualifiziert|kein-close|no-show|gesperrt`) aus `dropout_lists`, je mit Grund-Verteilung, Notiz, Wiedervorlage-Datum, Kontaktverbot und Aktionen | `ablage/[liste]/page.tsx` (neu); `AblageBoard.tsx` (neu); `src/app/actions/ablage.ts` (neu); `src/lib/dispositions.ts` (neu) | M9 | **L** | **Routenname zur Abstimmung:** `/listen` ist von der LinkedIn-Übersicht belegt, `/gesonderte-listen` ist literal aber sperrig — Vorschlag `/ablage` mit dem Sidebar-Label „Gesonderte Listen". Ein späterer Wechsel bricht geteilte Links |
| **M12** | K | Verfügbarkeits-Probe und ehrliche Leerzustände | `schemaProbe.ts` wertet den PostgREST-Fehlercode „Relation existiert nicht" aus (nicht die leere Ergebnismenge) und liefert `{available:false}` statt `[]`; Banner statt grünem „Nichts offen"; Analyse-Blöcke zeigen „—" statt 0, solange kein Touch älter als das Deploy-Datum existieren kann. Auf `/settings` deckt der Banner den Fall „Konfiguration nicht ladbar" ab, den M13 sonst als volle Defaults zeigte | `src/lib/schemaProbe.ts` (neu); `reminders.ts`; `recycle.ts`; `analyseData.ts`; `erinnerungen/page.tsx`; `settings/page.tsx` | M4, M9 | **S** | Behebt H7 und M19. **Steht vor allen Oberflächen-Modulen** — solange „Migration fehlt" wie „nichts fällig" aussieht, ist jeder folgende UI-Test wertlos. M13 baut darauf auf: ein Editor, der bei fehlendem Schema die Seed-Werte anzeigt und lautlos nicht speichert, wäre H7 in neuer Form |
| **M14** | K | Kaskaden-Panel im Setting-/Closing-Layout | **Eine** Komponente, zwei Einbindungen, jeweils **an der Spitze** des Editors (nicht am Ende): nächste fällige Stufe, fertiger Text zum Kopieren, Kanal mit Begründung und Umschalter, konkreter Adressat, Absender-Konto (K8), Erledigt-Knöpfe; darunter die ganze Kaskade als Timeline **inklusive der entfallenen Stufen mit Klartext-Begründung** (K11). Bei fehlender Zuständigkeit ein Banner „Keine zuständige Person — Erinnerungen entstehen erst mit der Zuweisung" samt Zuweisen-Knopf | `src/components/reminders/CascadePanel.tsx` + `CascadeTimeline.tsx` (neu); eingebunden in `SettingCallEditor.tsx:174` und `ClosingCallEditor.tsx` | M10 | **M** | Die roten Konzept-Forderungen G-1/G-2. Beide Editoren sind bereits groß (`ClosingCallEditor` 1101 Zeilen) — an der Spitze eingebunden erfüllt das Panel die Forderung praktisch, am Ende nur formal. **K11:** „Stufe 1 entfällt — Termin liegt in weniger als 3 Tagen" steht als Satz da; passt keine Stufe, steht dort der eine sofort fällige Bestätigungs-Touch mit derselben Begründung |
| **M15** | W2 | Lead-Dossier | `getLeadDossier(entityType, entityId)` sammelt in **einer** parallelen Abfrage: Stammdaten, Herkunft (Liste, `source_detail`, Skript-Arm, Zielgruppe, Pitch-/Erstkontakt-Datum), Anwahlen aus `phone_call_attempts`, Qualifizierung (`script_answers`, `ist_pain`, `warmth`, `soll_ziel`, `has_budget_8k`, `branche`), Einwände, Verschiebe-/No-Show-Zähler, Absage-/Disqualifikationsgrund, komplette Touch-Historie, **„zuletzt kontaktiert vor X Tagen" (K3)**, plus ein Notizfeld. Erreichbar aus `/erinnerungen`, `/nachfassen`, `/ablage` | `src/app/actions/leadDossier.ts` (neu); `src/components/lead/LeadDossierDrawer.tsx` (neu) | M10, M11 | **M** | Die rote Konzept-Forderung G-3. Sechs Quellen — parallel laden, nicht sequenziell (Gegenbeispiel N13). Für Termine vor dem Deploy ist die Historie dünn: leere Blöcke werden als „gab es damals noch nicht" beschriftet, nicht als „0" (Muster `phone_call_attempts`, docs §3). **Die konkrete Zahl hinter der Kontaktfrequenz-Warnung entsteht erst hier** — im Kern warnt die Karte ohne sie (§5.2) |
| **M16** | W2 | `/nachfassen` v2 | Recycling-Karte zeigt Grund **und** Notiz (`reason_note`), Text über die neue Vorlagenkette, „Reagiert" hebt den Lead sichtbar zurück, die drei hartkodierten Beschreibungstexte werden editierbare Vorlagen, Anreicherung parallelisiert (heute bis zu acht sequenzielle Roundtrips), Zeitzonen auf Berlin, Beschriftungen aufs tatsächliche Fünf-Quellen-Bild | `nachfassen.ts:60-240`; `NachfassenBoard.tsx`; `nachfassen/page.tsx:25` | M1, M9 | **M** | Behebt M6, N10, N13. `nachfassen_tasks` bleibt **unverändert** (Signatur seit 0028) — die Union entsteht weiter in JS; ein geänderter `RETURNS TABLE`-Typ verlangte `DROP FUNCTION` |
| **M17** | K | Mandanten-Lifecycle + Doku-Delta | Migration 0034: `seed_workspace_defaults`, Anbindung an **beide** Anlage-Pfade, Backfill über alle bestehenden Workspaces, `move_user_scope`/`admin_move_user_to_workspace`, `preview_delete_workspace`/`platform_delete_workspace`, Guard-Trigger, `followup_templates`-Backfill nach `message_templates`. **Dazu das Doku-Delta** (§0.3 Punkt 3): docs §3 neue Tabellen/Spalten, §6 der Absatz zur Produktgrenze (K4), §7 neue Migrationsliste, §8 neue Invarianten — ca. 1 PT, hier eingepreist | `…0034_tenant_lifecycle.sql`; `src/app/actions/platform.ts`; `src/app/actions/workspace.ts`; `docs/data-model.md` (Delta) | M2, M4, M9 | **M** | Fasst als einzige Datei **bereits live laufende** Funktionen an (0000, 0026, 0027) — deshalb eigene Datei, einzeln zurücknehmbar, `create or replace` mit **unveränderter Signatur** (ein geänderter Rückgabetyp verlangt DROP und nimmt Grants mit). Läuft **nach** dem Deploy, nicht im Verifikationsfenster. Die Umstellung der Besitz-Ermittlung auf `coalesce(assigned_user_id, created_by_user_id)` ist eine **Verhaltensänderung an Kundendaten** und gehört in die Release-Notiz |
| **M18** | W2 | Navigation, Badges, Abgrenzung | Sidebar-Eintrag „Gesonderte Listen", Fälligkeits-Badges an `/erinnerungen`, `/nachfassen` und `/ablage` über **eine** `nav_counts`-RPC (per Request gecacht), `/` verlinkt `/erinnerungen`, die Abgrenzung der vier Werkzeuge als Unterzeile statt nur als HTML-`title` (im Mobile-Drawer heute unsichtbar) | `Sidebar.tsx`; `MobileHeader.tsx`; `(dashboard)/layout.tsx`; `(dashboard)/page.tsx` | M10, M11, M16 | **S** | Behebt M12, N11. Der Zähler läuft im Layout und damit auf **jeder** Seite — eine RPC, nicht die vollen Loader. **Im Kern ist `/ablage` über einen einfachen Sidebar-Link erreichbar** (in M11 enthalten), nur ohne Badge und ohne Abgrenzungstext |
| **M19** | K | Tests | Erste `*.test.ts` des Repos für die reinen Funktionen: `computeCascadeDueAts` (inkl. DST-Wochenende, `after_appointment` und der `skipped`-Rückgabe aus K11), `resolveTemplate` (alle vier Ebenen), `renderTemplate` (Case-Insensitivität, `{name}`-Alias, leere Firma, verwaiste Satzzeichen), `recycleIntervalDays` (Grund vor Ursprungs-Default, `falsche_zielgruppe`/`kein_fit` → null), `resolveMessageChannel` (WhatsApp nur mit Nummer **und** Einwilligung, `wa_refused_at` → LinkedIn). Dazu `supabase/tests/invarianten.sql` als **eine** fahrbare Datei | `src/lib/__tests__/*.test.ts` (neu); `supabase/tests/invarianten.sql` | M0, läuft ab M1 modulbegleitend | **M** | Behebt M20. RLS, die vier RPCs und der partielle Unique-Index bleiben ungetestet — dafür der Rauchtest in §8 |
| **M20** | W2 | Auswertung | H6 beheben (`closing_followup`-Touches raus aus der Show-Quote des Closing-Gesprächs, eigener Block), Erinnerungs-Disziplin **je Kaskade** statt je Offset-Slot, Quellenfilter wirkt, Datum- statt String-Vergleich, Rückverlinkung; **Absagen (K5):** der Funnel-Tab schließt `cancelled_at is not null` aus, Übersicht, Kalender und „Termine im Zeitraum" behalten sie, dazu die neue Kennzahl **„Absagequote"**; **erste Recycling-Kennzahlen überhaupt:** Fällig/Kontaktiert/Reagiert/Ausgeschlossen, Wiederbelebungsquote je Grund, Umsatz aus recycelten Leads; Dispositions-Verteilung je Liste und Grund | `analyseData.ts:394-414`; `SettingTab.tsx`; `ClosingTab.tsx`; `FunnelTab.tsx`; `src/lib/compare/{model,facts,metrics}.ts` | M6, M9, M10 | **L** | Behebt H6, M9, M11, N3, N4, N12. **Die Asymmetrie aus K5 ist erklärungsbedürftig und gehört dokumentiert** (M23): derselbe Termin zählt im Funnel nicht und in der Übersicht schon. Der Doppel-`.or()`-Aufruf (`analyseData.ts:406-407`) ist ungeprüft — einmal gegen eine echte DB verifizieren. Jede neue Vergleichs-Kennzahl braucht eine Zeile in `MEASURE_SOURCE` (docs §5.2); jede Zahl gehört in **genau einen** Tab (docs §5.1) |
| **M21** | P2 | Mail-Spur | **Vertagt (P12).** Der Kern hält nur die Andockpunkte offen — §7. Bauplan separat: `MODUL-mailversand.md`, 15 Arbeitspakete | siehe `MODUL-mailversand.md` | M3, M4, M10 | **4–6 PW** | siehe §7 |
| **M22** | K | Migration 0035 — Pflichtfelder | Die Trigger, die `cancel_reason_code` bei gesetztem `cancelled_at` und `disqualify_reason_code` bei `status='unqualifiziert'` erzwingen | `…0035_pflichtfelder.sql` | M6, Deploy | **S** | **Erst nach dem Deploy.** In der DB-vor-Merge-Phase schreibt die laufende Produktion in `setSettingOutcome` genau dieses Update ohne Grundcode — der Trigger würde den Setting-Ausgang „Unqualifiziert" tagelang lahmlegen |
| **M23** | W2 | Doku (vollständig) | `docs/data-model.md` §1 (Lifecycle mit Absage/Verschiebung/Ablage; drei Mechanismen werden vier), §4 (neue Enums, **ein** Platzhalter-Dialekt), §5 (`dropout_lists`, geänderte `recycle_tasks`, `schedule_recycle`, `recycle_attempt`) — und die **zwei Absätze aus K4 und K5**: `Europe/Berlin` als **Produktgrenze** („nur DACH", §6) sowie die **Absage-Asymmetrie** (Funnel schließt aus, Übersicht/Kalender behalten). §3, §6, §7 und §8 sind bereits über das Doku-Delta in M17 aktuell | `docs/data-model.md` | alle | **M** | Die Doku ist im Repo verbindlich (`CLAUDE.md` lädt sie) und Grundlage jeder MCP-Auswertung. Eine falsche Doku produziert falsche Zahlen — deshalb liegt der schema-nahe Teil im Kern (M17) und nur die erzählenden Kapitel hier |

### 5.2 M10 im Detail — `/erinnerungen` v2

Das Modul ist von **L auf XL** gewachsen, weil vier Entscheidungen (K1, K3, K8, K12) dieselbe Seite
treffen. Es ist die Stelle, an der der Auftraggeber den Umbau täglich benutzt; ein halbfertiges
`/erinnerungen` entwertet M4, M7 und M14 gleich mit.

**(1) Gruppierung nach Termin statt nach Touch — die Antwort auf K1.**
Es gibt bewusst **keine Abbruchlogik**: eine Bestätigung auf Stufe 1 lässt Stufe 2 und 3 fällig werden,
weil Reminder 3 („wollte dir noch einmal den Link durchschicken") auch nach einer Zusage gilt. Das
Mengenproblem, das daraus folgt, löst ausschließlich die Oberfläche:

- **Eine Karte je Termin**, nicht je Nachricht. Aus neun Karten (drei Termine × drei Stufen) werden drei.
- **Die Stufen liegen als Zeitleiste in der Karte**: erledigte eingeklappt mit Zeitstempel, die fällige
  hervorgehoben und aufgeklappt (Text, Kanal, Adressat, Kopier-Knopf), die künftigen als graue Zeile mit
  ihrer Fälligkeit. **Entfallene Stufen stehen mit ihrer Begründung dabei** (K11) — dieselbe Zeile wie im
  Kaskaden-Panel (M14), damit beide Orte dieselbe Geschichte erzählen.
- **Sammelaktion „ganze Kaskade abhaken"** auf der Kartenkopfzeile: hakt alle noch offenen Stufen dieses
  Termins in **einem** Server-Roundtrip ab (ein `update … in (ids)`, nicht n Aufrufe). Das ist der Fall
  „Lead hat auf Stufe 1 geantwortet und bestätigt" — der Nutzer erledigt die Kaskade, statt sie
  abzuwarten. Ein Bestätigungs-Zwischenschritt ist nicht nötig: die Aktion ist über dieselbe Karte
  einzeln zurücknehmbar.
- **Die Sortierung folgt der frühesten offenen Fälligkeit** der Karte, nicht dem Termin. Sonst rutschte
  eine überfällige Stufe unter einen später stattfindenden Termin.
- Die Karte trägt die **Termin-Identität oben** (Lead, Firma, Termin-Zeitpunkt, Typ Setting/Closing) und
  verlinkt in den Editor — dort sitzt dasselbe Panel (M14).

**(2) Mehrfachauswahl mit Umzuweisung und Personenfilter — die Antwort auf K8.**
Ein neues Schema gibt es dafür nicht; die vorhandene Zuweisung reicht:

- **Checkbox je Karte** plus „alle sichtbaren auswählen"; eine Aktionsleiste am unteren Rand bietet
  **„Zuweisen an …"**. Sie ruft das bestehende `setAssignee()` (`src/app/actions/assignees.ts`) je
  Termin — dessen Berechtigungsprüfung (`role='owner'` **und** `data_scope='workspace'`) bleibt
  unverändert und ist die einzige Stelle, die entscheidet, wer umverteilen darf. Nach dem Aufruf
  regeneriert `syncTouchesAfterAppointmentWrite` (M5) die Touches auf die neue Person.
- **Personenfilter in der Team-Ansicht:** ein Owner mit `data_scope='workspace'` sieht standardmäßig
  **seine eigenen** Erinnerungen (heutiges Verhalten, sonst wäre die Seite unbrauchbar) und kann auf
  „alle" oder eine einzelne Person umschalten. Der Filter steht in der URL (`?person=`), damit ein
  Vertretungsfall verlinkbar ist. Ein Mitglied mit `data_scope='own'` sieht den Umschalter nicht.
- **Vorlagen folgen dem Assignee, nicht dem Betrachter** (§4.1): `getTemplateBundles(userIds[])` lädt in
  **einer** Query die Bundles aller sichtbaren Zuständigen; jede Karte rendert gegen das Bundle ihres
  eigenen Assignees. Ohne diesen Schritt läse ein Owner in der Team-Ansicht seine eigenen Texte unter
  fremden Namen.

**(3) Absender-Konto und die Warnung bei Auseinanderfallen — der zweite Teil von K8.**
Der Kanal sagt, *worüber* geschrieben wird; das Absender-Konto sagt, *von wem aus*:

- Die Karte weist aus: **„über LinkedIn-Konto von X"** bzw. „über die Telefonnummer von X", wobei X der
  **Owner der Quellliste** ist (`lists.owner_name` / `phone_lists.owner_name`, `owner_name` hat Vorrang —
  docs §2). Bei Quellen ohne Vorlaufkanal (Ads, Social, Sonstige) und bei WhatsApp entfällt die Zeile.
- **Fallen Listen-Owner und zugewiesene Person auseinander**, steht eine Warnung dabei: „Zuständig ist
  A, geschrieben werden muss über das Konto von B." Das ist kein Fehler, sondern der Normalfall bei
  Vertretung und bei Listen, die ein Admin für ein Mitglied angelegt hat — aber es ist genau die
  Information, ohne die die Nachricht aus dem falschen Profil rausgeht.
- **Kein Vertretungsfeld, kein neues Schema** (K8 wörtlich). Wer dauerhaft übernimmt, weist um (Punkt 2).

**(4) Erledigen: sichtbar, nachvollziehbar, revalidiert — K12.**

- **`done_by_user_id` erscheint auf der Karte** („erledigt von A, 14:12") — bei Mehrfachauswahl und
  Vertretung ist „ist abgehakt" ohne „von wem" nicht handelbar.
- **Nach dem Erledigen wird revalidiert** (`revalidatePath`), damit zwei Personen an derselben Liste
  nicht auf verschiedene Wahrheiten klicken. **Kein Optimistic Locking** — der Konfliktfall ist zwei
  Häkchen auf denselben Touch, und das Ergebnis ist in beiden Reihenfolgen dasselbe.
- **Fehler beim Häkchen werden angezeigt**, nicht verschluckt (heute `console.error`).

**(5) Kontaktfrequenz — weiche Warnung, K3.**
Existiert für denselben Lead in den letzten `CONTACT_GAP_WARN_DAYS` Tagen bereits ein `done_at` (aus
`reminder_touches`) oder ein `recycle_last_contacted_at`, trägt die Karte einen dezenten Hinweis
„kürzlich kontaktiert". **Keine harte Unterdrückung**, keine verschobene Fälligkeit, kein
Konfigurationsfeld — die Schwelle ist eine Code-Konstante. **Die Termin-Kaskade (`*_msg`) ist
ausgenommen**: drei Kontakte in drei Tagen sind dort gewollt und wären als Warnung nur Rauschen.
*Einschränkung im Kern:* die Warnung sagt „kürzlich", nicht „vor 2 Tagen" — die konkrete Zahl
(„zuletzt kontaktiert vor X Tagen") kommt mit dem Lead-Dossier in M15, zweite Welle.

**(6) Der Rest, der ohnehin fällig war.**
Serverseitiges Zeitfenster aus `pipeline_settings.reminder_horizon_days` (Default 7, per URL erweiterbar)
statt unbegrenztem Laden (H8) · Buckets in **Berliner** Zeit statt Browser-Zeit · Fälligkeit auf jeder
Karte · `done_at`-Filter mit eigener, begrenzter Sektion „Bereits erledigt" · Kanal **live** aufgelöst
mit Begründung („WhatsApp — Nummer und Einwilligung liegen vor" / „LinkedIn — keine Nummer, Fallback")
und Auswahl bei „frei wählen" (setzt `channel_locked`) · Snooze (`snoozed_until`) · vorbereiteter
Deeplink · korrigierter Titel (nicht mehr „heute", wenn ein Fenster von sieben Tagen gezeigt wird).

**Der Deeplink ist kein Versand.** `wa.me/…?text=…` öffnet den Client mit vorbefülltem Text; abgeschickt
wird von Hand, abgehakt ebenfalls. Die Karte sagt das mit Worten, nicht nur durch Abwesenheit eines
Sende-Knopfes (E4).

### 5.3 M11 im Detail — `/ablage`, sechs Ansichten

`dropout_lists()` liefert alle Ansichten aus dem **vorhandenen Zeilenzustand**; es gibt keine zweite
Datenhaltung neben `status`/`cancelled_at` (Begründung in §3.2).

| Ansicht | Bedingung | Konzept-Bezug |
|---|---|---|
| **Abgesagt ohne Aussicht** | `cancel_outlook='ohne_aussicht'` (beide Tabellen) | D-2 |
| **Abgesagt — Ersatztermin ausstehend** | `cancel_outlook='neuer_termin' and revived_at is null` | **K2** |
| **Disqualifiziert** | `setting_calls.status in ('unqualifiziert','dead')` | E-3 |
| **Kein Close** | `closing_calls.status='verloren'` | F-2 |
| **No-Show ohne Antwort** | `no_show_resolution='ohne_antwort'` (beide Tabellen) | E-2 / F-3 |
| **Gesperrte Leads** | `recycle_excluded_at is not null` über alle vier Recycling-Tabellen | **K10** |

**Die fünfte Ansicht ist der Zweck von K2.** Vorher fiel ein Termin, der mit Aussicht auf einen
Ersatztermin abgesagt wurde, aus **jeder** Liste: nicht „ohne Aussicht", nicht disqualifiziert, nicht
verloren — also unsichtbar. Genau das ist der Fall, in dem am ehesten noch Umsatz liegt. Die Ansicht
sortiert nach Absagedatum aufsteigend, damit der älteste offene Ersatztermin oben steht.

**„Zurückholen" legt einen neuen Vorgang an (K10).** Die terminale Zeile bleibt terminal: sie bekommt
`revived_at`, verliert `next_recycle_at` und verschwindet aus der Ansicht. Der neue Vorgang ist **immer
ein `setting_calls`-Eintrag** und trägt `revived_from_setting_call_id` oder `revived_from_closing_call_id`
(genau eine der beiden, per CHECK). Grund: ein von `verloren` auf `offen` gedrehtes Closing veränderte
rückwirkend die Win-Rate eines bereits abgeschlossenen Zeitraums — genau das, was docs §5 verbietet.
Sichtbar bleibt der Zusammenhang über die FK-Kette, so dass das Dossier (M15) beide Anläufe zeigt.

*Auslegung, die benannt gehört:* der neue Vorgang startet mit `reschedule_count = 0`. Wer einen Termin
absagt und zurückholt, bekommt die zwei Verschiebungen aus E6 also erneut. Das ist konsistent mit E9
(„frischer Anlauf"), macht die Verschiebe-Obergrenze aber umgehbar; die Ablage-Ansicht zeigt deshalb
`reschedule_count` und `no_show_count` der **Vorgänger**zeile mit an, so dass der Fall wenigstens sichtbar
ist. Siehe auch §10 Punkt 16.

**Kontaktverbote werden immer org-weit angezeigt (K10).** `dropout_lists` respektiert für fünf Ansichten
den Personenfilter wie `nachfassen_tasks` — und ignoriert ihn für `p_list='gesperrt'`. Begründung, die
auch in der Oberfläche steht: **ein Kontaktverbot, das nur sein Besitzer sieht, ist keines.** Die nächste
Person spricht den Lead sonst neu an und umgeht die rote Konzept-Notiz „kein weiteres kontaktieren!".
Die Sektion trägt deshalb sichtbar den Hinweis „organisationsweit, unabhängig von der Datensicht".

**Aktionen je Zeile:** Grund ändern (Code + Freitext) · Recycling vorziehen (setzt `next_recycle_at` auf
heute) · zurückholen (s. o.) · endgültig raus (`recycle_excluded_at`, wandert in „Gesperrte Leads") ·
Dossier aufklappen (im Kern die Kurzfassung: Herkunft, Grund, Zähler, Touch-Historie; die volle Ansicht
ist M15). Zeilen **ohne** erfassten Grund führt jede Ansicht getrennt als „Ohne Angabe" mit einem Knopf
„Grund nachtragen" — sie **fragt**, sie füllt nichts aus.

### 5.4 Warum `/settings` v2 (M13) im Kern liegt — zwei unabhängige Gründe

**Der erste Grund ist die Anforderung** und steht im Nachtrag zu K6: „Nachrichten pro Nutzer bearbeitbar."
E1 und E2 leben ohne Oberfläche nur im Datenmodell — die Vorrangkette löst korrekt auf, aber eine
persönliche Übersteuerung ließe sich ausschließlich per SQL anlegen. Eine Entscheidung, die der Kunde
nicht ausführen kann, ist nicht eingelöst.

**Der zweite Grund ist strukturell und wäre auch ohne den Nachtrag eingetreten.** §3.1 lässt
`reminder_settings` und `recycle_settings` **entfallen**. Läge der Editor in der zweiten Welle, zeigte
`/settings` nach dem Kern-Deploy zwei Formularkarten, die in Tabellen schreiben, die es nicht mehr gibt —
und beide Actions verschlucken heute jeden Fehler (H4): volle Defaults im Formular, „Speichern" ohne
Wirkung, keine Meldung. Das ist exakt der stille Ausfall, den H7/M12 abstellen soll, nur neu erzeugt.
**Beide Gründe zeigen auf dieselbe Maßnahme**, und der Nachtrag löst damit zwei Probleme mit einer
Verschiebung.

**Folgen für die Reihenfolge.** M13 wird **direkt nach M2 und M3** gebaut, weil es deren Oberfläche ist
und weil `/settings` zu keinem Zeitpunkt ein totes Formular zeigen darf. Voraussetzung ist nur M12
(Verfügbarkeits-Probe) — ein Editor, der bei fehlendem Schema die Seed-Werte anzeigt und lautlos nicht
speichert, wäre H7 unter neuem Namen. Die Recycling-Karte des Editors braucht zusätzlich M9 und wird als
letzte der drei Kartengruppen fertig; Kaskaden- und Vorlagen-Editor sind davon unabhängig.

**Rückfall, falls M13 im Kern nicht fertig wird** (§9.4): die beiden toten Karten werden durch **eine
Lesekarte** ersetzt — aktive Werte aus `pipeline_settings`, Stufen aus `cascade_steps` als Text, dazu der
Satz „Die Bearbeitung folgt mit dem Kaskaden-Editor". Kein Formular, kein stiller Fehlschlag, aber auch
kein eingelöstes E1/E2. Das ist ein Rückfall, keine Planung.

---

## 6. Behebung der acht Hoch-Lücken

Entscheidung E11 verlangt, alle acht im selben Zug zu beheben. Mit dem Umfangsschnitt K6 **in der Fassung
des Nachtrags** gilt das für sieben von acht: nur H6 (Auswertung) liegt in der zweiten Welle. Vor dem
Nachtrag waren es H4, H5 und H6 — das Vorziehen von M13 schließt H4 und H5 im Kern mit. Die Spalte
**Block** sagt es je Zeile.

| # | Lücke | Ursache | Fix | Modul | Block |
|---|---|---|---|---|---|
| **H1** | Recycling wird nie zurückgenommen, wenn ein Lead auf anderem Weg wiederbelebt wird — ein gewonnener Deal taucht Monate später als Aufgabe auf | `recycle_tasks` filtert nur auf `next_recycle_at`/`recycle_excluded_at`, nie auf den Status (0032:213-250); kein Schreibpfad nullt das Datum bei „gewonnen", „nachfassen", Ersatztermin, `setPhoneLeadOutcome('aktiv')` oder `markLinkedInAnswered` | **Drei unabhängige Riegel.** (1) `clearRecycle()` in allen Wiederbelebungspfaden. (2) Status-Guard in jedem der vier RPC-Zweige — die RPC macht veraltete Daten harmlos, auch wenn ein künftiger Schreibpfad den Aufruf vergisst. (3) `recycle_responded_at is null` **und** `revived_at is null` als zusätzliche Filter (K10) | **M9** | K |
| **H2** | Zombie-No-Show-Touches im Setting: „Show" nach No-Show und „Ergebnis zurücksetzen" lassen den sofort fälligen Touch aktiv stehen | `updateSettingCall` (`settingCalls.ts:71-79`) fasst keine Touches an, obwohl sein Patch-Typ `appointment_at`, `show_status`, `status`, `wa_phone`, `wa_consent_at` trägt — anders als `updateClosingCall` | `syncTouchesAfterAppointmentWrite(before, after)`: eine Diff-Funktion, die **alle** Zustandswechsel abdeckt statt einzelner Übergänge. Der Vorher-Zustand wird vor dem Update gelesen. Die Rücknahme entwertet den No-Show-Touch **und** baut die Bestätigungs-Kaskade wieder auf | **M5** | K |
| **H3** | Symmetrisch beim Closing: die Rücknahme eines No-Shows entwertet den Touch nicht — geprüft wird nur der Übergang **nach** `no_show` | `closingCalls.ts:116-118` kennt nur eine Richtung | dieselbe Diff-Funktion, für beide Tabellen | **M5** | K |
| **H4** | Beide Settings-Formulare verschlucken jeden Fehler: eine verletzte Offset-Reihenfolge oder `max_attempts > 5` scheitert stumm, das Feld springt auf den alten Wert | `updateReminderSettingsForm` / `updateRecycleSettingsForm` geben `Promise<void>` zurück und werfen das `{error}` weg (`reminders.ts:84-94`, `recycle.ts:86-96`); das Feedback-Banner deckt nur die Nutzerverwaltung ab | Alle Formulare auf `useActionState` mit sichtbarem Fehlerzustand; die Reihenfolge-Prüfung der Kaskade wandert aus dem DB-CHECK in die Server-Action, die die Meldung auch anzeigen kann; `max_attempts` wird serverseitig **beidseitig** geklemmt (M27). Die beiden Actions, die heute `Promise<void>` liefern, werden dabei ersetzt, nicht repariert — die Tabellen dahinter entfallen ohnehin (§5.4) | **M13** | **K** |
| **H5** | Vier Vorlagen-Modelle und drei Platzhalter-Dialekte auf einem Bildschirm; ein zwischen den Feldern kopierter Text rendert den rohen Platzhalter ohne Warnung | Historisch gewachsen: `lists.fuN_text`, `followup_templates`, `reminder_settings`, `recycle_settings` plus drei hartkodierte Texte | **Eine** Tabelle `message_templates`, **eine** Vorrangkette, **ein** Platzhalter-Dialekt (case-insensitiv, mit Alias `{name}`), `validateTemplate()` warnt vor unbekannten Token, Quelle-Badge macht die wirkende Ebene sichtbar. Modell und Rendering in M1/M2, die Bedienbarkeit (Editor, Quelle-Badge, persönliche Übersteuerung) in M13 — **seit dem Nachtrag zu K6 liegt beides im Kern** | **M1**, **M2**, **M13** | **K** |
| **H6** | Der Closing-Tab mischt `closing_followup`-Touches in die Show-Quoten-Auswertung des Closing-Gesprächs; ein Closing mit beiden Kaskaden zählt doppelt | Beide `entity_type` tragen dieselbe `entity_id` und dieselben Touch-Arten; die Schleife filtert nur `touch_type !== 'no_show'` (`ClosingTab.tsx:349-401`) | Auswertung schlüsselt nach `entity_type` **und** `cascade_kind`; der Nachfass-Kontakt bekommt einen eigenen Block („Erinnerungs-Disziplin: vereinbarte Nachfass-Kontakte"), weil er erst **nach** dem Closing entsteht und dessen `show_status` unmöglich beeinflusst haben kann | **M20** | **W2** |
| **H7** | Fehlende Migration ist von „nichts fällig" nicht unterscheidbar: grüner Erfolgs-Leerzustand, 0-Kennzahlen, volle Defaults im Formular, jedes Speichern scheitert lautlos | Kein `available:false`-Fallback wie beim Anruf-Log; alle Loader fallen auf Defaults oder `[]` zurück | `schemaProbe.ts` wertet den PostgREST-Fehlercode für „Relation existiert nicht" aus (nicht die leere Ergebnismenge) und liefert `{available:false}`; Banner statt Leerzustand; Analyse zeigt „—" statt 0. Muster `phoneAttemptsData.ts:50` | **M12** | K |
| **H8** | `/erinnerungen` hat kein Zeitfenster: jeder nicht-superseded Touch der Person wird geladen, ein Touch in fünf Wochen steht unter „Diese Woche", „Bereits erledigt" wächst unbegrenzt, und der Titel „Meine Erinnerungen **heute**" trifft nicht zu | `reminders.ts:394-402` ohne obere Grenze und ohne `done_at`-Filter | Serverseitiges Fenster aus `pipeline_settings.reminder_horizon_days` (Default 7, per URL erweiterbar), `done_at`-Filter mit eigener, begrenzter Sektion, Buckets in Berliner Zeit, Fälligkeit auf jeder Karte, Titel korrigiert. Dazu der fehlende Index `(workspace_id, assigned_user_id, due_at) where superseded_at is null and done_at is null` (N15), der auch die nach Termin gruppierte Sicht trägt | **M10** | K |

**Was nach dem Kern-Deploy von E11 offen bleibt** — in einem Satz, damit es niemanden überrascht: **genau
eine Lücke**, H6. Die Auswertung mischt bis M20 weiterhin Nachfass-Touches in die Closing-Show-Quote.
Das ist Anzeige, nicht Datenkorrektheit — die Daten stimmen ab MS4, und die Touches tragen ab M4
`entity_type` und `cascade_kind`, so dass die Korrektur später eine reine Auswertungsänderung ist.

---

## 7. Mail-Spur — vertagt auf Phase 2 (M21)

**Die Entscheidung ist gefallen (P12): Die Mail-Spur ist nicht Teil dieses Umbaus.** Es gibt hier keine
Variantenauswahl mehr und keine Empfehlung, die noch abzuwägen wäre. Dieser Abschnitt beantwortet nur
noch **eine** Frage: *Was muss der Kern offenhalten, damit die Mail-Spur später ohne Umbau andockt?*
Der ausführliche Bauplan liegt separat vor — `MODUL-mailversand.md`, 15 Arbeitspakete, 4–6 Wochen für
den dortigen Kern.

### 7.1 Die vier Andockpunkte im Kern

Alle vier sind **bereits im Zielschema (§3.2) enthalten** und kosten dort nichts. Sie sind hier
zusammengezogen, damit beim Umsetzen niemand einen davon als „unbenutzt" wegkürzt:

| # | Andockpunkt | Wo im Kern | Was ohne ihn passiert |
|---|---|---|---|
| **1** | `message_templates.subject` | 0031, §3.2 | Eine Mail braucht eine Betreffzeile. Ohne die Spalte entstünde entweder eine zweite Vorlagen-Tabelle (H5 zurück) oder ein Betreff als erste Zeile des Bodys (nicht validierbar, nicht getrennt änderbar) |
| **2** | Die fünf `*_mail_*`-Keys im `template_catalog` | 0031, §4.2 | Ein Key im Katalog ohne Zeile in `message_templates` kostet nichts. Nachträglich eingeführte Keys hingegen zwingen zu einer Migration **mitten in einer laufenden Vorlagen-Pflege** — genau der Zeitpunkt, an dem Kunden schon eigene Texte haben |
| **3** | `cascade_kind` kennt `setting_mail` und `closing_mail`; `cascade_steps` trägt sie mit `enabled=false` | 0032 + `seed_workspace_defaults`, §3.2 | `cascade_kind` ist per CHECK gedeckelt. Zwei Werte nachträglich zuzulassen heißt: CHECK ersetzen, Seed nachziehen, Backfill über alle Organisationen. Mit `enabled=false` laufen sie stumm mit und werden in der Oberfläche **nicht** angeboten — sonst konfiguriert ein Kunde Mails, die niemand verschickt |
| **4** | `reminder_touches.channel` kennt `'mail'`; der Unique-Index schlüsselt nach `cascade_kind` | 0032, §3.2 | Ohne `cascade_kind` im Index kollidierte Stufe 1 der Nachrichten-Kaskade mit Stufe 1 der Mail-Kaskade auf demselben Termin. Das ist der einzige Andockpunkt, dessen Fehlen später nicht additiv reparierbar wäre — ein Unique-Index-Wechsel auf einer gefüllten Tabelle |

**Mehr hält der Kern nicht offen.** Kein `user_mail_accounts`, kein `mail_outbox`, kein `sent_at`, kein
`provider_message_id`, keine OAuth-Anbindung, kein Scheduler-Endpunkt. Diese Objekte gehören zu einem
Produkt mit eigener Betriebsverantwortung (Zustellbarkeit, Bounces, Token-Refresh je Nutzer **je
Organisation**) und werden in `MODUL-mailversand.md` geplant, nicht hier vorweggenommen.

### 7.2 Zeitsteuerung: `pg_cron`, nicht Vercel Cron (P13)

**Entscheidung:** Falls Phase 2 einen Scheduler braucht, läuft er als `pg_cron`-Job in Supabase — nicht
als Vercel Cron. Grund: keine Tarif-Abhängigkeit, und der Job sitzt neben den Daten, die er liest.

**Einschätzung für den Kern, ausdrücklich benannt: der Kern braucht voraussichtlich gar keinen
Scheduler.** Alle Fälligkeiten sind beim Seitenaufruf berechenbar — `due_at` steht in der Zeile, das
Fenster kommt aus `reminder_horizon_days`, die Buckets entstehen in der Server Component. Es gibt im
Kern keinen einzigen Vorgang, der ohne Nutzeranwesenheit passieren muss: nichts wird verschickt (E4),
nichts eskaliert von selbst, und `recycle_tasks`/`nachfassen_tasks` werten `next_recycle_at <= today`
beim Aufruf aus. Ein Cron-Job wäre im Kern also ein Bauteil ohne Aufgabe — mit der üblichen Folge, dass
er ungetestet mitläuft und beim ersten echten Bedarf falsch konfiguriert ist. **Sollte sich das ändern**
(erster Kandidat: eine Tagesübersicht per Mail, also bereits Phase 2), ist `pg_cron` gesetzt und die
Entscheidung nicht erneut zu treffen.

### 7.3 Einwilligung (P14)

**Der Auftraggeber hat entschieden: kein Opt-In.** Das ist als getroffene Entscheidung zu behandeln und
hier nicht erneut abzuwägen. **Risiko in einem Satz:** LG Köln 81 O 88/21 stuft Terminbestätigung und
-erinnerung als Werbung nach § 7 Abs. 2 Nr. 2 UWG ein; das Risiko trägt die Kundenorganisation als
Versender, und es entsteht erst mit dem automatischen Versand — also frühestens in Phase 2. Für den Kern
ist es gegenstandslos, weil dort nichts automatisch rausgeht (E4). `wa_consent_at` bleibt trotzdem im
Schema und wird beim Übergang Qualifiziert→Closing erfasst (M8): es steuert die **Kanalwahl**
(WhatsApp nur mit Nummer und Einwilligung) und ist damit unabhängig von P14 begründet.

---

## 8. Umsetzungsreihenfolge und Meilensteine

MS0–MS8 sind der **Kern**, MS9–MS10 die **zweite Welle**, MS11 **Phase 2**. Die Blockgrenze liegt bewusst
nach MS8 (Merge + Deploy + 0034/0035): der Kern ist dort vollständig ausgeliefert und die zweite Welle
kann ohne weiteres Migrationsfenster darauf aufsetzen. **Die Konfigurierbarkeit (M13) liegt mit MS6 im
Kern-Ablauf, nicht am Ende** — sie ist die Oberfläche zu MS2 und muss stehen, bevor `/settings` im
Deploy auftaucht (§5.4).

| MS | Block | Inhalt | Module | Abnahmekriterium |
|---|---|---|---|---|
| **MS0** | K | **Bestätigungsmessung und Harness.** `list_tables` gegen die Live-DB, sobald ein `SUPABASE_ACCESS_TOKEN` vorliegt; Test-Harness; `node_modules/next/dist/docs/01-app` zu Server Actions / Form-Actions / `useActionState` lesen (AGENTS.md) | M0 | Ein Protokoll belegt, dass keine der drei Tabellen, keine der zwölf Recycling-Spalten und keine der beiden RPCs live existiert — die Bestätigung des Auftraggebers ist damit gegengeprüft. `npm test` läuft grün mit einem Dummy-Test. Fehlt das Token noch, **blockiert das MS1 und MS2 nicht**; die Messung muss aber **vor MS3** vorliegen |
| **MS1** | K | **Reine Funktionen zuerst, mit Tests, ohne DB.** `renderTemplate`/`resolveTemplate`, `computeCascadeDueAts` (DST, `after_appointment`, `skipped`), `recycleIntervalDays`, `resolveMessageChannel` | M1, M19 (Teil) | Alle fünf Funktionen sind testabgedeckt, inklusive `{name}`-Alias, leerer Firma, Zeitumstellungs-Wochenende, `wa_refused_at` → LinkedIn und der Begründung entfallener Stufen (K11). Nichts davon berührt die Datenbank; ein Fehlschlag kostet hier nichts |
| **MS2** | K | **Migrationen 0031–0033 formulieren** (noch nicht ausführen). Parallel: `scheduleRecycle`/`clearRecycle` im Code korrigieren, **bevor** die CHECKs existieren | M2, M3, M4 (SQL), M6 (SQL), M9 (SQL-Teil) | Alle drei Dateien sind idempotent (`if not exists`, `drop policy if exists`, `create or replace`), tragen einen Verifikationsblock am Ende und referenzieren keine Objekte aus 0034 |
| **MS3** | K | **Verifikationsfenster: 0031 → 0032 → 0033 einspielen und einzeln verifizieren** — **vor** dem Merge | — | Nach jedem Schritt läuft der Verifikationsblock der Datei; danach `supabase/tests/invarianten.sql` komplett. Zusätzlich: `recycle_tasks` und `dropout_lists` je einmal manuell aufrufen. **Keine dieser drei Dateien darf eine Bedingung einführen, die der ausgelieferte Code verletzt** (§9.1) |
| **MS4** | K | **Datenkorrektheit.** Kaskaden-Engine auf das neue Modell, dann die Auslöser-Vereinheitlichung, dann Recycling v2 | M4, M5, M9 | Ein Testtermin erzeugt in `reminder_touches` genau die erwarteten Zeilen; „Show" nach No-Show entwertet den No-Show-Touch; „Ergebnis zurücksetzen" baut die Kaskade wieder auf; ein gewonnener Deal hat kein `next_recycle_at` mehr und erscheint in `recycle_tasks` nicht; zwei parallele „Nochmal versucht" erhöhen den Zähler um genau 2 (K12). **Ab hier stimmen die Daten, unabhängig davon, was die Oberfläche zeigt** |
| **MS5** | K | **Die vier Konzept-Ausgänge.** Ketten (No-Show, Kein Close), Verschieben/Absagen/Disqualifizieren, Übergang Qualifiziert→Closing | M6, M7, M8 | Die neun Übergänge des Rauchtests laufen durch: verschieben (3× mit Warnung, **Setting und Closing über dieselbe Action**), absagen ohne Aussicht, absagen mit Ersatztermin-Aussicht, No-Show mit „Antwort"/„Keine Antwort", Ersatztermin (volle Kaskade startet neu, Zähler unverändert), disqualifizieren mit Grund, qualifizieren ohne Nummer (abgelehnt) und mit Verweigerung (LinkedIn), verlieren mit Grund. **Die Blöcke D, E und F sind fachlich vollständig** |
| **MS6** | K | **Ehrlichkeit, dann Konfigurierbarkeit.** Erst die Verfügbarkeits-Probe, dann der Kaskaden- und Vorlagen-Editor — die Oberfläche zu MS2, gebaut bevor `/settings` je im Deploy erscheint | M12, dann M13 | Bei fehlendem Schema steht überall ein Banner statt eines grünen Leerzustands. Danach: ein Owner ändert eine Kaskaden-Stufe und einen Org-Text und sieht das Ergebnis auf der nächsten Karte; **ein Mitglied übersteuert denselben Text für sich und sieht den Badge „Deine Vorlage"**; ein fehlerhaftes Feld zeigt eine Fehlermeldung statt zurückzuspringen. **E1/E2 sind eingelöst, H4 und H5 sind zu**, und `/settings` trägt kein Formular mehr, das in eine entfallene Tabelle schreibt |
| **MS7** | K | **Die drei Kern-Oberflächen** | M10, M11, M14 | Der Auftraggeber erkennt sein Diagramm auf dem Bildschirm wieder — **eine Karte je Termin** mit Zeitleiste, Sammelaktion, Mehrfachauswahl mit Umzuweisung und Absender-Konto; Kaskaden-Panel oben in beiden Editoren mit Text, Kanal und den entfallenen Stufen samt Begründung; sechs gesonderte Listen unter `/ablage`, „Gesperrte Leads" org-weit |
| **MS8** | K | **Merge, Deploy, 0034, 0035, Doku-Delta** — **Ende des Kerns** | M17, M22 | Reihenfolge: Merge → Deploy → 0034 (Lifecycle, Seeding-Backfill über alle Workspaces) → Invarianten → 0035 (Pflichtfeld-Trigger) → Invarianten → Doku-Delta in `docs/data-model.md` §3/§6/§7/§8. Danach: eine neue Testorganisation anlegen und prüfen, dass sie ohne einen einzigen Klick eine vollständige Kaskade **und** einen bedienbaren Vorlagen-Editor hat |
| **MS9** | W2 | **Nachfassen, Navigation, Dossier** | M15, M16, M18 | `/nachfassen` zeigt Grund und Notiz und lädt parallel statt in acht Roundtrips; die Sidebar trägt Badges und die Abgrenzung der vier Werkzeuge; das Dossier öffnet aus drei Oberflächen, lädt parallel und nennt „zuletzt kontaktiert vor X Tagen" (K3) |
| **MS10** | W2 | **Auswertung und Doku** | M20, M23 | H6 ist behoben (Nachfass-Touches in eigenem Block); der erste Recycling-Block zeigt Zahlen; die Absagequote steht, und der Funnel schließt abgesagte Termine aus, während Übersicht und Kalender sie behalten; `docs/data-model.md` beschreibt §1/§4/§5 im neuen Modell **inklusive der Absage-Asymmetrie und der Produktgrenze DACH** |
| **MS11** | P2 | **Mail-Spur** | M21 | Nach `MODUL-mailversand.md`. Voraussetzung ist ausschließlich, dass die vier Andockpunkte aus §7.1 im Kern nicht wegoptimiert wurden |

---

## 9. Rollout

### 9.1 Reihenfolge

1. **Vorher (MS0–MS2):** Bestätigungsmessung des Live-Schemas. Reine Funktionen mit Tests. Migrationen
   0031–0033 formulieren. Die Code-Fixes, die einen künftigen CHECK verletzen würden (`scheduleRecycle`,
   `clearRecycle`, Zähler-Reset), **vor** dem Einspielen korrigieren.
2. **Verifikationsfenster (MS3): Migration vor dem Merge — und der alte ausgelieferte Code muss sie noch
   vertragen.** Das ist die wichtigste Regel des ganzen Rollouts. 0031 → 0032 → 0033 laufen im
   Supabase-SQL-Editor in dieser Reihenfolge, mit Verifikation nach jedem Schritt, **während `main` noch
   die alte App ausliefert**. Das ist gefahrlos, weil das ausgelieferte `main` keine dieser Tabellen
   kennt — geht ein Schritt schief, ist nichts kaputt, weil noch kein Code darauf zeigt. Der Preis dafür
   ist eine harte Bedingung an die drei Dateien:
   - **Keine Bedingung, die der laufende Code verletzt.** Deshalb liegen die Pflichtfeld-Trigger für
     Absage- und Disqualifikationsgrund in **0035, nach dem Deploy** (M22): die laufende Produktion
     schreibt in `setSettingOutcome` heute `status='unqualifiziert'` ohne Grundcode und stünde sonst
     tagelang.
   - **Kein `drop table` einer Tabelle, die der laufende Code liest.** Deshalb bleibt
     `followup_templates` stehen (`nachfassen.ts:114` liest sie ohne Fehlerprüfung).
   - **Nur additive Spalten und neue Objekte.** Jede der drei Dateien muss zweimal hintereinander
     laufen können, ohne etwas zu ändern.
3. **Code (MS4–MS7):** Engine → Auslöser → Recycling → Ausgänge → Verfügbarkeits-Probe →
   **Konfigurierbarkeit (M13)** → die drei Oberflächen.
4. **Rauchtest gegen die echte Datenbank in EINER Organisation**, mit den neun Übergängen aus MS5 plus:
   Termin anlegen und in `reminder_touches` nachzählen; Vorlage **im Editor** ändern und die offene Karte
   neu laden (muss sofort wirken); denselben Text als Mitglied persönlich übersteuern und prüfen, dass die
   Karte des Mitglieds den eigenen und die des Kollegen den Org-Text zeigt (E1/E2); Offset ändern und
   prüfen, dass die bestehende Kaskade unverändert bleibt (dokumentierte Asymmetrie, §4.4); einen Termin
   für **morgen** anlegen und prüfen, dass die entfallenen Stufen mit Begründung erscheinen (K11).
5. **Merge nach `main`, dann Deploy.**
6. **Nach dem Deploy (MS8):** 0034 (Lifecycle + Seeding-Backfill über alle bestehenden Workspaces) →
   Invarianten → 0035 (Pflichtfeld-Trigger) → Invarianten → Doku-Delta.
7. **Zweite Welle (MS9–MS10)** ohne weiteres Migrationsfenster: M15, M16, M18, dann M20, M23.

### 9.2 Verifikationsschritte je Migration

- **0031:** `select count(*) from template_catalog` = Katalogumfang; `can_manage_org_settings()` liefert
  für einen Owner mit `data_scope='own'` **false** und für denselben mit `workspace` **true**;
  ein Insert einer zweiten Org-Zeile desselben Keys scheitert am partiellen Unique-Index; ein Insert mit
  `body = '   '` scheitert am `btrim`-CHECK.
- **0032:** Ein Insert in `reminder_touches` ohne `assigned_user_id` wirft; ein Insert mit einer
  `assigned_user_id` aus einer fremden Organisation wirft; `apply_reminder_touches` zweimal
  hintereinander aufgerufen hinterlässt genau einen aktiven Satz je Kaskade; ein `touch_kind='sofort'`
  mit `due_at > appointment_at` läuft durch (K11-Ausnahme), dasselbe mit `touch_kind='cascade'` scheitert;
  ein `delete` auf einem `setting_calls`-Testdatensatz nimmt seine Touches mit.
- **0033:** Ein `update` mit gleichzeitig gesetztem `recycle_excluded_at` und `next_recycle_at` scheitert;
  `lost_reason_code in ('falsche_zielgruppe','kein_fit')` mit Datum scheitert; `recycle_tasks` liefert für
  ein gewonnenes Closing mit altem `next_recycle_at` **keine** Zeile; `recycle_attempt()` zweimal
  hintereinander liefert 1 und 2 und setzt bei `max_attempts=2` `next_recycle_at` auf NULL;
  `dropout_lists(…, 'gesperrt', <fremde user_id>)` liefert trotzdem alle gesperrten Leads der
  Organisation (K10).
- **0034:** `seed_workspace_defaults` zweimal aufgerufen ändert nichts; jede Organisation hat genau eine
  `pipeline_settings`-Zeile und ihre `cascade_steps` (Mail-Kaskaden mit `enabled=false`);
  `preview_delete_workspace` nennt die neue Tabellenzahl; die Zeilenzahl in `followup_templates` und die
  Zahl der backfillten `message_templates`-Zeilen mit `template_key like 'linkedin_fu_%'` stimmen überein.
- **0035:** Ein `update setting_calls set status='unqualifiziert'` ohne Grundcode scheitert; mit Grundcode
  läuft es. Dasselbe für `cancelled_at` ohne `cancel_reason_code`.

### 9.3 Neue Invarianten für `docs/data-model.md` §8

Alle müssen `0` bzw. die erwartete Zeilenzahl liefern. Sie gehören ins Doku-Delta (M17), nicht erst in
M23 — eine Invariante, die erst Wochen nach dem Rollout dokumentiert wird, prüft in der Zwischenzeit
niemand.

```sql
-- Jeder aktive Touch hat eine zuständige Person (Trigger erzwingt es beim Insert)
select count(*) from reminder_touches where superseded_at is null and assigned_user_id is null;

-- ... und die Person ist Mitglied DERSELBEN Organisation
select count(*) from reminder_touches t where t.assigned_user_id is not null
  and not exists (select 1 from workspace_members wm
                   where wm.user_id = t.assigned_user_id and wm.workspace_id = t.workspace_id);

-- Kein Touch ohne Eltern-Termin (durch FK unmöglich — Gegenprobe nach jedem Backfill)
select count(*) from reminder_touches
 where coalesce(setting_call_id, closing_call_id) is null;

-- Höchstens ein aktiver Touch je (Termin, Kaskade, Stufe)
select entity_type, entity_id, cascade_kind, step_no, count(*)
  from reminder_touches where superseded_at is null
 group by 1,2,3,4 having count(*) > 1;

-- Ausschluss und Wiedervorlage schließen sich aus (jetzt CHECK — Gegenprobe)
select count(*) from contacts       where recycle_excluded_at is not null and next_recycle_at is not null;
select count(*) from phone_leads    where recycle_excluded_at is not null and next_recycle_at is not null;
select count(*) from setting_calls  where recycle_excluded_at is not null and next_recycle_at is not null;
select count(*) from closing_calls  where recycle_excluded_at is not null and next_recycle_at is not null;

-- Die zwei Codes ohne Recycling
select count(*) from closing_calls
 where lost_reason_code in ('falsche_zielgruppe','kein_fit') and next_recycle_at is not null;
select count(*) from setting_calls
 where disqualify_reason_code in ('falsche_zielgruppe','keine_zusammenarbeit') and next_recycle_at is not null;

-- Absage und No-Show-Ende sind an ihre Voraussetzung gekoppelt
select count(*) from setting_calls where cancel_outlook is not null and cancelled_at is null;
select count(*) from closing_calls where cancel_outlook is not null and cancelled_at is null;
select count(*) from setting_calls where no_show_resolution is not null and show_status is distinct from 'no_show';

-- Rückholung (K10): eine zurückgeholte Zeile steht in keiner Wiedervorlage mehr,
-- und der neue Vorgang zeigt auf höchstens eine Vorgängerzeile
select count(*) from setting_calls where revived_at is not null and next_recycle_at is not null;
select count(*) from closing_calls where revived_at is not null and next_recycle_at is not null;
select count(*) from setting_calls
 where revived_from_setting_call_id is not null and revived_from_closing_call_id is not null;

-- Vorlagen: keine persönliche Zeile eines Nicht-Mitglieds, keine zwei Org-Zeilen je Key
select count(*) from message_templates mt where mt.user_id is not null
  and not exists (select 1 from workspace_members wm
                   where wm.user_id = mt.user_id and wm.workspace_id = mt.workspace_id);
select workspace_id, template_key, count(*) from message_templates
 where user_id is null group by 1,2 having count(*) > 1;

-- Konfiguration: jede Organisation hat genau eine Zeile und ihre Stufen
select count(*) from workspaces w
 where not exists (select 1 from pipeline_settings p where p.workspace_id = w.id);
select count(*) from workspaces w
 where not exists (select 1 from cascade_steps c where c.workspace_id = w.id);
```

### 9.4 Rückfall, wenn ein Schritt scheitert

| Scheitert | Rückfall |
|---|---|
| **MS0** findet 0031/0032 doch live | Die Bestätigung des Auftraggebers wäre widerlegt und E3 (Direktumbau) hinfällig. Stopp, Vorlage an den Auftraggeber, keine eigenmächtige Umstellung auf Korrektur-Migrationen. Nach heutigem Stand ist das der unwahrscheinlichste Fall im ganzen Plan — die Messung läuft trotzdem, weil sie eine Stunde kostet und der Alternativpfad Wochen |
| **0031/0032/0033** im Verifikationsfenster | Nichts ist kaputt — der ausgelieferte Code kennt die Objekte nicht. Datei korrigieren, wiederholen (alle drei sind idempotent). Notfalls `drop` der neu angelegten Objekte in umgekehrter Reihenfolge |
| **Rauchtest** (MS5/MS7) findet einen Datenfehler | Der Weg zurück ist lang, weil die Oberflächen bereits umgebaut sind. Gegenmittel: der Rauchtest der neun Übergänge läuft **doppelt** — einmal direkt nach MS4 (nur DB und Actions, ohne UI) und einmal am Ende |
| **M10 trägt die Gruppierung nicht** (Karten zu groß, Zeitleiste unlesbar) | Rückfallplan: die Zeitleiste wird zur einzeiligen Statuszeile („1 von 3 erledigt · nächste heute 14:00"), die fällige Stufe bleibt aufgeklappt. Die Sammelaktion und die Kartenzahl bleiben — sie sind der eigentliche Ertrag von K1, nicht die Darstellung |
| **0034** nach dem Deploy | Eigene, einzeln zurücknehmbare Datei. Fällt sie aus, funktioniert die App vollständig; nur neue Organisationen bekommen kein Seeding (manuell nachholbar über `seed_workspace_defaults`), und Umzug/Löschvorschau bleiben auf ihrem heutigen, bekannten Stand |
| **0035** | Rein additiv, per `drop trigger` zurücknehmbar. Ohne sie bleibt der Grund ein Formular-Pflichtfeld statt eines DB-Pflichtfelds — funktional gleichwertig für die App, schwächer gegen direkte SQL-Schreibzugriffe |
| **M13** (Settings-Oberfläche trägt 34 Keys nicht) | Zwei Stufen, in dieser Reihenfolge. (1) **Ein** Text je Kaskade statt je Stufe — kostet die wörtliche Erfüllung von Konzept-Punkt B (drei verschiedene Reminder-Texte) und wird erst gezogen, wenn die Oberfläche nachweislich nicht trägt. (2) Wenn auch das scheitert: die **Lesekarte** aus §5.4 statt der beiden toten Formularkarten, und M13 rutscht in die zweite Welle zurück. Stufe 2 nimmt E1/E2 aus dem Kern und ist dem Auftraggeber vorzulegen, nicht still zu ziehen — sie kehrt den Nachtrag zu K6 um |
| **Abbruch mitten im Kern** | Der Schnitt ist so gelegt, dass nach **MS4** die Daten korrekt sind (H1, H2, H3 weg), nach **MS6** die Texte bedienbar (E1/E2, H4, H5) und nach **MS7** der Auftraggeber sein Diagramm sieht. Ein Abbruch zwischen MS4 und MS7 ist der ungünstigste Punkt: die neuen Ketten und Gründe existieren dann bereits, aber ohne Oberfläche, die sie sichtbar macht |
| **Abbruch nach dem Kern** (zweite Welle entfällt) | Deutlich weniger folgenreich als vor dem Nachtrag, weil E1/E2 nun im Kern liegen. Es bleiben zwei benannte Folgen: H6 offen (Closing-Show-Quote zählt Nachfass-Touches mit, und es gibt keine Recycling-Kennzahlen), und `docs/data-model.md` §1/§4/§5 bleiben erzählerisch veraltet, während §3/§6/§7/§8 durch das Doku-Delta stimmen. Das Lead-Dossier (G-3) fehlt — die einzige rote Konzept-Forderung, die dann offen ist |

### 9.5 Mandantenbetrieb — was der Rollout für Kunden bedeutet

- **Neue Organisation:** startet nach 0034 mit vollständiger Kaskaden-Konfiguration, ohne dass jemand
  `/settings` einmal speichern muss (heute nötig, M22). Texte sind **nicht** geseedet — sie kommen aus
  `TEMPLATE_DEFAULTS`, bis jemand sie bewusst ändert.
- **Bestandskunden:** bekommen dieselbe Ausstattung über den Backfill-Lauf am Ende von 0034.
- **Kein Backfill für Kaskade, Gründe und Recycling** (bewusst): sie gelten nur für Zeilen, die **nach**
  dem Deploy entstehen bzw. terminal werden. Ein rückwirkender Rollout risse einen Schwall sofort
  überfälliger Erinnerungen auf. Die Analyse-Blöcke sagen das (M12/M19), statt das Deploy-Datum als
  Arbeitsweise auszugeben — dieselbe Falle wie bei `phone_call_attempts` (0028).
- **Die gesonderten Listen sind trotzdem ab Tag 1 gefüllt**, weil sie als Sicht über den vorhandenen
  Zeilenzustand laufen: verlorene Closings und unqualifizierte Settings existieren bereits. Zeilen ohne
  erfassten Grund führt die Ansicht getrennt als „Ohne Angabe" mit einem Knopf „Grund nachtragen" —
  sie **fragt**, sie füllt nichts aus.
- **Texte sind ab dem Kern-Deploy in der Oberfläche änderbar** (Nachtrag zu K6, M13): der Owner pflegt
  den Standard der Organisation, jedes Mitglied übersteuert ihn für sich, und die Karte zeigt über den
  Quelle-Badge, welche Ebene gerade wirkt. **Geseedet wird trotzdem nichts** — solange niemand einen Text
  bewusst ändert, existiert keine `message_templates`-Zeile und es gilt `TEMPLATE_DEFAULTS`. Für den
  Kunden heißt das: die App schreibt von Tag 1 vollständige deutsche Nachrichten, und eine spätere
  Textverbesserung erreicht jeden, der nicht selbst Hand angelegt hat.
- **Plattform-Admin in fremder Organisation:** ist dort kein Mitglied. Er darf die Org-Standards der
  Kundenorganisation schreiben (`can_manage_org_settings` enthält `is_platform_admin()`), aber **keine**
  persönliche Vorlage dort anlegen und **keinen** Touch auf sich selbst erzeugen. Ein von ihm angelegter
  Termin ohne Zuweisung bekommt keine Kaskade — und das Layout sagt genau das, mit Zuweisen-Knopf
  daneben (`setAssignee()` erzeugt sie danach nach). Das ist die ehrliche Version des heutigen stillen
  Fehlverhaltens (IST §6.7).

---

## 10. Was der Plan bewusst nicht löst

1. **Kein Auto-Versand.** Weder WhatsApp noch LinkedIn noch Mail (E4). Die App liefert Text, Kanal,
   Adressat und einen Deeplink, der den Client mit vorbefülltem Text öffnet — der Nutzer schickt selbst
   und hakt ab. Das muss in der Oberfläche unmissverständlich sein.
2. **Keine Mail-Spur im Kern** (P12). §7 hält vier Andockpunkte offen, mehr nicht; der Bauplan liegt
   separat (`MODUL-mailversand.md`). Bis dahin laufen die Mail-Kaskaden mit `enabled=false` mit und
   erscheinen **nicht** in der Oberfläche — sonst konfiguriert ein Kunde Mails, die niemand verschickt.
3. **Kein Scheduler im Kern.** Fälligkeiten werden beim Seitenaufruf berechnet. Für Phase 2 ist
   `pg_cron` gesetzt (P13); ein im Kern mitlaufender, aufgabenloser Cron-Job wäre beim ersten echten
   Bedarf falsch konfiguriert.
4. **Keine Abbruchlogik in der Vor-Termin-Kaskade** (K1). Eine Bestätigung auf Stufe 1 lässt Stufe 2 und
   3 fällig; `requires_no_response` gilt ausschließlich für die Ketten (No-Show, Kein Close). Gelöst wird
   das Mengenproblem in der Oberfläche (§5.2), nicht im Datenmodell.
5. **Keine harte Kontaktfrequenz-Sperre** (K3). Es wird gewarnt, nicht unterdrückt; die Schwelle ist eine
   Code-Konstante, kein Kundenfeld. Die Termin-Kaskade ist von der Warnung ausgenommen.
6. **Keine kanalspezifischen Texte** (K9). Ein Text je Stufe für WhatsApp, LinkedIn und Telefon. Wer für
   einen Kanal anders formulieren will, ändert ihn vor dem Absenden — die Karte ist eine Kopier-Werkbank.
7. **Keine Zeitzonen-Unterstützung** (K4). `Europe/Berlin` bleibt fest verdrahtet, es entsteht **keine**
   Spalte, auch nicht vorsorglich. Die Beschränkung wird als **Produktgrenze** („nur DACH") in
   `docs/data-model.md` §6 festgeschrieben (M23) — sichtbar dokumentiert statt stillschweigend angenommen.
8. **Keine Onboarding-Strecke.** „Software Onboarding" wird ein Datumsfeld (`onboarding_at`) plus Häkchen
   in der Gewonnen-Erfassung, keine Checkliste und kein Prozess.
9. **Kein rückwirkender Rollout.** Kein Backfill für Touches, Absagegründe, Verschiebe-Zähler und
   Recycling. Erfundene Gründe wären schlechter als eine ehrliche Lücke.
10. **Keine kundendefinierten Kaskaden-Arten.** Ein Kunde kann Stufen einer bestehenden Kaskade
    hinzufügen, abschalten und umterminieren — aber keine neue Kaskadenart anlegen. `cascade_kind` ist per
    CHECK auf neun Werte gedeckelt, weil jede Art einen Auslöser im Code braucht.
11. **Keine automatische Kanal-Erkennung für Quellen ohne Vorlaufkanal.** Ads, Social Media und Sonstige
    haben keinen ableitbaren Kanal; die App zeigt das und lässt wählen, statt zu raten (docs §4).
12. **Kein Ersatz für die drei „Termin"-Definitionen.** Der Umbau fasst weder „gelegt" noch „absolut" noch
    die Pitch-Kohorte an (docs §5). Die neuen Kennzahlen liegen daneben, nicht darin. **Ausnahme, die
    dokumentiert gehört:** ab M20 zählt der **Funnel-Tab** abgesagte Termine nicht mehr, Übersicht,
    Kalender und „Termine im Zeitraum" schon (K5) — derselbe Termin erscheint also an zwei Orten mit zwei
    Zahlen. Das ist gewollt (Konversionsfrage vs. Kapazitätsfrage) und muss in `docs/data-model.md` §5
    stehen, sonst liest es sich wie ein Fehler.
13. **Kein Optimistic Locking** (K12). Der Zähler ist serverseitig atomar, das Erledigen revalidiert —
    mehr Nebenläufigkeitsschutz ist für zwei bis fünf gleichzeitige Nutzer nicht begründbar.
14. **Kein Test von RLS, RPCs und Indizes.** Die reinen Funktionen sind ab MS1 abgedeckt; RLS, die vier
    RPCs und der partielle Unique-Index bleiben durch den manuellen Rauchtest abgesichert. Ein
    DB-Integrationstest-Setup wäre ein eigenes Modul.
15. **`call_assignees` bleibt tot** und wird nicht mit aufgeräumt; **`followup_templates` wird nicht
    gedroppt**, nur stillgelegt. Der Drop kommt in eine spätere Migration, nachdem der Backfill im Betrieb
    verifiziert ist.
16. **Vier Auslegungen sind ausdrücklich als solche markiert**, damit ihnen widersprochen werden kann:
    (a) der Verschiebe-Zähler zählt nur den expliziten Lead-Anlass und nie den Kalender-Drag — die
    Unterscheidung steht so nicht im Konzept; (b) `keine_zusammenarbeit` (Setting) und `kein_fit`
    (Closing) setzen sofort `recycle_excluded_at`, also ein permanentes Kontaktverbot statt einer langen
    Frist — das Konzept sagt „kein weiteres kontaktieren!", nennt aber keine Rücknahmemöglichkeit;
    (c) M17, M19 und M22 werden dem Kern zugeschlagen, obwohl K6 sie in keinem Block nennt (§0.2);
    (d) ein per K10 zurückgeholter Vorgang startet mit `reschedule_count = 0` und bekommt die zwei
    Verschiebungen aus E6 erneut — konsistent mit E9, aber die Obergrenze wird dadurch umgehbar (§5.3).
17. **Zwei Widersprüche zwischen Entscheidungen sind aufgelöst, nicht wegdefiniert**, und die Auflösung
    steht dort, wo sie wirkt:
    - **§3.1 gegen K6 (ursprüngliche Fassung).** Der Kern lässt `reminder_settings`/`recycle_settings`
      entfallen, während der Editor (M13) in der zweiten Welle lag — `/settings` hätte damit nach dem
      Kern-Deploy zwei Formularkarten gezeigt, die in nicht mehr existierende Tabellen schreiben, und
      beide Actions verschlucken jeden Fehler. **Der Nachtrag zu K6 löst das an der Wurzel**, indem M13
      in den Kern rückt (§5.4); der frühere Notbehelf (Lesekarte statt Formular) bleibt nur noch als
      Rückfall in §9.4 stehen.
    - **E11 gegen K6.** „Alle acht Hoch-Lücken im selben Zug" trifft auf einen Umfangsschnitt, der die
      Auswertung nach hinten legt. Nach dem Nachtrag bleibt davon **eine** Lücke übrig — H6 — statt
      dreier; die Zuordnung steht je Zeile in §6, und der Kern liefert die Datenkorrektheit vollständig.
      Eine offene Anzeige-Lücke ist die verbleibende, bewusst getragene Abweichung von E11.
