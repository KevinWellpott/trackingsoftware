# Datenmodell & Auswertungs-Glossar (Pitch-Tracker)

Kontext für KI-gestützte Datenauswertung über den read-only Supabase-MCP.
Quellen: `supabase/migrations/` (maßgeblich für Schema) + tatsächliche Nutzung in `src/`.
Stand: Juli 2026 (nach Migration `20260404000020_list_followup_texts.sql`).

## 1. Was die App trackt (Lifecycle)

Vertriebs-Funnel eines Teams, zwei Akquise-Kanäle, die in einen gemeinsamen Termin-Funnel münden:

```
LinkedIn:  contacts (1 Zeile = 1 Pitch/DM) ──unbeantwortet──▶ FU1/FU2/FU3 (Nachfassen)
                    └──Antwort/Termin──▶ setting_calls (source_type='linkedin')
Telefon:   CSV-Import ▶ phone_leads ──Call-Outcome──▶ Rückruf | Nicht erreicht | Dead
                    └──Termin──▶ setting_calls (source_type='telefon')
Manuell:   direkt angelegter Termin ▶ setting_calls (source_type='manuell', source_detail=Freitext)

setting_calls (Erstgespräch/Qualifizierung) ──qualifiziert──▶ closing_calls (Abschlussgespräch)
closing_calls ▶ gewonnen (Umsatz = deal_volume) | verloren (lost_reason) | nachfassen
```

Begriffe:
- **Pitch / DM** = eine Zeile in `contacts`. Pitch-Datum = `pitched_at` (bzw. `created_at::date` als Fallback).
- **Liste** = `lists` (LinkedIn) bzw. `phone_lists` (Telefon). Kontakte/Leads hängen immer an einer Liste; die Liste bestimmt den Owner.
- **Setting** = `setting_calls`: gebuchter Termin + Qualifizierungsgespräch (Budget, Pain, Entscheider …).
- **Closing** = `closing_calls`: Abschlussgespräch, entsteht aus qualifiziertem Setting (verknüpft über `closing_calls.setting_call_id`).
- **Termine** = `/termine`: gemeinsamer Kalender über beide Tabellen (Monat/Woche/Tag + versteckte Listenansicht). Feste Dauern: Setting 30 min, Closing 60 min. `/setting` und `/closing` leiten dorthin um; die Detailrouten `/setting/[id]` und `/closing/[id]` bleiben. Setting-Calls mit `status in ('dead','unqualifiziert')` sind dort standardmäßig ausgeblendet.
- **Nachfassen** = zentrale Wiedervorlage (`/nachfassen`), gespeist aus RPC `nachfassen_tasks` (4 Quellen, siehe §5).

## 2. Workspace- & Sichtbarkeitsmodell

- Ein **Workspace = ein Team**; ein User hat genau **eine** Mitgliedschaft (`workspace_members`). Praktisch gibt es einen produktiven Workspace.
- Zwei unabhängige Achsen auf `workspace_members`:
  - `role`: `owner` | `member` → Admin-Rechte (Team-Dashboard `/team`, Nutzerverwaltung, Owner-Auswahl beim Import).
  - `data_scope`: `workspace` | `own` → Datensichtbarkeit (`own` sieht nur eigene Daten; RLS + RPCs erzwingen das).
- **Owner-Zuordnung von Listen: `owner_name` hat Vorrang vor `created_by_user_id`** (`list_owned_by_user()` in SQL, `buildOwnScope()` in `src/lib/access.ts`). Ein Admin kann eine Liste FÜR ein Mitglied anlegen (owner_name = Mitglied, created_by = Admin) — die Zahlen zählen dann beim Mitglied. `owner_name` matcht auf `profiles.username`.
- `setting_calls` und `closing_calls` haben **kein** `owner_name` — dort ist `created_by_user_id` die Personen-Zuordnung (zusätzlich Multi-Zuweisung über `call_assignees`).
- Persönliches Dashboard `/` = genau eine Person; Team-Dashboard `/team` = workspace-weit (nur `role='owner'` mit `data_scope='workspace'`). Admins können per Cookie die Datensicht eines Mitglieds einnehmen.
- **Wichtig für MCP-Auswertungen:** `execute_sql` läuft direkt auf Postgres **an RLS vorbei** — man sieht alle Daten. Personenfilter daher immer explizit setzen: über `lists.owner_name` / `phone_lists.owner_name` (Vorrang) bzw. `created_by_user_id` joined auf `profiles.username`.

## 3. Tabellen-Glossar

### LinkedIn-Funnel

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `lists` | LinkedIn-Pitch-Listen. `name`, `owner_name` (Besitzer, matcht `profiles.username`), `created_by_user_id`, `pitch_text` (Vorlage), `fu1_text`/`fu2_text`/`fu3_text` (Nachfass-Sequenz der Liste, `{name}`-Platzhalter), `archived_at`. |
| `contacts` | 1 Zeile = 1 gepitchter LinkedIn-Kontakt. `list_id` → `lists` (Trigger setzt `workspace_id`). Kernfelder: `name`, `company`, `pitched_at` (date), `answered` (bool), `answer_category` (§4), `answer_text`, `follow_up_number` (0–3), `next_follow_up_at` (date), `appointment_set` (bool), `appointment_at` (timestamptz), `meet_link`, `linkedin_url`, `setting_call_id` → `setting_calls`, `blocked_at` (timestamptz — Lead hat uns auf LinkedIn blockiert; App nullt `next_follow_up_at`, RPCs schließen blockierte zusätzlich aus). Legacy-CRM: `stage_id` → `pipeline_stages`, `deal_value`, `deal_closed`, `deal_lost_reason`, `meeting_notes`, `custom_fields` (jsonb). |
| `pipeline_stages` | Legacy-CRM-Stufen je Liste mit `probability_pct` (0–100) und `exclude_from_followup`. Defaults beim Anlegen: Neu 10 %, Gespräch 30 %, Angebot 60 %, Verhandlung 80 %, Gewonnen 100 %, Verloren 0 %. In der aktiven Tracking-UI kaum genutzt — **nicht** die „Termin-Wahrscheinlichkeit" des Setting-Flows (die gibt es nicht als Prozentwert). |

### Telefon-Funnel

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `phone_lists` | Telefonlisten. `list_kind`: `akquise` (Import) \| `rueckruf` \| `nicht_erreicht` — die beiden Routing-Listen existieren je Owner genau einmal (Leads werden bei entsprechendem Outcome physisch dorthin verschoben). `owner_name`, `created_by_user_id`. |
| `phone_leads` | 1 Zeile = 1 Firma/Lead. `first_call_at` (date, = „wurde angerufen"), `decider_name`, `company`, `phone`, `status` (§4), `call_attempt` (1–3), `gatekeeper_reached`, `gatekeeper_attempts` (1–2), `decider_reached` (bool), `answer_sentiment`, `callback_at` (timestamptz, Rückruf-Fälligkeit), `appointment_set`/`appointment_at`, `mailbox`, Begründungen: `no_transfer_reason`, `no_pitch_reason`, `no_appointment_reason`. |
| `csv_imports` | Protokoll der Telefon-Importe (`row_count`, `imported_count`, `duplicate_count`, `phone_list_id`). |

### Termin-Funnel (Setting → Closing)

| Tabelle | Zweck / Schlüsselspalten |
|---|---|
| `setting_calls` | Termin + Qualifizierungsgespräch. Herkunft: `source_type` (§4), `source_detail` (Freitext, v. a. bei manuell), `source_contact_id` → `contacts`, `source_phone_lead_id` → `phone_leads`. Termin: `appointment_at` (timestamptz), `meet_link` (optional), `meeting_kind` (`link` \| `telefon` \| NULL = ohne Angabe), `call_at` (date, Gesprächstag). Qualifizierung: `show_status` (`show`/`no_show`), `has_budget_8k`, `branche`, `sole_decider`/`can_decide_now`/`clear_need` (bool), `ist_pain` (1–10), `warmth` (1–10), `soll_ziel`, `script_answers` (jsonb, Setting-Skript-Blöcke). Ergebnis: `status` (§4), `follow_up_due` (date, Wiedervorlage), `no_show_count` (zählt No-Shows über Neuterminierungen), `closing_scheduled`/`closing_at`. |
| `closing_calls` | Abschlussgespräch. `setting_call_id` → `setting_calls`. `call_at` (timestamptz, Termin inkl. Uhrzeit), `meet_link`, `show_status`, `status` (§4), Deal: `closed` (bool), `deal_volume` (numeric, €), `payment_type` (Freitext, UI: „Einmal"/„Raten"), `signature_received`, `contract_start` (date), `lost_reason`, `follow_up_due` (date). |
| `call_assignees` | Multi-Zuweisung von Nutzern an Setting-/Closing-Calls: `entity_type` (`setting_call`\|`closing_call`), `entity_id`, `user_id`. |

### Sonstiges

| Tabelle | Zweck |
|---|---|
| `profiles` | `user_id` ↔ `username` (Login + Owner-Matching). |
| `workspaces` / `workspace_members` | Team + Mitgliedschaft (`role`, `data_scope`, Invite-Code). |
| `performance_targets` | Ziele je User: `channel` (`linkedin`\|`telefon`) × `period` (`daily`\|`weekly`) × `metric` (`pitches`\|`calls`\|`appointments`). App-Defaults ohne Eintrag: LinkedIn 20/Tag, 100/Woche; Telefon 40/Tag, 200/Woche (`src/lib/targets.ts`). |
| `followup_templates` | FU-Textvorlagen je User (`fu_number` 1–3). Vorschlagstext im Nachfassen-Board: `lists.fuN_text` > `followup_templates` > Standardtext (`followUpTextFor`, `src/app/actions/nachfassen.ts`). |
| `organic_lists` / `organic_posts` | Organic-Social-Tracker (Posts, Impressions, `content_type`: educational/motivational/entertaining/bts/other). UI ist abgeklemmt (alte Routen leiten um), Daten existieren ggf. noch. |

## 4. Status-/Enum-Werte (DB-Wert ↔ UI-Label)

**`phone_leads.status`**: `aktiv` „Aktiv" · `rueckruf` „Rückruf" · `nicht_erreicht` „Nicht erreicht" · `termin` „Termin" · `dead` „Dead"/„Toter Lead"
**`phone_leads.gatekeeper_reached`**: `ja` · `nein` · `direkt` (direkt zum Entscheider durchgekommen)
**`phone_leads.answer_sentiment`**: `positiv` · `neutral` · `negativ` (Reaktion im Telefonat — nicht verwechseln mit `contacts.answer_category`)

**`setting_calls.status`**: `offen` „Offen" · `no_show` „Nicht erschienen" · `qualifiziert` „Qualifiziert" · `closing_gelegt` „Closing gelegt" · `unqualifiziert` „Unqualifiziert" · `dead` „Dead"
Historie: Alt-Wert `disqualifiziert` wurde per Migration 0018 zu `unqualifiziert` migriert. Outcome-Logik: `no_show` → Wiedervorlage +1 Tag + `no_show_count`++; `unqualifiziert` → Wiedervorlage +7 Tage; `qualifiziert` → Closing wird angelegt, Status wird `closing_gelegt`. Show-Quote: `show_status` (`show`/`no_show`); bei `offen`/`dead` bewusst NULL.
**`setting_calls.source_type`**: `linkedin` · `telefon` · `inbound` · `website` · `manuell` (+ `source_detail` Freitext, z. B. „Social Selling", „Empfehlung …")
**`setting_calls.has_budget_8k`**: `ja` · `nein` · `unklar` — **`branche`**: `agentur` · `coach` · `consultant` · `sonstiges` — **`ist_pain`**, **`warmth`**: 1–10

**`closing_calls.status`**: `offen` „Offen" · `gewonnen` „Gewonnen" · `verloren` „Verloren" (erzwingt `lost_reason`) · `nachfassen` „Nachfassen" (erzwingt `follow_up_due`)

**`contacts.answer_category`** (Freitext, DB-Wert = deutsches Label, kein Constraint):
- Aktuell wählbar: `Positiv` · `Neutral` · `Negativ`
- Legacy in Bestandsdaten: `Interessiert`, `Kein Interesse`, `Zu teuer`, `Falsches Timing`, `Bereits Lösung`, `Kein Budget`, `Falsche Zielgruppe` (Definition: `src/lib/categories.ts`)

**`contacts.follow_up_number`** (FU-Stufe): NULL/0 = noch kein Follow-up, 1–3 = FU1–FU3. Fälligkeits-Intervalle: nach Pitch +3 Tage → FU1, danach +5 → FU2, danach +7 → FU3, danach Ende (`src/app/actions/contacts.ts`, `calcNextFollowUp`). Ausschluss aus dem FU-Flow: `answered=true` oder `appointment_set=true` oder FU3 erreicht oder `blocked_at` gesetzt (Lead hat uns blockiert).

## 5. RPCs = maßgebliche Metrik-Definitionen

Die Dashboards rechnen nicht frei, sondern über diese SECURITY-DEFINER-RPCs — für konsistente Auswertungen deren Semantik übernehmen. Alle nehmen `p_workspace_id` + optional `p_effective_user_id` (NULL = workspace-weit; bei `data_scope='own'` serverseitig auf den Aufrufer erzwungen).

| RPC | Liefert | Semantik-Details |
|---|---|---|
| `rpc_owner_day_metrics(ws, from, to, user?)` | je `owner_name`+Tag: `dms`, `answers`, `appts` | Tag = `coalesce(pitched_at, created_at::date)`; Owner über `lists.owner_name` (Vorrang) |
| `rpc_owner_week_counts(ws, from, to, user?)` | je Owner+Tag: `cnt` Pitches | Basis des Wochenduells |
| `rpc_appt_rate(ws, user?)` | `total_dms`, `total_appts` | **all-time**, ohne Zeitraum |
| `rpc_followup_alerts(ws, today, user?)` | `due_soon` (heute…+3 Tage), `overdue` | nur offene FU-Kandidaten (Ausschlüsse s. §4, inkl. `blocked_at is null`) |
| `rpc_phone_owner_metrics(ws, from, to, user?)` | je Owner: `calls`, `gatekeeper_reached`, `decider_reached`, `appointments`, `callbacks`, `dead` | **Achtung: nur `calls` ist zeitraumgefiltert** (`first_call_at between`), die übrigen Spalten sind all-time-Zählungen |
| `rpc_phone_day_metrics(ws, from, to, user?)` | wie oben, aber je Owner+**Tag** | Tag = `coalesce(first_call_at, created_at::date)`; `calls` zählt nur Leads mit `first_call_at is not null`; für Zeitraum-Analysen diese RPC nutzen |
| `rpc_phone_list_counts(ws, user?)` | Status-Counts je Telefonliste | |
| `nachfassen_tasks(ws, today, now, user?)` | fällige Aufgaben (Union) | 4 Zweige: ① LinkedIn-FU (`next_follow_up_at <= today`, Ausschlüsse §4) ② Telefon-Rückruf (`status='rueckruf'`, `callback_at <= now`) ③ Closing (`status='nachfassen'`, `follow_up_due <= today`) ④ Setting (`status in ('no_show','unqualifiziert')`, `follow_up_due <= today`). App blendet zusätzlich LinkedIn-Tasks mit Pitch > 7 Tage aus. |

Kennzahl-Definitionen der UI:
- **Antwortquote** = answers / dms; **Terminquote** = appts / dms (Zielband 3–7 %).
- **Umsatz** = Σ `closing_calls.deal_volume` where `status='gewonnen'`.
- **Wochenduell-Sieg** = strikt mehr Pitches als jede andere Person (geteiltes Maximum = Unentschieden).
- **Funnel je Quelle** (Analyse): DMs/Calls → Antworten/Entscheider → Termine → Setting-Shows (`show_status='show'`) → Closings → Gewonnen; Verknüpfung Setting↔Closing über `setting_call_id`.

Beispiel-Auswertungen (Muster):

```sql
-- Termine je Person diese Woche (gesetzt = Setting-Call angelegt)
select p.username, count(*) as termine
from setting_calls sc
join profiles p on p.user_id = sc.created_by_user_id
where sc.created_at >= date_trunc('week', now())
group by 1 order by 2 desc;

-- LinkedIn-DMs je Owner in einem Zeitraum (owner_name-Vorrang!)
select coalesce(l.owner_name, '—') as owner, count(*) as dms
from contacts c join lists l on l.id = c.list_id
where coalesce(c.pitched_at, c.created_at::date) between '2026-07-01' and '2026-07-31'
group by 1 order by 2 desc;
```

## 6. Zeit & Zeitzonen (Fallstricke für Auswertungen)

- **`date`-Spalten** (reine Kalendertage, kein TZ-Thema): `pitched_at`, `next_follow_up_at`, `first_call_at`, `setting_calls.call_at`, `follow_up_due`, `contract_start`.
- **`timestamptz`-Spalten** (UTC in DB): `appointment_at` (contacts/phone_leads/setting_calls), `callback_at`, `closing_at`, `closing_calls.call_at`, alle `created_at`/`updated_at`.
- **Alle Termin-Spalten enthalten echtes UTC** — seit Migration `20260404000021_appointment_timezone_fix.sql`. Vorher schrieben die Terminpfade den rohen `datetime-local`-String (Berlin-Wandzeit) direkt in die `timestamptz`-Spalte, wodurch Termine um den UTC-Offset zu spät erschienen; `closing_calls.call_at` war die einzige Ausnahme mit korrektem UTC. Die Migration hat `setting_calls.appointment_at`/`closing_at`, `contacts.appointment_at`, `phone_leads.appointment_at`/`callback_at` DST-genau korrigiert (Sicherung liegt in `public._appt_tz_backup_20260727`).
- **Einzige Konvertierungsstelle im Code: `src/lib/apptTime.ts`** (`berlinInputToIso` / `isoToBerlinInput` / `berlinDateISO` / `toBerlinSlot` / `slotToIso` / `formatTermin`). Der Offset kommt aus `Intl` mit fester Zone `Europe/Berlin` und hängt damit **nicht** von der Server-Zeitzone ab (Vercel = UTC, lokal = Berlin) — genau daran war die alte Speicherung zerbrochen. Neue Schreibpfade müssen `berlinInputToIso()` verwenden, nie `new Date(input).toISOString()`.
- Die Analyse-Tabs bucketen über den **Berlin-Kalendertag** (`berlinDateISO`, `src/lib/analyse.ts`); die frühere UTC-Slice-Inkonsistenz an der Tagesgrenze ist damit weg.
- **Empfehlung für SQL:** `(spalte at time zone 'Europe/Berlin')::date` für die Tageszuordnung von `timestamptz`-Spalten. ISO-Wochen (Montag-basiert) mit `date_trunc('week', …)`.

## 7. Schema-Drift-Warnung

Der Migrationsordner ist fast, aber nicht 100 % vollständig:
- Migrationen `…000002` und `…000004` fehlen im Repo (Nummerierungslücke).
- `lists.owner_name` wird überall benutzt (RPCs, RLS-Backfill, UI), wird aber von keiner Repo-Migration angelegt → stammt aus einer fehlenden Alt-Migration bzw. manuellem DDL.
- Migration 0014 erwähnt explizit einen Alt-CHECK auf `answer_category` „aus der nicht im Repo vorhandenen Alt-Migration".

Konsequenz: Bei Unsicherheit über existierende Spalten das Live-Schema per MCP prüfen (`list_tables`), statt allein den Migrationen zu vertrauen.

## 8. Datenauswertung per MCP

**Für Datenauswertung: den Supabase-MCP (read-only, `execute_sql` / `list_tables`) nutzen, mit obigem Glossar als Kontext.** RLS greift dort nicht — Personen-/Zeitraumfilter immer explizit in die Query schreiben (§2, §5). Der MCP funktioniert nur, wenn `SUPABASE_ACCESS_TOKEN` vor dem Start von Claude Code in der Umgebung gesetzt ist (siehe README, Abschnitt „Supabase MCP").
