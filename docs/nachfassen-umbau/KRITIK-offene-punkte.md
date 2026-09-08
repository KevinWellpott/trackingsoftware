## Offene Punkte am Zielplan — sortiert nach Wichtigkeit

---

**1. Die Vor-Termin-Kaskade hat keine Abbruchbedingung, wenn der Lead antwortet**

(a) `reminder_touches.outcome` kennt `bestaetigt`/`antwort` (Plan §3.2, Zeile 127), aber nirgends im Plan steht, was ein solcher Ausgang **bewirkt**. `requires_no_response` gilt laut §3.2 und M7 ausdrücklich nur für die zweistufigen Ketten (No-Show, Kein Close). Für `setting_msg_1..3` / `closing_msg_1..3` fehlt jede Regel. Das Konzept (Block B) sagt dazu ebenfalls nichts — es zeichnet drei Reminder ohne Ausgang.
(b) Ein Lead, der auf Reminder 1 („steht noch wie geplant?") mit „ja, passt" antwortet, erzeugt trotzdem Reminder 2 und 3; der Verkäufer muss zwei Karten wegklicken, die er nicht verschicken darf — genau das Verhalten, das die Boards heute unbrauchbar machen würde, sobald neun Kaskaden laufen.
(c) Optionen:
- **Bestätigung stoppt nur den nächsten Touch** — konservativ, aber der Nutzer klickt weiter zweimal.
- **Bestätigung supersedet alle noch offenen Stufen derselben Kaskade außer der Link-Stufe (`setting_msg_3`)** — der Termin-Link geht immer raus, das Nachhaken entfällt; deckt sich mit dem Text von Reminder 3 („wollte dir noch einmal den Link durchschicken").
- **Bestätigung supersedet die ganze Kaskade** — minimaler Aufwand, aber der Lead bekommt am Termintag keinen Link mehr.
- **Kein Abbruch, nur Markierung** (Status quo des Plans) — jede Stufe muss einzeln abgehakt werden.
(d) **Empfehlung:** zweite Option. Sie ist die einzige, die den Konzepttext von Reminder 3 respektiert, und sie kostet im Schema nichts — `outcome` und `superseded_at` existieren bereits.

---

**2. „Abgesagt, aber mit Aussicht auf einen neuen Termin" hat keinen Zustand — der Lead fällt aus allen Listen**

(a) Der Plan modelliert `cancel_outlook in ('ohne_aussicht','neuer_termin')`. `ohne_aussicht` speist `dropout_lists`. Für `neuer_termin` gibt es **keinen** Ort: die Kaskade ist superseded, `dropout_lists` filtert ausdrücklich auf `ohne_aussicht`, `nachfassen_tasks` bleibt unverändert (M16), `recycle_tasks` verlangt `status in ('dead','unqualifiziert')` o. ä. Das Konzept lässt hier eine ausdrückliche Entscheidung offen („hier bitte abwägen ob eine erneute Liste Sinn macht", zweimal im Diagramm) — der Plan schließt sie stillschweigend mit „keine Liste".
(b) Ein abgesagter Termin mit Aussicht auf einen neuen verschwindet vollständig aus der Oberfläche und wird nur wiedergefunden, wenn jemand sich erinnert — der häufigste und wertvollste Absagefall.
(c) Optionen:
- **Fünfte Ablage-Ansicht „Abgesagt — Ersatztermin ausstehend"** aus `cancelled_at is not null and cancel_outlook='neuer_termin' and appointment_at unverändert`; kostet eine Zeile in `dropout_lists`.
- **Pflichtfeld „Wiedervorlage am" bei der Absage** → speist `setting_calls.follow_up_due` und damit das bestehende `/nachfassen` ohne neue Struktur; braucht aber einen fünften Zweig in `nachfassen_tasks` (dessen Signatur der Plan bewusst nicht anfasst) oder einen Status-Trick.
- **Absage mit Aussicht = sofortige Pflicht-Neuterminierung** im selben Dialog; der Fall „weiß noch nicht wann" ist dann nicht abbildbar.
- Status quo belassen und ausdrücklich als Lücke dokumentieren.
(d) **Empfehlung:** erste Option — sie nutzt die Infrastruktur, die M11 ohnehin baut, und macht den vom Konzept offen gelassenen Punkt zu einer sichtbaren Entscheidung statt zu einem Loch.

---

**3. Kein Deckel und keine gemeinsame Sicht auf die Kontaktfrequenz eines Leads**

(a) Nach dem Umbau kann derselbe Lead gleichzeitig fällig sein in: `/erinnerungen` (bis zu 3 Nachrichten- + 3 Mail-Touches), `/nachfassen` (LinkedIn-FU, Telefon-Rückruf, Setting-/Closing-Wiedervorlage), Recycling und einer Ablage-Liste. Weder Konzept noch Plan kennen einen leadübergreifenden Schlüssel (ein `contact` und ein `phone_lead` derselben Firma sind zwei Zeilen), eine Mindestpause zwischen zwei Kontakten oder eine „zuletzt kontaktiert am"-Anzeige über alle Quellen.
(b) Der wahrscheinlichste sichtbare Fehler des fertigen Systems ist ein Lead, der an einem Tag drei Nachrichten aus drei Sektionen bekommt — und der Plan hat keine Stelle, an der das auffiele.
(c) Optionen:
- **Nur Anzeige:** das Lead-Dossier (M15) zeigt „zuletzt kontaktiert vor X Tagen" über alle Touch-Quellen; kein Eingriff, aber der Nutzer sieht es vor dem Absenden.
- **Weiche Warnung** auf der Karte, wenn für dieselbe Entität in den letzten N Tagen ein `done_at` existiert.
- **Harte Unterdrückung:** ein Touch wird nicht fällig, solange ein anderer Touch desselben Leads jünger als N Tage ist (`pipeline_settings.min_contact_gap_days`) — verschiebt aber Fälligkeiten und kollidiert mit „Reminder 3, 1 Stunde vorher".
- Nichts tun.
(d) **Empfehlung:** erste plus zweite Option. Eine harte Unterdrückung darf die Termin-Kaskade nie treffen (dort sind drei Kontakte in drei Tagen gewollt); die Warnung genügt für alles andere und braucht keine neue Konfiguration.

---

**4. Zeitzone ist im gesamten Plan hart „Europe/Berlin" — die Software geht an Kunden**

(a) M3 führt `berlinShiftMinutes` ein, M10 bucketet „in Berliner Zeit", die Invarianten und alle Datumsrechnungen des Plans folgen docs §6. Es gibt weder eine Workspace- noch eine Nutzer-Zeitzone. Der Auftrag nennt Mandantenfähigkeit ausdrücklich als Rahmenbedingung.
(b) Für einen Kunden in Wien fällt das nicht auf, für einen in Zürich/London/Dubai steht „1 Stunde vorher" um Stunden daneben — und zwar lautlos, weil die Kaskade nichts verschickt, sondern nur fällig wird.
(c) Optionen:
- **Bewusst bei Berlin bleiben** und es in `docs/data-model.md` als Produktgrenze festschreiben („nur DACH") — Aufwand 0.
- **`pipeline_settings.timezone` (Default `Europe/Berlin`)**, eine Zone je Organisation; alle Kaskaden- und Bucket-Rechnungen lesen sie statt der Konstante — mittlerer Aufwand, betrifft M3, M10, M16 und die Analyse-Bucketierung.
- **Zone je Nutzer** — korrekt für verteilte Teams, aber dann zeigen zwei Nutzer derselben Organisation dieselbe Zahl verschieden an; kollidiert mit docs §6.
(d) **Empfehlung:** zweite Option, aber **nur als Spalte mit Default jetzt und Auswertung später** — die Spalte kostet in 0032 nichts, das Nachrüsten nach dem Rollout kostet jede Bucket-Funktion doppelt. Entscheidung gehört dem Auftraggeber, weil sie den adressierbaren Markt betrifft.

---

**5. Absage und Verschiebung greifen in bestehende Kennzahlen ein, ohne dass der Plan das entscheidet**

(a) §3.2 begründet ausführlich, warum es **keinen** neuen `status`-Wert gibt, und leitet daraus ab, dass ein abgesagter Termin über `show_status is null` korrekt aus dem Show-Quoten-**Nenner** fällt. Nicht entschieden ist der **Zähler**: ein abgesagter Termin zählt weiter als „Termin Setting" in der Kanal-Matrix, in der ersten Trichterstufe des Funnel-Tabs, in „Termine im Zeitraum" und im Kalender (docs §5, §5.1). M20 nennt diesen Fall nicht.
(b) Sobald Absagen erfasst werden, sinkt jede Durchlassquote des Trichters gegenüber heute — ohne dass sich am Vertrieb etwas geändert hätte. Das ist genau die Sorte Zahlensprung, vor der docs §5 warnt („eine Zahl, die davon abhängt, wo man sie liest").
(c) Optionen:
- **Abgesagte Termine bleiben in allen Zählungen** (Status quo des Plans) — ehrlich für die Kapazitätsfrage, verzerrt die Konversionsfrage.
- **Der Funnel-Tab schließt `cancelled_at is not null` aus**, Übersicht und Kalender behalten sie — konsistent mit der bereits bestehenden Asymmetrie „Funnel schneidet bei heute ab".
- **Überall ausschließen** — verliert die Kapazitätsaussage.
- **Eigene Kennzahl „Absagequote"** zusätzlich, ohne die bestehenden Zähler anzufassen.
(d) **Empfehlung:** zweite plus vierte Option, und der Punkt gehört ausdrücklich in M20 und M23 — sonst ist er nach dem Deploy eine unerklärliche Verschlechterung im Reporting.

---

**6. Kein Gesamtaufwand, keine Priorisierung, kein MVP-Schnitt**

(a) 23 Module mit S/M/L/XL, 5 Migrationen, 10 Meilensteine — aber keine Summe, keine Kalenderabschätzung und keine Aussage, welche Module entfallen könnten. §9.4 sagt nur, dass ein Abbruch zwischen MS4 und MS6 der ungünstigste Punkt ist.
(b) Der Auftraggeber kann den Umfang nicht steuern: Er kann dem Plan nur ganz oder gar nicht zustimmen, obwohl mindestens M13 (XL), M20 (L) und M15 (M) fachlich nachrangig sind.
(c) Optionen:
- **Plan um eine Aufwandssumme und einen benannten „Kern" ergänzen** (Vorschlag: M0–M12 + M14 = Konzept erfüllt und Daten korrekt; M13, M15, M16, M18, M20, M21, M23 als zweite Welle).
- **Zwei Releases hart trennen** — Release 1 endet mit MS6 (Diagramm sichtbar), Release 2 bringt Konfigurierbarkeit und Auswertung; Entscheidung 1 (persönliche Vorlagen) verschiebt sich damit allerdings in Release 2.
- **Alles wie geplant** und Aufwand nur begleitend berichten.
(d) **Empfehlung:** erste Option. Der Schnitt bei M14 ist der einzige, nach dem sowohl die Daten stimmen als auch der Auftraggeber sein Diagramm sieht — genau die zwei Kriterien, die §9.4 selbst als Abnahmepunkte benennt.

---

**7. Löschung und Anonymisierung eines Leads sind nirgends behandelt**

(a) Code-belegt: `deleteContact` (contacts.ts:261) löscht die Kontaktzeile; `setting_calls.source_contact_id` ist `on delete set null` (0008:174). Der Setting-Call behält `lead_name`/`company` als Snapshot, behält seine Touches, bleibt in `dropout_lists` und in `recycle_tasks`. Der Plan erwähnt Löschung nur für Termine (FK-Cascade auf `reminder_touches`) und für Organisationen. Ein Auskunfts- oder Löschbegehren eines Leads ist im Modell nicht ausführbar.
(b) Bei einer Software, die an Kunden geht, ist das eine vertragliche Zusage, die der Kunde nicht einhalten kann — und der neue Umbau vervielfacht die Orte, an denen der Name eines Leads liegt (Touch-Snapshots, Ablage, Recycling-Notizen, `{notiz}`-Texte).
(c) Optionen:
- **Nichts tun**, Löschung bleibt eine manuelle SQL-Aufgabe des Betreibers.
- **Aktion „Lead anonymisieren"** — überschreibt Name/Firma/Telefon/Notizen in allen bekannten Tabellen, lässt Zähler und Kennzahlen stehen; ein eigenes kleines Modul (S–M).
- **Aktion „Lead vollständig löschen"** mit echter Cascade über Kontakt, Lead, Termine, Touches, Ablage — nimmt die Umsatzhistorie mit.
- Nur eine dokumentierte SQL-Vorlage in `docs/`, ohne UI.
(d) **Empfehlung:** vierte Option jetzt (kostet fast nichts und macht das Thema sichtbar), zweite Option als eigenes Modul außerhalb dieses Plans. Es gehört nicht in diesen Umbau, darf aber nicht unerwähnt bleiben.

---

**8. Abwesenheit, Vertretung — und wessen Konto die Nachricht verschickt**

(a) Touches hängen an `assigned_user_id` (Snapshot). Die Team-Ansicht auf `/erinnerungen` gibt es nur für `role='owner' && data_scope='workspace'`. Es gibt keine Vertretungs-/Urlaubsregel und keinen Weg, die Erinnerungen eines Abwesenden en bloc zu übernehmen. Zweitens: das Konzept verlangt „der Leadkanal worüber er kontaktiert werden muss" — aber der LinkedIn-Kanal gehört dem **Listen-Owner** (`owner_name`), während der Touch der **zugewiesenen Person** gehört; die beiden können laut docs §2 verschiedene Personen sein. Der Plan löst den Kanal auf, nicht den Absender-Account.
(b) Eine Woche Urlaub erzeugt eine Woche unbearbeiteter, überfälliger Touches, die niemand sieht; und ein zugewiesener Mitarbeiter bekommt die Anweisung „schreib ihm auf LinkedIn" für ein Profil, auf das er keinen Zugriff hat.
(c) Optionen:
- **Bulk-Umzuweisung**: `setAssignee` auf einer Mehrfachauswahl in `/erinnerungen` plus ein Filter „Person" in der Team-Ansicht — klein, löst den Urlaubsfall pragmatisch.
- **Vertretungsfeld je Nutzer** (`workspace_members.deputy_user_id`), Touches werden bei Abwesenheit zusätzlich beim Vertreter angezeigt — sauber, aber neue Konfiguration und neue RLS-Frage.
- **Absender explizit auf der Karte ausweisen** („über LinkedIn-Konto von Kevin") und bei Abweichung warnen — deckt die zweite Hälfte des Problems.
- Nichts tun.
(d) **Empfehlung:** erste plus dritte Option. Beide sind Anzeige- und Aktionsarbeit in M10/M14 und brauchen kein Schema; die Vertretungslogik wäre ein eigenes Feature.

---

**9. Ein Text für alle Kanäle — implizite Produktentscheidung**

(a) Der Katalog (§4.2) führt `setting_msg_1..3` genau einmal, unabhängig davon, ob der Touch über WhatsApp, LinkedIn oder Telefon geht. Das Konzept sagt „abhängig vom Kanal werden die folgenden Nachrichten per WhatsApp oder LinkedIn versendet" — es legt sich nicht fest, ob auch der **Text** kanalabhängig ist.
(b) LinkedIn-DM und WhatsApp haben unterschiedliche Anrede, Länge und Tonalität; ein Text für beides wird auf einem der beiden Kanäle falsch klingen — und der Nutzer editiert ihn dann jedes Mal von Hand, womit die ganze Vorlagenkette ihren Zweck verliert.
(c) Optionen:
- **Ein Text je Stufe** (Status quo des Plans) — 34 Keys, ein Bildschirm.
- **Optionale kanalspezifische Übersteuerung**: `message_templates` bekommt eine nullable Spalte `channel`; die Vorrangkette wird um eine Stufe länger (`channel-spezifisch → allgemein`), der Editor zeigt sie nur auf Wunsch. Schema-Kosten: eine Spalte plus ein Unique-Index.
- **Ein Text je Stufe je Kanal** — verdoppelt bis verdreifacht den Katalog und macht M13 unbedienbar.
(d) **Empfehlung:** zweite Option, aber die Spalte jetzt anlegen und die UI erst in der zweiten Welle freischalten. Nachträglich eingeführt bricht sie beide Unique-Indizes von `message_templates`.

---

**10. Ablage: Rückholung, Sichtbarkeit und Reichweite des Kontaktverbots sind unbestimmt**

(a) M11 nennt die Aktion „zurückholen", sagt aber nicht, in welchen Zustand: ein `status='verloren'`-Closing zurück auf `offen`? Ein `unqualifiziert`-Setting zurück auf `offen`? Ebenso offen: `dropout_lists` hat einen Personenfilter wie `nachfassen_tasks` — sieht ein Mitglied mit `data_scope='own'` also nur seine eigenen Ausschüsse, obwohl das Kontaktverbot (`recycle_excluded_at`) org-weit wirkt und jeder Kollege den Lead sonst neu anspricht?
(b) Ohne definierten Rückweg ist „zurückholen" ein Knopf, der Statistik verfälscht (ein zurückgeholtes verlorenes Closing verändert rückwirkend die Win-Rate des Zeitraums); ohne org-weite Sichtbarkeit des Kontaktverbots wird die rote Konzept-Notiz „kein weiteres kontaktieren!" von der nächsten Person umgangen.
(c) Optionen:
- **Rückholen = neuer Termin/Vorgang**, die alte Zeile bleibt terminal — die Historie bleibt sauber, kostet aber eine Anlagestrecke.
- **Rückholen = Statuswechsel auf der bestehenden Zeile** — einfach, ändert aber vergangene Kennzahlen.
- **Kein Rückholen**, nur „Recycling vorziehen" — minimal, deckt die meisten Fälle.
- Für die Sichtbarkeit: **Kontaktverbote immer org-weit anzeigen**, unabhängig von der Datensicht (eigene Sektion „Gesperrte Leads").
(d) **Empfehlung:** dritte Option für den Rückweg (das Recycling ist genau dafür da) plus die org-weite Sperrliste. Ein Statuswechsel, der die Win-Rate rückwirkend bewegt, widerspricht docs §5.

---

**11. Termine in der Vergangenheit und kurzfristig gebuchte Termine — Stufen fallen still weg**

(a) Heutiges Verhalten (`computeCascadeDueAts`, reminderCascade.ts:89-110): nur Touches mit Fälligkeit in der Zukunft werden angelegt. Der Plan übernimmt das (M3 beschreibt nur die DST-Korrektur) und erwähnt den Fall nicht. Damit bekommt ein Termin, der für morgen gebucht wird, keine Stufe 1; ein nachträglich erfasster Termin bekommt gar keine Kaskade — beides ohne Meldung. Für die neuen `anchor='after_appointment'`-Ketten ist derselbe Fall ungeklärt.
(b) Der Nutzer sieht ein leeres Kaskaden-Panel (M14) und kann nicht unterscheiden, ob die Kaskade fehlt, weil die Zeit nicht reichte, oder weil etwas kaputt ist — dieselbe Fehlerklasse, die H7 an anderer Stelle beheben soll.
(c) Optionen:
- **Verhalten beibehalten, aber begründen**: das Panel schreibt „Stufe 1 entfällt — Termin liegt in weniger als 3 Tagen".
- **Stauchen**: entfallene Stufen werden sofort fällig, damit wenigstens einmal bestätigt wird.
- **Untergrenze konfigurierbar** (`pipeline_settings.min_lead_time_hours`) und darunter gar keine Kaskade, dafür ein sofortiger Bestätigungs-Touch.
(d) **Empfehlung:** erste Option plus ein einzelner sofortiger Bestätigungs-Touch, wenn **keine** Stufe mehr passt. Stauchen erzeugt drei Nachrichten in einer Stunde und ist schlimmer als das Problem.

---

**12. Nebenläufigkeit: zwei Nutzer, derselbe Touch, derselbe Lead**

(a) Der Plan macht `apply_reminder_touches` atomar (M8-Fix) — das löst das Rennen zwischen zwei **Auslösern**, nicht das zwischen zwei **Nutzern**. Nicht behandelt: Owner (Team-Ansicht) und Assignee haken denselben Touch gleichzeitig ab; zwei Nutzer bearbeiten dieselbe Ablage-Zeile; `setReminderTouchDone` prüft nach dem Fix Organisation und Zuständigkeit, aber es gibt keine Anzeige „wurde vor 2 Minuten von X erledigt". Kein Optimistic Locking, kein `updated_at`-Vergleich in irgendeinem Schreibpfad des Plans.
(b) Bei Teams von 2–5 Personen ist der praktische Schaden gering (letzter Schreiber gewinnt), aber „Nochmal versucht" im Recycling erhöht `recycle_attempt_count` — zwei parallele Klicks verbrennen zwei von zwei erlaubten Versuchen.
(c) Optionen:
- **Nichts tun**, letzter Schreiber gewinnt; nur beim Recycling-Zähler serverseitig `count = count + 1` als atomares Update statt Lesen-Rechnen-Schreiben.
- **`done_by_user_id` auf der Karte anzeigen** und nach dem Erledigen revalidieren — macht die Doppelarbeit sichtbar.
- **Vollständiges Optimistic Locking** über `updated_at` in allen neuen Actions — teuer, für diese Teamgrößen unverhältnismäßig.
(d) **Empfehlung:** erste plus zweite Option. Der atomare Zähler gehört ohnehin in `schedule_recycle`/`markRecycleContacted` (M9), die Anzeige in M10.

---

**13. Entscheidung 8 („Ersatztermin startet die Kaskade neu") hat auf der Closing-Seite keinen Pfad**

(a) Code-belegt: es gibt `rescheduleSetting` und `moveSettingAppointment` (settingCalls.ts:148/209), aber **keine** Entsprechung für Closings — ein Closing-Termin wird nur über `updateClosingCall` mit `call_at` im Patch verschoben (closingCalls.ts:103-106). Der Plan unterscheidet in §3.2 sauber zwischen „Lead hat verschoben" (zählt) und Kalender-Drag (zählt nicht), nennt für das Closing aber keine der beiden Aktionen; M6 listet `closingCalls.ts` nur pauschal. Damit ist auf der Closing-Seite weder der Verschiebe-Zähler noch der Ersatztermin-Neustart eindeutig zugeordnet.
(b) Konzept-Block D („max. 2× verschieben") und Entscheidung 8 sind im Closing-Layout dann nur halb umgesetzt — und der Auftraggeber hat beide Blöcke ausdrücklich als strukturgleich gezeichnet.
(c) Optionen:
- **`postponeClosing` und `rescheduleClosing` als eigene Actions spiegeln**, `updateClosingCall` verliert `call_at` aus dem Patch-Typ — sauber, aber Anfassen von `ClosingCallEditor.tsx` (1101 Zeilen) und `TermineBoard.tsx`.
- **Eine gemeinsame Action für beide Tabellen** (`postponeAppointment(entityType, id, …)`) — weniger Code, aber die beiden Tabellen haben unterschiedliche Zeitspalten (`appointment_at` vs. `call_at`).
- **Kalender-Drag auch beim Closing nicht zählen, Verschiebe-Zähler nur im Editor-Dialog führen** — minimal, aber Verschiebungen über den Kalender bleiben unerfasst.
(d) **Empfehlung:** zweite Option, und M6 sollte die betroffenen Closing-Aufrufpfade genauso namentlich nennen, wie er es für `moveSettingAppointment` bereits tut — sonst wird die Asymmetrie erst beim Rauchtest in MS5 entdeckt.

---

### Was ich geprüft und **nicht** beanstandet habe

Bewusst nicht auf der Liste, weil der Plan sie belegbar behandelt: Vorlagen-Ebenen und Bestandskunden-Übergang (§4.1, `TEMPLATE_DEFAULTS` ohne Seeding, 0034-Backfill), fehlendes Schema vs. „nichts fällig" (M12/H7), Zombie-Touches (M5/H2/H3), Recycling-Rücknahme (M9/H1), Mandanten-Lifecycle (M17), Migrations-Reihenfolge und Verifikationsfenster (§9), sowie die drei bereits selbst als offen markierten Punkte (Route `/ablage`, Verschiebe-Zähler-Auslegung, `keine_zusammenarbeit` als permanentes Verbot) — die sind korrekt an den Auftraggeber adressiert und brauchen von mir keine Wiederholung.