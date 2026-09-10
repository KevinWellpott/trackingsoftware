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
