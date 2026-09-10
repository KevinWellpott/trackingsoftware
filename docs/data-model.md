# Datenmodell & Auswertungs-Glossar (Pitch-Tracker)

Kontext für KI-gestützte Datenauswertung über den read-only Supabase-MCP.
Quellen: `supabase/migrations/` (maßgeblich für Schema) + tatsächliche Nutzung in `src/`.
Stand: September 2026 — Schema nach Migration `20260404000037_rpc_zugriffspruefung.sql`,
Oberfläche nach der Entschlackung des Analyse-Bereichs (einklappbare Sektionen,
Erklärungen hinter dem Info-Icon, kumulative Fortschritts-Sektion je Tab) sowie nach
dem Nachfassen-Umbau: Vorlagen-Katalog (**0031** `message_templates`), Kaskade und
Termin-Lebenszyklus (**0032** `reminder_cascade`), Lead-Recycling und Ablage
(**0033** `lead_recycling`), Mandanten-Seeding (**0034** `tenant_lifecycle`),
Lifecycle-Nachtrag (**0036**) und die Zugriffsprüfung der beiden schreibenden
Recycling-RPCs (**0037**). Dazu die dritte Arbeitswelle in der Oberfläche:
Lead-Dossier (§5.3), Navigations-Zähler, Kontaktfrequenz-Warnung, Absage- und
Recycling-Kennzahlen im Analyse-Bereich.

**Zwei Stände laufen bewusst auseinander.** Die Migrationen 0031–0034 sind am
8. September 2026 auf der **Produktions-Datenbank eingespielt**, 0036 und 0037
kurz darauf; alle sechs sind damit eingefroren (jede weitere Schema-Änderung
braucht eine neue Nummer). Der zugehörige CODE liegt weiterhin nur auf Branch
`feature/erinnerungs-kaskade` und ist **nicht deployt** — die Datenbank ist der
ausgelieferten App voraus. Das ist der geplante Verifikationszustand und
gefahrlos, weil `main` keine der neuen Tabellen liest. Für Auswertungen heißt
das: Die neuen Tabellen und RPCs existieren, tragen aber außer den Seed-Daten aus
0034 (`pipeline_settings`, `cascade_steps`) noch keine Zeilen, solange der Branch
nicht gemergt ist. **0035** (Pflichtfeld-Trigger), **0038** (Umzug des
Anruf-Logs), **0039** (Prüfungen in `apply_reminder_touches`) und **0040**
(Mandantengrenzen dreier Schreibpfade) sind geschrieben und ausdrücklich **noch
nicht eingespielt** — bei 0035, weil sie die heute produktive App zerbrechen
würde; die anderen drei warten nur auf ihren Termin (§7).

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

Vor jedem Setting-/Closing-Termin UND vor einem vereinbarten Nachfass-Kontakt (Closing
im Status nachfassen):
  Erinnerungs-Kaskade  cascade_steps (Konfiguration) ──▶ reminder_touches (Fälligkeiten)
  Auslieferungs-Stufen: 3 Tage / 1 Tag / 1 Stunde vor dem Termin, je Kaskade eigene
  Stufen und Texte. Passt keine Stufe mehr, entsteht EIN sofort fälliger Touch.
Nach einem Ereignis statt vor einem Termin — dieselbe Tabelle, touch_kind='chain':
  No-Show (2 Stufen) · Kickoff nach der Qualifizierung (1) · kein Abschluss (2).
  Die jeweils zweite Stufe trägt requires_no_response und entfällt bei Antwort.
  Rein manuell: die App trackt nur Fälligkeit + Erledigt-Häkchen, verschickt nichts.

Termin-Lebenszyklus (0032) — eigene Spalten, KEIN neuer status-Wert:
  verschoben (reschedule_count, nur durch den Lead) · abgesagt (cancelled_at +
  cancel_reason_code + cancel_outlook) · No-Show mit Ausgang (no_show_resolution) ·
  disqualifiziert (disqualify_reason_code) · zurückgeholt (revived_at).

Terminal negativ (closing_calls.status='verloren' | phone_leads/setting_calls.status='dead' |
setting_calls abgesagt ohne Aussicht bzw. No-Show ohne Antwort | contacts nach FU3 ohne
Antwort) ──▶ Ablage /ablage (6 abgeleitete Listen, nur Ansicht)
                └──Recycling (next_recycle_at)──▶ Wiedervorlage nach einer vom Grund
                  abhängigen Wartezeit, zurück in denselben Funnel — außer
                  lost_reason_code in ('falsche_zielgruppe','kein_fit') bzw.
                  disqualify_reason_code in ('falsche_zielgruppe','keine_zusammenarbeit')
                  (nie) oder recycle_attempt_count ≥ max_attempts (Deckel erreicht).
```

**Drei Nachfass-Mechanismen — nicht verwechseln.** Der Name „Nachfassen" wird umgangssprachlich
für alle drei benutzt, sie beantworten aber unterschiedliche Fragen, laufen auf
unterschiedlicher Zeitkörnung und sind bewusst getrennte Seiten (alle drei seit dem
Nachfassen-Umbau in der Sidebar verlinkt, mit erklärendem Tooltip):

| Mechanismus | Frage | Körnung | Seite | Quellen |
|---|---|---|---|---|
| **Nachfassen** | „Was ist heute fällig?" | Tag | `/nachfassen` | LinkedIn-FU, Telefon-Rückruf, Setting-Wiedervorlage (no_show/unqualifiziert), Closing-Wiedervorlage (nachfassen), **Recycling** (5. Sektion) |
| **Erinnerungen** | „Was steht in den nächsten Stunden/Tagen vor einem Termin an?" | Stunde | `/erinnerungen` | Setting-Termin, Closing-Termin, Closing-Nachfass-Kontakt — plus die Ereignis-Ketten (No-Show, Kickoff, kein Abschluss) |
| **Recycling** | „Welcher tote Lead ist wieder einen Versuch wert?" | Woche/Monat | 5. Sektion in `/nachfassen` | Closing verloren, Telefon-/Setting-Lead dead, Setting abgesagt ohne Aussicht / No-Show ohne Antwort, LinkedIn FU3 ohne Antwort |

**Genau ZWEI echte Überschneidungen** — bis zum Termin-Ereignis-Umbau war es eine:

1. **Closing im Status `nachfassen`.** Erzeugt einen Tages-Eintrag in `/nachfassen` (Zweig ③
   aus `follow_up_due`) *und* die Kaskade `followup_msg` in `/erinnerungen` (aus
   `follow_up_due_at`).
2. **Erstgespräch mit Ergebnis `no_show`.** `setSettingOutcome('no_show')`
   (`src/app/actions/settingCalls.ts`) schreibt in EINEM Durchgang beides: `follow_up_due`
   (→ `/nachfassen`, Zweig ④) und über `createNoShowTouch()` den Start der Kette
   `no_show_setting` (→ `/erinnerungen`). Die Wiedervorlage beantwortet „an welchem Tag
   kümmere ich mich darum", die Kette „welcher Text geht wann raus" — dieselbe Ursache,
   zwei Fragen.

Beide Seiten **verlinken genau an diesen zwei Stellen** aufeinander, statt die Logik zu
duplizieren: im Board über `SECTION_CROSSLINK` (`NachfassenBoard.tsx`, nur die Sektionen
`closing` und `setting`), auf der Gegenseite über die Rückverweise im `ErinnerungenBoard`.
Die übrigen `/nachfassen`-Sektionen bekommen bewusst **keinen** Verweis: LinkedIn-Follow-up
und Telefon-Rückruf erzeugen gar keine Kaskade, und das Recycling eines verlorenen Closings
folgt Wochen NACH dessen „Kein Abschluss"-Kette — ein Verweis zeigte dort auf lauter längst
erledigte Stufen.

Was **keine** Überschneidung ist, obwohl es so aussieht: `unqualifiziert` setzt zwar
ebenfalls eine Wiedervorlage, erzeugt aber keinen Touch; und ein verlorenes Closing steht in
`/erinnerungen` (Kette `kein_close`) und Monate später im Recycling-Abschnitt von
`/nachfassen` — nacheinander, nie gleichzeitig.

**Die Gegenrichtung: `/ablage`** (Migration 0033, Entscheidung #7 in
`docs/nachfassen-umbau/ENTSCHEIDUNGEN.md`). Die drei Mechanismen oben zeigen, was
noch ANSTEHT; die Ablage zeigt, was aus dem Funnel GEFALLEN ist — ein Bereich, sechs
Ansichten (`?liste=`), gespeist aus der RPC `dropout_lists()`. Sie ist kein vierter
Nachfass-Mechanismus, sondern eine reine Ansicht: Die Zugehörigkeit steht in **keiner
Tabelle**, sondern wird aus dem Zeilenzustand abgeleitet — eine Ablage-Tabelle wäre
eine zweite Wahrheit neben `status` und `cancelled_at` und liefe beim ersten
Statuswechsel auseinander (derselbe Fehler, den `call_assignees` hinterlassen hat, §2).
Nebeneffekt der Ableitung: Die Listen sind am ersten Tag gefüllt. Die sechs Ansichten:
**Abgesagt ohne Aussicht · Abgesagt, Ersatztermin steht aus · Disqualifiziert · Kein Close ·
No-Show ohne Antwort · Sperrliste** (Details und die Sonderrolle der Sperrliste im Begriff
„Ablage" unten). Nur eine davon trägt einen Navigations-Zähler — „Ersatztermin steht aus",
die einzige mit offener Handlung (§5.4).

**Quer zu allem: das Lead-Dossier `/lead/[kind]/[id]`** (§5.3). Die vier Seiten oben zeigen
jeweils einen Ausschnitt nach *Fälligkeit*; das Dossier zeigt einen einzelnen Lead nach
*Vollständigkeit* — alles, was mit ihm je passiert ist, über alle vier Ursprungstabellen
hinweg. Es ist aus `/nachfassen`, `/erinnerungen` und `/ablage` als Overlay erreichbar und
zählt selbst nichts.

Begriffe:
- **Pitch / DM** = eine Zeile in `contacts`. Pitch-Datum = `pitched_at` (bzw. `created_at::date` als Fallback).
- **Liste** = `lists` (LinkedIn) bzw. `phone_lists` (Telefon). Kontakte/Leads hängen immer an einer Liste; die Liste bestimmt den Owner.
- **Anwahl** = eine Zeile in `phone_call_attempts`: 1 Wählversuch, **Ereignis-Ebene** — derselbe Lead zählt dort mehrfach.
- **Erstkontakt** = eine Firma mit `phone_leads.first_call_at` im Zeitraum: **Lead-Ebene** — jede Firma genau einmal. Wer 40-mal wählt und dabei 12 neue Firmen erreicht, hat **40 Anwahlen und 12 Erstkontakte**. Die beiden Wörter sind im ganzen Analyse-Bereich für genau diese zwei Ebenen reserviert und nicht austauschbar; ein gemeinsames Wort ergäbe zwei verschiedene Zahlen unter demselben Namen. Die RPC-Spalte heißt aus historischen Gründen weiter `calls`, zählt aber Erstkontakte (§5).
- **Setting** = `setting_calls`: gebuchter Termin + Qualifizierungsgespräch (Budget, Pain, Entscheider …). Genau eine zuständige Person (`assigned_user_id`, §2).
- **Closing** = `closing_calls`: Abschlussgespräch, entsteht aus qualifiziertem Setting (verknüpft über `closing_calls.setting_call_id`).
- **Termine** = `/termine`: gemeinsamer Kalender über beide Tabellen (Monat/Woche/Tag + versteckte Listenansicht). Feste Dauern: Setting 30 min, Closing 60 min. `/setting` und `/closing` leiten dorthin um; die Detailrouten `/setting/[id]` und `/closing/[id]` bleiben. **Es wird nichts ausgeblendet** — auch nicht `dead`/`unqualifiziert`. Der frühere „Versteckt"-Schalter ließ Termine lautlos verschwinden; stattdessen kodiert der Chip beides zugleich: **Füllung = Typ** (Setting/Closing), **Rahmen = Status** (durchgezogen = steht noch an, gestrichelt = Ergebnis steht fest, abgeblendet = erledigt). Definitionen ausschließlich in `src/lib/terminMeta.ts` (`outlineFor`).
- **Termin-Art** (`setting_calls.meeting_kind`) = `link` **oder** `telefon`. Die dritte Option „Ohne" gibt es nicht mehr: Bei `telefon` ist die Rufnummer (`setting_calls.phone`) Pflicht, bei `link` der Meet-Link — ein Termin ohne beides ist einer, den niemand übernehmen kann. Bestandszeilen mit `meeting_kind is null` bleiben gültig.
- **Kanal / Quelle** = `setting_calls.source_type`. Schlüssel, Labels, Farben und die Frage, ob ein Kanal ein eigenes Akquise-Volumen hat, stehen an genau **einer** Stelle: der Kanal-Registry `src/lib/channels.ts` (§4). Nur LinkedIn (`contacts`) und Telefon (`phone_leads`) haben eine Stufe **vor** dem Termin; Ads, Social Media und Sonstige beginnen erst beim Termin und zeigen dort „—" statt 0.
- **Nachfassen** = zentrale Wiedervorlage (`/nachfassen`), gespeist aus RPC `nachfassen_tasks` (4 Quellen, siehe §5) **plus** RPC `recycle_tasks` (Recycling, 4 weitere Quellen) — beide werden app-seitig in `getNachfassenTasks()` (`src/app/actions/nachfassen.ts`) zu einer Union gemischt, nicht in SQL: eine geänderte `RETURNS TABLE`-Signatur einer bestehenden Funktion bräuchte `DROP FUNCTION` statt `CREATE OR REPLACE` (§5).
- **Erinnerung / Touch** = eine Zeile in `reminder_touches` (Migration 0032): ein fälliger Kontakt vor einem Setting-/Closing-Termin, vor einem vereinbarten Nachfass-Kontakt oder nach einem Ereignis. Seite `/erinnerungen` ("Meine Erinnerungen"), stundengenau gruppiert (Überfällig/Nächste Stunde/Heute/Diese Woche); der Blick nach vorn endet nach `pipeline_settings.reminder_horizon_days` (Default 7) — ohne obere Grenze stünde ein Touch in fünf Wochen unter „Diese Woche". Rein manuell — kein Auto-Versand, die App liefert nur den fertigen Text zum Kopieren, ein Erledigt-Häkchen und ein `outcome`.
- **Kaskade** = die konfigurierte Abfolge von Stufen, aus der Touches entstehen. Neun benannte Kaskaden je Organisation (`cascade_steps.cascade_kind`, §4), nicht mehr EIN Offset-Tripel für alles: Setting und Closing tragen eigene Abstände, die Mail-Spur eigene Stufen, jede Stufe ist abschaltbar. Gerechnet wird ausschließlich in `src/lib/cascadeEngine.ts` — und zwar in **Berliner Wandzeit**: „1 Tag vorher" heißt dieselbe Uhrzeit einen Tag früher, über eine Zeitumstellung hinweg läge eine Millisekunden-Rechnung eine Stunde daneben.
- **Vorlage** = ein Nachrichtentext aus dem gemeinsamen Katalog (`template_catalog`, 31 Schlüssel) mit einer Vorrangkette: **Liste > persönlich > Organisation > Auslieferungstext** (`resolveTemplate()` in `src/lib/messageTemplates.ts`). Die Auslieferungstexte stehen bewusst **nur in TypeScript** (`TEMPLATE_DEFAULTS`), nicht in der DB — eine geseedete Textkopie je Organisation friert den Text ein und erreicht Bestandskunden nicht mehr. Eine Zeile in `message_templates` entsteht erst, wenn jemand einen Text ändert.
- **Recycling** = Wiedervorlage für terminal negative Leads (Migration 0033) — die „toten Enden" der Pipeline, an denen ein Lead sonst spurlos verschwindet: `closing_calls.status='verloren'`, `phone_leads.status='dead'`, `setting_calls.status='dead'` oder `unqualifiziert`, ein Erstgespräch mit `cancel_outlook='ohne_aussicht'` bzw. `no_show_resolution='ohne_antwort'`, `contacts` nach FU3 ohne Antwort. Wartezeit bis zum nächsten Versuch (`next_recycle_at`) hängt vom Grund ab (`pipeline_settings`, org-weit editierbar), gedeckelt über `max_attempts`. Gerechnet wird **serverseitig** in `schedule_recycle()` — der Grund kommt aus der Ursprungszeile, nicht vom Client (§5). Vier Codes bekommen bewusst nie ein Recycling-Datum: `lost_reason_code` in `falsche_zielgruppe`/`kein_fit`, `disqualify_reason_code` in `falsche_zielgruppe`/`keine_zusammenarbeit`.
- **Ablage** = `/ablage`, sechs abgeleitete Listen ausgeschiedener Vorgänge (RPC `dropout_lists`, §5): Abgesagt ohne Aussicht · Abgesagt, Ersatztermin steht aus · Disqualifiziert · Kein Close · No-Show ohne Antwort · **Sperrliste**. Die Sperrliste ist die **einzige Ansicht der App, die die Datensicht bewusst ignoriert** und immer org-weit liefert: Ein Kontaktverbot, das nur sein Besitzer sieht, ist keines — die nächste Person spräche den Lead sonst neu an. Sie ist außerdem die einzige der sechs, die alle vier Recycling-Tabellen abdeckt; die anderen fünf beschreiben Ereignisse, die es nur an einem Termin gibt.
- **Lead-Dossier** = `/lead/[kind]/[id]` (`src/lib/leadDossier.ts`, §5.3) — die Akte EINES Leads über alle vier Ursprungstabellen hinweg: Verlauf, Kontaktwege, Steckbrief, Notizen. Kein Zähl-, sondern ein Nachschlagewerk; es kommt in keiner Auswertung vor. Entscheidend ist die **Zwei-Stufen-Lösung der Lead-Identität**: belegt vs. vermutet (§5.3) — Vermutetes zählt nirgends mit.
- **Navigations-Zähler** = die drei Badges in der Seitenleiste (`src/lib/navCounts.ts`, §5.4) an `/erinnerungen`, `/nachfassen` und `/ablage`. `null` heißt „nicht ermittelbar", **nicht** „null Aufgaben" — bei einem Fehler verschwindet das Badge, statt eine beruhigende 0 zu behaupten.
- **Kontaktfrequenz-Warnung** = der amberfarbene Hinweis „Zuletzt kontaktiert vor …" auf den Karten in `/nachfassen` und `/erinnerungen` (`src/lib/contactGap.ts`, `CONTACT_GAP_WARN_DAYS = 3`, Entscheidung K3). **Ein Hinweis, kein Riegel** — die Zahl steht bewusst als Code-Konstante da und nicht als `pipeline_settings`-Spalte, weil sie nichts blockiert und deshalb auch nichts zu konfigurieren gibt. Die Termin-Kaskade ist ausgenommen: drei Kontakte in drei Tagen sind dort das Verfahren, keine Belästigung.

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
- **Organisation anlegen:** Seit Migration 0034 hängt ein AFTER-INSERT-Trigger `workspaces_seed_defaults` auf `workspaces` und ruft `seed_workspace_defaults()` — eine `pipeline_settings`-Zeile und 21 `cascade_steps` (16 aktiv, 5 abgeschaltete Mail-Stufen). Bewusst ein Trigger statt einer Ergänzung in `bootstrap_workspace()` **und** `platform_create_workspace()`: Ein Kunde entsteht über den einen Pfad, ein anderer über den anderen — ein Trigger deckt beide ab und zusätzlich jeden künftigen, ohne dass jemand daran denken muss. Textzeilen legt er bewusst **keine** an (§1, Begriff „Vorlage"). Bestehende Organisationen wurden in 0034 nachgezogen.
- **Organisation löschen:** `preview_delete_workspace()` / `platform_delete_workspace()` (Migration 0027, UI unter `/admin/org/[id]`). An `workspaces` hängen inzwischen **19 Fremdschlüssel mit `on delete cascade`** (15 plus `message_templates`, `pipeline_settings`, `cascade_steps`, `reminder_touches`) — ein `delete` nimmt den kompletten Datenbestand der Organisation mit, ohne Undo. **Historie — die Vorschau zählte lange weniger, als gelöscht wird:** Die Fassung aus 0027 nannte 13 Tabellen und kannte weder `phone_call_attempts` (0028) noch die vier neuen; gelöscht wurden sie trotzdem. Eine Löschvorschau, die weniger nennt als sie löscht, ist gefährlicher als gar keine. **Migration 0036 hat das behoben:** `counts` trägt jetzt **18 Tabellen** (die 13 plus `phone_call_attempts`, `message_templates`, `pipeline_settings`, `cascade_steps`, `reminder_touches`); zusammen mit `workspace_members`, das die Vorschau getrennt unter `members` führt, sind das genau die 19 Kaskaden. Die Verifikation dazu ist bewusst kein Abzählen, sondern eine `pg_constraint`-Abfrage: Sie listet jede Tabelle mit `on delete cascade` auf `workspaces`, die **nicht** als Schlüssel in `counts` vorkommt — und wird damit von selbst wieder rot, sobald jemand eine neue Tabelle anhängt. `platform_delete_workspace()` blieb unverändert; sie vergleicht die Vorschau-`counts` gegen `p_expected` und übernimmt die neuen Schlüssel automatisch. Die Funktion verweigert, solange noch Mitglieder da sind (sonst blieben verwaiste Accounts zurück: Mitgliedschaft kaskadiert weg, Login bleibt), und bei der eigenen Organisation; die UI verlangt zusätzlich das Abtippen des Namens.
- **Nutzer verschieben:** `preview_move_user()` / `admin_move_user_to_workspace()` (Migration 0026, seit **0036** auf dem aktuellen Stand, UI unter `/admin/org/[id]`). Der Umzug stempelt `workspace_id` auf inzwischen **16 Tabellen** um (15 reine `workspace_id`-Stempel plus die Mitgliedschaft selbst) und kappt Kanten, die über die neue Org-Grenze zeigen (Termin ohne Quellkontakt, Closing ohne Setting, Smart View ohne Ordner) — genullt, nicht blockiert, weil `lead_name`/`company` als Snapshot vorliegen. Besitz-Ermittlung ausschließlich in `move_user_scope()`, damit Vorschau und Umzug nie auseinanderlaufen.
  - **Was 0036 nachgezogen hat:** die persönlichen `message_templates` (`user_id = <umziehender>`, Org-Standards mit `user_id is null` bleiben stehen) und die `reminder_touches` an den mitziehenden Terminen. Die zurückgebliebene Vorlage war dabei der leiseste Fehler: Die Vorrangkette ersetzt den fehlenden Text lautlos durch den Org-Standard — der Nutzer sieht keinen Fehler, sondern einen anderen Text. Die **Reihenfolge im Umzug ist tragend**: Die beiden neuen Stempel laufen NACH dem Mitgliedschaftswechsel, sonst entwertete `reminder_touches_ws_guard` die Erinnerungen des Umziehenden reihenweise, weil er in der Zielorganisation noch kein Mitglied war. Neu ist außerdem eine Vorbedingung: Liegen in der Zielorganisation schon persönliche Vorlagen desselben Nutzers, bricht der Umzug ab — `uq_message_templates_user (workspace_id, user_id, template_key)` aus 0031 kollidierte sonst mitten im Schreiben. (`performance_targets` und `followup_templates` haben dieses Problem nicht: Ihre Unique-Keys führen `workspace_id` gar nicht.) Erinnerungen, die an Terminen der ALTEN Organisation hängen, werden vor dem Umzug *superseded* statt gelöscht — die Erledigungs-Historie speist die „Erinnerungs-Disziplin" (§5.1); die Vorschau meldet sie als eigenen Warncode `reminder_touch_superseded`.
  - **Zwei Lücken bleiben mit Ansage:** `move_user_scope()` ist von 0036 bewusst **nicht** angefasst — ein weiterer OUT-Parameter wäre eine Signaturänderung, und ihre bestehenden Ausgaben reichen. Sie ermittelt den Besitz an Terminen deshalb weiterhin über `created_by_user_id`: Ein Termin, der dem Umziehenden nur *zugewiesen* ist, bleibt zurück. Und `phone_call_attempts` (0028) zieht weiter nicht mit — die Löschvorschau kennt die Tabelle seit 0036, der Umzug nicht; die Gegenprobe steht im Verifikationsblock von 0036 und als Invariante in §8.
  - Der Guard-Trigger `assigned_user_guard` (0028) greift bei `update of workspace_id` — und seit 0040 zusätzlich beim INSERT sowie bei `update of assigned_user_id` — und nullt eine Zuweisung, die über die neue Grenze zeigen würde; sein Pendant `reminder_touches_ws_guard` (0032) *supersedet* statt zu nullen, damit die Erledigungs-Historie erhalten bleibt. Zurückbleibende Zeilen fasst keiner von beiden an — deshalb die Invarianten in §8.
- **Wichtig für MCP-Auswertungen:** `execute_sql` läuft direkt auf Postgres **an RLS vorbei** — man sieht alle Daten. Personenfilter daher immer explizit setzen: bei Listen-Daten (LinkedIn/Telefon) über `lists.owner_name` / `phone_lists.owner_name` (Vorrang) bzw. `created_by_user_id`, bei `setting_calls`/`closing_calls` über `coalesce(assigned_user_id, created_by_user_id)` — jeweils auf `profiles.username` gejoint.

## 3. Tabellen-Glossar

### LinkedIn-Funnel

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `lists` | LinkedIn-Pitch-Listen. `name`, `owner_name` (Besitzer, matcht `profiles.username`), `created_by_user_id`, `pitch_text` (Vorlage), `fu1_text`/`fu2_text`/`fu3_text` (Nachfass-Sequenz der Liste, `{name}`-Platzhalter), `archived_at`. |
| `contacts` | 1 Zeile = 1 gepitchter LinkedIn-Kontakt. `list_id` → `lists` (Trigger setzt `workspace_id`). Kernfelder: `name`, `company`, `pitched_at` (date), `answered` (bool), `answer_category` (§4), `answer_text`, `follow_up_number` (0–3), `next_follow_up_at` (date), `appointment_set` (bool), `appointment_at` (timestamptz), `meet_link`, `linkedin_url`, `target_group` (Freitext-Zielgruppe, Achse „Zielgruppe" im Vergleich), `setting_call_id` → `setting_calls`, `blocked_at` (timestamptz — Lead hat uns auf LinkedIn blockiert; App nullt `next_follow_up_at`, RPCs schließen blockierte zusätzlich aus). Recycling (Migration 0033, **dieselben sechs Spalten auf allen vier Ursprungstabellen**): `next_recycle_at` (date, gesetzt sobald FU3 ohne Antwort abgeschlossen wird — `advanceLinkedInFollowUp` UND `updateContact` rufen dafür `schedule_recycle('linkedin', …)`), `recycle_attempt_count`, `recycle_excluded_at` (permanentes Opt-out = Sperrliste, unabhängig von `blocked_at`), `recycle_last_contacted_at`, `recycle_responded_at` (**ohne diesen Zeitstempel gibt es keine Wiederbelebungsquote** — und damit keine Grundlage, die Wartezeiten begründet zu ändern), `recycle_reason_code`. CHECK: `recycle_excluded_at` und `next_recycle_at` schließen sich aus. Legacy-CRM: `stage_id` → `pipeline_stages`, `deal_value`, `deal_closed`, `deal_lost_reason`, `meeting_notes`, `custom_fields` (jsonb). |
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
| `setting_calls` | Termin + Qualifizierungsgespräch. Person: `assigned_user_id` (zuständige Person, **die Auswertungsachse** — §2), `created_by_user_id` (Audit: wer angelegt hat). Herkunft: `source_type` (§4), `source_detail` (Freitext, trägt den echten Ursprung — die Analyse schlüsselt danach auf, sofern gesetzt), `source_contact_id` → `contacts`, `source_phone_lead_id` → `phone_leads`. Termin: `appointment_at` (timestamptz), `meet_link` (bei `meeting_kind='link'`), `phone` (Rufnummer bei `meeting_kind='telefon'`, Migration 0029 — nullable und ohne CHECK, die Pflicht sitzt im Formular; bewusst am Termin statt am Lead, weil `phone_leads.phone` die Firmenzentrale ist und LinkedIn-/manuelle Termine gar keine Lead-Zeile haben), `meeting_kind` (`link` \| `telefon` \| NULL = Altbestand), `call_at` (date, Gesprächstag). WhatsApp-Kanal (Migration 0032): `wa_phone` (persönliche WhatsApp-Nummer des Entscheiders — **nicht** dieselbe wie `phone`, das ist die Einwahlnummer bei `meeting_kind='telefon'`; wird HIER im Setting-Call eingesammelt, weil erst dort echtes Vertrauen besteht), `wa_consent_at` (Zeitstempel der dokumentierten Einwilligung — nach deutschem UWG Pflicht für WhatsApp-Kontakt zu kalten Leads, auch B2B), `wa_refused_at` (dokumentierte Verweigerung „will keine Nummer rausgeben" — nur so lässt sich eine bewusste Ablehnung von einer Erfassungslücke unterscheiden; CHECK: nur OHNE `wa_phone`, und `wa_consent_at` nur MIT einer Nummer). Ohne Nummer **und** Einwilligung fällt der Kaskaden-Kanal auf den Akquise-Kanal zurück (`resolveFollowUpChannel` in `src/lib/reminderCascade.ts`). Termin-Lebenszyklus (Migration 0032, s. u.): `cancelled_at`, `cancel_reason_code`, `cancel_reason`, `cancel_outlook`, `reschedule_count`, `last_reschedule_at`, `no_show_resolution`, `revived_at`, `revived_from_setting_call_id`/`revived_from_closing_call_id`, `disqualify_reason_code`, `disqualify_reason`. Qualifizierung: `show_status` (`show`/`no_show`), `has_budget_8k`, `branche`, `sole_decider`/`can_decide_now`/`clear_need` (bool), `ist_pain` (1–10), `warmth` (1–10), `soll_ziel`, `script_answers` (jsonb, Setting-Skript-Blöcke). Ergebnis: `status` (§4), `follow_up_due` (date, Wiedervorlage), `no_show_count` (zählt No-Shows über Neuterminierungen hinweg — **kein** Nenner der Show-Quote mehr, siehe §5; die Analyse liest es nur noch für die Fußnote der Status-Verteilung „wie viele Termine hatten mehr als einen No-Show"), `closing_scheduled`/`closing_at`. Recycling (Migration 0033, die sechs Spalten s. `contacts`): `next_recycle_at` wird über `schedule_recycle('setting', …)` gesetzt — bei `status='dead'`, bei `unqualifiziert` (eigene, längere Frist) und bei einer Absage `ohne_aussicht`. |
| `closing_calls` | Abschlussgespräch. `setting_call_id` → `setting_calls`. Person: `assigned_user_id` (erbt beim Anlegen vom Setting), `created_by_user_id` (Audit). `call_at` (timestamptz, Termin inkl. Uhrzeit), `meet_link`, `show_status` (§4), `status` (§4), Deal: `closed` (bool), `deal_volume` (numeric, €), `payment_type` (Freitext, UI: „Einmal"/„Raten"), `signature_received`, `contract_start` (date), `lost_reason_code` (zehn feste Codes, §4 — **das zählbare Feld**), `lost_reason` (Freitext daneben, optionaler Kontext), `follow_up_due` (date). `follow_up_due_at` (timestamptz, Migration 0032 — präziser Nachfass-Zeitpunkt für die Erinnerungs-Kaskade; wird von `follow_up_due` per App-Code synchron gehalten, `withFollowUpDateSynced()` in `src/app/actions/closingCalls.ts`, **kein** Trigger — `nachfassen_tasks` liest weiter unverändert `follow_up_due`). `onboarding_at` (date, Migration 0032 — Tag des Software-Onboardings nach einem gewonnenen Deal; ohne Angabe bewusst NULL statt eines geratenen Datums). Termin-Lebenszyklus (Migration 0032): `cancelled_at`, `cancel_reason_code`, `cancel_reason`, `cancel_outlook`, `reschedule_count`, `last_reschedule_at`, `no_show_resolution`, `revived_at` — dieselben Spalten wie am Setting, **ohne** `revived_from_*` und ohne Disqualifikationsgrund (dafür hat das Closing `lost_reason_code`). Recycling (Migration 0033, die sechs Spalten s. `contacts`): `next_recycle_at` wird bei `status='verloren'` über `schedule_recycle('closing', …)` gesetzt, die Wartezeit hängt am `lost_reason_code` (§5). |
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

Vier Regeln, die man beim Nachrechnen kennen muss:
- **`reschedule_count` zählt NUR Verschiebungen durch den Lead** (`postponeAppointment(byLead=true)`).
  Der Kalender-Drag und die interne Umplanung des Verkäufers zählen nicht — sonst misst der
  Zähler die Disziplin des eigenen Teams statt der Verbindlichkeit des Leads. Ein Ersatztermin
  nach No-Show zählt ebenfalls nicht (er läuft über `rescheduleSetting`).
- **`pipeline_settings.max_reschedules` ist eine Warnung, keine Sperre** — über dem Kontingent
  meldet die Action `warn:'limit'`, die Oberfläche lässt bestätigen und schlägt die Ablage
  „abgesagt ohne Aussicht" vor.
- **`no_show_resolution` ist per CHECK an `show_status='no_show'` gebunden.** Wandert der
  Show-Status weg, muss der Ausgang mitgehen — die App nullt ihn dafür in
  `withNoShowResolutionCleared()`, sonst weist Postgres das ganze UPDATE ab.
- **`revived_at` wird geschrieben — von genau einem Pfad: `reviveDropout()`**
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
  tatsächlich. Nicht verwechseln mit der Ablage-Liste „Abgesagt, Ersatztermin steht aus": Die
  fragt `cancel_outlook='neuer_termin'` **und** `revived_at is null` ab und leert sich genau
  durch diesen Knopf.

### Vorlagen, Kaskade & Recycling-Konfiguration

Ersetzt die früheren Tabellen `reminder_settings` und `recycle_settings` (Historie: Sie
standen in der nie eingespielten ersten Fassung von 0031/0032 und existieren **nicht**).
Ihre Offsets liegen jetzt in `cascade_steps`, ihre Texte in `message_templates`, der Rest
in `pipeline_settings`.

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `template_catalog` | Katalog der Nachrichtenarten (Migration 0031), **31 Zeilen**. `template_key` (PK), `label`, `group_key` (`setting`\|`closing`\|`followup`\|`no_show`\|`kein_close`\|`recycling`\|`linkedin`\|`aufgaben`), `placeholders` (text[]), `sort_order`, `is_mail`. Bewusst **ohne Textkörper** — die Auslieferungstexte stehen ausschließlich in `TEMPLATE_DEFAULTS` (`src/lib/messageTemplates.ts`), damit SQL und TypeScript nicht auseinanderlaufen und eine Textverbesserung jeden Kunden erreicht, der den Text nie angefasst hat. Bei jedem Einspielen abgeglichen (`on conflict do update`), Zeilen werden nie gelöscht, damit kein FK ins Leere zeigt. Lesbar für jedes angemeldete Konto, schreibbar für niemanden — er ändert sich nur mit einer Migration. Keine Gruppe `mail`: Eine Mail-Stufe gehört fachlich zu Erstgespräch bzw. Closing, die Unterscheidung trägt `is_mail`. |
| `message_templates` | Die **abweichenden** Texte (Migration 0031). `workspace_id`, `user_id` (**NULL = Standard der Organisation**, gesetzt = persönliche Übersteuerung), `template_key` → `template_catalog`, `subject` (nur für Mail-Vorlagen), `body` (CHECK: nicht leer), `updated_by_user_id`. Zwei partielle Unique-Indizes trennen die beiden Ebenen ohne zweite Tabelle; `workspace_id` steht auch im persönlichen Index — `followup_templates` (0011) hat nur `unique(user_id, fu_number)` und wird dadurch beim Nutzer-Umzug mehrdeutig. **Keine `channel`-Spalte:** ein Text je Stufe gilt für WhatsApp, LinkedIn und Telefon gleichermaßen; die Karte ist eine Kopier-Werkbank. Eine Zeile entsteht erst beim bewussten Ändern, ein geleertes Feld löscht sie wieder. RLS: Org-Ebene über `can_manage_org_settings()`, die eigene Zeile immer gegen `auth.uid()` — **nicht** gegen die eingestellte Datensicht, sonst überschriebe ein Owner mit aktiver Datensicht unbemerkt den Text eines Kollegen. |
| `pipeline_settings` | **Eine** Konfigurationszeile je Organisation (Migration 0032, PK = `workspace_id`) — ersetzt `reminder_settings` UND `recycle_settings`: ein Seeding-Schritt, ein RLS-Paar, eine Kartengruppe in den Einstellungen statt zweier. Termin-Disziplin: `max_reschedules` (1–5, Default 2), `reminder_horizon_days` (1–60, Default 7 — wie weit `/erinnerungen` nach vorn schaut). Recycling **zweistufig**: fünf Ursprungs-Defaults mit den Konzept-Fristen (`days_default_closing_lost` 28, `days_default_setting_disqualified` 56, `days_default_phone_dead`/`_setting_dead`/`_linkedin_exhausted` je 100) und daneben neun Verlustgrund-Werte, die sie übersteuern (`days_timing` 75, `days_preis`/`days_kein_bedarf` 105, `days_entscheider` 150, `days_wettbewerb`/`days_vertrauen` 270, `days_ghosting_breakup` 14 / `days_ghosting` 180 — Ghosting ist zweistufig: kurzer „Breakup"-Touch zuerst, dann das lange Intervall —, `days_sonstiges` 120). `max_attempts` (1–5, Default 2) deckelt die Versuche. Alle Tages-Spalten bewusst `not null`: nullable Spalten hätten die Staffelung faktisch abgeschafft. Für `falsche_zielgruppe` und `kein_fit` gibt es **keine** Spalte — sie bekommen nie ein Datum. Lesen: jedes Mitglied. Schreiben: `can_manage_org_settings()`, UI unter `/settings`. |
| `cascade_steps` | Die Stufen der neun Kaskaden je Organisation (Migration 0032). PK `(workspace_id, cascade_kind, step_no)`. `cascade_kind` (§4), `step_no` (1–5), `trigger_event` (`scheduled`\|`created`\|`no_show`\|`no_close`), `anchor` (`before_appointment`\|`after_appointment`), `offset_minutes` (≥ 0), `requires_no_response`, `enabled`, `template_key` → `template_catalog`. **Zeile statt Spalte**, weil die Stufenzahl je Kaskade verschieden ist (Setting-Mail 2, Closing-Mail 3) und eine Stufe abschaltbar sein muss. **Minuten statt Stunden**, damit „3 Tage vorher" (4320) und „1 Stunde vorher" (60) in einer Einheit liegen. **Anker + nicht-negativer Offset statt vorzeichenbehafteter Minuten**: derselbe Ausdrucksumfang, aber eine Erinnerung NACH dem Termin lässt sich in einer Vor-Termin-Kaskade gar nicht erst formulieren (CHECK: `trigger_event='scheduled'` ⇔ `anchor='before_appointment'`). Die Reihenfolge der Stufen prüft die Oberfläche beim Speichern, nicht ein CHECK — sie ist ein zeilenübergreifender Zustand. **In der Oberfläche bisher nur ablesbar, nicht editierbar** (`PipelineSettingsCard` zeigt die Stufen als Liste); geändert werden sie per SQL. |
| `reminder_touches` | Ein fälliger Touch je Zeile (Migration 0032, **v2** — die polymorphe Fassung mit `touch_type` gibt es nicht mehr). **Echte Fremdschlüssel** statt polymorpher `entity_id`: `setting_call_id` / `closing_call_id` (je `on delete cascade`), dazu `entity_type` (`setting`\|`closing`\|`closing_followup`) und `entity_id` als **generierte Spalte** (`coalesce(setting_call_id, closing_call_id)`, stored). Ein direkter DB-Delete oder ein vergessener Aufrufpfad nimmt die Touches damit mit, statt Karteileichen zu hinterlassen, die kein Invarianten-Check findet. Stufe: `touch_kind` (`cascade`\|`chain`\|`sofort`), `cascade_kind`, `step_no` (≥ 0; der `sofort`-Touch liegt kollisionsfrei auf 0), `requires_no_response`, `template_key` (**Snapshot** — eine später umbenannte Stufe schreibt die Historie nicht um). `assigned_user_id` ist ebenfalls ein **Snapshot** nach der `personOf()`-Regel, per BEFORE-INSERT-Trigger `reminder_touches_require_assignee` Pflicht (die Spalte bleibt trotzdem nullable: `deleteUser` räumt nicht vor, ein NOT NULL bräche die Nutzerverwaltung, ein `on delete cascade` löschte die Historie). `due_at`/`appointment_at` (timestamptz), `channel` (`linkedin`\|`telefon`\|`whatsapp`\|`mail`\|NULL) + `channel_locked`, `outcome` (§4), `done_at`/`done_by_user_id` (per CHECK ein Paar), `done_note`, `snoozed_until`, `superseded_at` (Soft-Delete — die Erledigungs-Historie bleibt zählbar). Höchstens ein aktiver Touch je `(entity_type, entity_id, cascade_kind, step_no)`: `unique index … where superseded_at is null` — die Kaskade steht bewusst IM Schlüssel, sonst kollidierte Stufe 1 der Nachrichten-Spur mit Stufe 1 der Mail-Spur desselben Termins. |

**Kanal: Snapshot für die Auswertung, live für die Anzeige.** `reminder_touches.channel` hält
fest, was zum Erzeugungszeitpunkt galt; die Karte löst beim Rendern neu auf, damit eine
nachträglich erfasste WhatsApp-Einwilligung noch wirkt. `channel_locked` merkt eine bewusste
Nutzerwahl und schaltet das Nachlösen ab. Wer Kanäle auswertet, liest die Spalte (den
Snapshot) — was der Nutzer auf dem Bildschirm sah, kann davon abweichen.

**`outcome` entwertet nur Ketten, nie geplante Stufen.** Wird auf einem `chain`-Touch
„antwort" eingetragen, werden die noch offenen Folgestufen mit `requires_no_response`
superseded — das ist wörtlich der Pfeil „keine Antwort" aus dem Konzept. Bei einer
Vor-Termin-Kaskade passiert das bewusst NICHT: Eine Bestätigung auf Stufe 1 lässt Stufe 2
und 3 fällig, weil der Meeting-Link aus Stufe 3 auch nach einer Zusage rausgehen soll.

### Sonstiges

| Tabelle | Zweck |
|---|---|
| `profiles` | `user_id` ↔ `username` (Login + Owner-Matching). |
| `workspaces` / `workspace_members` | Team + Mitgliedschaft (`role`, `data_scope`, Invite-Code). |
| `performance_targets` | Ziele je User: `channel` (`linkedin`\|`telefon`) × `period` (`daily`\|`weekly`) × `metric` (`pitches`\|`calls`\|`appointments`). App-Defaults ohne Eintrag: LinkedIn 20/Tag, 100/Woche; Telefon 40/Tag, 200/Woche (`src/lib/targets.ts`). |
| `followup_templates` | **Abgelöst und von der App nicht mehr gelesen — die Tabelle steht trotzdem noch da.** FU-Textvorlagen je User (`fu_number` 1–3). Migration 0034 hat die Zeilen nach `message_templates` (`linkedin_fu_1..3`) übernommen; die Vorrangkette ist seither `lists.fuN_text` > persönlich > Organisation > Auslieferungstext (`resolveTemplate`, §1). Auf diesem Branch liest **keine Zeile Anwendungscode** die Tabelle mehr: `src/app/actions/templates.ts` ist gelöscht, `actions/nachfassen.ts` holt seine Texte aus dem Katalog, und `resolveTemplate()` kennt nur noch `message_templates`. Angefasst wird sie nur noch von den Lifecycle-RPCs — Umzug und Löschvorschau stempeln bzw. zählen sie weiter, deshalb steht ihr Label in `COUNT_LABELS` (`src/lib/lifecycleLabels.ts`). Sie **bleibt trotzdem stehen** (Muster `call_assignees`): Ein `drop table` vor dem Merge träfe das ausgelieferte `main`, das sie noch ohne Fehlerprüfung liest — Nutzer mit eigenen Texten bekämen im Verifikationsfenster stillschweigend den Standardtext. Für Auswertungen nicht mehr verwenden: Ihre Zeilen sind ein eingefrorener Stand von vor 0034, spätere Änderungen stehen ausschließlich in `message_templates`. |
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
Historie: Alt-Wert `disqualifiziert` wurde per Migration 0018 zu `unqualifiziert` migriert. Outcome-Logik: `no_show` → Wiedervorlage (Vorschlag +1 Tag) + `no_show_count`++ + No-Show-Kette; `unqualifiziert` → Wiedervorlage (Vorschlag +7 Tage), **seit dem Umbau nur noch MIT `disqualify_reason_code`** — Status und Grund schreibt `setSettingOutcome` in EINEM UPDATE, damit der Trigger aus 0035 später nie einen Zwischenstand sieht; `dead` → Recycling-Datum; `qualifiziert` → Closing wird angelegt, Status wird `closing_gelegt`. Show-Quote: `show_status` (`show`/`no_show`); bei `offen`/`dead` bewusst NULL — und bei einem **abgesagten** Termin ebenfalls, siehe Termin-Lebenszyklus weiter unten.
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
- **`cancel_reason_code`**: `kein_neuer_termin` „Will keinen neuen Termin" · `krank` · `familiaer` „Familiär" · `beruflich` · `preis` „Preis" · `sonstiges`. Freitext daneben: `cancel_reason`. Der Code ist fachlich Pflicht, erzwungen wird er aber (noch) in der Server-Action, nicht per Constraint — der Trigger dafür steht in der noch nicht eingespielten 0035 (§7).
- **`cancel_outlook`**: `ohne_aussicht` „Ohne Aussicht auf einen neuen Termin" · `neuer_termin`. CHECK: `cancelled_at` und `cancel_outlook` sind ein Paar (beide oder keins). Die beiden Werte trennen zwei Ablage-Listen, die nicht zusammenfallen dürfen: totes Ende vs. offener Ersatztermin.
- **`no_show_resolution`**: `antwort` · `ohne_antwort` · `ersatztermin`. CHECK: nur bei `show_status='no_show'`. `ohne_antwort` ist der einzige saubere Auslöser für die Ablage-Ansicht „No-Show ohne Antwort" — vorher war dieser Fall von „noch nicht nachgefasst" nicht zu unterscheiden.
- **`setting_calls.disqualify_reason_code`** (nur Setting; ein Closing hat dafür `lost_reason_code`): `geld` · `kein_budget` · `kein_bedarf` · `falscher_zeitpunkt` · `kein_entscheider` · `falsche_zielgruppe` · `keine_zusammenarbeit` · `sonstiges`. Zwei davon bekommen nie ein Recycling-Datum: `keine_zusammenarbeit` ist die rote Notiz „kein weiteres Kontaktieren!" (die App setzt zusätzlich `recycle_excluded_at`, also die **Sperrliste**), `falsche_zielgruppe` ist schlicht der falsche Fit (dort wird nur ein bereits gesetztes Datum geräumt). Freitext daneben: `disqualify_reason`.

**`cascade_steps.cascade_kind`** (neun Kaskaden): `setting_msg` „Setting — Nachrichten" · `setting_mail` · `closing_msg` · `closing_mail` · `followup_msg` „Nachfass-Kontakt" · `closing_kickoff` „Nach der Qualifizierung" · `no_show_setting` · `no_show_closing` · `kein_close` „Kein Abschluss" (Labels: `CASCADE_KIND_LABELS`, `src/lib/cascadeEngine.ts`). Die fünf **Mail-Stufen sind ausgeliefert, aber `enabled=false`** (Phase 2) — der Kern erzeugt und rendert sie nicht; Touches dafür wären Karten, die die Oberfläche nicht anzeigen kann.
**`cascade_steps.trigger_event`**: `scheduled` (geplant vor dem Termin) · `created` (beim Anlegen, nur `closing_kickoff`) · `no_show` · `no_close`. **`anchor`**: `before_appointment` · `after_appointment`.

**`reminder_touches.entity_type`**: `setting` · `closing` · `closing_followup` (der vereinbarte Nachfass-Kontakt eines Closings im Status `nachfassen`, nicht das Closing-Gespräch selbst).
**`reminder_touches.touch_kind`** (ersetzt das frühere `touch_type` mit `offset_1..3`/`no_show`): `cascade` (geplante Stufe vor dem Termin) · `chain` (Stufe einer Kette nach einem Ereignis) · `sofort` (Ersatz-Touch, wenn der Termin für jede geplante Stufe zu kurzfristig war — `step_no = 0`, `due_at` = Erzeugungszeitpunkt). WELCHE Stufe es ist, steht in `cascade_kind` + `step_no`, nicht mehr im Typ. CHECK: bei `touch_kind='cascade'` muss `due_at <= appointment_at` sein; `sofort` ist davon ausgenommen.
**`reminder_touches.channel`**: `linkedin` · `telefon` · `whatsapp` · `mail` · NULL (kein Kanal ableitbar — Quelle ohne Vorlaufkanal wie `ads`/`sonstige`, oder ein Closing ohne Setting-Bezug; UI zeigt „Kanal frei wählen" statt zu raten). Auflösung: `resolveCascadeChannel()`/`resolveFollowUpChannel()` in `src/lib/reminderCascade.ts` — WhatsApp nur, wenn `setting_calls.wa_phone` **und** `wa_consent_at` gesetzt sind; ist `wa_refused_at` gesetzt, fällt der Kanal ausdrücklich auf den Akquise-Kanal des Settings zurück. `channel_locked` = die Person hat den Kanal bewusst gewählt.
**`reminder_touches.outcome`**: `antwort` · `keine_antwort` · `bestaetigt` · `abgesagt` · `verschoben` · NULL (noch nicht erledigt oder ohne Angabe abgehakt).

> **`src/lib/reminderCascade.ts` trägt nur noch die Kanal-Frage.** Das feste Offset-Tripel der
> ersten Fassung (`DEFAULT_REMINDER_SETTINGS`, `computeCascadeDueAts()`, `templateFieldFor()`,
> `renderReminderTemplate()` und der Typ `ReminderTouchType` mit `offset_1..3`/`no_show`) ist
> **entfernt** — es beschrieb ein Datenmodell, das die ausgelieferte Datenbank nicht kennt.
> Gerechnet wird in `src/lib/cascadeEngine.ts`, die Texte kommen aus `message_templates`. In
> der Datei stehen jetzt nur noch die beiden Kanal-Auflöser und die Typen
> `ReminderEntityType`/`TouchChannel`.

**`closing_calls.status`**: `offen` „Offen" · `gewonnen` „Gewonnen" · `verloren` „Verloren" (erzwingt `lost_reason_code`, **nicht** mehr den Freitext) · `nachfassen` „Nachfassen" (erzwingt `follow_up_due`)
**`closing_calls.lost_reason_code`** (CHECK aus Migration 0029, in 0032 auf **zehn** Werte erweitert): `preis` „Preis" · `timing` „Timing" · `kein_bedarf` „Kein Bedarf" · `entscheider` „Entscheider" · `wettbewerb` „Wettbewerb" · `vertrauen` „Vertrauen" · `ghosting` „Ghosting" · `falsche_zielgruppe` „Falsche Zielgruppe" · **`kein_fit` „Kein Fit"** (neu in 0032) · `sonstiges` „Sonstiges" (Labels: `CLOSING_LOST_REASON_LABELS`, `src/lib/types.ts`).
Warum zusätzlich zum Freitext: „zu teuer", „Preis", „Budget nicht da" sind drei Zeilen mit je Häufigkeit 1 — zählbar wird der Grund erst über den Code. **Code = Statistik, Freitext = Gedächtnis**; `lost_reason` bleibt daneben bestehen und ist seit 0029 optional. `falsche_zielgruppe` ist der einzige Code, der nicht das Closing bewertet, sondern die Stufe davor: Er macht messbar, wer falsch qualifiziert — ohne ihn verschwände der Fall unter `kein_bedarf`. `kein_fit` ist das Closing-Pendant zu „Zusammenarbeit macht keinen Sinn": nicht der Lead war falsch, das Gespräch hat gezeigt, dass es nicht passt — der zweite Code neben `falsche_zielgruppe`, der nie ein Recycling-Datum bekommt. Die Erweiterung ist rein additiv, Bestandszeilen bleiben gültig. **Fallstrick:** Migration 0029 hat **alle** Bestandszeilen mit `status='verloren'` auf `sonstiges` gesetzt (bewusst kein Rate-Mapping aus dem Freitext) — sie sind von Hand nachzupflegen. Bis dahin ist die Verteilung eine Aussage über das Deploy-Datum, nicht über die Einwände. Zeilen ohne Code führt der Closing-Tab getrennt als „Ohne Angabe", statt sie nach `sonstiges` zu buchen.

**Derselbe Code entscheidet seit Migration 0033 zusätzlich die Recycling-Wartezeit** — und zwar **serverseitig in `schedule_recycle()`**, nicht mehr im App-Code (Werte in `pipeline_settings`, §3): `timing`/`preis`/`kein_bedarf` kurz (75–105 Tage), `entscheider` 150, `wettbewerb`/`vertrauen` 270, `ghosting` zweistufig (14 Tage Breakup-Touch, dann 180), `sonstiges`/ohne Code ein konservativer Mittelwert (120), `falsche_zielgruppe` und `kein_fit` **nie** — Letzteres hält ein CHECK auf `closing_calls` zusätzlich fest, nicht nur eine App-Regel. Die RPC `recycle_tasks` (§5) liefert als `reason` den gespeicherten `recycle_reason_code`, ersatzweise den `lost_reason_code`; bei `origin='telefon'`/`'setting'` steht dort `dead`, bei `origin='linkedin'` `fu_exhausted` — beides keine DB-Enums, nur die beiden Ursprüngen zugeordneten Grund-Token der App.
**Der Grund kommt aus der Zeile, nicht vom Client.** Die frühere Fassung schickte ihn als Argument mit — womit sich per direktem POST jede beliebige Wartezeit auslösen ließ. `schedule_recycle()` liest ihn selbst, prüft zusätzlich den Status und gibt `null` zurück, wenn der Vorgang gar nicht (mehr) terminal ist. Für Auswertungen heißt das: **`recycle_reason_code` ist das maßgebliche Feld**. `recycleIntervalDays()`/`computeNextRecycleAt()` und `DEFAULT_RECYCLE_SETTINGS` in `src/lib/recycleCadence.ts` sind **entfernt** (ihre Feldnamen `days_phone_dead` … entsprachen auch nicht mehr den Spalten in `pipeline_settings`); aus der Datei wirken nur noch `RECYCLE_REASON_LABELS` und die `{anlass}`-Ableitung `RECYCLE_REASON_HINTS`. `tests/recycleCadence.test.ts` prüft die eine Regel, die dabei nicht verloren gehen durfte — „`falsche_zielgruppe`/`kein_fit` bekommen nie ein Datum" — jetzt am Text der eingefrorenen Migration 0033, also dort, wo sie lebt.
**`closing_calls.show_status`** (`show`/`no_show`, bei `offen` NULL): wird beim Eintragen eines Ergebnisses **abgeleitet** — ein Ergebnis setzt voraus, dass das Gespräch stattgefunden hat, also schreibt `setClosingOutcome` `show`, sofern noch nichts erfasst ist (ein bewusst gesetztes `no_show` bleibt stehen). Analog zu `setSettingOutcome`. Migration 0028 hat das für Bestandsdaten nachgezogen. **Fallstrick:** Echte Closing-No-Shows der Vergangenheit sind nicht rekonstruierbar — die Closing-Show-Quote springt dadurch auf ~100 % und sinkt erst mit neuen Daten.

**`contacts.answer_category`** (Freitext, DB-Wert = deutsches Label, kein Constraint):
- Aktuell wählbar: `Positiv` · `Neutral` · `Negativ`
- Legacy in Bestandsdaten: `Interessiert`, `Kein Interesse`, `Zu teuer`, `Falsches Timing`, `Bereits Lösung`, `Kein Budget`, `Falsche Zielgruppe` (Definition: `src/lib/categories.ts`)

**`contacts.follow_up_number`** (FU-Stufe): **NULL** = noch kein Follow-up, 1–3 = FU1–FU3. Achtung: der CHECK erlaubt nur `null` oder `1,2,3` — eine **0 steht nie in der DB**. Wer auf „noch kein Follow-up" filtert, braucht `is null`; ein `in (0)` findet nichts, und `in (…)` trifft NULL grundsätzlich nicht. Fälligkeits-Intervalle: nach Pitch +3 Tage → FU1, danach +5 → FU2, danach +7 → FU3, danach Ende. Der Rhythmus steht an genau **einer** Stelle: `nextFollowUpAfter()` (`src/lib/followup.ts`), geschlüsselt nach der gerade *abgeschlossenen* Stufe. Beide Schreibpfade nutzen ihn — das Listen-Board (`calcNextFollowUp`, `src/app/actions/contacts.ts`, Anker = Pitch-Datum) und das Nachfassen-Board (`advanceLinkedInFollowUp`, `src/app/actions/nachfassen.ts`, Anker = heute, sonst läge die nächste Stufe bei älteren Leads sofort in der Vergangenheit). In Bestandsdaten stecken noch Fälligkeiten aus der Zeit davor, als der Nachfassen-Pfad mit der Stufe *davor* rechnete (nach FU1 nur +3 statt +5) und nach FU3 noch eine Fälligkeit setzte — je nachdem, wo ein Follow-up erledigt wurde, stand eine andere Wiedervorlage in der Zeile. Ausschluss aus dem FU-Flow: `answered=true` oder `appointment_set=true` oder FU3 erreicht oder `blocked_at` gesetzt (Lead hat uns blockiert).

## 5. RPCs = maßgebliche Metrik-Definitionen

Die Dashboards rechnen nicht frei, sondern über diese SECURITY-DEFINER-RPCs — für konsistente Auswertungen deren Semantik übernehmen. Alle nehmen `p_workspace_id` + optional `p_effective_user_id` (NULL = workspace-weit; bei `data_scope='own'` serverseitig auf den Aufrufer erzwungen).

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
| `nachfassen_tasks(ws, today, now, user?)` | fällige Aufgaben (Union) | 4 Zweige: ① LinkedIn-FU (`next_follow_up_at <= today`, Ausschlüsse §4) ② Telefon-Rückruf (`status='rueckruf'`, `callback_at <= now`) ③ Closing (`status='nachfassen'`, `follow_up_due <= today`) ④ Setting (`status in ('no_show','unqualifiziert')`, `follow_up_due <= today`). Personenfilter: ①② über `list_owned_by_user()`, ③④ über `coalesce(assigned_user_id, created_by_user_id)`. App blendet zusätzlich LinkedIn-Tasks mit Pitch > 7 Tage aus. **Signatur und Verhalten unverändert seit 0030** — der ganze Nachfassen-Umbau hat sie nicht angefasst; Recycling ist bewusst eine eigene RPC, siehe nächste Zeile. |
| `recycle_tasks(ws, today, user?)` | fällige Recycling-Versuche (Union, **v2** aus Migration 0033) | 4 Zweige über die „toten Enden" (§1). **Jeder Zweig prüft zusätzlich den STATUS** — das ist der Unterschied zur ersten Fassung, die nur auf das Datum sah: ein Lead, der auf anderem Weg wiederbelebt oder gewonnen wurde, tauchte dort Monate später als Aufgabe auf. LinkedIn: `next_recycle_at <= today`, `blocked_at is null`, `answered is not true`, `appointment_set is not true`, **`follow_up_number = 3`** · Telefon: `status='dead'` · Setting: `status in ('dead','unqualifiziert')` **oder** `no_show_resolution='ohne_antwort'` **oder** `cancel_outlook='ohne_aussicht'`, dazu `revived_at is null` · Closing: `status='verloren'`, `revived_at is null`. Alle vier zusätzlich `recycle_excluded_at is null` **und `recycle_responded_at is null`**. Liefert `reason` (`recycle_reason_code`, ersatzweise `lost_reason_code`/`sonstiges`), `reason_note`, `attempt_count`, `last_contacted_at`. Personenfilter wie bei `nachfassen_tasks`. **Eigene RPC statt Erweiterung von `nachfassen_tasks`**: eine geänderte `RETURNS TABLE`-Signatur verlangt `DROP FUNCTION` statt `CREATE OR REPLACE` — zwei stabile RPCs sind das kleinere Risiko als ein Drop mit Grants/Abhängigkeiten einer produktiv genutzten Funktion. Die App mischt beide Listen zu einer Union in `getNachfassenTasks()` (`src/app/actions/nachfassen.ts`). |
| `dropout_lists(ws, list, user?)` | Zeilen einer der sechs Ablage-Listen (Migration 0033) | `list` ∈ `abgesagt` · `ersatztermin_offen` · `disqualifiziert` · `kein_close` · `no_show_ohne_antwort` · `gesperrt` (unbekannter Wert → Exception). Abgeleitet aus dem Zeilenzustand, **keine eigene Tabelle** (§1). Fünf Listen kennen nur `setting_calls`/`closing_calls`; **`gesperrt` deckt alle vier Recycling-Tabellen ab** (auch `contacts` und `phone_leads` — „Endgültig sperren" ist im Nachfassen-Board für alle vier Ursprünge anklickbar) und **setzt den Personenfilter bewusst außer Kraft**: `v_user := null`, die Liste liefert immer org-weit. Die Spalte `list_id` ist nur bei den beiden Lead-Ursprüngen gefüllt (sie haben keine Detailseite, der Verweis führt zur Liste); bei Terminen bleibt sie NULL. |
| `schedule_recycle(ws, origin, entity_id, today?)` | das gesetzte `next_recycle_at` oder `null` (Migration 0033, Zugriffsprüfung 0037) | Bestimmt die Wartezeit **serverseitig** und schreibt `next_recycle_at` + `recycle_reason_code` in die Ursprungszeile. Grund UND Status kommen aus der Zeile, nie vom Aufrufer. Gibt `null` zurück (und schreibt nichts), wenn: keine `pipeline_settings`-Zeile existiert · der Vorgang ausgeschlossen/wiederbelebt/nicht terminal ist · der Grund nie recycelt wird · `recycle_attempt_count >= max_attempts`. **Fasst den Versuchszähler NICHT an** — die alte Fassung setzte ihn bei jedem Aufruf auf 0 und startete den Deckel neu. Prüft seit 0037 die Mitgliedschaft selbst (`workspace_members` oder Plattform-Admin). |
| `recycle_attempt(ws, origin, entity_id, today?)` | neuer `recycle_attempt_count` (Migration 0033, Zugriffsprüfung 0037) | Erhöht den Zähler, setzt `recycle_last_contacted_at` und nullt `next_recycle_at`, sobald der Deckel erreicht ist — alles in **EINER** Anweisung. Vorher wurde gelesen, gerechnet und zurückgeschrieben: zwei parallele Klicks auf „Nochmal versucht" verbrannten zwei von zwei erlaubten Versuchen. Prüft seit 0037 die Mitgliedschaft selbst — und zwar **vor** der Prüfung des `origin`-Arguments: Wer nicht zur Organisation gehört, soll nicht einmal erfahren, welche Ursprünge es gibt. **Setzt unterhalb des Deckels KEINE neue Fälligkeit** — der alte `next_recycle_at` bliebe stehen, und der liegt per Definition schon in der Vergangenheit. Die nächste Wartezeit plant deshalb `markRecycleContacted` (`src/app/actions/recycle.ts`) direkt danach über `schedule_recycle()` ein; ohne diesen zweiten Aufruf stünde dieselbe Karte am nächsten Tag wieder da, und die zweite Ghosting-Stufe (`days_ghosting` statt `days_ghosting_breakup`) wäre unerreichbar, weil sie `recycle_attempt_count > 0` verlangt. |
| `apply_reminder_touches(ws, entity_type, entity_id, cascade_kind, rows)` | Anzahl neu angelegter Touches (Migration 0032) | Entwertet die offenen Touches dieser einen Kaskade (`superseded_at = now()`) und legt die übergebenen neu an — in **EINEM** Funktionskörper. Vorher waren das zwei Statements gegen einen partiellen Unique-Index; zwei dicht aufeinanderfolgende Auslöser (Umterminieren plus Ergebnis) ließen den Insert scheitern, und weil der Aufruf fail-soft ist, stand der Termin danach ganz ohne Kaskade da. Prüft die Mitgliedschaft selbst (`workspace_members` oder Plattform-Admin). |
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
Auswertung, die beantwortet, ob die Wiedervorlage überhaupt etwas bringt. Ohne sie ließen sich
die Wartezeiten in `pipeline_settings` nur nach Gefühl ändern.

| Kennzahl | Zähler | Nenner | Zeitachse |
|---|---|---|---|
| **Kontaktiert** | — | — | Zeilen mit `recycle_last_contacted_at` (Berlin-Tag) im Zeitraum. Das ist die **Kohorte** der Sektion. |
| **Reaktionen** | `recycle_responded_at is not null` | — | heutiger Stand, gebucht auf den Tag des Versuchs |
| **Wiederbelebungsquote** („Wiederbelebt") | Reaktionen | Kontaktierte | **Kohorten-Quote wie die Telefon-Quoten:** Der Zeitraum schneidet den *letzten Versuch*, der Zähler ist der heutige Stand genau dieser Leads. Eine Antwort, die erst nächste Woche kommt, zählt rückwirkend auf die Woche des Versuchs. |
| **Am Deckel** | `recycle_attempt_count >= max_attempts` **und** keine Reaktion | — | ohne konfigurierten Deckel `null` („—"), nie 0 |
| **Gesperrt** | `recycle_excluded_at` im Zeitraum | — | **eigenes Datum**, bewusst außerhalb der Quote: Eine Sperre ist kein gescheiterter Versuch, sie ist eine Entscheidung. |
| **Warten aktuell** | `next_recycle_at is not null` | — | Stand von **heute**, ohne Zeitraumfilter — „wie viel liegt gerade in der Wiedervorlage" |
| **Verteilung der Versuche** | Kontaktierte je Slot (1 · 2 · 3+) | Kontaktierte | aus `recycle_attempt_count` |

Zwei Tabellen mit denselben vier Spalten (Kontaktiert · Reaktionen · Wiederbelebt · Am Deckel):
**Je Ursprung** (LinkedIn · Telefon · Erstgespräch · Closing) und **Je Grund**. Der Schlüssel
der zweiten ist `<ursprung>:<grund>`, nicht der Grund allein — „Dead" aus dem Telefon und
„Dead" aus dem Erstgespräch sind zwei verschiedene Befunde und dürfen nicht in eine Zeile
fallen. Personenachse wie überall zweigleisig: LinkedIn/Telefon über den Listen-Owner,
Setting/Closing über `personOf()` (§5.1). Datenlage-Anker und `available`-Rückfall wie beim
Anruf-Log: Fehlt Migration 0033, sagt die Sektion das, statt wie „niemand recycelt" auszusehen.

### 5.1 Analyse-Bereich (`/analyse`, sechs Tabs)

Sechs Tabs, jeder mit genau einer Zuständigkeit — dieselbe Zahl steht nirgends zweimal:

| Tab | Trägt | Zuständig für (steht nur hier) |
|---|---|---|
| **Übersicht** | Matrix **Kennzahl × Kanal × Gesamt** („Kanäle im direkten Vergleich": Akquise-Volumen · Settingtermine · Show-Quote · Quali-Quote · Closingtermine · Umsatz), „Fortschritt im Zeitraum", Personen-Tabelle, **„Lohnt das Recycling?"** (Wiederbelebungsquote je Ursprung und je Grund, zugeklappt am Ende — §5) | der Kanalvergleich in einem Blick **und** die Recycling-Wirkung. **Kein Trichter** — den gibt es genau einmal, im Funnel-Tab; zwei optisch gleiche Trichter mit verschiedenen Zählweisen beschädigen beide |
| **LinkedIn** | 6 Kennzahlen (DMs · Antwortquote · Antworten mit Stimmungs-Balken · Termine gelegt · Terminquote · Block-Quote), „Vergleich" (nur bei mehr als einer sichtbaren Person), „Fortschritt", Consistency, Follow-ups (Kaskade + „Zusatz durch FU an Umsatz"), „Wird konsequent nachgefasst?", „Wer hängt hinterher?", „Listen im Vergleich" | alle LinkedIn-Kennzahlen. Die früheren Tabs „Follow-ups" und „Listen" sind hier aufgegangen; `?tab=followup`/`?tab=listen` fällt still auf „uebersicht" zurück |
| **Telefon** | 11 Kennzahlen in drei Blöcken (Volumen · Durchkommen · Terminquoten & Rückruf), „Vergleich" (Personen ohne Telefon-Aktivität im Zeitraum werden ausgeblendet und in der Fußnote gezählt), „Nachfassen oder neue Leads?" (Anruf-Log), „Fortschritt", A/B nach Skript und Branche, Gatekeeper-Weg, Versuchszähler, Abbruch-Gründe (drei Untertabellen), Akquise-Trichter | die Ereignis-Ebene (**Anwahlen**, §1) und die A/B-Achsen |
| **Setting** | 4 Kennzahlen (Termine · Show-Quote · Qualifiziert · Zu Closing geschickt), „Vergleich", „Fortschritt im Zeitraum", „Termine im Verlauf", Quellen-Donut, „Quelle des Termins", „Erinnerungs-Disziplin" (Erledigungsquote je Person + Show-Quote je Kaskaden-Stufe, zugeklappt — zwei Grundgesamtheiten, s. u.); alles Weitere unter „Mehr Auswertungen" (Zeitfenster · Termin-Art · Branche · Kriterien · Budget · Qualität · Status) | die Qualifizierungs-Schnitte |
| **Closing** | 6 Kennzahlen (Closing-Termine · Show-Quote · Abschlussrate · Umsatz pro Meeting · Ø-Deal · Umsatz), „Vergleich", „Fortschritt im Zeitraum", Top-Einwände, Matrix Einwand × Person, „Erinnerungs-Disziplin" (wie Setting; der vereinbarte Nachfass-Kontakt zählt beim Personen-Block mit, beim Stufen-Block bewusst nicht, s. u.); „Mehr Auswertungen" („Umsatz im Verlauf" · Win/Loss · Geschwindigkeit · Deal-Größen · Vertrag · Zahlungsarten) | Verlustgründe. **Keine Quellen-Tabelle mehr** — Herkunft rechnet der Funnel-Tab als einziger bis zum Umsatz durch |
| **Funnel** | Wert-Kacheln je Kanal, „Wo kommt der Umsatz her?", der **Trichter** („Funnel Gesamt"), „Fortschritt", Matrix „Je Quelle", **„Absagen"** (zwei Absagequoten + Tabelle „Warum abgesagt wurde", zugeklappt unter dem Trichter — §5) | der einzige Termin-Trichter, die einzige Quellen-Auswertung bis zum Umsatz **und** die einzige Stelle mit einer Absagequote. Die Sektion sitzt bewusst hier: Der Funnel ist der Tab, der Absagen ausschließt — die Zahl darf nicht verschwinden, sie muss sichtbar werden |

**Zwei Konventionen gelten auf allen sechs Tabs** (und auf der Vergleichsseite):

- **„Fortschritt" ist nicht „Verlauf".** Jeder Tab führt eine kumulative Fortschritts-Sektion (`CumulativeProgressChart`): aufsummierter Stand über den Zeitraum, mit der Vorperiode als Vergleichslinie. Sie beantwortet „liegen wir vorn oder hinten" — die Frage, mit der man die Seite öffnet, und deshalb steht sie oben. Die Sektionen mit „… im Verlauf" (Setting, Closing) sind etwas anderes: bucketierte Perioden-Werte, jeder Balken für sich. Wer die kumulative Kurve als Perioden-Chart liest, sieht überall Wachstum.
- **Sektionen sind einklappbar, Erklärungen stehen hinter dem Info-Icon.** Alles unterhalb der Kennzahlen-Reihe läuft über `AnalyseSection` mit `collapsible`; die meisten Sektionen starten zugeklappt (`defaultOpen={false}`) — der Tab öffnet mit Kennzahlen und Fortschritt, den Rest holt man sich. Die Begründungstexte stecken in `InfoPopover` statt dauerhaft im Fließtext. Wichtig für die Umsetzung: `AnalyseSection` ist eine Server Component, das `info`-Element darf **keinen** Handler tragen — `preventDefault`/`stopPropagation` sitzen im Client-Teil `InfoPopover`, sonst bricht das Prerendering (was hier lange unbemerkt blieb, weil alle Analyse-Seiten `force-dynamic` sind).

> **„Erinnerungs-Disziplin": zwei Blöcke, zwei Grundgesamtheiten.** `loadReminderTouches()`
> (`src/lib/analyseData.ts`) selektiert `touch_kind`/`cascade_kind`/`step_no` (v2, §4) und gibt
> — Muster Anruf-Log — `{ rows, available }` zurück: Scheitert die Abfrage, sagt die Sektion
> das, statt wie „keine Erinnerungen" auszusehen. (Bis zur Nachführung stand dort die alte
> Spalte `touch_type`; PostgREST wies die gesamte Abfrage ab, ein `.catch(… → [])` machte
> daraus eine leere Liste, und beide Blöcke waren dauerhaft und unbemerkt leer.)
> Gezählt werden nur Touches, die entweder erledigt **oder** nicht superseded sind
> (`done_at.not.is.null,superseded_at.is.null`): Eine Neuterminierung macht einen offenen Touch
> obsolet, aber ein VORHER erledigter bleibt ein echtes Stück Disziplin.
>
> Der **Personen-Block** zählt jeden fälligen Touch (alle `touch_kind`, im Closing-Tab auch die
> des Nachfass-Kontakts) — das ist die geleistete Arbeit. Der **Stufen-Block** („Welcher Touch
> wirkt am stärksten?") zählt nur, was VOR dem Gespräch lag: `chain`-Stufen (No-Show-,
> Kein-Close-Kette) fallen raus, und im Closing-Tab zusätzlich `entity_type='closing_followup'`.
> Beide Gründe sind derselbe — ein Touch, der erst nach dem Termin entsteht, kann dessen
> `show_status` nicht erklären. Der Nachfass-Kontakt trägt zudem **dieselbe `entity_id`** wie
> das Closing (beide zeigen auf `closing_calls.id`), ein Closing mit beiden Kaskaden zählte
> sonst doppelt. Gruppiert wird über `cascade_kind` + `step_no`, nicht über die Stufennummer
> allein: Nachrichten- und Mail-Spur tragen beide eine „Stufe 1".

Filter in der URL: `tab`, `range`/`von`/`bis`, `g` (Granularität, auf allen Tabs — auch der Funnel bucketet), `users`, `quelle` (Setting/Funnel; Wertebereich = `filterable` in der Kanal-Registry, §4), `reife` (nur LinkedIn), `listen` (nur LinkedIn, kommaseparierte `lists.id`, syntaktisch UUID-geprüft und zusätzlich gegen die real sichtbaren Listen abgeglichen), `modus` (nur Funnel, Default `kohorte`). Beim Tabwechsel werden die Parameter gelöscht, die auf dem Zieltab nichts bewegen — ein Filter ohne Bedienelement filterte sonst unsichtbar weiter. Einen Parameter `min` (Mindest-DMs) gibt es **nicht**: Die Grenze für das Listen-Ranking steht fest bei 10 DMs (`MIN_LIST_DMS`) — bei 3 von 5 DMs steht in der Antwortquote 60 %, und ein Regler, mit dem man Rauschen einschalten kann, hilft niemandem. Der Auf-/Zuklapp-Zustand der Filterleiste steht bewusst **nicht** in der URL (er ändert keine Zahl), sondern im localStorage; die aktiven Filter stehen als Satz im zugeklappten Kopf. Parsing ausschließlich in `parseAnalyseParams` (`src/lib/analyse.ts`), Datenbeschaffung ausschließlich in `src/lib/analyseData.ts` — dort läuft **jede** Abfrage über `fetchAllRows`, weil PostgREST sonst still bei 1000 Zeilen abschneidet. Drei Stellen daneben, alle ebenfalls über `fetchAllRows`: die Auswahlliste des Listen-Filters (`analyse/page.tsx`), die Termin→Liste-Brücke (`LinkedInTab.tsx`) und das Anruf-Log (`src/lib/phoneAttemptsData.ts`, eigene Datei — es ist die einzige EREIGNIS-Quelle und fällt bei fehlender Migration 0028 auf `available: false` zurück, statt den Telefon-Tab abzuräumen).

**Drei Loader mit `available`-Rückfall** folgen inzwischen demselben Muster — sie geben `{ rows, available }` zurück, statt einen Fehler zu `[]` einzuebnen, weil sonst eine fehlende Migration genauso aussieht wie „nichts passiert": `loadCallAttempts` (0028), `loadReminderTouches` (0032) und `loadRecycleData` (0033). Zwei Eigenheiten von `loadRecycleData`, die man beim Nachrechnen kennen muss: Es lädt **ohne Zeitraumfilter** — die Sektion trägt zwei Zeitachsen (`recycle_last_contacted_at` für die Kohorte, `recycle_excluded_at` für die Sperren) und braucht zusätzlich den ältesten Versuch als Anker gegen die Deploy-Datum-Falle. Und `pipeline_settings.max_attempts` hängt an einem **eigenen** Zweig: Ein Fehler dort kostet die Kachel „Am Deckel", nicht die Sektion.

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

-- Erinnerungs-Disziplin von Hand (dieselbe Zählweise wie der Analyse-Block,
-- §5.1). Gruppiert über cascade_kind + step_no, NICHT über die Stufennummer
-- allein — Nachrichten- und Mail-Spur tragen beide eine "Stufe 1".
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

-- Fälligkeit aus nachfassen_tasks: due_at ist timestamptz, trägt aber
-- überwiegend TAGE (§6). Ein gecastetes `date` steht auf 02:00 Berlin — roh
-- gegen now() verglichen wäre ab zwei Uhr morgens alles überfällig. Nur der
-- Telefon-Zweig trägt eine echte Uhrzeit.
select source, count(*) filter (
         where case when source = 'telefon' then due_at < now()
                    else (due_at at time zone 'Europe/Berlin')::date
                         < (now() at time zone 'Europe/Berlin')::date end
       ) as ueberfaellig, count(*) as faellig
from nachfassen_tasks('<workspace>', current_date, now())
group by 1 order by 3 desc;
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
- **Sechs Ereignisquellen** in der Zeitleiste (`DossierEventSource`): `linkedin` · `telefon` ·
  `setting` · `closing` · `erinnerung` · `recycling`. Geschätzte Zeitpunkte tragen ein
  sichtbares `≈` — vor allem die FU-Stufen, für die es **kein** Ereignis-Log gibt (§5.1);
  eine geratene Uhrzeit als Tatsache darzustellen wäre hier besonders teuer, weil daneben
  echte Zeitstempel stehen.
- **Doppelzählung vermieden:** Der „Erstkontakt" aus `phone_leads.first_call_at` erscheint nur,
  wenn das Anruf-Log für diesen Lead leer ist — sonst stünde derselbe erste Wählversuch zweimal
  in der Leiste. Superseded, nie erledigte Touches fallen raus.
- **Fail-soft in Stufen:** Vier Abfragerunden, höchstens acht Abfragen. Runde 4
  (`phone_call_attempts`, `reminder_touches`, `profiles`) darf scheitern, ohne die Seite
  mitzunehmen — die Zeitleiste wird dann dünner, nicht die Seite weiß. Fehlt eine ganze
  Migration, unterscheidet die Leerseite ausdrücklich „Dossier nicht verfügbar" von „Kein Lead
  unter dieser Adresse".
- **Bekannte Grenze:** Das Dossier benutzt **kein** `fetchAllRows` (§5.1). Der
  Firmennamen-Vorfilter läuft als `ilike` gegen `contacts` und `phone_leads` und unterliegt
  damit der PostgREST-Standardgrenze — bei einem sehr häufigen Firmennamen kann die
  **Vermutungsliste** still unvollständig sein. Der Kern ist davon nicht betroffen (er wird
  über IDs geladen), und weil Vermutetes ohnehin nirgends mitzählt, kostet das eine Anregung,
  keine Zahl.
- **Erreichbar** ist es aus `/ablage`, `/erinnerungen` und `/nachfassen` — jeweils als Overlay
  (`LeadDossierSheet`), nicht als Absprung, damit die Arbeitsliste nicht verloren geht. Die
  globale **Suche verlinkt es bisher nicht**; sie kennt dieselben vier `kind`-Werte, führt aber
  weiter auf Listen- und Detailseiten.

### 5.4 Navigations-Zähler (`src/lib/navCounts.ts`)

Drei Badges in der Seitenleiste — an `/erinnerungen`, `/nachfassen` und `/ablage`, sonst
nirgends. Jedes trägt `{ total, overdue }`; überfällige Einträge färben das Badge amber. Auf
Mobil fasst `MobileHeader` alle drei zu einem Punkt am Menü-Knopf zusammen.

Drei Eigenschaften, die man kennen muss, bevor man eine Badge-Zahl gegen eine Seite hält:

- **`null` heißt „nicht ermittelbar", nicht „null Aufgaben".** Schlägt eine der Abfragen fehl
  (fehlende Migration, RLS), verschwindet das Badge — es behauptet keine beruhigende 0. Bei
  `/nachfassen` gilt das für beide RPCs gemeinsam: ein halbes Badge wäre schlimmer als keins.
- **Die Zähler sind strikt persönlich** (`effective_user_id ?? user.id`), auch für einen Owner
  mit Team-Sicht — mit einer Ausnahme: **`/ablage` zählt org-weit**, wenn keine Datensicht
  aktiv ist, genau wie die Seite selbst. Gezählt wird dort nur die eine Liste mit offener
  Handlung („Abgesagt, Ersatztermin steht aus"), nicht die Summe aller sechs: Ein Badge auf
  einem Archiv, das nie auf null geht, ist eine Mahnung ohne Adressat.
- **Zwei der drei weichen bewusst von ihrer Seite ab, und zwar in bekannter Richtung:**

| Badge | Verhältnis zur Seite |
|---|---|
| **Ablage** | **deckungsgleich** — dieselbe RPC, dieselben Parameter wie der Tab-Zähler |
| **Nachfassen** | **zählt mehr**: dieselben zwei RPCs wie die Seite, aber ohne deren Ausblendung älterer LinkedIn-Leads (Pitch > 7 Tage). Die Seite nennt die versteckte Zahl in derselben Zeile — die Differenz ist also auflösbar, nicht rätselhaft |
| **Erinnerungen** | **zählt anders in beide Richtungen**: nur **heute** statt des vollen `reminder_horizon_days`-Fensters und nur unerledigte Touches (ein 7-Tage-Badge ginge nie auf null und mahnte an, was noch gar nicht fällig ist) — dafür zählt es **Touches**, während die Seite mehrere Stufen desselben Termins zu EINER Karte bündelt. Das Badge kann die Kartenzahl deshalb überschreiten |

**Was Badge und Seite garantiert teilen, ist die Überfällig-Regel** — sie steht einmal in
`src/lib/dueState.ts` und wird von beiden gelesen (§6). Genau dafür wurde die Datei angelegt:
Eine Navigation, die eine Dringlichkeit behauptet, die die Seite daneben nicht kennt, ist
schlimmer als gar kein Badge.

Betriebsverhalten: kein Caching (die Zähler laufen bei jedem Seitenaufruf im bestehenden
`Promise.all` des Layouts mit), aber eine harte **Frist von 1,5 s** — was länger braucht,
liefert `null` und damit kein Badge, statt das Layout aufzuhalten. Der Überfällig-Anteil wird
über höchstens 500 Zeilen ermittelt (nach Fälligkeit aufsteigend sortiert, überfällige stehen
also vorn); `total` kommt aus `count: 'exact'` und ist von dieser Grenze **nicht** betroffen.
Eine „99+"-Kappung gibt es nicht.

## 6. Zeit & Zeitzonen (Fallstricke für Auswertungen)

- **`date`-Spalten** (reine Kalendertage, kein TZ-Thema): `pitched_at`, `next_follow_up_at`, `first_call_at`, `setting_calls.call_at`, `follow_up_due`, `contract_start`, `closing_calls.onboarding_at` (Migration 0032 — der Onboarding-Tag hat keine Uhrzeit), `next_recycle_at` (contacts/phone_leads/setting_calls/closing_calls, Migration 0033 — Recycling ist Wochen/Monate-Kadenz, keine Uhrzeit-Präzision).
- **`timestamptz`-Spalten** (UTC in DB): `appointment_at` (contacts/phone_leads/setting_calls), `callback_at`, `closing_at`, `closing_calls.call_at`, `phone_call_attempts.called_at`, `wa_consent_at`/`wa_refused_at` (setting_calls, Migration 0032), `follow_up_due_at` (closing_calls, Migration 0032), der Termin-Lebenszyklus aus 0032 (`cancelled_at`, `last_reschedule_at`, `revived_at` auf beiden Termin-Tabellen), die beiden Recycling-Zeitstempel aus 0033 (`recycle_excluded_at`, `recycle_last_contacted_at`, `recycle_responded_at` auf allen vier Ursprungstabellen), `reminder_touches.due_at`/`appointment_at`/`done_at`/`superseded_at`/`snoozed_until` (Migration 0032 — anders als die übrigen `_at`-Termin-Spalten hier UHRZEIT-präzise, weil die Kaskade genau darauf rechnet), alle `created_at`/`updated_at`.
- **Alle Termin-Spalten enthalten echtes UTC** — seit Migration `20260404000021_appointment_timezone_fix.sql`. Vorher schrieben die Terminpfade den rohen `datetime-local`-String (Berlin-Wandzeit) direkt in die `timestamptz`-Spalte, wodurch Termine um den UTC-Offset zu spät erschienen; `closing_calls.call_at` war die einzige Ausnahme mit korrektem UTC. Die Migration hat `setting_calls.appointment_at`/`closing_at`, `contacts.appointment_at`, `phone_leads.appointment_at`/`callback_at` DST-genau korrigiert (Sicherung liegt in `public._appt_tz_backup_20260727`).
- **Einzige Konvertierungsstelle im Code: `src/lib/apptTime.ts`** (`berlinInputToIso` / `isoToBerlinInput` / `berlinDateISO` / `toBerlinSlot` / `slotToIso` / `formatTermin`). Der Offset kommt aus `Intl` mit fester Zone `Europe/Berlin` und hängt damit **nicht** von der Server-Zeitzone ab (Vercel = UTC, lokal = Berlin) — genau daran war die alte Speicherung zerbrochen. Neue Schreibpfade müssen `berlinInputToIso()` verwenden, nie `new Date(input).toISOString()`.
- Die Analyse-Tabs **und** die Vergleichsseite bucketen über den **Berlin-Kalendertag** (`berlinDateISO`, `src/lib/analyse.ts`); die frühere UTC-Slice-Inkonsistenz an der Tagesgrenze ist damit weg. `rpc_appointments_booked` macht dasselbe in SQL (`(created_at at time zone 'Europe/Berlin')::date`) — sonst rutschte ein abends gebuchter Termin in den Vortag. Auch die Kachel „Termine gelegt" im LinkedIn-Tab rechnet über `berlinDateISO(created_at)`.
- **Zeitraumfilter auf `timestamptz` brauchen einen Tagespuffer.** PostgREST kann nicht in Berlin-Zeit schneiden, deshalb das Muster aus `loadCallAttempts` (`src/lib/phoneAttemptsData.ts`): in SQL grob mit einem Tag Luft nach beiden Seiten filtern (`gte from-1`, `lt to+2`), danach in JS exakt über `berlinDateISO` nachfiltern. Ohne den Puffer fehlten Randanrufe, ohne den Nachfilter lägen sie im falschen Tag — und der Rest des Tabs bucketet bereits nach Berlin.
- **`nachfassen_tasks.due_at` ist ein `timestamptz`, trägt aber überwiegend TAGE.** Die RPC presst fünf Quellen in eine Spalte, und vier davon sind in Wahrheit `date`-Werte, die sie nur castet. Ein `date` wird dabei zu Mitternacht UTC — in Berlin also **02:00 desselben Tages**. Wer die Spalte nach ihrem Datentyp liest, hält jedes Follow-up ab zwei Uhr morgens für überfällig; und weil die RPC ohnehin nur Fälliges liefert, wäre schlicht **alles** überfällig. Eine Dringlichkeit, die immer gilt, ist keine. Maßgeblich ist deshalb die **Körnung der Quelle**, nicht die Schreibweise des Werts: Nur der Telefon-Rückruf (`callback_at`) trägt eine verabredete Uhrzeit (`moment`), LinkedIn-Follow-up, Setting-/Closing-Wiedervorlage und Recycling haben den ganzen Tag Zeit (`day`) und werden erst am **Folgetag** überfällig. Die Regel steht an genau einer Stelle — `isOverdue(value, granularity, ref)` in `src/lib/dueState.ts` —, gelesen von der Seite *und* vom Navigations-Zähler (§5.4). Für SQL heißt das: `due_at` nie roh gegen `now()` halten, sondern gegen `(now() at time zone 'Europe/Berlin')::date`, außer beim Telefon-Zweig.
- **Kontaktfrequenz: der Auslöser ist ein rollendes 72-Stunden-Fenster, die Beschriftung ein Kalendertag.** `CONTACT_GAP_WARN_DAYS = 3` entscheidet als reine Millisekunden-Differenz (`now − last < 3 · 86 400 000`), ob die Warnung erscheint; `contactAgeDays()` / `lastContactLabel()` (`src/lib/contactGap.ts`) rechnen für den Text dagegen in **Berliner Kalendertagen** — „gestern 23:00" ist gestern, auch wenn es zwei Stunden her ist. Beide Zahlen sind absichtlich verschieden gemeint (Schwelle vs. Sprechweise); sie sind nur dann inkonsistent, wenn man sie füreinander hält.
- **Kaskaden-Offsets rechnen in Berliner WANDZEIT, nicht in Millisekunden** (`shiftBerlinMinutes()`, `src/lib/cascadeEngine.ts`). „1 Tag vorher" heißt für einen Menschen dieselbe Uhrzeit einen Tag früher; auf dem UTC-Zeitstempel gerechnet läge die Fälligkeit am Umstellungswochenende eine Stunde daneben. Der Weg ist immer: ISO → Berliner Wandzeit → Kalenderarithmetik auf den Ziffern → `berlinInputToIso()` zurück nach UTC. Dieselbe Zone benutzt `schedule_recycle()` in SQL für „heute" (`(now() at time zone 'Europe/Berlin')::date`).
- **Empfehlung für SQL:** `(spalte at time zone 'Europe/Berlin')::date` für die Tageszuordnung von `timestamptz`-Spalten. ISO-Wochen (Montag-basiert) mit `date_trunc('week', …)`.

**`Europe/Berlin` ist eine Produktgrenze, keine Einstellung.** Es gibt bewusst **keine
Zeitzone je Organisation und keine je Nutzer** — die Zone steht als Konstante an genau einer
Stelle (`src/lib/apptTime.ts`), in `rpc_appointments_booked`, in `schedule_recycle()` und in
jeder SQL-Empfehlung dieses Dokuments. Das ist eine Entscheidung, keine Auslassung: Sobald
zwei Organisationen in verschiedenen Zonen lägen, wären „Tag", „Woche" und damit *jede* Zahl
in §5 mandantenabhängig — Wochenduell, Consistency, Fortschritts-Kurven und die
Kaskaden-Fälligkeiten müssten alle dieselbe zusätzliche Achse tragen, und ein Vergleich über
Organisationen hinweg (Plattform-Admin-Sicht) verlöre seine gemeinsame Grundlage. Solange
alle Kunden im DACH-Raum arbeiten, kostet die feste Zone nichts und spart genau diese Achse.
**Die Software ist damit auf den DACH-Raum begrenzt.** Ein Kunde in einer anderen Zone ist
kein Konfigurations-, sondern ein Umbaufall: Er berührt jede Bucket-Funktion, beide
Termin-Definitionen aus §5, die Kaskaden-Engine und die Tagesgrenzen sämtlicher RPCs.

## 7. Schema-Drift-Warnung

**Migrationen laufen in der Supabase-Konsole nicht zuverlässig vollständig.** Wird im Editor Text markiert, führt „Run" nur die Markierung aus — der Rest der Datei bleibt liegen, ohne Fehlermeldung. Zweimal nachgewiesen: Migration `…0027` hatte auf der Produktions-DB nur `preview_delete_workspace` angelegt, nicht `platform_delete_workspace` (nachgezogen am 9. September 2026; bis dahin scheiterte „Organisation löschen" im Admin-Bereich — was niemandem auffiel, weil man es erst im Ernstfall merkt). Dasselbe am 8. September bei `…0031`, wo `template_catalog` entstand, `message_templates` aber nicht. **Nach jedem Einspielen deshalb den Verifikationsblock am Dateiende fahren** — er steht genau dafür dort.

Der Migrationsordner ist fast, aber nicht 100 % vollständig:
- Migrationen `…000002` und `…000004` fehlen im Repo (Nummerierungslücke).
- Migration 0014 erwähnt explizit einen Alt-CHECK auf `answer_category` „aus der nicht im Repo vorhandenen Alt-Migration".

**Stand des Abgleichs (Juli 2026, vor dem Mandanten-Umbau):** Das Live-Schema wurde vollständig gegen den Migrationsordner geprüft (alle 18 Tabellen). Genau **zwei** Spalten existierten live ohne Migration:
- `lists.owner_name` — wird überall benutzt (RPCs, RLS-Backfill, UI). Nachgezogen in Migration `…0024_schema_reconcile.sql`.
- `profiles.is_super_admin` — verwaist, von keiner Zeile Code gelesen. Bewusst **nicht** in den Migrationsordner übernommen (eine frische DB soll sie nicht bekommen); Migration 0025 friert sie per Trigger ein. Siehe §2.

**Seit dem Nachfassen-Umbau kommen fünf Tabellen dazu** — `template_catalog`, `message_templates` (0031), `pipeline_settings`, `cascade_steps`, `reminder_touches` (0032). Sie stammen unmittelbar aus den Migrationen; geprüft wurden sie nach dem Einspielen über die Verifikationsblöcke am Ende jeder Datei (Katalog 31 Zeilen, je Organisation 21 Kaskadenstufen). Ein vollständiger Abgleich des Live-Schemas gegen den Migrationsordner steht seither aus. **0035–0040 legen keine Tabelle und keine Spalte an** — sie fassen ausschließlich Funktionen, Trigger und Ausführungsrechte an; der Tabellenstand ist mit 0033 abgeschlossen.

Konsequenz: Bei Unsicherheit über existierende Spalten das Live-Schema per MCP prüfen (`list_tables`), statt allein den Migrationen zu vertrauen.

**Nullable-Fallen bei Boolean-Filtern:** `contacts.answered` und `contacts.appointment_set` sind `boolean | null`, und **NULL ist der Normalfall** (frisch gepitcht = noch nichts passiert). Ein `= false` verliert damit die Mehrheit der Zeilen. Die gesamte App liest „nicht true" als Nein — so auch `isDueFollowUp` (`ListBoardV2`), der `nachfassen_tasks`-RPC und `viewFilterOps` (`src/lib/listViews.ts`). In SQL entsprechend `is not true` statt `= false`.

**Manuell auszuführende Migrationen:** `…0019`, `…0020`, `…0021`, `…0022` (pg_trgm-Suchindizes), `…0023` (`list_views`), `…0024` (Schema-Abgleich), `…0025` (`platform_admins`), `…0026` (Nutzer-Umzug), `…0027` (Organisation löschen), `…0028` (`fundament`: Zuweisung, Anruf-Log, RPC-Korrekturen), `…0029` (`analyse_umbau`: Quellen, Termin-Rufnummer, Verlustgrund-Codes, Telefon-Skripte), `…0030` (`script_label_snapshot`), `…0031` (`message_templates`), `…0032` (`reminder_cascade`), `…0033` (`lead_recycling`), `…0034` (`tenant_lifecycle`), `…0036` (`tenant_lifecycle_nachtrag`), `…0037` (`rpc_zugriffspruefung`), `…0038` (`umzug_anruflog`), `…0039` (`apply_touches_pruefung`) und `…0040` (`schreibpfad_mandantengrenzen`) laufen nicht automatisch — sie müssen im Supabase-SQL-Editor ausgeführt werden. **0031 bis 0034 sind am 8. September 2026 auf der Produktions-DB eingespielt** (Verifikation bestanden: Katalog 31 Einträge, je Organisation eine `pipeline_settings`-Zeile und 21 `cascade_steps`, davon 16 aktiv), **0036 und 0037 kurz darauf**. Der zugehörige Code liegt aber weiterhin nur auf Branch `feature/erinnerungs-kaskade` und ist NICHT deployt: Die Datenbank ist dem ausgelieferten Stand voraus. Das ist gewollt (Verifikationsfenster) und gefahrlos, weil `main` keine der neuen Tabellen liest. **Damit sind 0031–0034, 0036 und 0037 eingefroren** — jede weitere Schema-Änderung braucht eine neue Nummer.

Dass 0036 und 0037 nach 0035 eingespielt wurden, obwohl 0035 dazwischen liegt, ist **kein Versehen**: Die drei sind voneinander unabhängig (keine berührt eine Tabelle), und 0035 ist die einzige, die auf den Deploy warten muss. Die Nummer ist eine Reihenfolge im Ordner, keine Zwangsfolge beim Ausführen.

Beim Einspielen zu beachten: **Die Supabase-Konsole fährt ein ganzes Skript in einer Transaktion — ein Abbruch rollt die Datei zurück. Wird sie in Teilen ausgeführt (markierter Text), entsteht ein Halbzustand;** genau das ist bei 0031 einmal passiert.

**Noch NICHT eingespielt, mit Absicht — vier Dateien:**
- **`…0035`** (`pflichtfelder`) erzwingt per Trigger zwei Regeln, die heute nur die Oberfläche einhält: ein abgesagter Termin braucht einen `cancel_reason_code`, ein Erstgespräch mit `status='unqualifiziert'` einen `disqualify_reason_code`. **Erst mergen und ausliefern, dann einspielen** — die heute produktive App schreibt `unqualifiziert` ohne Grundcode und würde beim nächsten Klick an einer DB-Exception zerbrechen; die Datei trägt die Warnung als Kopfblock und prüft beim Start per `raise exception`, dass 0032 vorhanden ist. Trigger statt CHECK, weil ein CHECK bei JEDEM Update der Zeile greift und damit jede Bestandszeile ohne Grund dauerhaft unbearbeitbar machte — ausgerechnet die, die nachgepflegt werden müssen (dieselbe Falle wie bei den `source_type`-CHECKs, §4). Die Trigger vergleichen deshalb OLD/NEW und werfen nur, wenn der schlechte Zustand **in diesem Statement neu entsteht**; sie hängen zudem an `update of <spaltenliste>`, ein Update auf Notizen oder Zuweisung löst sie gar nicht erst aus. Drei Trigger, zwei Funktionen, kein Backfill — die Nachpflege gehört bewusst in die Oberfläche (`/ablage`), weil ein rohes `UPDATE` die Folgen des Grundes überspringt (Kontaktverbot bei `keine_zusammenarbeit`, Räumen eines geplanten Recycling-Datums bei `falsche_zielgruppe`). Die App-Voraussetzung ist bereits erfüllt: `setSettingOutcome` schreibt Status und Grund in EINEM UPDATE (§4).

- **`…0038`** (`umzug_anruflog`) schließt die letzte dokumentierte Umzugslücke: `phone_call_attempts` zieht beim Nutzer-Umzug mit (§2, bis dahin die benannte Ausnahme in §8). Rein additiv — nur `create or replace` auf `preview_move_user()` und `admin_move_user_to_workspace()` bei unveränderter Signatur plus idempotente Grants, keine DDL. Reihenfolge unkritisch, sie kann vor oder nach 0035 laufen. Der neue `counts`-Schlüssel `phone_call_attempts` steht bereits in `COUNT_LABELS` (`src/lib/lifecycleLabels.ts`), die neue Warnung `attempt_list_snapshot_split` bringt ihren Text aus der DB mit. `list_id`/`owner_name` bleiben bewusst unangetastet — sie sind Snapshots des Anrufzeitpunkts (§3).
- **`…0039`** (`apply_touches_pruefung`) zieht in `apply_reminder_touches()` zwei Prüfungen nach, die dort seit 0032 fehlten: Der übergebene **Termin** muss zur Organisation gehören, und jede **Zuweisung** muss auf ein Mitglied ebendieser Organisation zeigen (bei `data_scope='own'` zusätzlich auf den Aufrufer selbst). Die Funktion ist `security definer` und läuft damit an der RLS vorbei — ihr WITH CHECK hätte beides abgewiesen, sie nicht. Erreichbar war die Lücke per direktem POST auf die RPC, Server Actions sind nicht der einzige Weg dorthin. Dieselbe Migration hängt `reminder_touches_ws_guard` zusätzlich als **BEFORE INSERT** ein; als reiner UPDATE-Trigger deckte er nur den Nutzer-Umzug ab. Signaturen unverändert (`create or replace`), Funktion des Triggers unverändert, beliebig wiederholbar. Reihenfolge unkritisch, aber **nach** dem Deploy einspielen: Erst der App-Fix in `generateScheduled`/`generateChain` (kein Ersteller-Fallback in fremder Organisation) sorgt dafür, dass ein Plattform-Admin keine Zuweisung mehr schickt, die die neue Prüfung (c) abweisen würde.
- **`…0040`** (`schreibpfad_mandantengrenzen`) schließt drei Schreibpfade, die die Mandantengrenze nicht zu Ende ziehen. **(1)** `schedule_recycle()` und `recycle_attempt()` prüfen seit 0037 die *Mitgliedschaft*, aber nicht den *Besitz* — beide sind `security definer`, ihr einziger Zeilenfilter ist `where id = … and workspace_id = …`, und der trennt Organisationen, nicht Kollegen. Ein Mitglied mit `data_scope='own'` konnte damit die Wiedervorlage eines Kollegen umdatieren oder (über den Versuchszähler, der beim Erreichen von `max_attempts` in derselben Anweisung `next_recycle_at` nullt) lautlos verschwinden lassen. Die neue Prüfung greift **nur** bei `data_scope='own'` und benutzt wörtlich die Prädikate des Personenfilters aus `recycle_tasks()` (`list_owned_by_user()` bzw. `coalesce(assigned_user_id, created_by_user_id)`) — sie kann deshalb keine Aufgabe blockieren, die die Oberfläche jemandem anzeigt. **(2)** `seed_workspace_defaults()` stand seit 0034 jedem angemeldeten Konto offen; sie überschreibt nichts (`on conflict do nothing`), legt aber per SQL abgeschaltete Kaskadenstufen einer fremden Organisation wieder an. Behoben durch Entzug des Ausführungsrechts (`revoke … from public` **und** `from authenticated`; `service_role` bekommt es ausdrücklich zurück) — es gibt keinen legitimen Aufruf aus der App, der einzige Aufrufer ist der Trigger `workspaces_seed_defaults`, und der braucht kein Grant. **(3)** `assigned_user_guard` (0028) hing nur an `before update of workspace_id`, deckte also allein den Nutzer-Umzug ab; ein direkter POST/PATCH auf `/rest/v1/setting_calls` konnte eine Zuweisung über die Org-Grenze setzen, weil die Policy schon über `created_by_user_id` erfüllt ist. Die Migration hängt denselben Trigger zusätzlich als **INSERT** ein und erweitert die Spaltenliste des UPDATE-Triggers auf `workspace_id, assigned_user_id`. Die Triggerfunktion selbst bleibt unangetastet (sie liest nur `new` und kennt kein `OLD`, arbeitet also auch beim INSERT korrekt), ebenso die Datei 0028 — die beiden Trigger werden unter demselben Namen ersetzt. Rein additiv und beliebig wiederholbar: `create or replace` auf zwei Funktionen mit unveränderter Signatur, zwei `revoke`, vier `drop trigger if exists` + `create trigger`; keine DDL auf Spalten, kein Backfill, keine Datenbewegung. **Reihenfolge frei — vor ODER nach dem Deploy**, am besten vorher: Die Datei verschärft ausschließlich Prüfungen und nimmt der Oberfläche nichts weg. Der begleitende App-Fix (Vorprüfung in `scheduleRecycle`, `src/app/actions/recycle.ts`) ergänzt sie, ist aber keine Voraussetzung — die App schützt den Weg durch die App, die Datenbank den direkten POST auf die RPC. Dass die beiden Besitzprüfungen wortgleich bleiben, prüft `tests/schreibpfadGrenzen.test.ts`.

**Eingespielt und eingefroren, aber jünger als der Rest dieses Dokuments:**
- **`…0036`** (`tenant_lifecycle_nachtrag`) zieht `preview_move_user()`, `admin_move_user_to_workspace()` und `preview_delete_workspace()` auf die neuen Tabellen nach (§2): Löschvorschau 13 → **18** gezählte Tabellen, Umzug 14 → **16**, zwei neue Vorschau-Zähler und der Warncode `reminder_touch_superseded`. `move_user_scope()` bleibt bewusst unangetastet — ein weiterer OUT-Parameter wäre eine Signaturänderung. Ausschließlich `create or replace` plus idempotente Grants, keine DDL auf Tabellen — beliebig wiederholbar. Ihr Verifikationsblock ist der wertvollste Teil: Er vergleicht `pg_constraint` gegen die Schlüssel der Löschvorschau und schlägt damit von selbst wieder an, sobald jemand eine neue Tabelle an `workspaces` hängt. Bekannte, ausdrücklich offen gelassene Lücke: `phone_call_attempts` zieht weiter nicht mit dem Nutzer um.
- **`…0037`** (`rpc_zugriffspruefung`) stellt `schedule_recycle()` und `recycle_attempt()` denselben Mitgliedschafts-Block voran, den `apply_reminder_touches()` seit 0032 trägt (§5). Beide Signaturen bleiben byte-gleich zu 0033, deshalb `create or replace` statt `drop function` — ein Drop nähme die Grants einer produktiv aufgerufenen Funktion mit. Die lesenden RPCs `recycle_tasks()`/`dropout_lists()` bekommen nichts, sie hängen an `rpc_effective_user`. Rein additiv und wiederholbar. **Der Verifikationsblock hat eine eigene Falle**, die man kennen muss: Im SQL-Editor ist man `postgres`, `auth.uid()` ist NULL, und **beide** Aufrufe scheitern — das sähe wie ein bestandener Test aus und beweist nichts. Der Test läuft nur mit gesetzten JWT-Claims je Transaktion, und die Gegenprobe mit einer Plattform-Admin-UUID muss *bestehen*, sonst ist die org-übergreifende Arbeit ab hier tot.

**Die früheren Fassungen 0031 (`reminder_cascade`) und 0032 (`lead_recycling`) gibt es nicht mehr.** Sie waren auf keiner Datenbank eingespielt und wurden deshalb neu geschnitten statt durch Korrektur-Migrationen ergänzt; ihr Inhalt steckt jetzt in 0031–0034. Wer sie nachschlagen will, findet sie unter Commit `b145b35`. Ersatzlos entfallen sind dabei die Tabellen `reminder_settings` und `recycle_settings` — ihre Offsets liegen jetzt in `cascade_steps`, ihre Texte in `message_templates`, der Rest in `pipeline_settings`.

- **0028** ist bis auf zwei Stellen additiv: Sie ersetzt die RLS-Policies `setting_calls_scoped_member` / `closing_calls_scoped_member` destruktiv und schreibt vier RPCs per `create or replace` neu (Signaturen unverändert, Grants bleiben). Vor dem Ausführen prüfen, dass `call_assignees` keine Mehrfachzuweisung enthält — der Backfill kollabiert sie sonst auf eine Person.
- **0029** muss **vor** dem Deploy des zugehörigen Codes laufen. `src/lib/analyseData.ts` selektiert `setting_calls.phone`, `closing_calls.lost_reason_code` und `phone_lists.script_label`/`target_group` **namentlich** — eine fehlende Spalte lässt PostgREST die GESAMTE Abfrage abweisen, der Analyse-Bereich wäre dann leer statt unvollständig. Rein additiv (vier Spalten, ein erweiterter CHECK, ein neuer CHECK), aber mit zwei Backfills, die man kennen muss: die Regel-basierte Umdeutung von `source_type='manuell'` nach `ads`/`social_media` (§4) und `lost_reason_code='sonstiges'` auf **alle** verlorenen Bestandszeilen (§4). Beide sind bewusst konservativ — der Rest ist To-do-Liste, nicht Statistik. Verifikationsblock am Ende der Datei.
- **0030** ist rein additiv (`phone_leads.script_label` + Index) und setzt 0029 voraus. Der Backfill übernimmt das Label nur für Leads, die noch in einer Liste **mit** Label liegen; bereits in eine Routing-Liste abgewanderte Leads bekommen nichts — ihr ursprünglicher Arm ist nicht rekonstruierbar und wird als „ohne Testarm" ausgewiesen, statt einen Arm zu verfälschen.
- **0031** (`message_templates`) legt das Vorlagen-Fundament und ist Voraussetzung für 0032 und 0033 (`cascade_steps` verweist auf `template_catalog`). Rein additiv: der Helfer `can_manage_org_settings()`, die Tabellen `template_catalog` (31 abgeglichene Zeilen) und `message_templates`. **Kein Backfill der Texte** — die Auslieferungstexte bleiben in TypeScript (§1, Begriff „Vorlage"); die Übernahme der `followup_templates` erfolgt erst in 0034.
- **0032** (`reminder_cascade`) setzt 0031 voraus. Additiv, aber umfangreich: `pipeline_settings`, `cascade_steps`, `reminder_touches` **v2** (echte FKs, `touch_kind`/`cascade_kind`/`step_no`), die Lebenszyklus-Spalten auf beiden Termin-Tabellen, `wa_phone`/`wa_consent_at`/`wa_refused_at` am Setting, `onboarding_at` und `follow_up_due_at` am Closing, die RPC `apply_reminder_touches()` — und der auf zehn Werte erweiterte CHECK für `lost_reason_code` (`kein_fit`, §4). Die neuen CHECKs sind einzeln in einem `do $$`-Block angelegt, damit ein erneutes Einspielen nicht scheitert. **Kein Backfill** — die Kaskade gilt bewusst nur für Termine, die NACH dem Deploy angelegt/verschoben werden (sonst risse beim Rollout ein Schwall sofort überfälliger Erinnerungen auf). Die Migration muss **vor** dem Deploy des zugehörigen Codes laufen: `src/lib/analyseData.ts` selektiert **namentlich** (Muster 0029) sowohl `touch_kind`/`cascade_kind`/`step_no` auf `reminder_touches` als auch `cancelled_at`/`cancel_outlook`/`cancel_reason_code` auf **beiden** Termin-Tabellen. Die Folgen unterscheiden sich in der Härte: Bei den Touches bleiben nur die „Erinnerungs-Disziplin"-Blöcke leer und sagen das (`available`-Fallback, §5.1) — die drei Absage-Spalten hängen dagegen in `SETTING_COLUMNS`/`CLOSING_COLUMNS`, also in der **Hauptabfrage** des Analyse-Bereichs. Fehlt dort eine Spalte, weist PostgREST die ganze Abfrage ab und der Bereich ist leer statt unvollständig.
- **0033** (`lead_recycling`) setzt 0032 voraus (`pipeline_settings` trägt die Wartezeiten, die Lebenszyklus-Spalten speisen die Listen). Additiv: je **sechs** Recycling-Spalten auf `contacts`, `phone_leads`, `setting_calls`, `closing_calls` samt zwei CHECKs je Tabelle, der CHECK „`falsche_zielgruppe`/`kein_fit` bekommen nie ein Datum" auf `closing_calls`, die Funktionen `schedule_recycle()` und `recycle_attempt()`, `recycle_tasks` **v2** und `dropout_lists()`. Zwei Fehler der alten Fassung verschwinden hier strukturell: Das Recycling wurde nie zurückgenommen, wenn ein Lead auf anderem Weg zurückkam (jetzt sichern App-Code UND ein davon unabhängiger Status-Riegel in der RPC), und der Versuchszähler wurde gelesen-gerechnet-geschrieben (jetzt eine Anweisung). **Kein Backfill** — gilt nur für Zeilen, die NACH dem Deploy terminal werden. `recycle_tasks` und `dropout_lists` werden per `drop function` + `create` neu angelegt (geänderter Rückgabetyp), `nachfassen_tasks` bleibt unangetastet (§5).
- **0034** (`tenant_lifecycle`) setzt 0031 und 0032 voraus. `seed_workspace_defaults()` + AFTER-INSERT-Trigger auf `workspaces` (§2), Nachziehen aller bestehenden Organisationen und die **einzige Datenbewegung des ganzen Umbaus**: `followup_templates` → `message_templates` (`linkedin_fu_1..3`), nur für Zeilen mit Text und bestehender Mitgliedschaft. Die Quelltabelle bleibt stehen (§3). Bewusst ein Trigger statt Änderungen an `bootstrap_workspace()`/`platform_create_workspace()` — das schont das Verifikationsfenster vor dem Merge.

## 8. Invarianten (nach jedem Nutzer-Umzug und nach jedem Backfill prüfen)

Alle Abfragen müssen `0` bzw. eine leere Menge liefern — mit **vier benannten Ausnahmen**, die etwas anderes erwarten: Kaskadenstufen je Organisation (21/16/3), Katalogumfang (31), die Zugriffsprüfung aus 0037 (genau 2 Funktionen) und die eine bekannte Lücke `phone_call_attempts` beim Nutzer-Umzug. Sie decken genau die Fehler ab, die ein unvollständiger Umzug hinterlässt — die beiden Zuweisungs-Blöcke zusätzlich die eines unvollständigen Backfills aus 0028, die beiden Testarm-Blöcke die aus 0030 (dort mit einer benannten Altbestands-Ausnahme), die Kaskaden- und Recycling-Blöcke die aus 0032–0034, die letzten vier die aus 0036/0037. **Ein zweiter Zweck ist inzwischen genauso wichtig wie der erste:** Weil die Supabase-Konsole markierten Text ausführt und dabei lautlos Halbzustände hinterlässt (§7), sind mehrere dieser Abfragen weniger Umzugs- als **Einspiel-Kontrolle**.

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

-- Erinnerungs-Kaskade (Migration 0032): jeder aktive Touch hat eine
-- zuständige Person — die Erzeugung snapshotet immer assigned_user_id ??
-- created_by_user_id des Eltern-Termins (§3). Der Insert-Trigger
-- reminder_touches_require_assignee hält das für NEUE Zeilen fest; ein
-- Treffer hier heißt also: nachträglich genullt (gelöschter Nutzer).
select count(*) from reminder_touches where superseded_at is null and assigned_user_id is null;

-- Ein Touch zeigt auf GENAU EINEN Termin, passend zu seinem entity_type.
-- Die CHECKs aus 0032 halten das fest; die Abfrage findet, was ein direkter
-- SQL-Eingriff daran vorbei angelegt hat.
select count(*) from reminder_touches
 where (entity_type = 'setting') <> (setting_call_id is not null)
    or (entity_type in ('closing','closing_followup')) <> (closing_call_id is not null);

-- Der Touch liegt in derselben Organisation wie sein Termin. Der Guard
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

-- assigned_user_id eines aktiven Touches zeigt nur auf Mitglieder DERSELBEN
-- Organisation — dieselbe Regel wie bei setting_calls/closing_calls oben.
select count(*) from reminder_touches rt where rt.superseded_at is null
  and rt.assigned_user_id is not null
  and not exists (select 1 from workspace_members wm
                   where wm.user_id = rt.assigned_user_id and wm.workspace_id = rt.workspace_id);

-- Jede Organisation hat Konfiguration UND Kaskadenstufen (Migration 0034).
-- Ein Treffer heißt: Der Seeding-Trigger hat nicht gegriffen — die Folge wäre
-- eine Organisation, in der schedule_recycle() immer NULL liefert und gar
-- keine Erinnerung entsteht.
select count(*) from workspaces w
 where not exists (select 1 from pipeline_settings ps where ps.workspace_id = w.id);
select count(*) from workspaces w
 where not exists (select 1 from cascade_steps cs where cs.workspace_id = w.id);
-- Erwartete Verteilung je Organisation: 21 Stufen, davon 16 aktiv, davon
-- 3 mit requires_no_response (no_show_setting_2, no_show_closing_2, kein_close_2).
select workspace_id,
       count(*) as gesamt,
       count(*) filter (where enabled) as aktiv,
       count(*) filter (where requires_no_response) as nur_ohne_antwort
  from cascade_steps group by 1;

-- Eine geplante Stufe hängt vor dem Termin, alles andere reagiert auf ein
-- Ereignis und liegt danach (CHECK aus 0032).
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

-- Vorlagen (Migration 0031): jeder template_key zeigt in den Katalog, und
-- beide Ebenen sind eindeutig (Org-Standard = user_id is null).
select count(*) from message_templates mt
 where not exists (select 1 from template_catalog tc where tc.template_key = mt.template_key);
select workspace_id, template_key, count(*) from message_templates
 where user_id is null group by 1,2 having count(*) > 1;
select count(*) from template_catalog;  -- erwartet: 31

-- Eine PERSÖNLICHE Vorlage liegt nur in einer Organisation, in der ihr
-- Besitzer Mitglied ist (Migration 0036). Ein Treffer heißt: beim Umzug
-- zurückgeblieben — und das fällt niemandem auf, weil die Vorrangkette den
-- fehlenden Text lautlos durch den Org-Standard ersetzt (§2).
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

-- BEKANNTE AUSNAHME, kein Fehler: Das Anruf-Log zieht beim Nutzer-Umzug nicht
-- mit (§2). 0036 hat das ausdrücklich offen gelassen; die Abfrage steht hier,
-- damit die Zahl bekannt bleibt, statt unbemerkt zu wachsen.
select count(*) from phone_call_attempts a
  join phone_leads pl on pl.id = a.lead_id
 where a.workspace_id <> pl.workspace_id;

-- Zugriffsprüfung der beiden schreibenden Recycling-RPCs (Migration 0037).
-- Erwartet: genau 2 Zeilen. Weniger heißt, die Migration lief nur zur Hälfte
-- durch (§7, Teil-Ausführung im Editor).
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('schedule_recycle','recycle_attempt')
   and pg_get_functiondef(p.oid) like '%Kein Zugriff auf diese Organisation%';
```

**Zwei Nachpflege-Zählungen, die (noch) NICHT null sein müssen.** Sie messen die To-do-Liste
für Migration 0035 (§7), nicht einen Defekt — die Trigger, die diese Zustände künftig
verhindern, sind bewusst noch nicht eingespielt. **Vor** dem Einspielen von 0035 sollten sie
auf 0 stehen, danach halten die Trigger sie dort:

```sql
select count(*) from setting_calls where cancelled_at is not null and cancel_reason_code is null;
select count(*) from closing_calls where cancelled_at is not null and cancel_reason_code is null;
select count(*) from setting_calls where status = 'unqualifiziert' and disqualify_reason_code is null;
```

Nachpflegen bitte **über die Oberfläche** (`/ablage`), nicht per rohem `UPDATE`: Ein direktes
Statement überspringt die Folgen des Grundes — das Kontaktverbot bei `keine_zusammenarbeit`
und das Räumen eines bereits geplanten Recycling-Datums bei `falsche_zielgruppe` (§4).

Zusätzlich als UI-Gegenprobe in der eigenen Organisation: `/team` zeigt nur eigene Mitglieder · Datensicht-Auswahl ohne fremde Namen · `/termine` ohne fremde Termine · Suche nach einem fremden Lead liefert 0 Treffer · Sidebar ohne fremde Listen · `/erinnerungen` ohne fremde Karten. **Die Ablage-Sperrliste ist dabei die eine bewusste Ausnahme**: Sie zeigt auch gesperrte Vorgänge fremder Personen derselben Organisation (nie einer fremden Organisation) — wer dort nur die eigenen sieht, hat den `v_user := null`-Zweig in `dropout_lists()` verloren.

## 9. Datenauswertung per MCP

**Für Datenauswertung: den Supabase-MCP (read-only, `execute_sql` / `list_tables`) nutzen, mit obigem Glossar als Kontext.** RLS greift dort nicht — Personen-/Zeitraumfilter immer explizit in die Query schreiben (§2, §5). Der MCP funktioniert nur, wenn `SUPABASE_ACCESS_TOKEN` vor dem Start von Claude Code in der Umgebung gesetzt ist (siehe README, Abschnitt „Supabase MCP").
