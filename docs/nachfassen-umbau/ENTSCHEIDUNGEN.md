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
