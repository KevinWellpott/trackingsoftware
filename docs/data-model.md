# Datenmodell & Auswertungs-Glossar (Pitch-Tracker)

Kontext für KI-gestützte Datenauswertung über den read-only Supabase-MCP.
Quellen: `supabase/migrations/` (maßgeblich für Schema) + tatsächliche Nutzung in `src/`.
Stand: Juli 2026 (nach Migration `20260404000023_list_views.sql`).

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

- Ein **Workspace = eine Organisation = ein Kunden-Mandant.** Ein User hat genau **eine** Mitgliedschaft (`workspace_members`) — das ist eine harte Annahme: `getAccessContext()` würde bei zwei Mitgliedschaften den Nutzer aussperren (Redirect `/onboarding`, wo `bootstrap_workspace` mit `'Already in a workspace'` abbricht). Die Umzugsfunktion löscht die alte Mitgliedschaft deshalb, statt eine zweite anzulegen.
- **Plattform-Admins (`platform_admins`, Migration 0025)** stehen *oberhalb* der Organisation: Simon und Kevin dürfen jede Organisation lesen und dort schreiben, sind aber **in keiner Kunden-Organisation Mitglied**. Sonst erschienen sie im Team-Dashboard und in der Datensicht-Auswahl des Kunden — und umgekehrt.
  - Technisch: `is_platform_admin()` (SECURITY DEFINER, `stable`) + je eine zusätzliche permissive RLS-Policy `<tabelle>_platform_admin` auf 17 Tabellen. Die bestehenden `can_access_*`-Helfer bleiben unangetastet.
  - Die 8 Metrik-RPCs sind über einen einzigen Zweig in `rpc_effective_user` org-übergreifend — keine RPC musste geändert werden.
  - **`profiles.is_super_admin` ist NICHT dieses Flag.** Die Spalte existiert live, wird von keiner Zeile Code gelesen und ist als Berechtigung unbrauchbar, weil `profiles_update_own` jedem Nutzer erlaubt, seine eigene Profilzeile zu ändern. Ein Trigger aus Migration 0025 friert sie ein.
- **Aktive Organisation:** `AccessContext.workspace_id` meint die *aktive* Organisation, nicht zwingend die eigene. Für einen Plattform-Admin steuert der Cookie `pt_active_workspace_id` (8 h, httpOnly) den Wechsel; in fremder Org werden `role='owner'` und `data_scope='workspace'` synthetisiert, damit alle Owner-Gates greifen. `is_foreign_org` schaltet die roten Warnbanner. Ein Org-Wechsel löscht immer den Datensicht-Cookie.
- **`workspace_id` beim INSERT immer explizit setzen.** Die BEFORE-INSERT-Trigger leiten es sonst aus der Mitgliedschaft ab — was für einen Plattform-Admin in einer Kunden-Org die falsche Organisation wäre. Seit Migration 0025 wirft der Trigger in genau diesem Fall, statt still zu raten. Ausnahme: `contacts` und `phone_leads` erben es korrekt von ihrer Elternliste.
- Zwei unabhängige Achsen auf `workspace_members`:
  - `role`: `owner` | `member` → Admin-Rechte (Team-Dashboard `/team`, Nutzerverwaltung, Owner-Auswahl beim Import).
  - `data_scope`: `workspace` | `own` → Datensichtbarkeit (`own` sieht nur eigene Daten; RLS + RPCs erzwingen das).
- **Owner-Zuordnung von Listen: `owner_name` hat Vorrang vor `created_by_user_id`** (`list_owned_by_user()` in SQL, `buildOwnScope()` in `src/lib/access.ts`). Ein Admin kann eine Liste FÜR ein Mitglied anlegen (owner_name = Mitglied, created_by = Admin) — die Zahlen zählen dann beim Mitglied. `owner_name` matcht auf `profiles.username`.
- `setting_calls` und `closing_calls` haben **kein** `owner_name` — dort ist `created_by_user_id` die Personen-Zuordnung (zusätzlich Multi-Zuweisung über `call_assignees`).
- Persönliches Dashboard `/` = genau eine Person; Team-Dashboard `/team` = workspace-weit (nur `role='owner'` mit `data_scope='workspace'`). Admins können per Cookie die Datensicht eines Mitglieds einnehmen.
- **Zwei geschachtelte Umschalter:** Der Org-Umschalter (rot, nur Plattform-Admins) wechselt die *Organisation*, die Datensicht (orange) wechselt die *Person* innerhalb der aktiven Organisation. Rot steht über Orange — äußere Grenze zuerst.
- **Organisation löschen:** `preview_delete_workspace()` / `platform_delete_workspace()` (Migration 0027, UI unter `/admin/org/[id]`). An `workspaces` hängen **14 Fremdschlüssel mit `on delete cascade`** — ein `delete` nimmt den kompletten Datenbestand der Organisation mit, ohne Undo. Die Funktion verweigert deshalb, solange noch Mitglieder da sind (sonst blieben verwaiste Accounts zurück: Mitgliedschaft kaskadiert weg, Login bleibt), und bei der eigenen Organisation; die UI verlangt zusätzlich das Abtippen des Namens.
- **Nutzer verschieben:** `preview_move_user()` / `admin_move_user_to_workspace()` (Migration 0026, UI unter `/admin/org/[id]`). Der Umzug stempelt `workspace_id` auf 14 Tabellen um und kappt Kanten, die über die neue Org-Grenze zeigen (Termin ohne Quellkontakt, Closing ohne Setting, Smart View ohne Ordner) — genullt, nicht blockiert, weil `lead_name`/`company` als Snapshot vorliegen. Besitz-Ermittlung ausschließlich in `move_user_scope()`, damit Vorschau und Umzug nie auseinanderlaufen.
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
| `list_views` | **Smart Views** — gespeicherte, filter-definierte Sichten auf LinkedIn-Kontakte, beliebig verschachtelbar. `parent_id` → `list_views` (Selbstreferenz, `on delete cascade`), `name`, `sort_order`, `filters` (jsonb), `owner_name`/`created_by_user_id` wie bei `lists`. **`filters is null` = reiner Ordner** (gruppiert nur), `filters` gesetzt = Ansicht, die zu einer Kontaktmenge auflöst. Besitzt nichts: Kontakte bleiben an ihrer Liste. Filter-Schema und Query-Aufbau ausschließlich in `src/lib/listViews.ts` (`parseViewFilters`, `viewFilterOps`), UI unter `/ansicht/[viewId]` und im Sidebar-Baum. |
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

**`contacts.follow_up_number`** (FU-Stufe): **NULL** = noch kein Follow-up, 1–3 = FU1–FU3. Achtung: der CHECK erlaubt nur `null` oder `1,2,3` — eine **0 steht nie in der DB**. Wer auf „noch kein Follow-up" filtert, braucht `is null`; ein `in (0)` findet nichts, und `in (…)` trifft NULL grundsätzlich nicht. Fälligkeits-Intervalle: nach Pitch +3 Tage → FU1, danach +5 → FU2, danach +7 → FU3, danach Ende (`src/app/actions/contacts.ts`, `calcNextFollowUp`). Ausschluss aus dem FU-Flow: `answered=true` oder `appointment_set=true` oder FU3 erreicht oder `blocked_at` gesetzt (Lead hat uns blockiert).

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
- Migration 0014 erwähnt explizit einen Alt-CHECK auf `answer_category` „aus der nicht im Repo vorhandenen Alt-Migration".

**Stand des Abgleichs (Juli 2026, vor dem Mandanten-Umbau):** Das Live-Schema wurde vollständig gegen den Migrationsordner geprüft (alle 18 Tabellen). Genau **zwei** Spalten existierten live ohne Migration:
- `lists.owner_name` — wird überall benutzt (RPCs, RLS-Backfill, UI). Nachgezogen in Migration `…0024_schema_reconcile.sql`.
- `profiles.is_super_admin` — verwaist, von keiner Zeile Code gelesen. Bewusst **nicht** in den Migrationsordner übernommen (eine frische DB soll sie nicht bekommen); Migration 0025 friert sie per Trigger ein. Siehe §2.

Konsequenz: Bei Unsicherheit über existierende Spalten das Live-Schema per MCP prüfen (`list_tables`), statt allein den Migrationen zu vertrauen.

**Nullable-Fallen bei Boolean-Filtern:** `contacts.answered` und `contacts.appointment_set` sind `boolean | null`, und **NULL ist der Normalfall** (frisch gepitcht = noch nichts passiert). Ein `= false` verliert damit die Mehrheit der Zeilen. Die gesamte App liest „nicht true" als Nein — so auch `isDueFollowUp` (`ListBoardV2`), der `nachfassen_tasks`-RPC und `viewFilterOps` (`src/lib/listViews.ts`). In SQL entsprechend `is not true` statt `= false`.

**Manuell auszuführende Migrationen:** `…0019`, `…0020`, `…0021`, `…0022` (pg_trgm-Suchindizes), `…0023` (`list_views`), `…0024` (Schema-Abgleich), `…0025` (`platform_admins`), `…0026` (Nutzer-Umzug) und `…0027` (Organisation löschen) laufen nicht automatisch — sie müssen im Supabase-SQL-Editor ausgeführt werden.

## 8. Mandanten-Invarianten (nach jedem Nutzer-Umzug prüfen)

Alle Abfragen müssen `0` bzw. eine leere Menge liefern. Sie decken genau die Fehler ab, die ein unvollständiger Umzug hinterlässt.

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

-- owner_name zeigt nur auf Mitglieder DERSELBEN Organisation
select l.workspace_id, l.owner_name from lists l where l.owner_name is not null
  and not exists (select 1 from workspace_members wm join profiles p on p.user_id = wm.user_id
                   where wm.workspace_id = l.workspace_id and p.username = l.owner_name);
```

Zusätzlich als UI-Gegenprobe in der eigenen Organisation: `/team` zeigt nur eigene Mitglieder · Datensicht-Auswahl ohne fremde Namen · `/termine` ohne fremde Termine · Suche nach einem fremden Lead liefert 0 Treffer · Sidebar ohne fremde Listen.

## 9. Datenauswertung per MCP

**Für Datenauswertung: den Supabase-MCP (read-only, `execute_sql` / `list_tables`) nutzen, mit obigem Glossar als Kontext.** RLS greift dort nicht — Personen-/Zeitraumfilter immer explizit in die Query schreiben (§2, §5). Der MCP funktioniert nur, wenn `SUPABASE_ACCESS_TOKEN` vor dem Start von Claude Code in der Umgebung gesetzt ist (siehe README, Abschnitt „Supabase MCP").
