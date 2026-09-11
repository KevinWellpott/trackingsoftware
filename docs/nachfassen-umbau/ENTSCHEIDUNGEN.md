# Entscheidungen zum Nachfassen-/Reminder-Umbau

Getroffen von Simon am 2026-09-08 im Gespräch. Quelle des Soll-Konzepts: Excalidraw „EXCALI.svg"
(Google Drive, 2026-09-08 12:13), rekonstruiert nach `KONZEPT-rekonstruiert.md`.

## Phase 1 — jetzt

| # | Thema | Entscheidung |
|---|---|---|
| 1 | **Vorlagen-Ebene** | Org-Default + persönliche Übersteuerung. Owner setzt den Standard der Organisation, jeder Nutzer darf ihn für sich überschreiben, Fallback auf den Org-Default. Vorbild: `followup_templates` (Migration 0011). |
| 2 | **Umfang der Übersteuerung** | ALLE Nachrichtenarten: Termin-Erinnerungen (Setting + Closing), No-Show- und Nachfass-Nachrichten, alle vier Recycling-Nachrichten, LinkedIn FU1–FU3 (letztere existieren pro Nutzer bereits, brauchen wieder eine Oberfläche). |
| 3 | **Migrationen** | 0031 und 0032 werden **direkt umgebaut**, nicht durch Korrektur-Migrationen ergänzt. Begründung: nirgends eingespielt, also kein Bestandsrisiko. |
| 4 | **Versand** | Bleibt manuell: fertiger Text + Kopieren + Erledigt-Häkchen. Kein Auto-Versand von WhatsApp/LinkedIn. |
| 5 | **Kaskaden-Konfiguration** | Vier getrennte Kaskaden mit je eigenen Offsets und Texten statt einem Offset-Tripel für alles. |
| 6 | **Verschieben** | Ab der 3. Verschiebung Warnung, die bestätigt werden muss, plus automatischer Vorschlag „auf gesonderte Liste (abgesagt ohne Aussicht)". |
| 7 | **Gesonderte Listen** | Eigener Navigationsbereich, der jede der vier Listen in einer gesonderten Ansicht zeigt: Abgesagt ohne Aussicht · Disqualifiziert · Kein Close · No-Show ohne Antwort. |
| 8 | **Recycling-Fristen** | Konzept-Fristen als Default (Disqualifiziert 8 Wochen, Kein Close 4 Wochen); die feinere Staffelung je Verlustgrund bleibt und übersteuert. |
| 9 | **No-Show-Ende** | Sobald ein Ersatztermin eingetragen wird, startet die volle Kaskade automatisch neu. |
| 10 | **Telefonnummer Qualifiziert → Closing** | Pflichtfeld mit begründeter Ausnahme: ohne Nummer kein Closing, außer aktiv „will keine Nummer rausgeben" → LinkedIn als Fallback-Kanal. |
| 11 | **Altlasten** | Alle 8 als „Hoch" eingestuften Lücken (H1–H8 aus `IST-STAND-nachfassen.md`) werden im selben Zug behoben. |

## Phase 2 — später

| # | Thema | Entscheidung |
|---|---|---|
| 12 | **Mail-Spur** | Vertagt. Datenmodell in Phase 1 so anlegen, dass die Mails ohne Umbau andocken. Bauplan liegt vor: `MODUL-mailversand.md`, 15 Arbeitspakete, 4–6 Wochen Kern. |
| 13 | **Zeitsteuerung** | `pg_cron` in Supabase (nicht Vercel Cron — keine Tarif-Abhängigkeit). Für Phase 1 voraussichtlich nicht nötig, Fälligkeiten sind beim Seitenaufruf berechenbar. |
| 14 | **Einwilligung** | Simon: „Wir brauchen kein Opt-In." Bewusst gegen den Befund entschieden, dass LG Köln 81 O 88/21 Terminbestätigung und -erinnerung als Werbung nach § 7 Abs. 2 Nr. 2 UWG einstuft. Risiko trägt die Kundenorganisation als Versender. Offen: ob der bestehende WhatsApp-Nachweis `wa_consent_at` bleibt. |

## Technisch belegte Randbedingungen

- **Google Kalender kann keine zeitgesteuerten Erinnerungsmails an Gäste senden.** `reminders.overrides`
  gilt nur für die eigene Kopie des Termins; Gäste werden nach ihren eigenen Einstellungen erinnert.
  Garantiert zugestellt wird dem Gast nur: Einladung, Änderung, Absage.
- **Keine Sendequittung für Kalender-Erinnerungen** über die Google-API.
- **Über die Calendar-API wäre lesbar:** Antwortstatus des Leads (zugesagt / abgelehnt / keine Reaktion),
  Absage und Verschiebung durch den Lead. Nicht Teil von Phase 1, aber wertvoller als „Mail ging raus".
- **Weder `setting_calls` noch `closing_calls` haben ein E-Mail-Feld** — Empfänger- und Absenderadresse
  existieren heute nirgends.
- **Vercel Hobby-Plan führt Cron nur einmal täglich aus** — für stundengenaue Auslösung unbrauchbar.

## Nachtrag 2026-09-08, 14:2x — Stopp-Kriterium M0 beantwortet

Simon hat bestätigt: **Migrationen 0031 und 0032 sind nicht eingespielt** — auf keiner Datenbank.
Damit steht Entscheidung 3 („0031/0032 direkt umbauen") endgültig, und M0 reduziert sich auf eine
Bestätigungsmessung, sobald ein `SUPABASE_ACCESS_TOKEN` in der Umgebung liegt.

## Nachtrag 2026-09-08 — Migrationen eingespielt

0031, 0032, 0033 und 0034 liegen auf der **Produktions-Datenbank**. Verifikation bestanden:
Katalog 31 Einträge, je Organisation eine `pipeline_settings`-Zeile und 21 `cascade_steps`
(davon 16 aktiv).

**Damit sind diese vier Dateien eingefroren.** Jede weitere Schema-Änderung braucht eine neue
Nummer. Beim Einspielen zu beachten: Die Supabase-Konsole fährt ein Skript in einer Transaktion —
ein Abbruch rollt die ganze Datei zurück. Wird eine Datei in Teilen ausgeführt (markierter Text),
entsteht dagegen ein Halbzustand; genau das ist bei 0031 passiert.

**Die Datenbank ist dem ausgelieferten Code voraus.** Der Branch ist nicht gemergt, `main` kennt
weder `/ablage` noch den Vorlagen-Editor. Das ist der geplante Verifikationszustand und
gefahrlos, weil die ausgelieferte App keine der neuen Tabellen liest.

## Nachtrag 2026-09-10 — Vier Lebenszyklus-Fragen beantwortet

Vor dem Produktivstart gestellt und von Simon entschieden. Alle vier sind **Verhaltensregeln,
keine Fehler** — die Software tut heute in jedem der vier Fälle etwas Definiertes, nur eben
nicht das Gewünschte. Keine blockiert den Deploy; die Umsetzung braucht eine neue Migration
(0041) und folgt nach dem Start.

**E-N1 · Recycling-Deckel erreicht → eigene Ablage-Liste.**
Heute wird `next_recycle_at` genullt, sobald `recycle_attempt_count >= max_attempts`; der Lead
steht danach in keiner einzigen Liste — auch nicht auf der Sperrliste. Er verschwindet, ohne
dass jemand das entschieden hat. Künftig trägt `dropout_lists()` eine **siebte Ansicht
„Recycling ausgeschöpft"**: sichtbar und nachschlagbar, aber ohne Aufgabe und ohne
Navigations-Zähler. Bewusst NICHT die Sperrliste — die ist ein Kontaktverbot, nicht ein
„hat nicht geklappt"; zwei Bedeutungen in einer Liste wären derselbe Fehler wie ein sechster
`status`-Wert für Absagen (§3 im Datenmodell).

**E-N2 · Sperre aufheben darf jeder, der die Zeile sieht.**
`recycle_excluded_at` wird heute an einer Stelle gesetzt und nirgends genullt — auch dann nicht,
wenn die Sperre automatisch aus `disqualify_reason_code='keine_zusammenarbeit'` entstand und der
Grund später korrigiert wird. Künftig gibt es „Sperre aufheben", ohne Rechtestufe.
**Der Zielkonflikt ist benannt und bewusst in Kauf genommen:** Die Sperre aus
`keine_zusammenarbeit` ist im Datenmodell als „kein weiteres Kontaktieren!" beschrieben, also
eine Zusage an den Lead und nicht bloß eine interne Notiz. Ein Recht, das jeder hat, entwertet
sie als verbindlich. Abgewogen gegen den Umstand, dass ein Fehlklick auf einer 28 Pixel hohen
Pille den Lead sonst für immer kostet — und dass die Sperre keine dokumentierte
Widerspruchserklärung ist, sondern eine Arbeitsnotiz. Zwei Sicherungen, die nichts blockieren:
eine Rückfrage, die den ursprünglichen Sperrgrund im Klartext nennt, und ein Protokolleintrag
(wer, wann). Wird die Sperre je zum echten Werbewiderspruch nach § 7 UWG, ist diese Entscheidung
neu zu treffen.

**E-N3 · Antwort im Recycling lässt die Karte stehen.**
Heute setzt „Reagiert" nur `recycle_responded_at`; `recycle_tasks` blendet die Zeile danach aus,
und sonst passiert nichts — kein Termin, keine Aufgabe, kein Statuswechsel. Künftig wechselt die
Karte auf **„Reagiert — Termin vereinbaren"** und verschwindet erst, wenn jemand gehandelt hat.
Begründung: Eine Antwort ist der wertvollste Moment im ganzen Recycling. Sie darf nicht der
Moment sein, in dem die Karte verschwindet.

**E-N4 · Persönliche Vorlagen sieht nur ihr Besitzer.**
`message_templates_select` (0031) lässt heute jedes Mitglied mit `data_scope='workspace'` die
persönlichen Texte der Kollegen lesen; der Kommentar in der Migration behauptet, das sei auf den
Supportfall beschränkt — die Policy sagt etwas anderes. Künftig: **nur `auth.uid()`**, plus
`is_platform_admin()` für den Supportfall, der damit dort liegt, wo er hingehört. Die Org-Ebene
(`user_id is null`) bleibt für alle Mitglieder lesbar — sie ist der gemeinsame Standard.
Schreibrechte ändern sich nicht. Anlass: Die Software geht an Kunden; ein persönlicher Text ist
persönlich. 0031 ist eingefroren, die Policy wird in 0041 ersetzt.

## Nachtrag 2026-09-10 — Mail-Spur: Resend, mit Rückfall aufs Kopieren

Ergänzt Phase 2 (M21). Weiterhin **ohne Priorität** — erst nach der Kernfunktionalität.

**E-M1 · Versand über Resend, aber nur zentral für TitanPitching.**
Kundenorganisationen und externe Mandanten bringen ihren **eigenen Key** mit. Begründung:
Ein gemeinsamer Absender hieße, dass TitanPitching für Zustellbarkeit und Rechtslage fremder
Kundenmails einsteht — und ein einziger Spam-Report träfe die Domain aller anderen. Der Key
gehört damit auf die **Organisations-Ebene** (neben `pipeline_settings`), nicht in eine
Umgebungsvariable; sonst wäre er wieder zentral. Dass damit ein Fremdschlüssel eines Kunden in
unserer Datenbank liegt, ist eine bewusste Folge und beim Bau eigens zu behandeln.

**E-M2 · Ohne Key: Mail-Stufen als Kopier-Karte, nicht ausgeblendet.**
Eine Organisation ohne Resend-Key bekommt dieselbe Karte wie bei den Nachrichten-Stufen —
fertiger Text zum Kopieren, Erledigt-Häkchen, `outcome`. Das ist konsequent: Die gesamte
Kaskade ist eine Kopier-Werkbank (§1 im Datenmodell), der Automatikversand ist der Zusatz,
nicht die Grundlage. Ausblenden hätte die Stufe aus der Kaskade genommen und damit den
Nachfass-Rhythmus je nach Konfiguration verschieden lang gemacht.

**E-M3 · Absender ist immer eine feste Adresse — eine je Organisation.**
Nicht die persönliche Adresse des Verkäufers. Gelesen als **eine feste Adresse je
Organisation**, konfiguriert neben dem Key: Eine global feste Adresse ist für eine
Kundenorganisation mit eigenem Key und eigener Domain gar nicht möglich.
**Der Platzhalter `{absender}` bleibt davon unberührt** — er steht in der Signatur und nennt
weiter die zuständige Person. Der Verkäufer steht also unter der Mail, sie kommt nur nicht von
seiner Adresse.

**Offen, sobald M21 beginnt — die Empfängeradresse.** Sie existiert heute für einen der drei
Ursprünge: `phone_leads.email` (aus dem CSV-Import). `contacts` (LinkedIn) hat keine, ein
manuell angelegter Termin auch nicht, und weder `setting_calls` noch `closing_calls` tragen ein
E-Mail-Feld. Ohne Empfänger ist die Mail-Spur für LinkedIn- und Direkt-Termine nicht
lauffähig — zu klären ist, ob die Adresse im Erstgespräch eingesammelt wird (wie `wa_phone`,
§3) oder ob die Spur für diese Ursprünge auf E-M2 zurückfällt.

**E-M4 · Die E-Mail-Adresse wird eingetragen oder aktiv ausgelassen.**
Nachtrag zur offenen Frage aus E-M3. Kein stilles Fehlen: Das Erstgespräch sammelt die Adresse
ein, oder jemand hält fest, dass der Lead sie nicht herausgibt — **wörtlich dasselbe Muster wie
`wa_phone` / `wa_refused_at`** (§3 im Datenmodell), inklusive Pflichtfeld-Gate im Editor vor dem
Anlegen des Closings. Damit lässt sich eine bewusste Ablehnung von einer Erfassungslücke
unterscheiden, und das ist die Voraussetzung dafür, dass die Kennzahl „wie viele Leads sind per
Mail erreichbar" überhaupt etwas bedeutet.

Die Adresse gehört ans **Erstgespräch**, nicht an den Lead — aus demselben Grund wie bei der
WhatsApp-Nummer: `phone_leads.email` stammt aus dem CSV-Import und ist die Firmenadresse
(`info@…`), während hier die persönliche des Entscheiders gemeint ist; LinkedIn- und
Direkt-Termine haben ohnehin keine Lead-Zeile. Beim Erfassen gilt derselbe Vorrang wie sonst:
liegt eine importierte Adresse vor, wird sie vorgeschlagen, aber nicht ungefragt übernommen.

Zwei Folgen, die beim Bau anstehen: Der Kanal-Auflöser (`resolveCascadeChannel` /
`resolveFollowUpChannel`, `src/lib/reminderCascade.ts`) bekommt Mail als weitere Stufe, und die
Pflichtfeld-Prüfung im Setting-Editor muss dieselbe Bedingung prüfen wie der Auflöser — genau
der Fehler, der bei WhatsApp einmal durchgerutscht ist (Gate prüfte die Nummer, der Kanal
verlangte Nummer UND Einwilligung).

## Nachtrag 2026-09-11 — DER RÜCKBAU

Drei Tage nach dem Produktivstart hat der Geschäftspartner das Nachfass-System zurückgewiesen.
Wörtlich:

> „Wir haben Kaskaden mit Stufenlogik, Template-Kataloge, Recycling-Regeln mit Reason-Codes und
> Wiedervorlage-Fristen pro Einwandtyp. Das ist ein Produkt für eine Firma mit zwanzig Settern.
> Wir sind zu dritt."

Sein Zielbild ist **eine Liste je Person mit den Namen, die genervt werden müssen**. Vorbild ist
ausdrücklich die LinkedIn-Liste — „nur EIN Feld, was Gold leuchtet". Die Regel dazu: „Wer offen
ist, wird jeden Tag kontaktiert. Ohne Ausnahme, ohne Intervall-Logik. Er verschwindet von der
Liste, wenn er entweder neu terminiert ist oder als tot markiert wird. Nichts anderes nimmt ihn
da runter."

**Das ist keine Fehlerkorrektur, sondern eine Produktentscheidung**, und sie richtet sich gegen
die Entscheidungen 1, 2, 5 und 7 dieses Dokuments. Deren Begründungen waren nicht falsch — sie
beantworteten eine Frage, die dieses Team nicht hat. Umgesetzt in drei Wellen (`4189cbd`
Oberfläche · `d8c654f` Arbeitsliste · `e87a924` Kaskaden-Kern) plus einer adversarischen Prüfung
(`0fdfce8`).

### R1 · Die Zustände werden ABGELEITET, nicht gespeichert

Die Arbeitsliste trägt je Zeile genau einen von zehn Zuständen (`verlegt` · `offen` · `show` ·
`no_show` · `qualifiziert` · `closing_gelegt` · `nicht_qualifiziert` · `tot` · `close` ·
`kein_close`). **Keiner davon steht in einer Spalte.** Sie werden bei jedem Rendern aus `status`,
`show_status`, dem Termin, `cancelled_at`, `cancel_outlook`, `no_show_resolution` und
`revived_at` berechnet (`src/lib/dranRegel.ts`).

Die naheliegende Alternative — eine `zustand`-Spalte — ist aus einem Grund verworfen worden, der
schwerer wiegt als der Aufwand: **`offen` heißt in der Liste das GEGENTEIL des gespeicherten
Werts.** In der Datenbank ist `setting_calls.status='offen'` der Anfangszustand und bedeutet
„ein Termin steht, das Ergebnis fehlt"; in der Liste bedeutet `offen` „es steht **kein** Termin,
der Mensch liegt in der Luft". Dieselben fünf Buchstaben, entgegengesetzte Aussagen. Wer den
gespeicherten Wert übernommen hätte, hätte die Bedeutung des halben Bestands umgedreht, **ohne
dass irgendwo eine Zahl rot geworden wäre**. Eine abgeleitete Größe kann dagegen nicht
auseinanderlaufen: Es gibt nichts, was falsch stehen könnte.

Zweite Folge derselben Wahl: Die fünf Quoten des Termin-Funnels, der Trichter und die
Absagequote rechnen unverändert auf `status`/`show_status` weiter. Ein neuer Statuswert hätte
jede dieser Definitionen zu einer Entscheidung gezwungen — genau der Grund, aus dem schon
Migration 0032 dem Termin-Lebenszyklus **eigene Spalten** gab statt eines sechsten
`status`-Werts. Der Rückbau setzt diese Linie fort, statt sie zu brechen.

### R2 · Die Tabellen bleiben stehen. Nur der Code fällt.

`template_catalog`, `message_templates`, `cascade_steps` und `reminder_touches` existieren
unverändert weiter und werden von **keiner Zeile Code** mehr gelesen oder geschrieben. Kein
`drop table`, kein Backfill, keine Zeile wird umgedeutet.

Drei Gründe, der dritte ist der eigentliche:

1. **Ein `drop table` ist der riskante Teil, nicht der Gewinn.** Es wäre eine eigene Migration mit
   vier Kaskaden-Fremdschlüsseln, zwei RLS-Paaren und je einem Eintrag in Löschvorschau (0036)
   und Nutzer-Umzug. Eine ungelesene Tabelle kostet Plattenplatz, sonst nichts.
2. **Es ist das bewährte Muster dieses Projekts.** `call_assignees` steht seit Migration 0028
   ungelesen da, `followup_templates` seit 0034 — beide aus demselben Grund, und beide haben
   seither nie gestört.
3. **Die Zeilen sind Daten.** `reminder_touches` trägt die Erledigungs-Historie aus zwei
   produktiven Tagen. Ein Wiedereinstieg — in welcher Form auch immer — beginnt sinnvollerweise
   mit dem Blick darauf, was damals erledigt wurde und was nicht. Wer die Tabelle löscht, wirft
   die einzige Messung weg, die je über die Kaskade vorlag.

Dieselbe Linie gilt für die **Funktionen**: `apply_reminder_touches()` und `nachfassen_tasks()`
haben keinen Aufrufer mehr und bleiben trotzdem stehen (ein `drop function` nähme Grants und
Abhängigkeiten einer produktiv erreichbaren Funktion mit); und in Migration 0041 bleiben
`require_cancel_reason()` / `require_disqualify_reason()` stehen, obwohl ihre Trigger fallen — in
ihnen steckt nicht die Regel, sondern die Bauart, die Bestandszeilen verschont.

**Für Auswertungen ist das die wichtigste Konsequenz des ganzen Rückbaus:** Diese vier Tabellen
beantworten die Frage „was war zwischen dem 8. und dem 10. September 2026" — sonst nichts. Eine
Kennzahl darauf ist ab dem Deploy konstant und sinkt danach nie wieder. Wer aus ihrer Leere
schließt „es wird nicht nachgefasst", irrt. `docs/data-model.md` §3 sagt es an jeder einzelnen
Tabelle noch einmal.

### R3 · Das Recycling bleibt — flach

Es fällt **nicht** mit, und das ist die eine Stelle, an der der Rückbau bewusst haltmacht. Zwei
Gründe:

* **Fachlich:** Das Recycling ist kein tägliches Nerven, sondern eine Wiedervorlage nach Wochen
  bis Monaten (28–270 Tage). Stünde ein Recycling-Lead in der Tagesliste, fiele er unter deren
  einzige Regel — „jeden Tag kontaktieren" —, und die ist für ihn genau falsch.
* **Strukturell, und das entscheidet:** Das Recycling deckt **vier** Ursprungstabellen ab,
  darunter `contacts` und `phone_leads`. Die haben gar keinen Termin und können in einer
  Terminliste nicht vorkommen. Ein LinkedIn-Kontakt nach FU3 ohne Antwort wäre nach einem Umzug
  **nirgends** mehr erreichbar — das Listen-Board schließt genau ihn aus (`follow_up_number !== 3`
  gegen `follow_up_number = 3` im Recycling-Zweig: zwei disjunkte Mengen). Deshalb bleibt
  `/nachfassen` als eigene Seite bestehen und trägt ab jetzt ausschließlich das Recycling.

**Flach heißt: in der Oberfläche, nicht in der Datenbank.** `schedule_recycle()` ist eingefroren
(0033) und sucht sich die Wartezeit unverändert aus einer von **vierzehn** Spalten, je nach
Ursprung und Verlustgrund. Was fällt, sitzt eine Ebene darüber: In `/settings` steht nur noch
**ein** Feld „Recycling — Wartezeit (Tage)", und es schreibt **alle vierzehn Spalten mit derselben
Zahl**. Ein Feld, das nur eine Spalte schriebe, wäre eine Behauptung — in der Oberfläche stünde
eine Frist, in der Datenbank gälte für drei der vier Ursprünge weiter die alte Staffelung,
sichtbar nirgends. Solange in einer Organisation niemand gespeichert hat, gelten die geseedeten,
gestaffelten Werte; erst der erste Klick auf Speichern ebnet sie ein.

**Der Versuchs-Deckel ist die Korrektur innerhalb der Korrektur.** `max_attempts` war mit der
Staffelung aus Einstellungen *und* Analyse geflogen — nur aus der Datenbank nicht:
`recycle_attempt()` nullt beim Erreichen `next_recycle_at`, der Lead verschwindet endgültig aus
der Wiedervorlage. Er wirkte also weiter, war aber unsichtbar und für niemanden verstellbar. Ihn
faktisch abzuschalten ginge nicht ohne Migration (der CHECK aus 0032 klemmt ihn zwischen 1 und 5,
einen „greift nie"-Wert gibt es dort nicht). Also steht er wieder in `/settings`, als drittes von
drei Feldern. **Was wirkt, muss man sehen und stellen können** — das ist die Grenze, an der
„weniger Bedienoberfläche" aufhört, ein Gewinn zu sein.

### R4 · Der Telefon-Rückruf wird ein REITER, keine Zeile in der Liste

Er ist die einzige Aufgabe der ganzen Software mit einer **mit dem Lead verabredeten Uhrzeit**
(`callback_at`) und entscheidet „du bist dran" deshalb auf die Minute, während die Liste daneben
auf Berliner Kalendertage rechnet. In eine gemeinsame Tabelle gemischt stünden in derselben
Spalte zwei verschiedene Dringlichkeits-Begriffe — man müsste entweder seine Uhrzeit oder die
Tages-Körnung der anderen aufgeben.

Er steht aber auf **derselben Seite**, weil es dieselbe Frage ist („um wen kümmere ich mich
jetzt") und weil eine eigene Seite für eine Handvoll Zeilen genau der Überbau wäre, gegen den
sich dieser Rückbau richtet. `/termine` trägt damit drei gleichrangige Reiter — **Liste ·
Kalender · Rückrufe** — und öffnet in der Liste. Bis hierher öffnete die Seite im Kalender, und
die Liste lag hinter einem unbeschrifteten Umschalt-Knopf ganz rechts: Sie war da, aber niemand
fand sie. Der Kalender beantwortet „wann habe ich was", die Liste „wen muss ich heute nerven" —
und die zweite Frage stellt sich jeden Morgen, die erste nicht.

Bewusst **keine gespeicherte Vorliebe** für den Startreiter: Wer einmal in den Kalender wechselt
— und das tut jeder, der einen Termin sucht —, bekäme dauerhaft den Kalender als Startseite und
sähe seine Arbeitsliste nie wieder von selbst. Die Ansicht steht deshalb ausschließlich in der
URL; ein geteilter Link auf `?view=woche` funktioniert unverändert.

### R5 · Der Nachfass-Stempel — ein Feld, kein Ereignis-Log

Ohne eine Spur davon, wann zuletzt kontaktiert wurde, leuchtet jede Zeile jeden Tag gleich hell:
Es gibt nichts abzuhaken, und niemand sieht, ob heute schon jemand drangewesen ist. Migration
0041 legt dafür `follow_up_last_contacted_at` + `follow_up_last_contacted_by_user_id` auf beiden
Termin-Tabellen an; der Ein-Klick-Knopf „Genervt" stempelt hinein, die Zeile wird ruhig und
leuchtet morgen wieder.

Vier Entscheidungen stecken darin:

* **WIE genervt wurde, interessiert bewusst niemanden** — „DM, Anruf, WhatsApp, Mail,
  Brieftaube". Kein Kanal, keine Stufe, kein Text. Genau das war die Kaskade.
* **Ein Zeitpunkt, keine Historie.** Wer dreimal nachgefasst hat, hinterlässt eine Zeile, nicht
  drei. Ein Ereignis-Log je Klick wäre `reminder_touches` in neuer Form — der Überbau, der gerade
  abgeräumt wurde. Das Lead-Dossier sagt die Grenze offen dazu („frühere Nachfass-Kontakte hält
  die App nicht fest"), statt einen einzelnen Eintrag wie einen Verlauf aussehen zu lassen.
* **Zwei Spalten, nicht eine.** Das Recycling kommt mit dem Zeitstempel allein aus; hier reicht
  er nicht, weil mit der Kaskade auch die Erledigungs-Historie fällt, die bisher festhielt, wer
  etwas getan hat. Käme nur ein Zeitstempel, hielte anschließend **nirgends** mehr etwas fest,
  wer einen Lead angefasst hat. Zu dritt ist „hast du den angerufen oder ich?" die Frage, die
  täglich anfällt. Die Person ist dabei ein **AUDIT-Feld** in der Bedeutung von
  `created_by_user_id` (die real angemeldete Person, nicht die eingestellte Datensicht) — die
  Personenachse jeder Auswertung bleibt `assigned_user_id`.
* **Konvention von `recycle_last_contacted_at` (0033) kopiert:** `timestamptz`, nullable, ohne
  Default, ohne Backfill, ohne Index. Ein Default `now()` behauptete für jeden Bestandstermin, er
  sei heute nachgefasst worden — die ganze Liste wäre am ersten Tag abgehakt. Die beiden Felder
  leben nebeneinander weiter (Recycling für die toten Enden, Stempel für die offenen Vorgänge);
  zwei Konventionen für dieselbe Bedeutung wären ein teurer Fehler.

### R6 · Was bewusst NICHT mitgefallen ist

Ein Rückbau, der zu viel herausreißt, ist teurer als der Überbau. Das Folgende liegt nachweislich
unverändert da — `tests/rueckbauAnalyse.test.ts` sichert die Auswertungs-Zeilen als Gegenprobe:

| Was | Warum es geblieben ist |
|---|---|
| **LinkedIn-Liste und Telefon-Funnel** | Sie waren nie Teil des Überbaus. Die LinkedIn-Liste ist im Gegenteil das erklärte **Vorbild** — ihre Gold-Regel wurde herausgelöst und wird jetzt geteilt (`src/lib/dranRegel.ts`), statt ein zweites Mal formuliert zu werden |
| **Die fünf Quoten des Termin-Funnels** | Sie hängen an `status`/`show_status`/`cancelled_at`, nicht am Überbau |
| **Der Trichter und die Absagequote** | dieselbe Begründung; die Absagequote ist zusätzlich die einzige Brücke zwischen zwei Termin-Zählweisen |
| **Die Vergleichsseite** (`/analyse/vergleich`) | keine Zeile berührt |
| **Der Termin-Lebenszyklus** (0032) | Absage, Verschiebung, No-Show-Ausgang, Disqualifikationsgrund bleiben vollständig — sie sind die Grundlage der abgeleiteten Zustände aus R1, nicht ihr Gegenstück |
| **Das Verschiebe-Kontingent `max_reschedules`** | Es lag im Erinnerungs-Modul und ist **vor** dessen Löschung nach `actions/pipelineSettings.ts` umgezogen. Es ist kein Kaskaden- und kein Recycling-Feld, sondern steuert genau die Unterscheidung, auf der die neue Arbeitsfläche steht: „liegt in der Luft" gegen „ist versorgt". Wäre es mitgefallen, verschwänden die Verschiebe-Warnung und die Lebenszyklus-Leiste **lautlos** — ein fehlender Hinweis ist kein Fehler, den jemand meldet |
| **`revived_at`** | Die Spalte war seit 0032 vorbereitet und wurde von keinem Schreibpfad gesetzt. Der Rückbau hat ihr endlich einen gegeben (`setNeuerTermin`): Sie ist das dritte Signal, ohne das „abgesagt, altes Datum steht noch drin" nicht von „abgesagt, danach neu terminiert" zu unterscheiden ist |
| **Der Altlasten-Schnitt** | Er ist **kein Intervall** und widerspricht der Ansage „jeden Tag kontaktieren" deshalb nicht: Jeder Klick auf „Genervt" erneuert das Lebenszeichen, ein täglich bearbeiteter Lead kann nie zur Altlast werden. Ohne ihn stünden am ersten Tag zweihundert Zeilen gleichzeitig gold da — und zweihundert goldene Zeilen sind dasselbe wie keine |

### R7 · Die Ablage: aus sechs Ansichten werden zwei

Die sechs Reiter hatten ihren Sinn, solange der **Grund** eine Folge hatte: Er bestimmte die
Recycling-Wartezeit und die Kaskade. Beides ist gefallen. Damit unterscheiden vier der sechs
Listen nur noch die *Art* des Endes — und die steht seither als Kennzeichen auf jeder Karte.
Geblieben sind **Ausgeschieden** (die vier Endzustände zusammengelegt) und die **Sperrliste**
(das Kontaktverbot, org-weit sichtbar, als einzige über alle vier Ursprungstabellen).

**Eine Liste ist ersatzlos weg: „Abgesagt, Ersatztermin steht aus".** Sie beschrieb keinen
Endzustand, sondern einen Lead ohne nächsten Termin — also genau den, der jetzt in der
Hauptliste steht und täglich genervt wird. Ein Archivreiter für offene Arbeit war schon vorher
die Ausnahme (er war der einzige mit einem Zähler); neben der Arbeitsliste wäre er eine zweite,
stille Arbeitsliste. **Die RPC `dropout_lists()` bleibt unverändert** und kennt weiterhin alle
sechs Werte; die App fragt fünf davon ab. Alte `?liste=`-Adressen führen auf die Ansicht, in der
ihr Inhalt jetzt liegt.

### R8 · Was die adversarische Prüfung nachgezogen hat

Nach den drei Wellen wurde gegen den Rückbau geprüft, nicht mit ihm. Acht Befunde, die
Entscheidungen enthielten und nicht nur Fehler waren:

1. **Der Blocker.** Ein fehlgeschlagener Klick auf „Termin" ließ die Zeile mit gesetztem
   `revived_at` zurück. Sie passierte danach den Absage-Riegel, galt über ihr altes Datum als
   „Verlegt" und verschwand **lautlos** aus Arbeitsliste UND Recycling (`recycle_tasks` verlangt
   `revived_at is null`) — während der Nutzer eine Fehlermeldung sah und glaubte, es sei nichts
   passiert. Seither wird der selbst gesetzte Stempel zurückgenommen. Die Regel dahinter:
   **Jede Fehlerbehandlung führt in „bleibt Arbeit", nie in „ist versorgt."** Ein Lead, der
   einmal zu viel auf der Liste steht, kostet einen Klick; einer, der zu früh verschwindet, ist
   weg.
2. **`show_status` beim Umterminieren.** `rescheduleSetting` setzt Status und Show-Status zurück
   — bei einem No-Show richtig, weil er in `no_show_count` erhalten bleibt. Ein
   `show_status='show'` steht dagegen in keiner zweiten Spalte: Der Reset wäre eine **Löschung**,
   und weil die Zeile zugleich in den Monat des neuen Termins wandert, verlöre die Show-Quote
   eines abgeschlossenen Zeitraums ihren Zähler. Eine bereits erschienene Zeile bekommt deshalb
   nur ein neues Datum (`moveSettingAppointment`).
3. **Zwei Ablage-Zustände standen gleichzeitig in der Tagesarbeit.** „Abgesagt ohne Aussicht" und
   „No-Show ohne Antwort" lassen `status` unangetastet (das ist die Entscheidung aus 0032) und
   landeten deshalb als `offen`/`no_show` in der Arbeitsmenge — täglich gold *und* zugleich in
   der Ablage. Beide werden jetzt auf den vorhandenen negativen Zustand abgebildet (`tot` bzw.
   `kein_close`). **Bewusst kein elfter Zustand „ausgeschieden":** Die zehn sind wörtlich die
   Liste des Auftraggebers, und beide Fälle haben in seinen Worten längst einen Namen.
4. **Die Navigations-Zähler zählten falsch.** Der Nachfassen-Zähler las noch beide RPCs, während
   die Seite drei ihrer Zweige abgegeben hatte — das Badge zeigte 14, die Seite darunter zwei
   Karten. Der Ablage-Zähler zählte eine Liste, die es in der Oberfläche nicht mehr gab. Damit
   ist die alte Regel („das Badge zählt mehr, die Seite erklärt die Differenz") **aufgegeben**:
   Sie trug, solange die Differenz eine benannte Menge war. Übrig ist **ein** Zähler, der
   dieselbe Quelle mit denselben Schnitten liest wie seine Seite. `/termine` bekam bewusst
   keinen — sein Gold ist abgeleitet, ein Badge müsste die Regel ein zweites Mal formulieren.
5. **Der Datumsschnitt lief im Browser.** Die Terminliste holte sich ihr „heute" selbst — auf
   Vercel (UTC) abends ein anderer Tag als im Client, und für jeden außerhalb Berlins ein
   dritter. Beides schlägt unmittelbar auf die Gold-Regel durch, weil die den Nachfass-Stempel
   über Berlin bucketet. `today` kommt jetzt vom Server.
6. **Acht Dialogtexte behaupteten Erinnerungen und Ketten**, die es nicht mehr gibt — die
   Lebenszyklus-Leiste, die drei No-Show-Ausgänge, der Blockieren-Dialog der LinkedIn-Liste und
   die Absage-Ausblicke, die noch die alten Ablage-Reiter nannten. Ein Rückbau, der die Funktion
   entfernt und ihre Versprechen stehen lässt, ist schlimmer als keiner.
7. **Der Versuchs-Deckel** — siehe R3.
8. **Der Seitenname.** `/nachfassen` heißt auf dem Bildschirm „Recycling". Route, Datei und
   Server-Action behalten den alten Namen, weil Lesezeichen und der Rückweg der Detailseiten
   (`?from=nachfassen`) daran hängen.

### R9 · Was der Rückbau ÜBERHOLT — nicht vergessen, sondern gegenstandslos

Die folgenden Entscheidungen dieses Dokuments sind mit dem Rückbau **hinfällig**. Sie stehen oben
unverändert, damit ihre Begründungen nachlesbar bleiben; umzusetzen ist keine davon. Wer sie
liest, ohne diesen Absatz zu kennen, baut den Überbau versehentlich wieder auf:

* **Entscheidungen 1, 2, 5** (Vorlagen-Ebenen, Umfang der Übersteuerung, vier Kaskaden) — der
  Gegenstand existiert nicht mehr. Es gibt in der ganzen App **keinen vorformulierten Text mehr**;
  einzige Ausnahme und unverändert sind die FU-Texte der LinkedIn-Liste (`lists.fuN_text`).
* **Entscheidung 7** (sechs gesonderte Listen) — ersetzt durch R7.
* **Entscheidung 8** (Fristen-Staffelung) — nur noch in der Datenbank wirksam, siehe R3.
* **Entscheidung 10** (Telefonnummer als Pflichtfeld vor dem Closing) — das Gate hing am
  WhatsApp-Kanal der Closing-Kaskade und ist mit ihm entfallen; siehe O1 unten.
* **E-N1 bis E-N4** (die vier Lebenszyklus-Fragen vom 10. September) — alle vier waren für
  Migration 0041 vorgesehen. 0041 ist stattdessen die Rückbau-Migration geworden, und **keine der
  vier ist umgesetzt.** E-N1 (siebte Ablage-Ansicht „Recycling ausgeschöpft") widerspricht R7
  direkt und ist damit auch fachlich vom Tisch; der Befund darunter bleibt allerdings gültig — ein
  Lead am Deckel steht in keiner Liste. Sichtbar ist er heute nur indirekt, über den wieder
  einstellbaren Deckel und den ausgeschriebenen Sperrgrund auf der Ablage-Karte. E-N2, E-N3 und
  E-N4 sind unverändert offen, weder umgesetzt noch zurückgenommen.
* **Die gesamte Mail-Spur (Entscheidung 12, E-M1 bis E-M4)** — sie sollte an der Kaskade andocken,
  und die gibt es nicht mehr. Die fünf `enabled=false`-Mail-Stufen stehen weiter in
  `cascade_steps` und werden von niemandem gelesen.

### R10 · Zwei offene Punkte, die der Rückbau hinterlässt

Beide sind bekannt und bewusst nicht in derselben Welle behoben worden; beide gehören auf die
nächste Liste.

**O1 · Für die WhatsApp-Bestandsdaten gibt es keinen Löschweg mehr.**
`wa_phone`, `wa_consent_at` und `wa_refused_at` (0032) sind mit dem Rückbau eingefroren: Ihr
einziger Zweck war der Kanal der Closing-Erinnerungen, und mit ihm ist das Pflichtfeld-Gate im
Setting-Editor entfallen (Entscheidung 10). **Kein Formular schreibt sie mehr — aber es gibt auch
keines, das sie löscht.** Gelesen werden sie weiterhin an zwei Stellen im Lead-Dossier (als
Kontaktweg und als Warnung). Für die bestehenden Zeilen heißt das: Widerruft ein Lead seine
Einwilligung oder verlangt er die Löschung seiner Nummer, ist das heute nur per Migration oder
direktem `UPDATE` zu erfüllen. Das ist bei einer personenbezogenen Kontaktnummer mit
dokumentierter Einwilligung die unangenehmere der beiden Lücken. Zu entscheiden ist, ob die drei
Spalten einen Bedienweg zurückbekommen (ein Feld im Setting-Editor genügte) oder ob die
Bestandsdaten nach einer Frist gelöscht werden.

**O2 · Die persönlichen Follow-up-Vorlagen sind über keine Oberfläche mehr erreichbar.**
Migration 0034 hat die Zeilen aus `followup_templates` nach `message_templates`
(`linkedin_fu_1..3`) übernommen — die einzige Datenbewegung des ganzen Umbaus. Der
Vorlagen-Editor, der sie sichtbar machte, ist mit dem Rückbau gefallen, und das Listen-Board
liest ausschließlich `lists.fu1_text`/`fu2_text`/`fu3_text`. **Beide Tabellen sind damit
gleichzeitig unerreichbar**, und die früheren persönlichen Texte wirken nirgends mehr. Im
Ergebnis ist das harmlos (die Listen-Texte sind der praktisch genutzte Weg, und sie sind
unberührt), aber es ist genau die Sorte stiller Verlust, vor der die Vorrangkette einmal
geschützt hat: Der Nutzer sieht keinen Fehler, sondern einen anderen Text. Zu entscheiden ist, ob
die persönliche Ebene eine kleine Oberfläche zurückbekommt oder ob die Zeilen als endgültig
abgelöst gelten — im zweiten Fall gehört das in `docs/data-model.md` §3 als abgeschlossene
Aussage, nicht als offener Punkt.
