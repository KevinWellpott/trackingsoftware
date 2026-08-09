# Datenmodell & Auswertungs-Glossar (Pitch-Tracker)

Kontext für KI-gestützte Datenauswertung über den read-only Supabase-MCP.
Quellen: `supabase/migrations/` (maßgeblich für Schema) + tatsächliche Nutzung in `src/`.
Stand: August 2026 (nach Migration `20260404000030_script_label_snapshot.sql`).

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
```

Begriffe:
- **Pitch / DM** = eine Zeile in `contacts`. Pitch-Datum = `pitched_at` (bzw. `created_at::date` als Fallback).
- **Liste** = `lists` (LinkedIn) bzw. `phone_lists` (Telefon). Kontakte/Leads hängen immer an einer Liste; die Liste bestimmt den Owner.
- **Anruf** = eine Zeile in `phone_call_attempts` (1 Wählversuch). Nicht mit „angerufener Lead" verwechseln: `phone_leads.first_call_at` markiert nur den Erstkontakt, das Log zählt jeden Versuch.
- **Setting** = `setting_calls`: gebuchter Termin + Qualifizierungsgespräch (Budget, Pain, Entscheider …). Genau eine zuständige Person (`assigned_user_id`, §2).
- **Closing** = `closing_calls`: Abschlussgespräch, entsteht aus qualifiziertem Setting (verknüpft über `closing_calls.setting_call_id`).
- **Termine** = `/termine`: gemeinsamer Kalender über beide Tabellen (Monat/Woche/Tag + versteckte Listenansicht). Feste Dauern: Setting 30 min, Closing 60 min. `/setting` und `/closing` leiten dorthin um; die Detailrouten `/setting/[id]` und `/closing/[id]` bleiben. **Es wird nichts ausgeblendet** — auch nicht `dead`/`unqualifiziert`. Der frühere „Versteckt"-Schalter ließ Termine lautlos verschwinden; stattdessen kodiert der Chip beides zugleich: **Füllung = Typ** (Setting/Closing), **Rahmen = Status** (durchgezogen = steht noch an, gestrichelt = Ergebnis steht fest, abgeblendet = erledigt). Definitionen ausschließlich in `src/lib/terminMeta.ts` (`outlineFor`).
- **Termin-Art** (`setting_calls.meeting_kind`) = `link` **oder** `telefon`. Die dritte Option „Ohne" gibt es nicht mehr: Bei `telefon` ist die Rufnummer (`setting_calls.phone`) Pflicht, bei `link` der Meet-Link — ein Termin ohne beides ist einer, den niemand übernehmen kann. Bestandszeilen mit `meeting_kind is null` bleiben gültig.
- **Kanal / Quelle** = `setting_calls.source_type`. Schlüssel, Labels, Farben und die Frage, ob ein Kanal ein eigenes Akquise-Volumen hat, stehen an genau **einer** Stelle: der Kanal-Registry `src/lib/channels.ts` (§4). Nur LinkedIn (`contacts`) und Telefon (`phone_leads`) haben eine Stufe **vor** dem Termin; Ads, Social Media und Sonstige beginnen erst beim Termin und zeigen dort „—" statt 0.
- **Nachfassen** = zentrale Wiedervorlage (`/nachfassen`), gespeist aus RPC `nachfassen_tasks` (4 Quellen, siehe §5).

## 2. Workspace- & Sichtbarkeitsmodell

- Ein **Workspace = eine Organisation = ein Kunden-Mandant.** Ein User hat genau **eine** Mitgliedschaft (`workspace_members`) — das ist eine harte Annahme: `getAccessContext()` würde bei zwei Mitgliedschaften den Nutzer aussperren (Redirect `/onboarding`, wo `bootstrap_workspace` mit `'Already in a workspace'` abbricht). Die Umzugsfunktion löscht die alte Mitgliedschaft deshalb, statt eine zweite anzulegen.
- **Plattform-Admins (`platform_admins`, Migration 0025)** stehen *oberhalb* der Organisation: Simon und Kevin dürfen jede Organisation lesen und dort schreiben, sind aber **in keiner Kunden-Organisation Mitglied**. Sonst erschienen sie im Team-Dashboard und in der Datensicht-Auswahl des Kunden — und umgekehrt.
  - Technisch: `is_platform_admin()` (SECURITY DEFINER, `stable`) + je eine zusätzliche permissive RLS-Policy `<tabelle>_platform_admin` auf 18 Tabellen (17 aus Migration 0025, `phone_call_attempts` aus 0028). Die bestehenden `can_access_*`-Helfer bleiben unangetastet.
  - Die 9 Metrik-RPCs sind über einen einzigen Zweig in `rpc_effective_user` org-übergreifend — keine RPC musste dafür geändert werden.
  - **`profiles.is_super_admin` ist NICHT dieses Flag.** Die Spalte existiert live, wird von keiner Zeile Code gelesen und ist als Berechtigung unbrauchbar, weil `profiles_update_own` jedem Nutzer erlaubt, seine eigene Profilzeile zu ändern. Ein Trigger aus Migration 0025 friert sie ein.
- **Aktive Organisation:** `AccessContext.workspace_id` meint die *aktive* Organisation, nicht zwingend die eigene. Für einen Plattform-Admin steuert der Cookie `pt_active_workspace_id` (8 h, httpOnly) den Wechsel; in fremder Org werden `role='owner'` und `data_scope='workspace'` synthetisiert, damit alle Owner-Gates greifen. `is_foreign_org` schaltet die roten Warnbanner. Ein Org-Wechsel löscht immer den Datensicht-Cookie.
- **`workspace_id` beim INSERT immer explizit setzen.** Die BEFORE-INSERT-Trigger leiten es sonst aus der Mitgliedschaft ab — was für einen Plattform-Admin in einer Kunden-Org die falsche Organisation wäre. Seit Migration 0025 wirft der Trigger in genau diesem Fall, statt still zu raten. Ausnahme: `contacts` und `phone_leads` erben es korrekt von ihrer Elternliste.
- Zwei unabhängige Achsen auf `workspace_members`:
  - `role`: `owner` | `member` → Admin-Rechte (Team-Dashboard `/team`, Nutzerverwaltung, Owner-Auswahl beim Import).
  - `data_scope`: `workspace` | `own` → Datensichtbarkeit (`own` sieht nur eigene Daten; RLS + RPCs erzwingen das).
- **Owner-Zuordnung von Listen: `owner_name` hat Vorrang vor `created_by_user_id`** (`list_owned_by_user()` in SQL, `buildOwnScope()` in `src/lib/access.ts`). Ein Admin kann eine Liste FÜR ein Mitglied anlegen (owner_name = Mitglied, created_by = Admin) — die Zahlen zählen dann beim Mitglied. `owner_name` matcht auf `profiles.username`.
- **Personen-Zuordnung von Terminen: `assigned_user_id`, nicht `created_by_user_id`.** `setting_calls` und `closing_calls` haben **kein** `owner_name`; stattdessen trägt jede Zeile genau EINE zuständige Person in `assigned_user_id`. Maßgeblich für **jede** Auswertung ist `coalesce(assigned_user_id, created_by_user_id)` — in SQL wörtlich so, im Code `personOf()` / `personIn()` (`src/lib/personResolution.ts`).
  - **Zwei Spalten, zwei Bedeutungen:** `created_by_user_id` = Audit („wer hat geklickt"), immer die real angemeldete Person. `assigned_user_id` = Fachlichkeit („wem gehört der Termin"). Warum das getrennt gehört: Bis Migration 0028 landete in `created_by_user_id` die eingestellte *Datensicht* statt des Anmeldekontos — wer mit der Datensicht eines Kollegen arbeitete, schrieb sämtliche Termine auf ihn. Zusätzlich entsteht ein Closing ausschließlich über „Qualifiziert" im Setting, wurde also faktisch immer von derselben Person angelegt.
  - **Gesetzt wird beim Anlegen, nie beim Lesen** (`src/app/actions/appointments.ts`, `createClosingFromSetting`): LinkedIn/Telefon → Owner der **Quellliste** (`owner_name` hat Vorrang vor `created_by_user_id`, `ownerUserIdOfList`), manuell → der Anlegende, Closing → erbt vom Setting. Bestandsdaten per Backfill in 0028 nach derselben Reihenfolge (bestehende `call_assignees`-Zeile → Owner der Quellliste → Ersteller der Quellliste → Ersteller des Termins). Deshalb braucht keine Auswertung Quellketten-Joins.
  - Umverteilen von Hand: `setAssignee()` (`src/app/actions/assignees.ts`), nur für `role='owner'` mit `data_scope='workspace'`. `null` = „Niemand" — die Auswertung fällt dann auf den Ersteller zurück.
  - **RLS kennt die Zuweisung:** `setting_calls_scoped_member` / `closing_calls_scoped_member` prüfen `created_by_user_id` **oder** `assigned_user_id`. Ohne diesen zweiten Zweig verschwände ein Termin, den ein Admin FÜR ein Mitglied mit `data_scope='own'` anlegt, aus dessen Sicht komplett.
  - In fremder Organisation bleibt `assigned_user_id` NULL: Ein Plattform-Admin ist dort kein `workspace_members`-Eintrag, seine `user_id` wäre eine Zuweisung über die Org-Grenze.
- **`call_assignees` ist tot.** Die Tabelle existiert weiter (0026/0027 fassen sie an) und enthält Alt-Zeilen, wird aber von keiner Zeile Code mehr gelesen oder geschrieben. Für Auswertungen nicht verwenden — sie beschreibt den Stand vor 0028.
- Persönliches Dashboard `/` = genau eine Person; Team-Dashboard `/team` = workspace-weit (nur `role='owner'` mit `data_scope='workspace'`). Admins können per Cookie die Datensicht eines Mitglieds einnehmen.
- **Zwei geschachtelte Umschalter:** Der Org-Umschalter (rot, nur Plattform-Admins) wechselt die *Organisation*, die Datensicht (orange) wechselt die *Person* innerhalb der aktiven Organisation. Rot steht über Orange — äußere Grenze zuerst.
- **Organisation löschen:** `preview_delete_workspace()` / `platform_delete_workspace()` (Migration 0027, UI unter `/admin/org/[id]`). An `workspaces` hängen **15 Fremdschlüssel mit `on delete cascade`** — ein `delete` nimmt den kompletten Datenbestand der Organisation mit, ohne Undo. (Die Vorschau aus 0027 zählt 13 Tabellen und kennt `phone_call_attempts` aus 0028 noch nicht; gelöscht wird die Tabelle trotzdem.) Die Funktion verweigert deshalb, solange noch Mitglieder da sind (sonst blieben verwaiste Accounts zurück: Mitgliedschaft kaskadiert weg, Login bleibt), und bei der eigenen Organisation; die UI verlangt zusätzlich das Abtippen des Namens.
- **Nutzer verschieben:** `preview_move_user()` / `admin_move_user_to_workspace()` (Migration 0026, UI unter `/admin/org/[id]`). Der Umzug stempelt `workspace_id` auf 14 Tabellen um und kappt Kanten, die über die neue Org-Grenze zeigen (Termin ohne Quellkontakt, Closing ohne Setting, Smart View ohne Ordner) — genullt, nicht blockiert, weil `lead_name`/`company` als Snapshot vorliegen. Besitz-Ermittlung ausschließlich in `move_user_scope()`, damit Vorschau und Umzug nie auseinanderlaufen. Zwei Stellen sind älter als die Zuweisung: `move_user_scope()` ermittelt den Besitz an Terminen weiterhin über `created_by_user_id` — ein Termin, der dem Umziehenden nur *zugewiesen* ist, bleibt also zurück; und `phone_call_attempts` (0028) steht nicht in der Liste der 14 umgestempelten Tabellen, das Anruf-Log zieht nicht mit. Der Guard-Trigger `assigned_user_guard` (0028) greift nur bei `update of workspace_id` und nullt eine Zuweisung, die über die neue Grenze zeigen würde; zurückbleibende Zeilen fasst er nicht an — deshalb die Invarianten in §8.
- **Wichtig für MCP-Auswertungen:** `execute_sql` läuft direkt auf Postgres **an RLS vorbei** — man sieht alle Daten. Personenfilter daher immer explizit setzen: bei Listen-Daten (LinkedIn/Telefon) über `lists.owner_name` / `phone_lists.owner_name` (Vorrang) bzw. `created_by_user_id`, bei `setting_calls`/`closing_calls` über `coalesce(assigned_user_id, created_by_user_id)` — jeweils auf `profiles.username` gejoint.

## 3. Tabellen-Glossar

### LinkedIn-Funnel

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `lists` | LinkedIn-Pitch-Listen. `name`, `owner_name` (Besitzer, matcht `profiles.username`), `created_by_user_id`, `pitch_text` (Vorlage), `fu1_text`/`fu2_text`/`fu3_text` (Nachfass-Sequenz der Liste, `{name}`-Platzhalter), `archived_at`. |
| `contacts` | 1 Zeile = 1 gepitchter LinkedIn-Kontakt. `list_id` → `lists` (Trigger setzt `workspace_id`). Kernfelder: `name`, `company`, `pitched_at` (date), `answered` (bool), `answer_category` (§4), `answer_text`, `follow_up_number` (0–3), `next_follow_up_at` (date), `appointment_set` (bool), `appointment_at` (timestamptz), `meet_link`, `linkedin_url`, `target_group` (Freitext-Zielgruppe, Achse „Zielgruppe" im Vergleich), `setting_call_id` → `setting_calls`, `blocked_at` (timestamptz — Lead hat uns auf LinkedIn blockiert; App nullt `next_follow_up_at`, RPCs schließen blockierte zusätzlich aus). Legacy-CRM: `stage_id` → `pipeline_stages`, `deal_value`, `deal_closed`, `deal_lost_reason`, `meeting_notes`, `custom_fields` (jsonb). |
| `pipeline_stages` | Legacy-CRM-Stufen je Liste mit `probability_pct` (0–100) und `exclude_from_followup`. Defaults beim Anlegen: Neu 10 %, Gespräch 30 %, Angebot 60 %, Verhandlung 80 %, Gewonnen 100 %, Verloren 0 %. In der aktiven Tracking-UI kaum genutzt — **nicht** die „Termin-Wahrscheinlichkeit" des Setting-Flows (die gibt es nicht als Prozentwert). |

### Telefon-Funnel

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `phone_lists` | Telefonlisten. `list_kind`: `akquise` (Import) \| `rueckruf` \| `nicht_erreicht` — die beiden Routing-Listen existieren je Owner genau einmal (Leads werden bei entsprechendem Outcome physisch dorthin verschoben). `owner_name`, `created_by_user_id`. Seit Migration 0029: `script_text` (Gesprächsleitfaden dieser Liste), `script_label` (**Testarm** des A/B-Tests — die Gruppierungsachse; zehn Importlisten mit demselben Label sind ein Arm mit belastbarer Fallzahl), `target_group` (Listen-Default der Ziel-Branche, wird beim Import auf jeden Lead gestempelt). Alle drei freies `text` ohne CHECK: Skriptvarianten und Zielbranchen entstehen laufend neu, ein Enum wäre eine Migration pro Test. |
| `phone_leads` | 1 Zeile = 1 Firma/Lead. `first_call_at` (date, = „wurde angerufen"), `decider_name`, `company`, `phone`, `status` (§4), `call_attempt` (1–3, denormalisiertes Maximum aus `phone_call_attempts`), `gatekeeper_reached`, `gatekeeper_attempts` (1–2), `decider_reached` (bool, „durchgestellt bekommen"), `pitch_delivered` (bool, „Pitch kam durch" — §4), `answer_sentiment`, `callback_at` (timestamptz, Rückruf-Fälligkeit), `appointment_set`/`appointment_at`, `mailbox`, `target_group` (Branche, beim Import gestempelt — je Lead maßgeblich), `script_label` (**Testarm, beim Import am LEAD festgeschrieben**, Migration 0030 — s. u.), `script` (Alt-Feld je Lead, als Testachse unbrauchbar), Begründungen: `no_transfer_reason`, `no_pitch_reason`, `no_appointment_reason`. |
| `phone_call_attempts` | **Anruf-Ereignis-Log: 1 Zeile = 1 Wählversuch** (Migration 0028). `lead_id` → `phone_leads`, `called_at` (timestamptz), `attempt_no` (≥ 1, serverseitig vergeben), `kind` / `outcome` (§4), Snapshots des Gesprächs: `mailbox`, `gatekeeper_reached`, `decider_reached`, `pitch_delivered`, `notes`. `list_id` + `owner_name` sind **Snapshots der Liste zum Zeitpunkt des Anrufs** — Leads wandern bei Rückruf/Nicht-erreicht physisch in eine Routing-Liste, ein Join über die *aktuelle* Liste schriebe die Historie rückwirkend um. `source`: `app` \| `backfill`. **Achtung: die Tabelle startet leer** — es gibt bewusst keinen Backfill (`first_call_at` ist ein Datum ohne Uhrzeit und kennt nur den ersten Anruf, `call_attempt` war manuell gesetzt). Vor dem Deploy-Datum von 0028 existiert also keine Anruf-Historie; geschrieben wird ausschließlich in `logCallAttempt` (`src/app/actions/phoneAttempts.ts`, fail-soft), gelesen in der Sektion „Nachfassen oder neue Leads?" des Telefon-Tabs (`src/lib/phoneAttemptsData.ts`) — der einzigen Auswertung, in der derselbe Lead mehrfach zählt. |
| `csv_imports` | Protokoll der Telefon-Importe (`row_count`, `imported_count`, `duplicate_count`, `phone_list_id`). |

**Der Testarm gehört an den LEAD, nicht an die Liste** (Migration 0030). Migration 0029 hatte `script_label` nur an `phone_lists` eingeführt — das trägt nur, solange ein Lead in seiner Liste bleibt, und genau das tut er nicht: `setPhoneLeadOutcome` verschiebt ihn bei „Rückruf" und „Nicht erreicht" physisch in die Routing-Liste des Owners, und die hat kein Label. Aus jedem Arm verschwänden damit ausgerechnet die schlechten Ausgänge, während Termine und tote Leads in der Akquise-Liste bleiben — jeder Arm sähe besser aus als er ist, und weil die Abwanderung je Skript unterschiedlich stark ausfällt, wären die Arme auch untereinander nicht mehr vergleichbar. Der Import stempelt das Label deshalb auf jeden Lead; `updatePhoneListScript` zieht es nachträglich auf die Leads durch, die noch in der Liste liegen. **Für Auswertungen gilt `phone_leads.script_label`**; `phone_lists.script_label` ist nur Rückfall für Bestandsleads, die ihre Liste nie verlassen haben (so liest es auch der Telefon-Tab). Bereits abgewanderte Altbestände bekamen im Backfill nichts und laufen bewusst als „ohne Testarm" (§8). Dieselbe Umzugsfestigkeit hat `phone_leads.target_group` von Anfang an.

### Termin-Funnel (Setting → Closing)

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `setting_calls` | Termin + Qualifizierungsgespräch. Person: `assigned_user_id` (zuständige Person, **die Auswertungsachse** — §2), `created_by_user_id` (Audit: wer angelegt hat). Herkunft: `source_type` (§4), `source_detail` (Freitext, trägt den echten Ursprung — die Analyse schlüsselt danach auf, sofern gesetzt), `source_contact_id` → `contacts`, `source_phone_lead_id` → `phone_leads`. Termin: `appointment_at` (timestamptz), `meet_link` (bei `meeting_kind='link'`), `phone` (Rufnummer bei `meeting_kind='telefon'`, Migration 0029 — nullable und ohne CHECK, die Pflicht sitzt im Formular; bewusst am Termin statt am Lead, weil `phone_leads.phone` die Firmenzentrale ist und LinkedIn-/manuelle Termine gar keine Lead-Zeile haben), `meeting_kind` (`link` \| `telefon` \| NULL = Altbestand), `call_at` (date, Gesprächstag). Qualifizierung: `show_status` (`show`/`no_show`), `has_budget_8k`, `branche`, `sole_decider`/`can_decide_now`/`clear_need` (bool), `ist_pain` (1–10), `warmth` (1–10), `soll_ziel`, `script_answers` (jsonb, Setting-Skript-Blöcke). Ergebnis: `status` (§4), `follow_up_due` (date, Wiedervorlage), `no_show_count` (zählt No-Shows über Neuterminierungen hinweg — **kein** Nenner der Show-Quote mehr, siehe §5), `closing_scheduled`/`closing_at`. |
| `closing_calls` | Abschlussgespräch. `setting_call_id` → `setting_calls`. Person: `assigned_user_id` (erbt beim Anlegen vom Setting), `created_by_user_id` (Audit). `call_at` (timestamptz, Termin inkl. Uhrzeit), `meet_link`, `show_status` (§4), `status` (§4), Deal: `closed` (bool), `deal_volume` (numeric, €), `payment_type` (Freitext, UI: „Einmal"/„Raten"), `signature_received`, `contract_start` (date), `lost_reason_code` (neun feste Codes, §4 — **das zählbare Feld**), `lost_reason` (Freitext daneben, optionaler Kontext), `follow_up_due` (date). |
| `call_assignees` | **Historisch, nicht mehr in Gebrauch.** Alte Multi-Zuweisung (`entity_type` = `setting_call`\|`closing_call`, `entity_id`, `user_id`). Seit Migration 0028 ersetzt durch `assigned_user_id`; wird weder gelesen noch geschrieben (§2). |

### Sonstiges

| Tabelle | Zweck |
|---|---|
| `profiles` | `user_id` ↔ `username` (Login + Owner-Matching). |
| `workspaces` / `workspace_members` | Team + Mitgliedschaft (`role`, `data_scope`, Invite-Code). |
| `performance_targets` | Ziele je User: `channel` (`linkedin`\|`telefon`) × `period` (`daily`\|`weekly`) × `metric` (`pitches`\|`calls`\|`appointments`). App-Defaults ohne Eintrag: LinkedIn 20/Tag, 100/Woche; Telefon 40/Tag, 200/Woche (`src/lib/targets.ts`). |
| `followup_templates` | FU-Textvorlagen je User (`fu_number` 1–3). Vorschlagstext im Nachfassen-Board: `lists.fuN_text` > `followup_templates` > Standardtext (`followUpTextFor`, `src/app/actions/nachfassen.ts`). |
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
Historie: Alt-Wert `disqualifiziert` wurde per Migration 0018 zu `unqualifiziert` migriert. Outcome-Logik: `no_show` → Wiedervorlage +1 Tag + `no_show_count`++; `unqualifiziert` → Wiedervorlage +7 Tage; `qualifiziert` → Closing wird angelegt, Status wird `closing_gelegt`. Show-Quote: `show_status` (`show`/`no_show`); bei `offen`/`dead` bewusst NULL.
**Achtung: `qualifiziert` wird vom UI nicht mehr vergeben.** Ein Klick auf „Qualifiziert" legt sofort das Closing an und schreibt `closing_gelegt` (`setSettingOutcome` → `createClosingFromSetting`); wird ein Closing gelöscht, fällt das Setting auf `offen` zurück, nicht auf `qualifiziert`. Der Wert steht also nur noch in Bestandszeilen. Konsequenz für Auswertungen: Die Kennzahl „Zu Closing geschickt" (`closing_gelegt` ÷ `qualifiziert` + `closing_gelegt`, §5) liegt bei aktuellen Daten fast immer bei 100 % — sie kann erst wieder trennen, wenn der Zwischenschritt „qualifiziert, aber noch kein Closing gelegt" in der Oberfläche erreichbar ist.

**`setting_calls.source_type`** — die Kanal-Registry (`src/lib/channels.ts`) ist die einzige Quelle für Schlüssel, Label, Farbe und Volumen-Flag; der CHECK aus Migration 0029 kennt dieselbe Liste. Fünf Werte sind wählbar, drei bleiben für Bestandszeilen gültig:

| DB-Wert | Label | wählbar | Filter `?quelle=` | eigenes Akquise-Volumen |
|---|---|---|---|---|
| `linkedin` | LinkedIn | ja | ja | `contacts` („DMs") |
| `telefon` | Telefon | ja | ja | `phone_leads` („Calls") |
| `social_media` | Social Media | ja | nein | — (Funnel beginnt beim Termin) |
| `ads` | Ads | ja | nein | — |
| `sonstige` | Sonstige | ja | nein | — |
| `inbound` | Inbound | nein (Altwert) | nein | — |
| `website` | Website | nein (Altwert) | nein | — |
| `manuell` | Manuell (ohne Angabe) | nein (Altwert) | ja | — |

Warum die Altwerte bleiben: Der CHECK gilt auch für UPDATEs auf ganz anderen Spalten — sie zu streichen hieße, dass sich kein alter Termin mehr bearbeiten ließe. Neu vergeben werden sie nicht mehr (`normalizeSource` in `src/app/actions/appointments.ts`). `manuell` ist trotzdem filterbar, weil dort der Großteil des historischen Volumens liegt. Migration 0029 hat `manuell` **nur bei eindeutigem Freitext** umgedeutet: `source_detail ~* '(\mads\M|\mwerbung\M|werbeanzeige|\manzeigen?\M)'` → `ads` (zuerst, weil „Facebook Ads" beide Muster trifft und der bezahlte Kanal gewinnen muss; `ads` nur mit Wortgrenzen, sonst träfe es jedes „Leads"), danach `~* '(insta|social|facebook|tiktok)'` → `social_media`. Der Rest steht weiter auf `manuell` und heißt im UI „Manuell (ohne Angabe)" — eine ehrliche Restkategorie statt geratener Statistik. Ein unbekannter Wert (neuerer Client, Fremddaten) wird in der App als „Sonstige" beschriftet, nicht roh angezeigt.
Zusätzlich zum Kanal trägt **`source_detail`** den echten Ursprung als Freitext („Social Selling", „Empfehlung Meier"). Setting- und Closing-Tab schlüsseln ihre Quellen-Tabellen **primär nach `source_detail`** auf (case-insensitiv zusammengefasst, erste Schreibweise gewinnt) und fallen nur ohne Freitext auf den Kanal zurück; der Donut daneben bleibt auf Kanal-Ebene.

**`setting_calls.has_budget_8k`**: `ja` · `nein` · `unklar` — **`branche`**: `agentur` · `coach` · `consultant` · `sonstiges` — **`ist_pain`**, **`warmth`**: 1–10
**`setting_calls.meeting_kind`**: `link` · `telefon` · NULL (nur Altbestand — die dritte Option „Ohne" gibt es nicht mehr, §1).

**`closing_calls.status`**: `offen` „Offen" · `gewonnen` „Gewonnen" · `verloren` „Verloren" (erzwingt `lost_reason_code`, **nicht** mehr den Freitext) · `nachfassen` „Nachfassen" (erzwingt `follow_up_due`)
**`closing_calls.lost_reason_code`** (CHECK aus Migration 0029, neun Werte): `preis` „Preis" · `timing` „Timing" · `kein_bedarf` „Kein Bedarf" · `entscheider` „Entscheider" · `wettbewerb` „Wettbewerb" · `vertrauen` „Vertrauen" · `ghosting` „Ghosting" · `falsche_zielgruppe` „Falsche Zielgruppe" · `sonstiges` „Sonstiges" (Labels: `CLOSING_LOST_REASON_LABELS`, `src/lib/types.ts`).
Warum zusätzlich zum Freitext: „zu teuer", „Preis", „Budget nicht da" sind drei Zeilen mit je Häufigkeit 1 — zählbar wird der Grund erst über den Code. **Code = Statistik, Freitext = Gedächtnis**; `lost_reason` bleibt daneben bestehen und ist seit 0029 optional. `falsche_zielgruppe` ist der einzige Code, der nicht das Closing bewertet, sondern die Stufe davor: Er macht messbar, wer falsch qualifiziert — ohne ihn verschwände der Fall unter `kein_bedarf`. **Fallstrick:** Migration 0029 hat **alle** Bestandszeilen mit `status='verloren'` auf `sonstiges` gesetzt (bewusst kein Rate-Mapping aus dem Freitext) — sie sind von Hand nachzupflegen. Bis dahin ist die Verteilung eine Aussage über das Deploy-Datum, nicht über die Einwände. Zeilen ohne Code führt der Closing-Tab getrennt als „Ohne Angabe", statt sie nach `sonstiges` zu buchen.
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
| `rpc_phone_owner_metrics(ws, from, to, user?)` | je Owner: `calls`, `gatekeeper_reached`, `decider_reached`, `appointments`, `callbacks`, `dead` | **Achtung: nur `calls` ist zeitraumgefiltert** (`first_call_at between`), die übrigen Spalten sind all-time-Zählungen. Personenfilter über `list_owned_by_user()` — `owner_name` hat Vorrang |
| `rpc_phone_day_metrics(ws, from, to, user?)` | wie oben, aber je Owner+**Tag** | Tag = `coalesce(first_call_at, created_at::date)`; `calls` zählt nur Leads mit `first_call_at is not null`; für Zeitraum-Analysen diese RPC nutzen. Personenfilter wie oben |
| `rpc_phone_list_counts(ws, user?)` | Status-Counts je Telefonliste | Personenfilter über `list_owned_by_user()` |
| `nachfassen_tasks(ws, today, now, user?)` | fällige Aufgaben (Union) | 4 Zweige: ① LinkedIn-FU (`next_follow_up_at <= today`, Ausschlüsse §4) ② Telefon-Rückruf (`status='rueckruf'`, `callback_at <= now`) ③ Closing (`status='nachfassen'`, `follow_up_due <= today`) ④ Setting (`status in ('no_show','unqualifiziert')`, `follow_up_due <= today`). Personenfilter: ①② über `list_owned_by_user()`, ③④ über `coalesce(assigned_user_id, created_by_user_id)`. App blendet zusätzlich LinkedIn-Tasks mit Pitch > 7 Tage aus. |

**Personenfilter der Telefon-RPCs:** Die drei `rpc_phone_*`-RPCs und der Telefon-Zweig von `nachfassen_tasks` filtern über `list_owned_by_user()` — genau wie die LinkedIn-RPCs seit Migration 0015. Bis 0028 filterten sie stattdessen über `created_by_user_id` und ignorierten damit den `owner_name`-Vorrang: Eine Telefonliste, die ein Admin FÜR ein Mitglied angelegt hatte, zählte in der *Gruppierung* beim Mitglied, im *Personenfilter* aber beim Admin — das Mitglied sah seine eigenen Zahlen nicht. Wer alte Zahlen nachrechnet, muss diesen Bruch einkalkulieren.

**Drei Definitionen von „Termin" — nicht vermischen.** Die häufigste Verwechslungsquelle im ganzen Datenmodell. Dieselbe Person, derselbe Zeitraum, drei verschiedene Zahlen — alle drei korrekt, weil sie verschiedene Fragen beantworten:

| Definition | Frage | Stichtag / Quelle | Wo sie erscheint |
|---|---|---|---|
| **gelegt** | Wie viele Termine hat die Person in diesem Zeitraum **gebucht**? (Aktivität) | `setting_calls.created_at`, Berlin-Tag → `rpc_appointments_booked` | Kachel „Termine gelegt" auf `/` und `/team`; auf `/` folgen auch die Setting-Kopfzahlen diesem `created_at`-Fenster. Der **LinkedIn-Tab** nutzt dieselbe Definition, rechnet sie aber in JS (`berlinDateISO(created_at)` + `source_type='linkedin'`), weil die RPC keinen Listen-Filter kennt |
| **absolut** | Welche Termine **finden** in diesem Zeitraum statt? | `settingEffDate(r)` = `coalesce(appointment_at (Berlin-Tag), call_at, created_at (Berlin-Tag))`, analog `closingEffDate` | Übersicht-, Setting-, Closing- und Funnel-Tab, die Vergleichsseite (`src/lib/analyse.ts`) und der Kalender `/termine` |
| **Pitch-Kohorte** | Wie viele der in diesem Zeitraum **gepitchten** Kontakte haben irgendwann einen Termin bekommen? (Konversion) | `contacts.appointment_set is true`, Tag = Pitch-Tag (in SQL: `rpc_owner_day_metrics.appts`) | Terminquote auf `/` und `/team` (appts / dms, Zielband 3–7 %) sowie Listen-Ranking und Umsatz je Liste im LinkedIn-Tab. **Nicht** mehr im Funnel-Tab: dessen sechs Stufen kommen inzwischen alle aus `setting_calls`/`closing_calls` — vorher trug die Stufe „Termine" die RPC-Spalte `appts`, die Stufe daneben gezählte Setting-Zeilen, zwei Definitionen in einem Trichter. Die RPCs liefern dort nur noch die Nenner der Wert-Kacheln (DMs, Antworten, Anwahlen, Entscheider) |

Warum das auseinanderfällt: Ein Termin, der am 3. gebucht und für den 20. gelegt wurde, zählt in „gelegt" zum 3., in „absolut" zum 20. Wird er umterminiert, wandert er in „absolut" mit (`rescheduleSetting` fasst nur `appointment_at` an), in „gelegt" nicht — das ist gewollt, sonst verschöbe eine Umbuchung rückwirkend die Aktivitätszahl. Die Pitch-Kohorte wiederum hängt an `contacts` und kennt manuell gebuchte Termine gar nicht; sie misst die Güte der Pitches, nicht die Menge der Termine. Für „wie viel hat X getan" ist **gelegt** die richtige Zahl, für Kalender/Auslastung **absolut**, für Konversionsquoten die **Kohorte**.

Kennzahl-Definitionen der UI:
- **Antwortquote** = answers / dms; **Terminquote** = appts / dms (Zielband 3–7 %). Auf `/` und `/team` die Pitch-Kohorte (s. o.), im LinkedIn-Tab dagegen gelegte Termine ÷ Pitches des Zeitraums — bewusst zwei verschiedene Mengen (§5.1).
- **Termine gelegt** = `rpc_appointments_booked`, Σ `cnt` im Zeitraum.
- **Umsatz** = Σ `closing_calls.deal_volume` where `status='gewonnen'`.
- **Wochenduell-Sieg** = strikt mehr Pitches als jede andere Person (geteiltes Maximum = Unentschieden).
- **Funnel je Quelle** (Analyse): DMs/Calls → Antworten/Entscheider → Termine → Setting-Shows (`show_status='show'`) → Qualifiziert → Closings → Closing-Shows → Gewonnen; Verknüpfung Setting↔Closing über `setting_call_id`, Kanal und Zielgruppe erbt das Closing von seinem Setting.

#### Die fünf Quoten des Termin-Funnels

Sie stehen in keiner RPC — die Tabs rechnen sie aus `setting_calls`/`closing_calls`. Zähler **und Nenner** gehören zur Definition; wer nur den Zähler übernimmt, bekommt eine andere Zahl als die UI.

| Kennzahl | Zähler | Nenner | Warum dieser Nenner |
|---|---|---|---|
| **Show-Quote (Setting)** | `show_status='show'` | Termine mit **erfasstem** `show_status` (`show` + `no_show`) | Datensatz-Ebene. Der frühere Nenner nutzte `no_show_count` und mischte damit EREIGNISSE (Wiederholungs-No-Shows, teils von **vor** dem Zeitraum) mit DATENSÄTZEN; ein neuterminierter, später erschienener Termin drückte die Quote dauerhaft. Noch offene Termine bleiben aus Zähler **und** Nenner, sonst läse sich jeder laufende Zeitraum wie ein Einbruch. Übersicht und Setting-Tab rechnen identisch. |
| **Quali-Quote** | `show_status='show'` **und** `status in ('qualifiziert','closing_gelegt')` | Shows | Misst die Lead-Qualität: Wie viele der Erschienenen überstehen die Qualifizierung? |
| **Zu Closing geschickt** | Show **und** `status='closing_gelegt'` | Qualifizierte (`qualifiziert` + `closing_gelegt`, jeweils mit Show) | Misst die Konsequenz des Setters, nicht die Lead-Qualität: Von den Terminen, die überhaupt eine Chance hatten, wie viele landen wirklich in einem Closing? No-Shows und Unqualifizierte stehen damit gar nicht erst im Nenner. **Liegt derzeit fast immer bei 100 %** — Grund siehe §4 (`qualifiziert` wird nicht mehr vergeben). |
| **Show-Quote (Closing)** | `closing_calls.show_status='show'` | **alle** Closing-Termine | Vorher fielen Termine ohne Angabe komplett aus der Rechnung — die Quote maß, wer das Häkchen gesetzt hat. Zweiter Fallstrick: `show_status` wird beim Eintragen eines Ergebnisses abgeleitet (§4), die Quote steht deshalb nahe 100 % und wird erst mit neu erfassten No-Shows aussagekräftig. |
| **Abschlussrate (Win-Rate)** | `status='gewonnen'` | **Shows** des Closings | Der frühere Nenner „gewonnen + verloren" wirft jeden noch offenen Deal heraus und schönt systematisch: Ein Zeitraum ohne einen einzigen Verlust stand auf 100 %, obwohl zehn Termine unentschieden lagen. |

**Zwei bewusste Abweichungen davon** — wer Zahlen quer vergleicht, muss sie kennen:
- Die **Quellen-Matrix im Funnel-Tab** rechnet die Show-Quote gegen **alle** Termine der Quelle (nicht gegen die entschiedenen), damit die Kette Termin → Show → Closing → Win in einer Zeile durchrechenbar bleibt; ihre Spalte „Closing → Win" rechnet gegen **Closings**, nicht gegen Shows.
- Die **Vergleichsseite** (§5.2) rechnet `showquote` = Shows ÷ alle Termine und `winrate` = Gewonnen ÷ Closings — ihre Registry-Kennzahlen sind Verhältnisse zweier vorberechneter Mengen und kennen den „entschieden"-Zwischenwert nicht. Ihre Quali-Quote (Quali ÷ Shows) und Closing-Show-Quote (Closing-Shows ÷ Closings) stimmen dagegen mit den Tabs überein.

**Telefon-Quoten** sind Kohorten-Quoten: Nenner ist immer `calls` = Leads mit `first_call_at` im Zeitraum (RPC-Ebene), Zähler der heutige Stand genau dieser Leads (Lead-Ebene). Das gilt auch für die **Mailbox-Quote** = Leads mit `mailbox=true` ÷ Calls des Zeitraums — der frühere Nenner „Leads mit gesetztem Mailbox-Feld" maß die Erfassungsdisziplin, nicht das Ergebnis. Nicht verwechseln mit dem **Mailbox-Anteil** in der Sektion „Nachfassen oder neue Leads?": Der zählt Anwahlen aus `phone_call_attempts` (Ereignisse), nicht Leads.

### 5.1 Analyse-Bereich (`/analyse`, sechs Tabs)

Tabs: Übersicht · LinkedIn · Telefon · Setting · Closing · Funnel. Die früheren Tabs „Follow-ups" und „Listen" sind im **LinkedIn**-Tab aufgegangen (Follow-up-Kaskade, Listen-Ranking, Textsatz-Vergleich); `?tab=followup`/`?tab=listen` fällt still auf „uebersicht" zurück. Filter in der URL: `tab`, `range`/`von`/`bis`, `g` (Granularität, auf allen Tabs — auch der Funnel bucketet inzwischen), `users`, `quelle` (Setting/Funnel; Wertebereich = `filterable` in der Kanal-Registry, §4), `reife` (nur LinkedIn), `listen` (nur LinkedIn, kommaseparierte `lists.id`, syntaktisch UUID-geprüft und zusätzlich gegen die real sichtbaren Listen abgeglichen), `modus` (nur Funnel, Default `kohorte`). Der frühere Parameter `min` (Mindest-DMs im Listen-Tab) ist **entfallen**: Die Grenze steht fest bei 10 DMs (`MIN_LIST_DMS`) — bei 3 von 5 DMs steht in der Antwortquote 60 %, und ein Regler, mit dem man Rauschen einschalten kann, hilft niemandem. Parsing ausschließlich in `parseAnalyseParams` (`src/lib/analyse.ts`), Datenbeschaffung ausschließlich in `src/lib/analyseData.ts` — dort läuft **jede** Abfrage über `fetchAllRows`, weil PostgREST sonst still bei 1000 Zeilen abschneidet. Drei Stellen daneben, alle ebenfalls über `fetchAllRows`: die Auswahlliste des Listen-Filters (`analyse/page.tsx`), die Termin→Liste-Brücke (`LinkedInTab.tsx`) und das Anruf-Log (`src/lib/phoneAttemptsData.ts`, eigene Datei — es ist die einzige EREIGNIS-Quelle und fällt bei fehlender Migration 0028 auf `available: false` zurück, statt den Telefon-Tab abzuräumen).

Der LinkedIn-Tab rechnet **nicht** über `rpc_owner_day_metrics`, sondern über `loadContacts`: die RPC kennt keinen Listen-Parameter, ihre Zahlen wären bei aktivem Listen-Filter ungefiltert. **Termine** zählen dort als *gelegt* (`setting_calls.created_at` im Zeitraum, `source_type='linkedin'`), nicht als Kohorte — Zähler und Nenner der Terminquote sind damit bewusst verschiedene Mengen. Das Listen-Ranking bleibt dagegen auf der Pitch-Kohorte (`contacts.appointment_set`).

Abgeleitete Kennzahlen, die es so in keiner RPC gibt:
- **Follow-up-Kaskade** (`buildFuCascade`): Stufe = `coalesce(follow_up_number, 0)`. *Erreicht Stufe k* = Kontakte mit Stufe ≥ k; *Antwort auf Stufe k* = `answered = true` **und** Stufe = k. Trägt, weil der Flow das Nachfassen bei einer Antwort stoppt — es gibt **kein** Ereignis-Log je Follow-up und kein `answered_at`. Marginalquote = Antworten_k / Erreicht_k, kumuliert = Σ Antworten ≤ k / Pitches.
- **Kohorten-Reife** (`reife=reif`): nur Pitches, die mindestens `FU_MATURITY_DAYS` (15 = 3+5+7) zurückliegen. Ohne diesen Schnitt drücken frische Pitches jede späte Stufenquote.
- **Stimmung** (`sentimentOf`): `answer_category` → positiv/neutral/negativ; Legacy-Werte werden gemappt (Interessiert → positiv, Falsches Timing → neutral, Kein Interesse / Zu teuer / Kein Budget / Bereits Lösung / Falsche Zielgruppe → negativ).
- **Umsatz je Liste**: `contacts.setting_call_id` → `closing_calls` mit `status='gewonnen'`. Manuell gebuchte Termine haben keinen Quellkontakt und tauchen dort nicht auf.
- **Funnel-Zählweise** (`modus`, nur Funnel-Tab): `kohorte` (Default) — Grundgesamtheit sind die Termine des Zeitraums, ihre Closings zählen dazu, egal wann sie stattfanden; Person und Quelle kommen dabei vom Setting, sonst risse eine Zeile auseinander (Termin bei A, Abschluss bei B). Nur so sind die Prozentwerte zwischen den Stufen echte Durchlaufquoten. `periode` — jede Stufe zählt auf ihrem eigenen Stichtag („was ist in diesem Zeitraum passiert"); Termine und Closings stammen dann aus verschiedenen Mengen und „Show → Closing" kann über 100 % gehen. Vorher war der Kohorten-Abgleich an den Quellenfilter gekoppelt und setzte bei „alle Quellen" zwei unabhängige Mengen ins Verhältnis.
- **Umsatz je Stufe** (Funnel-Tab): kanalrein. Der Umsatz wird über `setting_calls.source_type` des zugehörigen Settings auf den Kanal zurückgeführt; alles ohne LinkedIn- oder Telefon-Herkunft (manuell, Ads, Social, Inbound, Website, Closings ohne Setting) steht sichtbar als „Andere Quellen" daneben und läuft in keinem der beiden Blöcke mit — nur so summieren sich die Kanäle auf den Gesamtumsatz. Die Kacheln zeigen **immer beide** Kanäle, unabhängig vom Quellenfilter (sonst wäre der Vergleich eine Frage der Filterstellung); Zeitraum, Zählweise und Personenfilter gelten sehr wohl. Vorher gab es eine einzige Kachel „Umsatz pro DM", die im Zähler den GESAMTumsatz aller Quellen trug und damit systematisch zu hoch lag.
- **Vorlaufzeit** (Setting) = `appointment_at − created_at` in Tagen, gegen die Show-Quote. **Abschluss-Geschwindigkeit** (Closing) = Closing-Tag − Setting-Tag, gegen die Win-Rate; die Win-Rate rechnet **dort** gegen entschiedene Deals (gewonnen + verloren), weil ein noch offener Deal über seine endgültige Dauer nichts aussagt.
- **Consistency** (LinkedIn-Tab): Aktive Tage ÷ **Arbeitstage** Mo–Fr im Zeitraum, gerechnet nur bis **heute** — sonst zählte ein laufender Monat seine Zukunft als Lücke, und jedes Wochenende drückte die Quote. Ein Tag zählt ab **einer** DM als aktiv; die strengere Spalte daneben ist „Ziel erreicht" (Tage mit ≥ Tagesziel aus `performance_targets`, ohne Eintrag 20 DMs). Pitches an Wochenenden fallen hier heraus, stecken in den Kennzahlen oben aber drin. Die **Streak** sind die zuletzt lückenlos aktiven Arbeitstage *innerhalb des gewählten Zeitraums* (ein kurzer Zeitraum deckelt sie); der heutige Tag darf leer sein, ohne sie zu brechen. Der frühere Soll/Ist-Abgleich der Übersicht ist entfallen.
- **A/B-Achsen** (Telefon-Tab): Skript-Arm und Zielgruppe sind derselbe Schnitt über dieselbe Kohorte, nur andere Gruppierung. Beide Achsen sind Freitext und werden normalisiert (trimmen, Mehrfach-Leerzeichen einkochen, case-insensitiv zusammenfassen). Der Skript-Arm kommt vom **Lead** (`phone_leads.script_label`), die Liste ist nur Rückfall (§3). Nenner ist `calls` (nur Leads mit `first_call_at`) — ein importierter, nie angerufener Lead darf den Arm nicht verwässern. Arme unter `MIN_AB_CALLS` (20) werden ausgeblendet, Leads ohne Label bekommen **keine** Sammelzeile, sondern werden in der Fußnote gezählt: „Ohne Angabe" wäre sonst der größte Balken.
- **Kanäle ohne eigenes Akquise-Volumen** (Ads, Social Media, Sonstige) zeigen auf der Volumen-Stufe `CHANNEL_NO_VOLUME` („—"), nie 0 — eine 0 läse sich wie ein toter Kanal und zöge jede daraus gerechnete Quote ins Absurde. DMs und Anwahlen werden **nie** addiert („Kontaktpunkte" gibt es nicht mehr): zwei Tätigkeiten mit völlig verschiedenen Quoten. Addiert wird erst ab dem Termin, wo beide Kanäle dasselbe Objekt erzeugen.
- **Zwei Personenachsen laufen nebeneinander:** DMs/Calls kommen aus den RPCs und hängen am Listen-Owner (`list_owned_by_user()`: `owner_name` hat Vorrang, `created_by_user_id` greift nur ohne Namen). Termine/Closings hängen an `personOf()` = `assigned_user_id ?? created_by_user_id` (§2). Zeilen ohne auflösbare Person landen sichtbar in der Sammelzeile „Ohne Zuordnung", statt verworfen zu werden — sonst zeigte der Funnel weniger Termine an, als es gibt.

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
```

### 5.2 Serienvergleich (`/analyse/vergleich`)

Eigenständige Seite neben den sechs Tabs: beliebig viele Serien (max. 6 — so viele validierte Slots hat die kategoriale Palette) in einem Chart plus Gegenüberstellungs-Tabelle. Gerechnet wird auf dem Server; der Zustand liegt vollständig in der URL. Eine Serie ist ein `s`-Parameter im Format `s=<kennzahl>;<dimension>=<wert>;…` (Werte prozentcodiert, damit Listennamen mit `;`/`=` die Struktur nicht sprengen); ohne `s` läuft die Startbelegung „Termine × LinkedIn" gegen „Termine × Telefon". Zeitraum, Granularität und Personenrecht kommen aus demselben `parseAnalyseParams`.

Drei Bausteine, jeder mit genau einer Aufgabe:

| Datei | Rolle |
|---|---|
| `src/lib/compare/model.ts` | Die flache **Faktenzeile**: ein Berlin-Tag, fünf Dimensionen (`person` · `kanal` · `liste` · `zielgruppe` · `skript`), ein Bündel vorberechneter Messgrößen (`MeasureKey`). |
| `src/lib/compare/facts.ts` | Der **Mapper**: bildet `contacts`, `phone_leads`, `setting_calls` und `closing_calls` auf dieselbe Faktenzeile ab. Dadurch liegen Zähler und Nenner einer quellenübergreifenden Kennzahl („Umsatz pro DM") im selben Bucket unter derselben Person, ohne dass irgendwo gejoint werden muss. |
| `src/lib/compare/metrics.ts` | Die **Registry**: eine Kennzahl = eine Zeile aus Zähler, optionalem Nenner und Format (`int`/`pct`/`eur`). Fehlt der Nenner, ist es eine Menge, sonst ein Verhältnis. Der `key` steht in geteilten Links und darf nie umbenannt werden. |

Regeln, die dort gelten und die man beim Nachrechnen kennen muss:
- **Die Personenachse ist immer eine `user_id`**, nie ein Name: LinkedIn/Telefon lösen über den Listen-Owner auf (`owner_name` vor `created_by_user_id`), Termine über `personOf()`. Ein `owner_name`, der zu keinem Mitglied der aktiven Organisation gehört, fällt bewusst auf `null` und **nicht** auf den Ersteller zurück — sonst schriebe man das Volumen dem Admin zu, der die Liste angelegt hat, und der `owner_name`-Vorrang wäre ausgehebelt.
- **Der Tag einer Zeile ist derselbe wie in den Tabs** (`contactDay`, `phoneLeadDay`, `settingEffDate`, `closingEffDate`) — sonst zählte der Vergleich anders als der Tab daneben.
- **`null` in einer Dimension** heißt „nicht anwendbar oder nicht auflösbar": Die Zeile zählt in jeder ungefilterten Serie mit und fällt aus jeder Serie heraus, die auf diese Dimension filtert — dieselbe Logik wie „Ohne Zuordnung" in den Tabs.
- **Kanal und Zielgruppe eines Closings kommen vom Setting** (über `setting_call_id`); ohne diese Kette landete jeder Umsatz unter „ohne Kanal" und „Umsatz pro DM" wäre nicht kanalrein.
- **Die Listen-Achse mischt beide Welten:** LinkedIn-Listen unter ihrer `lists.id`, Telefonlisten präfixiert als `tel:<phone_lists.id>` — über den Namen fielen die je Owner gleichnamigen Routing-Listen zusammen. Die Zielgruppen-Achse führt `contacts.target_group`, `phone_leads.target_group` und `setting_calls.branche` zusammen (Schlüssel = Rohwert, damit ein Deep-Link stabil bleibt).
- **Quoten-Gesamtwerte sind gewichtet** (Σ Zähler ÷ Σ Nenner), nicht der Mittelwert der Perioden-Quoten — sonst zählte ein Tag mit einem Termin so viel wie einer mit vierzig. Ein Bucket ohne Nenner ist eine **Lücke**, keine 0. „Ø je Periode" gibt es deshalb nur für Mengen.
- Die Wert-Kennzahlen (`umsatz_pro_dm`, `_call`, `_termin`, `_closing`) sind **Perioden-Kennzahlen**: Der Deal aus dem August stammt aus einer DM vom Juni. Zähler und Nenner liegen im selben Fenster, aber nicht in derselben Kohorte.
- Die fünfte Dimension trägt bewusst den **Skript-Testarm** statt einer zweiten Quellen-Achse: „Kanal" *ist* die Quelle (dieselbe Spalte `source_type`), und der Testarm ist die einzige Achse, für die es sonst gar keine Auswertung gäbe. **Abweichung zum Telefon-Tab:** Der Mapper liest den Arm derzeit nur aus `phone_lists.script_label`, nicht aus `phone_leads.script_label` — abgewanderte Leads (Routing-Listen) fallen hier also weiterhin aus ihrem Arm, während der Telefon-Tab sie über den Lead-Wert behält. Beide Zahlen sind damit nicht deckungsgleich; maßgeblich ist der Lead-Wert (§3).

## 6. Zeit & Zeitzonen (Fallstricke für Auswertungen)

- **`date`-Spalten** (reine Kalendertage, kein TZ-Thema): `pitched_at`, `next_follow_up_at`, `first_call_at`, `setting_calls.call_at`, `follow_up_due`, `contract_start`.
- **`timestamptz`-Spalten** (UTC in DB): `appointment_at` (contacts/phone_leads/setting_calls), `callback_at`, `closing_at`, `closing_calls.call_at`, `phone_call_attempts.called_at`, alle `created_at`/`updated_at`.
- **Alle Termin-Spalten enthalten echtes UTC** — seit Migration `20260404000021_appointment_timezone_fix.sql`. Vorher schrieben die Terminpfade den rohen `datetime-local`-String (Berlin-Wandzeit) direkt in die `timestamptz`-Spalte, wodurch Termine um den UTC-Offset zu spät erschienen; `closing_calls.call_at` war die einzige Ausnahme mit korrektem UTC. Die Migration hat `setting_calls.appointment_at`/`closing_at`, `contacts.appointment_at`, `phone_leads.appointment_at`/`callback_at` DST-genau korrigiert (Sicherung liegt in `public._appt_tz_backup_20260727`).
- **Einzige Konvertierungsstelle im Code: `src/lib/apptTime.ts`** (`berlinInputToIso` / `isoToBerlinInput` / `berlinDateISO` / `toBerlinSlot` / `slotToIso` / `formatTermin`). Der Offset kommt aus `Intl` mit fester Zone `Europe/Berlin` und hängt damit **nicht** von der Server-Zeitzone ab (Vercel = UTC, lokal = Berlin) — genau daran war die alte Speicherung zerbrochen. Neue Schreibpfade müssen `berlinInputToIso()` verwenden, nie `new Date(input).toISOString()`.
- Die Analyse-Tabs **und** die Vergleichsseite bucketen über den **Berlin-Kalendertag** (`berlinDateISO`, `src/lib/analyse.ts`); die frühere UTC-Slice-Inkonsistenz an der Tagesgrenze ist damit weg. `rpc_appointments_booked` macht dasselbe in SQL (`(created_at at time zone 'Europe/Berlin')::date`) — sonst rutschte ein abends gebuchter Termin in den Vortag. Auch die Kachel „Termine gelegt" im LinkedIn-Tab rechnet über `berlinDateISO(created_at)`.
- **Zeitraumfilter auf `timestamptz` brauchen einen Tagespuffer.** PostgREST kann nicht in Berlin-Zeit schneiden, deshalb das Muster aus `loadCallAttempts` (`src/lib/phoneAttemptsData.ts`): in SQL grob mit einem Tag Luft nach beiden Seiten filtern (`gte from-1`, `lt to+2`), danach in JS exakt über `berlinDateISO` nachfiltern. Ohne den Puffer fehlten Randanrufe, ohne den Nachfilter lägen sie im falschen Tag — und der Rest des Tabs bucketet bereits nach Berlin.
- **Empfehlung für SQL:** `(spalte at time zone 'Europe/Berlin')::date` für die Tageszuordnung von `timestamptz`-Spalten. ISO-Wochen (Montag-basiert) mit `date_trunc('week', …)`.

## 7. Schema-Drift-Warnung

Der Migrationsordner ist fast, aber nicht 100 % vollständig:
- Migrationen `…000002` und `…000004` fehlen im Repo (Nummerierungslücke).
- Migration 0014 erwähnt explizit einen Alt-CHECK auf `answer_category` „aus der nicht im Repo vorhandenen Alt-Migration".

**Stand des Abgleichs (Juli 2026, vor dem Mandanten-Umbau):** Das Live-Schema wurde vollständig gegen den Migrationsordner geprüft (alle 18 Tabellen). Genau **zwei** Spalten existierten live ohne Migration:
- `lists.owner_name` — wird überall benutzt (RPCs, RLS-Backfill, UI). Nachgezogen in Migration `…0024_schema_reconcile.sql`.
- `profiles.is_super_admin` — verwaist, von keiner Zeile Code gelesen. Bewusst **nicht** in den Migrationsordner übernommen (eine frische DB soll sie nicht bekommen); Migration 0025 friert sie per Trigger ein. Siehe §2.

Konsequenz: Bei Unsicherheit über existierende Spalten das Live-Schema per MCP prüfen (`list_tables`), statt allein den Migrationen zu vertrauen.

**Nullable-Fallen bei Boolean-Filtern:** `contacts.answered` und `contacts.appointment_set` sind `boolean | null`, und **NULL ist der Normalfall** (frisch gepitcht = noch nichts passiert). Ein `= false` verliert damit die Mehrheit der Zeilen. Die gesamte App liest „nicht true" als Nein — so auch `isDueFollowUp` (`ListBoardV2`), der `nachfassen_tasks`-RPC und `viewFilterOps` (`src/lib/listViews.ts`). In SQL entsprechend `is not true` statt `= false`.

**Manuell auszuführende Migrationen:** `…0019`, `…0020`, `…0021`, `…0022` (pg_trgm-Suchindizes), `…0023` (`list_views`), `…0024` (Schema-Abgleich), `…0025` (`platform_admins`), `…0026` (Nutzer-Umzug), `…0027` (Organisation löschen), `…0028` (`fundament`: Zuweisung, Anruf-Log, RPC-Korrekturen), `…0029` (`analyse_umbau`: Quellen, Termin-Rufnummer, Verlustgrund-Codes, Telefon-Skripte) und `…0030` (`script_label_snapshot`) laufen nicht automatisch — sie müssen im Supabase-SQL-Editor ausgeführt werden.

- **0028** ist bis auf zwei Stellen additiv: Sie ersetzt die RLS-Policies `setting_calls_scoped_member` / `closing_calls_scoped_member` destruktiv und schreibt vier RPCs per `create or replace` neu (Signaturen unverändert, Grants bleiben). Vor dem Ausführen prüfen, dass `call_assignees` keine Mehrfachzuweisung enthält — der Backfill kollabiert sie sonst auf eine Person.
- **0029** muss **vor** dem Deploy des zugehörigen Codes laufen. `src/lib/analyseData.ts` selektiert `setting_calls.phone`, `closing_calls.lost_reason_code` und `phone_lists.script_label`/`target_group` **namentlich** — eine fehlende Spalte lässt PostgREST die GESAMTE Abfrage abweisen, der Analyse-Bereich wäre dann leer statt unvollständig. Rein additiv (vier Spalten, ein erweiterter CHECK, ein neuer CHECK), aber mit zwei Backfills, die man kennen muss: die Regel-basierte Umdeutung von `source_type='manuell'` nach `ads`/`social_media` (§4) und `lost_reason_code='sonstiges'` auf **alle** verlorenen Bestandszeilen (§4). Beide sind bewusst konservativ — der Rest ist To-do-Liste, nicht Statistik. Verifikationsblock am Ende der Datei.
- **0030** ist rein additiv (`phone_leads.script_label` + Index) und setzt 0029 voraus. Der Backfill übernimmt das Label nur für Leads, die noch in einer Liste **mit** Label liegen; bereits in eine Routing-Liste abgewanderte Leads bekommen nichts — ihr ursprünglicher Arm ist nicht rekonstruierbar und wird als „ohne Testarm" ausgewiesen, statt einen Arm zu verfälschen.

## 8. Invarianten (nach jedem Nutzer-Umzug und nach jedem Backfill prüfen)

Alle Abfragen müssen `0` bzw. eine leere Menge liefern. Sie decken genau die Fehler ab, die ein unvollständiger Umzug hinterlässt — die beiden Zuweisungs-Blöcke zusätzlich die eines unvollständigen Backfills aus 0028, die beiden Testarm-Blöcke die aus 0030 (dort mit einer benannten Altbestands-Ausnahme).

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
-- aus 0028 greift nur bei 'update of workspace_id' — eine Zeile, die beim
-- Nutzer-Umzug ZURÜCKBLEIBT (Besitz wird über created_by_user_id ermittelt),
-- behält ihre Zuweisung auf den inzwischen Ausgezogenen.
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
```

Zusätzlich als UI-Gegenprobe in der eigenen Organisation: `/team` zeigt nur eigene Mitglieder · Datensicht-Auswahl ohne fremde Namen · `/termine` ohne fremde Termine · Suche nach einem fremden Lead liefert 0 Treffer · Sidebar ohne fremde Listen.

## 9. Datenauswertung per MCP

**Für Datenauswertung: den Supabase-MCP (read-only, `execute_sql` / `list_tables`) nutzen, mit obigem Glossar als Kontext.** RLS greift dort nicht — Personen-/Zeitraumfilter immer explizit in die Query schreiben (§2, §5). Der MCP funktioniert nur, wenn `SUPABASE_ACCESS_TOKEN` vor dem Start von Claude Code in der Umgebung gesetzt ist (siehe README, Abschnitt „Supabase MCP").
