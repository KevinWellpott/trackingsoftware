# Ist-Stand: Nachfassen, Erinnerungs-Kaskade und Lead-Recycling

Repo `D:\Tracking\trackingsoftware`, Branch `feature/erinnerungs-kaskade` (Commit `b145b35`), Stand 2026-09-06.
Quelle: 8 Teil-Inventare (Migrationen 0031/0032, Kaskaden-Logik, Auslösepunkte, /erinnerungen, /nachfassen + Recycling, /settings + Berechtigungen, Auswertung + Navigation).
**Migrationen 0031 und 0032 sind nirgends eingespielt** — alles unten Beschriebene existiert als Code, aber nicht als Datenbank.

---

## 1. Kurzfassung

1. Das System besteht aus drei bewusst getrennten Mechanismen mit unterschiedlicher Zeitkörnung: **Nachfassen** (Tag, `/nachfassen`), **Erinnerungen** (Stunde, `/erinnerungen`) und **Recycling** (Wochen/Monate, 5. Sektion in `/nachfassen`).
2. Alle drei sind reine Kopier-Werkbänke ohne jeden Auto-Versand: die App berechnet Fälligkeiten, rendert einen fertigen Text und bietet einen Kopier-Button plus ein manuelles Erledigt-Häkchen.
3. Die Erinnerungs-Kaskade erzeugt vor jedem Setting-, Closing- und vereinbarten Nachfass-Termin bis zu drei geplante Bestätigungs-Touches (Default 72/24/1 Stunden vorher) sowie einen sofort fälligen Touch bei No-Show.
4. Ausgelöst wird sie an elf Stellen in drei Action-Dateien (`appointments.ts`, `settingCalls.ts`, `closingCalls.ts`), jeweils fail-soft nach dem eigentlichen Schreibvorgang; Touches werden nie hart gelöscht, sondern per `superseded_at` entwertet und neu erzeugt.
5. `/erinnerungen` zeigt die offenen Touches der Person in vier Buckets (Überfällig / Nächste Stunde / Heute / Diese Woche), mit Kanal-Badge, Deeplink zum Termin und live gegen die aktuelle Org-Vorlage gerendertem Text; Owner mit Team-Datensicht haben zusätzlich eine Team-Ansicht.
6. Das Recycling setzt an den vier „toten Enden“ der Pipeline an (Closing verloren, Telefon-Lead dead, Setting dead, LinkedIn nach FU3 ohne Antwort) und schreibt dort ein grund-abhängiges `next_recycle_at`; `falsche_zielgruppe` bekommt bewusst nie eines.
7. Fällige Recycling-Leads erscheinen über die eigene RPC `recycle_tasks` als fünfte Sektion in `/nachfassen` mit drei Aktionen: „Nochmal versucht“ (neue Frist, gedeckelt über `max_attempts`), „Reagiert“ (Recycling stoppen) und „Endgültig raus“ (`recycle_excluded_at`).
8. Konfiguriert wird beides ausschließlich org-weit unter `/settings` durch einen Owner mit workspace-weiter Datensicht: drei Offsets + fünf Erinnerungs-Vorlagen, zwölf Wartezeiten + `max_attempts` + vier Recycling-Vorlagen.
9. Ausgewertet wird nur die Kaskade — zwei zugeklappte Sektionen je im Setting- und Closing-Tab („Erinnerungs-Disziplin“, „Welcher Touch wirkt am stärksten?“); für das Recycling existiert **keine einzige** Kennzahl.
10. Die Textvorlagen liegen auf vier verschiedenen Modellen nebeneinander (Liste, Nutzer ohne UI, Workspace, hartkodiert) mit drei unterschiedlichen Platzhalter-Dialekten — das ist die größte konzeptionelle Baustelle des Bereichs.

---

## 2. Datenmodell (Migrationen 0031 und 0032)

### 2.1 Migration 0031 — `20260404000031_reminder_cascade.sql` (253 Zeilen, rein additiv, kein Backfill)

**Neue Spalten auf bestehenden Tabellen**

| Tabelle.Spalte | Typ | Constraints / Default | Zweck | Beleg |
|---|---|---|---|---|
| `setting_calls.wa_phone` | text | nullable, kein CHECK | persönliche WhatsApp-Nummer des Entscheiders (≠ `phone` = Einwahlnummer) | 0031:29-31 |
| `setting_calls.wa_consent_at` | timestamptz | nullable | dokumentierte Einwilligung (UWG-Pflicht) — Kanal WhatsApp nur mit **beiden** Feldern | 0031:29-31 |
| `closing_calls.follow_up_due_at` | timestamptz | nullable | uhrzeitgenauer Nachfass-Zeitpunkt; App-seitig mit `follow_up_due` synchron gehalten (`withFollowUpDateSynced`, closingCalls.ts:55-61), **kein** Trigger | 0031:45-46 |

**Neue Tabelle `reminder_settings`** (eine Zeile pro Organisation)

| Spalte | Typ | Constraints / Default | Beleg |
|---|---|---|---|
| `workspace_id` | uuid | **PRIMARY KEY**, FK → `workspaces` on delete cascade | 0031:63 |
| `offset_1_hours` | int | not null, default 72, check > 0 | 0031:65 |
| `offset_2_hours` | int | not null, default 24, check > 0 | 0031:66 |
| `offset_3_hours` | int | not null, default 1, check > 0 | 0031:67 |
| *(Tabellen-CHECK)* | — | `offset_1 > offset_2 > offset_3` (strikt absteigend, keine Stufe abschaltbar) | 0031:68 |
| `template_setting_reminder` | text | not null + deutscher Default | 0031:70-79 |
| `template_closing_reminder` | text | not null + Default | 0031:70-79 |
| `template_followup_reminder` | text | not null + Default | 0031:70-79 |
| `template_no_show_setting` | text | not null + Default | 0031:70-79 |
| `template_no_show_closing` | text | not null + Default | 0031:70-79 |
| `updated_at` | timestamptz | not null default now() — **kein** Trigger, nur App pflegt es | 0031:81 |
| `updated_by_user_id` | uuid | FK → `auth.users` on delete set null | 0031:82 |

Keine `id`-Spalte, kein `user_id`, kein Index außer PK, kein BEFORE-INSERT-Trigger.

**Neue Tabelle `reminder_touches`** (ein Touch je Zeile, polymorph)

| Spalte | Typ | Constraints / Default | Beleg |
|---|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` | 0031:153 |
| `workspace_id` | uuid | not null, FK → `workspaces` cascade | 0031:154 |
| `created_by_user_id` | uuid | nullable, FK → `auth.users` set null (Audit: real handelnde Person) | 0031:155 |
| `entity_type` | text | not null, CHECK in `setting` / `closing` / `closing_followup` | 0031:157 |
| `entity_id` | uuid | not null, **ohne FK** (polymorph, kein Cascade, kein Aufräum-Trigger) | 0031:158 |
| `touch_type` | text | not null, CHECK in `offset_1` / `offset_2` / `offset_3` / `no_show` | 0031:160 |
| *(Tabellen-CHECK)* | — | `no_show` nur bei `entity_type in ('setting','closing')` | 0031:164 |
| `assigned_user_id` | uuid | **nullable**, FK set null — Snapshot nach `personOf()` beim Erzeugen | 0031:166 |
| `due_at` | timestamptz | not null — Fälligkeit des Touches | 0031:168 |
| `appointment_at` | timestamptz | not null — **Snapshot** des Termins | 0031:171 |
| `channel` | text | nullable, CHECK `linkedin` / `telefon` / `whatsapp` | 0031:176 |
| `done_at` | timestamptz | nullable — manuelles Häkchen | 0031:181 |
| `done_by_user_id` | uuid | FK set null | 0031:182 |
| `superseded_at` | timestamptz | nullable — Soft-Delete statt Hard-Delete | 0031:184 |
| `created_at` | timestamptz | not null default now() (kein `updated_at`) | 0031:186 |

**Indizes:** `(workspace_id, due_at)`, `(entity_type, entity_id)`, `(workspace_id, assigned_user_id)` sowie `uq_reminder_touches_active` UNIQUE `(entity_type, entity_id, touch_type) WHERE superseded_at is null` (0031:189-201).
**Trigger:** `reminder_touches_bi` → bestehendes `set_workspace_and_creator()` (0031:203-206) — füllt `workspace_id`/`created_by_user_id`, **nicht** `assigned_user_id`; wirft für Plattform-Admins.
**RLS:** `reminder_settings` — select für jedes Mitglied, insert/update nur `role='owner'` (**ohne** `data_scope`-Prüfung), platform_admin FOR ALL, **keine** DELETE-Policy (0031:85-133). `reminder_touches` — `scoped_member` FOR ALL über `can_access_owned_workspace_row(ws, created_by)` **oder** `(ws, assigned_user_id)`, plus platform_admin (0031:208-227).

### 2.2 Migration 0032 — `20260404000032_lead_recycling.sql` (273 Zeilen, rein additiv, kein Backfill)

**Neue Spalten — identisch auf `contacts`, `phone_leads`, `setting_calls`, `closing_calls`** (0032:41-59)

| Spalte | Typ | Constraints / Default | Zweck |
|---|---|---|---|
| `next_recycle_at` | **date** | nullable, kein CHECK | Wiedervorlage-Datum (bewusst tagesgenau, keine Uhrzeit) |
| `recycle_attempt_count` | integer | not null default 0, **kein** CHECK ≥ 0 | Zähler gegen `max_attempts` |
| `recycle_excluded_at` | timestamptz | nullable | permanentes Opt-out, unabhängig von `contacts.blocked_at` |

**Indizes:** je Tabelle `(workspace_id, next_recycle_at) where next_recycle_at is not null` (0032:61-68).

**Neue Tabelle `recycle_settings`** (eine Zeile pro Organisation)

| Spalte | Typ | Default | Beleg |
|---|---|---|---|
| `workspace_id` | uuid | **PRIMARY KEY**, FK → `workspaces` cascade | 0032:82 |
| `days_timing` | int nn, check > 0 | 75 | 0032:85-96 |
| `days_preis` | int nn, check > 0 | 105 | |
| `days_kein_bedarf` | int nn, check > 0 | 105 | |
| `days_entscheider` | int nn, check > 0 | 150 | |
| `days_wettbewerb` | int nn, check > 0 | 270 | |
| `days_vertrauen` | int nn, check > 0 | 270 | |
| `days_ghosting_breakup` | int nn, check > 0 | 14 (kurzer Breakup-Touch) | |
| `days_ghosting` | int nn, check > 0 | 180 | |
| `days_sonstiges` | int nn, check > 0 | 120 | |
| `days_phone_dead` | int nn, check > 0 | 100 | 0032:102-104 |
| `days_setting_dead` | int nn, check > 0 | 100 | |
| `days_linkedin_exhausted` | int nn, check > 0 | 100 | |
| `max_attempts` | int nn | 2, CHECK `between 1 and 5` | 0032:106 |
| `template_recycle_linkedin` | text nn | deutscher Default | 0032:108-115 |
| `template_recycle_telefon` | text nn | Default | |
| `template_recycle_setting` | text nn | Default | |
| `template_recycle_closing` | text nn | Default | |
| `updated_at` | timestamptz nn | now(), kein Trigger | 0032:117 |
| `updated_by_user_id` | uuid | FK set null | 0032:118 |

Für `falsche_zielgruppe` existiert **bewusst keine** Spalte (0032:97-98). RLS wie 0031: select Mitglied, insert/update nur `role='owner'` (ohne `data_scope`), platform_admin FOR ALL, keine DELETE-Policy (0032:121-166).

**Neue RPC `recycle_tasks(p_workspace_id uuid, p_today date, p_effective_user_id uuid default null)`** — `plpgsql`, `stable`, `security definer`, `search_path = public`, `grant execute to authenticated` (0032:183-254).
Rückgabe: `origin text, entity_id uuid, owner_name text, lead_name text, company text, due_at date, reason text, attempt_count int`.
Vier UNION-ALL-Zweige, alle mit `workspace_id = p_workspace_id and next_recycle_at <= p_today and recycle_excluded_at is null`:

| Zweig | Quelle | `owner_name` | `lead_name` | `reason` | Besonderheit |
|---|---|---|---|---|---|
| `linkedin` | `contacts` + `lists` | `lists.owner_name` | `c.name` | Literal `fu_exhausted` | zusätzlich `blocked_at is null` |
| `telefon` | `phone_leads` + `phone_lists` | `phone_lists.owner_name` | `pl.decider_name` | Literal `dead` | Join über die **aktuelle** Liste |
| `setting` | `setting_calls` | **`null::text`** | `sc.lead_name` | Literal `dead` | Personenfilter `coalesce(assigned, created_by)` |
| `closing` | `closing_calls` | **`null::text`** | `cc.lead_name` | `coalesce(lost_reason_code,'sonstiges')` | einziger variabler Grund; **Status wird nicht geprüft** |

`nachfassen_tasks` bleibt unverändert (Signatur seit 0028) — die Union entsteht in JS (`getNachfassenTasks`), weil ein geänderter `RETURNS TABLE`-Typ `DROP FUNCTION` verlangt hätte (0032:171-176).

---

## 3. Abläufe

### 3.1 Erinnerungs-Kaskade: Auslöser → Touch-Erzeugung → Anzeige → Erledigung

1. **Auslöser Setting** — Termin entsteht oder verschiebt sich: `convertContactToSetting` (appointments.ts:228), `createManualSetting` (appointments.ts:319), `convertPhoneLeadToSetting` (appointments.ts:438), `rescheduleSetting` (settingCalls.ts:172-173), `moveSettingAppointment` per Kalender-Drag (settingCalls.ts:229 ← TermineBoard.tsx:160). Jeweils `generateSettingCascade(id)`.
2. **Auslöser Closing** — `createClosingFromSetting` in beiden Zweigen (settingCalls.ts:289-290 und 343-344) und `updateClosingCall` bei `call_at` im Patch (closingCalls.ts:103-106 ← ClosingCallEditor.tsx:589, TermineBoard.tsx:161). Jeweils `generateClosingCascade(closingId)`.
3. **Auslöser Nachfass-Kontakt** — Outcome „Nachfassen“ (closingCalls.ts:228-232) oder `follow_up_due_at` im Patch (closingCalls.ts:109-112) → `generateFollowUpCascade(closingId)` mit `entity_type='closing_followup'`.
4. **Frisches Nachlesen statt Parameter** — jede `generate*`-Funktion liest die Eltern-Zeile selbst, hart auf `workspace_id` gefiltert (reminders.ts:156-157, 188-189, 221-222); fehlt der Termin-Zeitpunkt, kehrt sie **ohne** Supersede zurück (reminders.ts:165, 197, 230).
5. **Kanal-Auflösung** — Setting: `resolveCascadeChannel(source_type)` liefert nur `linkedin`/`telefon`, alles andere `null` (reminderCascade.ts:63-67). Closing/Nachfass: `resolveFollowUpChannel` → `whatsapp` nur wenn `wa_phone.trim()` **und** `wa_consent_at` am verknüpften Setting gesetzt sind, sonst Rückfall auf den Akquise-Kanal (reminderCascade.ts:74-81, resolveClosingChannel reminders.ts:131-145).
6. **Fälligkeits-Rechnung** — `computeCascadeDueAts`: `due = appointment_at − offset_N × 3.600.000 ms`; aufgenommen werden **nur Touches, deren Fälligkeit noch in der Zukunft liegt** (reminderCascade.ts:89-110). Ein kurzfristig gebuchter Termin bekommt die frühen Stufen gar nicht, statt sie zu stauchen. Reine Millisekunden-Arithmetik, keine DST-Korrektur.
7. **Schreiben** — `regenerateOffsetTouches` (reminders.ts:98-128): erst `supersedeTouches(entity, id, OFFSET_TOUCHES)`, dann ein Array-Insert mit explizitem `workspace_id`, `created_by_user_id = access.user.id` und `assigned_user_id = assigned_user_id ?? created_by_user_id` des Eltern-Termins (Snapshot, nie live nachgeschlagen). Zwei getrennte Statements, keine Transaktion.
8. **No-Show-Sonderweg** — `setSettingOutcome` mit `no_show` (settingCalls.ts:126-127) bzw. echter Übergang im Closing (closingCalls.ts:88-95, 116-118) ruft `createNoShowTouch`: sofort fälliger Touch, `due_at = jetzt`, `channel` bewusst `null`, ein evtl. offener No-Show-Touch wird vorher superseded (reminders.ts:282-347).
9. **Anzeige** — `/erinnerungen` lädt über `getDueReminderTouches()` **alle** nicht-superseded Touches des Workspaces mit `assigned_user_id = effective_user_id ?? user.id`, sortiert nach `due_at`, **ohne Zeitfenster** (reminders.ts:383-440); Team-Ansicht nur für `role='owner' && data_scope='workspace'` (reminders.ts:389, erinnerungen/page.tsx:16). Kontext (lead_name/company/username) kommt aus zwei Nachschlägen (reminders.ts:409-429).
10. **Darstellung** — `bucketOf()` teilt client-seitig in Überfällig / Nächste Stunde / Heute / Diese Woche gegen ein minütlich nachgeführtes `nowMs` (ErinnerungenBoard.tsx:47-55, 250-256). Der Text wird bei **jedem** Rendern live gegen die aktuelle Org-Vorlage gerendert (`templateFieldFor` + `renderReminderTemplate`, ErinnerungenBoard.tsx:70-78), nie eingefroren.
11. **Erledigung** — `setReminderTouchDone(touchId, done)` prüft nur die Organisation, setzt `done_at`/`done_by_user_id` bzw. nullt beide, revalidiert `/erinnerungen` (reminders.ts:443-466). Rein manuell, kanalunabhängig, keine Verknüpfung zu `phone_call_attempts`.
12. **Entwertung** — jedes Ergebnis supersedet die drei Offsets (settingCalls.ts:126, closingCalls.ts:228); `rescheduleSetting` supersedet **alle** Arten inkl. No-Show (settingCalls.ts:172); Löschen ruft `deleteTouchesForEntity` (settingCalls.ts:391; closingCalls.ts:272-273 für beide entity_types).
13. **Auswertung** — `loadReminderTouches` (analyseData.ts:394-414) liest „erledigt ODER nicht superseded“ und speist die zwei zugeklappten Sektionen im Setting-Tab (SettingTab.tsx:269-272, 435-532, 896-960) und Closing-Tab (ClosingTab.tsx:197-201, 346-443, 812-875).

### 3.2 Recycling: terminal negativ → `next_recycle_at` → Wiedervorlage → Ausschluss

1. **Terminal-Ereignis** an genau vier Stellen: Closing „Verloren“ → `scheduleRecycle('closing', id, lostReasonCode)` (closingCalls.ts:240) · Setting „Dead“ → `scheduleRecycle('setting', id, null)` (settingCalls.ts:132) · Telefon-Outcome „Dead“ → `scheduleRecycle('telefon', id, null)` (phone.ts:351) · LinkedIn nach FU3 ohne Antwort → `scheduleRecycle('linkedin', id, null)` aus **beiden** Schreibpfaden (nachfassen.ts:323 und contacts.ts:206-215).
2. **Frist-Rechnung** — `computeNextRecycleAt(origin, reason, 0, settings, localDateISO())` → `recycleIntervalDays` (recycleCadence.ts:104-136): die drei Nicht-Closing-Ursprünge ignorieren `reason` und nehmen den generischen Wert; nur `closing` schaut auf den Code. `falsche_zielgruppe` → `null` (nie Recycling), `ghosting` zweistufig über `attemptNumber` (14 → 180 Tage), Default deckt `sonstiges` und fehlenden Code ab.
3. **Speichern** — `scheduleRecycle` (recycle.ts:111-131) schreibt `{ next_recycle_at, recycle_attempt_count: 0 }` auf die Ursprungszeile, gefiltert auf `id` **und** `workspace_id`; komplett fail-soft (try/catch, nur `console.error`) — ein misslungenes Recycling darf das Outcome nie blockieren.
4. **Fälligkeit** — `recycle_tasks(ws, today, eff)` liefert die vier Zweige (§2.2), gelesen über `loadRecycleTasksRaw` mit `fetchAllRows` und eigenem `catch → []` (recycle.ts:230-247).
5. **Union** — `getNachfassenTasks()` (nachfassen.ts:60-240) ruft erst `nachfassen_tasks`, dann `recycle_tasks` und mischt beide in JS; die Anreicherung (Lead-Daten aus `contacts`/`phone_leads`, Vorlagen) läuft in bis zu acht sequenziellen 200er-Batches (nachfassen.ts:91-142, 189-204).
6. **Text** — `renderRecycleTemplate(recycleSettings[recycleTemplateField(origin)], …)` füllt `{vorname}` (Fallback „dir“), `{firma}` (Fallback Leerstring) und `{anlass}` aus `RECYCLE_REASON_HINTS` (5 Gründe) bzw. dem neutralen Fallback-Satz (nachfassen.ts:207-211, recycleCadence.ts:84-92, 175-184).
7. **Anzeige** — fünfte Sektion in `/nachfassen` über alle vier Ursprünge zusammen; der Ursprung steht nur als Badge auf der Karte, dazu Grund-Label und „Versuch N+1“ (NachfassenBoard.tsx:342-359, 803-808).
8. **Wiedervorlage** — „Nochmal versucht“ → `markRecycleContacted` (recycle.ts:154-184): `nextAttempt = count + 1`; ist `nextAttempt >= max_attempts`, wird `next_recycle_at = null` (Recycling endet endgültig), sonst neue Frist mit `attemptNumber = nextAttempt`. Der Deckel wirkt **ausschließlich hier**, nicht in der RPC.
9. **Stoppen** — „Reagiert“ → `markRecycleResponded` (recycle.ts:187-200) setzt **nur** `next_recycle_at = null`; Status (`dead`/`verloren`), `recycle_attempt_count` und FU-Stand bleiben unverändert.
10. **Ausschluss** — „Endgültig raus“ → `excludeFromRecycle` (recycle.ts:203-216) setzt `next_recycle_at = null` **und** `recycle_excluded_at = now()`; alle vier RPC-Zweige filtern zusätzlich `recycle_excluded_at is null`.
11. **Auswertung** — existiert nicht: `grep -i recycle` über `src/lib/analyseData.ts`, `src/lib/analyse.ts`, `src/components/analyse/` und `src/lib/compare/` liefert null Treffer.

---

## 4. Textvorlagen und Mandantenfähigkeit

**Der wichtigste Abschnitt.** Vier Speichermodelle und drei Platzhalter-Dialekte stehen auf demselben Bildschirm nebeneinander.

| Nachrichtenart | Wo gespeichert (Tabelle.Spalte) | Ebene | Wer darf editieren | Platzhalter | UI-Ort (Pflege → Anzeige) |
|---|---|---|---|---|---|
| **LinkedIn FU1** | 1. `lists.fu1_text` · 2. `followup_templates.body` (`fu_number=1`) · 3. hartkodiert `nachfassen.ts:40-53` | 1. **Liste** (Vorrang) · 2. **Nutzer** · 3. Code | Listen-Text: wer die Liste bearbeiten darf · Nutzer-Vorlage: **niemand mehr** (Karte entfernt, `setFollowupTemplateForm` ohne Aufrufer) | `{name}` (nur in 1 und 2; der Code-Default baut die Anrede selbst) | Pflege: Listen-Editor → Anzeige: `/nachfassen`, Sektion „FU1“ |
| **LinkedIn FU2** | 1. `lists.fu2_text` · 2. `followup_templates.body` (`fu_number=2`) · 3. Code | Liste > Nutzer > Code | wie FU1 | `{name}` | Listen-Editor → `/nachfassen`, Sektion „FU2“ |
| **LinkedIn FU3** | 1. `lists.fu3_text` · 2. `followup_templates.body` (`fu_number=3`) · 3. Code | Liste > Nutzer > Code | wie FU1 | `{name}` | Listen-Editor → `/nachfassen`, Sektion „FU3“ |
| **Setting-Erinnerung** | `reminder_settings.template_setting_reminder` | **Workspace** (PK = `workspace_id`, eine Zeile/Org) | App: `role='owner' && data_scope='workspace'` (`access.can_switch_view`) · RLS: nur `role='owner'` | `{vorname}` `{firma}` `{datum}` `{uhrzeit}` | `/settings`, Karte „Erinnerungs-Kaskade“ → `/erinnerungen`, Touch `offset_1..3` auf einem Setting |
| **Closing-Erinnerung** | `reminder_settings.template_closing_reminder` | Workspace | wie oben | `{vorname}` `{firma}` `{datum}` `{uhrzeit}` | `/settings` → `/erinnerungen`, `entity_type='closing'` |
| **Nachfass-Erinnerung** | `reminder_settings.template_followup_reminder` | Workspace | wie oben | `{vorname}` `{firma}` `{datum}` `{uhrzeit}` | `/settings` → `/erinnerungen`, `entity_type='closing_followup'` |
| **No-Show Setting** | `reminder_settings.template_no_show_setting` | Workspace | wie oben | `{vorname}` `{firma}` `{datum}` `{uhrzeit}` | `/settings` → `/erinnerungen`, Touch `no_show` auf einem Setting |
| **No-Show Closing** | `reminder_settings.template_no_show_closing` | Workspace | wie oben | `{vorname}` `{firma}` `{datum}` `{uhrzeit}` | `/settings` → `/erinnerungen`, Touch `no_show` auf einem Closing |
| **Recycling LinkedIn** | `recycle_settings.template_recycle_linkedin` | **Workspace** (PK = `workspace_id`) | App: `access.can_switch_view` · RLS: nur `role='owner'` | `{vorname}` `{firma}` `{anlass}` (`{anlass}` **nicht** editierbar, kommt aus `RECYCLE_REASON_HINTS`) | `/settings`, Karte „Recycling“ → `/nachfassen`, Recycling-Karte `origin='linkedin'` |
| **Recycling Telefon** | `recycle_settings.template_recycle_telefon` | Workspace | wie oben | `{vorname}` `{firma}` `{anlass}` | `/settings` → `/nachfassen`, `origin='telefon'` |
| **Recycling Setting** | `recycle_settings.template_recycle_setting` | Workspace | wie oben | `{vorname}` `{firma}` `{anlass}` | `/settings` → `/nachfassen`, `origin='setting'` |
| **Recycling Closing** | `recycle_settings.template_recycle_closing` | Workspace | wie oben | `{vorname}` `{firma}` `{anlass}` | `/settings` → `/nachfassen`, `origin='closing'` |
| *(zusätzlich)* **Telefon-Rückruf** | hartkodiert `nachfassen.ts:167-176` | **keine** (Code) | **niemand** | keine (Beschreibungstext, kein Nachrichtentext) | — → `/nachfassen`, Sektion „Rückrufe“ |
| *(zusätzlich)* **Setting-Wiedervorlage** | hartkodiert `nachfassen.ts:167-176` | keine (Code) | niemand | keine | — → `/nachfassen`, Sektion „Setting (No-Show & Unqualifiziert)“ |
| *(zusätzlich)* **Closing-Wiedervorlage** | hartkodiert `nachfassen.ts:167-176` | keine (Code) | niemand | keine | — → `/nachfassen`, Sektion „Closing“ |

**Mandantenfähigkeit — was daraus folgt**

- **Keine Pro-Nutzer-Ebene für Erinnerungen und Recycling.** Beide Tabellen haben `workspace_id` als Primärschlüssel und außer `updated_by_user_id` keinerlei Nutzerbezug (0031:63, 0032:82). Ein Mitglied kann sich weder eigene Texte noch eigene Offsets/Wartezeiten einstellen; die Boards rendern read-only und bieten nur „Kopieren“.
- **Lesen ist bewusst für jedes Mitglied offen** (`*_select_member`), weil jeder die Vorlagen zum Rendern seiner eigenen Karten braucht — `getReminderSettings`/`getRecycleSettings` haben deshalb kein Rollen-Gate (reminders.ts:49-53, recycle.ts:39-43).
- **Schreiben ist zweistufig und ungleich streng:** App verlangt `role='owner' && data_scope='workspace'` (access.ts:146, settings/page.tsx:137, reminders.ts:61, recycle.ts:49), die RLS nur `role='owner'`. Ein Owner mit `data_scope='own'` wird von der UI ausgesperrt, dürfte per direktem PostgREST-Call aber schreiben.
- **Vorlagen sind live, Zeiten sind eingefroren.** Eine geänderte Textvorlage wirkt sofort auf jeden bereits erzeugten, offenen Touch (ErinnerungenBoard.tsx:70-78); ein geänderter Offset bzw. eine geänderte Wartezeit wirkt **nur** auf künftig erzeugte Touches bzw. künftige Terminal-Ereignisse.
- **Kein Seeding, doppelte Defaults.** Weder `bootstrap_workspace` noch `platform_create_workspace` legen eine Settings-Zeile an; bis zum ersten Speichern gelten ausschließlich die TS-Konstanten `DEFAULT_REMINDER_SETTINGS` (reminderCascade.ts:42-54) und `DEFAULT_RECYCLE_SETTINGS` (recycleCadence.ts:38-60), die die SQL-Defaults zeichengenau duplizieren.
- **Plattform-Admins editieren Kundendaten.** `getAccessContext` synthetisiert in fremder Organisation `role='owner'` + `data_scope='workspace'` (access.ts:109-125), zusätzlich greifen die `*_platform_admin`-FOR-ALL-Policies (0031:130-133, 0032:163-166) — beide Karten erscheinen dort normal und schreiben in die Kunden-Organisation, `updated_by_user_id` bekommt die Admin-UID.
- **Das einzige Pro-Nutzer-Vorbild im Repo** ist `followup_templates` (Migration 0011:40-62): `(workspace_id, user_id, fu_number, body)` mit `unique (user_id, fu_number)`, RLS über `can_access_owned_workspace_row(workspace_id, user_id)`, Schreiben für `effective_user_id ?? user.id` (templates.ts:40). Genau dieses Muster wäre die Vorlage für eine spätere Nutzer-Override-Ebene der Erinnerungs-/Recycling-Texte — mit derselben Vorrangkette wie `followUpTextFor` (nachfassen.ts:245-257).

---

## 5. Bekannte Lücken (dedupliziert, nach Schwere)

### 5.1 Hoch

| # | Lücke | Beleg |
|---|---|---|
| H1 | **Recycling wird nie zurückgenommen, wenn ein Lead auf anderem Weg wiederbelebt wird.** `recycle_tasks` filtert nur auf `next_recycle_at`/`recycle_excluded_at`, nie auf den Status; kein Schreibpfad nullt das Datum bei „gewonnen“, „nachfassen“, `rescheduleSetting`, `setPhoneLeadOutcome('aktiv')` oder `markLinkedInAnswered`. Ein gewonnener Deal taucht Monate später als Recycling-Aufgabe auf; ein von „verloren“ auf „nachfassen“ gedrehtes Closing steht gleichzeitig in zwei Sektionen. | 0032:213-250 vs. closingCalls.ts:183-202/240, settingCalls.ts:157-165, phone.ts:331-351, nachfassen.ts:272-275 |
| H2 | **Zombie-No-Show-Touches im Setting.** `updateSettingCall` (settingCalls.ts:71-79) fasst keine Touches an, obwohl sein Patch-Typ `appointment_at`, `show_status`, `status`, `wa_phone`, `wa_consent_at` trägt. Folge: „Show“ nach No-Show (SettingCallEditor.tsx:248-257) und „Ergebnis zurücksetzen“ (266-279, setzt sogar `no_show_count:0`) lassen den sofort fälligen No-Show-Touch aktiv stehen. | settingCalls.ts:71-79 gegen closingCalls.ts:103-118 |
| H3 | **Symmetrisch beim Closing:** die Rücknahme eines No-Shows (`handleShowStatus`-Toggle auf `null`, `handleReset`) entwertet den No-Show-Touch nicht — geprüft wird nur der Übergang **nach** `no_show`. | closingCalls.ts:116-118; ClosingCallEditor.tsx:338-342, 346-380 |
| H4 | **Beide Settings-Formulare verschlucken jeden Fehler.** `updateReminderSettingsForm` und `updateRecycleSettingsForm` geben `Promise<void>` zurück und werfen das `{error}` weg; das Feedback-Banner der Seite deckt nur die Nutzerverwaltung ab. Praktisch: eine verletzte Offset-Reihenfolge (DB-CHECK) oder `max_attempts > 5` scheitert stumm, das Feld springt auf den alten Wert. | reminders.ts:84-94, recycle.ts:86-96, settings/page.tsx:150-158; CHECKs 0031:68, 0032:106 |
| H5 | **Vier Vorlagen-Modelle und drei Platzhalter-Dialekte auf einem Bildschirm** (§4): Liste > Nutzer > Code für LinkedIn, Workspace für Erinnerungen und Recycling, gar nichts für Telefon-Rückruf/Setting-/Closing-Wiedervorlage. `{name}` vs. `{vorname}/{firma}/{anlass}` vs. `{vorname}/{firma}/{datum}/{uhrzeit}` — ein zwischen den Feldern kopierter Text rendert den rohen Platzhalter, ohne Warnung. | nachfassen.ts:167-176/245-256 vs. recycleCadence.ts:180-183 vs. settings/page.tsx:410-413, 512-514 |
| H6 | **Der Closing-Tab mischt `closing_followup`-Touches in die Show-Quoten-Auswertung des Closing-Gesprächs.** Beide entity_types tragen dieselbe `entity_id` und dieselben Touch-Arten; die Schleife filtert nur `touch_type !== 'no_show'`. Ein Nachfass-Touch entsteht aber erst **nach** dem Closing und kann dessen `show_status` unmöglich beeinflusst haben — zusätzlich zählt ein Closing mit beiden Kaskaden doppelt. | ClosingTab.tsx:349-350, 364, 388-401; Erzeugung reminders.ts:233-239 |
| H7 | **Fehlende Migration ist von „nichts fällig“ nicht unterscheidbar.** Es gibt keinen `available:false`-Fallback wie beim Anruf-Log: `/erinnerungen` zeigt den grünen Erfolgs-Leerzustand „Nichts offen“, die Analyse-Sektionen „0 fällig · 0 überfällig“, `/settings` die vollen TS-Defaults — und jedes Speichern scheitert lautlos. Da 0031/0032 nirgends eingespielt sind, ist genau das der heutige Ist-Zustand. | reminders.ts:40-45/392-406, recycle.ts:30-35/243-246, analyseData.ts:409-412; Gegenmuster phoneAttemptsData.ts:50,122 |
| H8 | **`/erinnerungen` hat kein Zeitfenster.** Geladen wird jeder nicht-superseded Touch der Person, ohne obere Grenze und ohne `done_at`-Filter; der Bucket „Diese Woche“ ist das Auffangbecken für alles Zukünftige (ein Touch in fünf Wochen steht dort), und „Bereits erledigt“ wächst unbegrenzt. Der Seitentitel „Meine Erinnerungen **heute**“ trifft damit nicht zu. | reminders.ts:394-402; ErinnerungenBoard.tsx:47-55, 266-267, 341-353 |

### 5.2 Mittel

| # | Lücke | Beleg |
|---|---|---|
| M1 | Nach „Ergebnis zurücksetzen“ kommt die Bestätigungs-Kaskade nicht zurück — die Offsets wurden beim Outcome superseded, der Reset regeneriert nichts. Ein wieder offener Zukunftstermin steht dauerhaft ohne Erinnerungen da. | SettingCallEditor.tsx:278, ClosingCallEditor.tsx:364-379 gegen settingCalls.ts:126 / closingCalls.ts:228 |
| M2 | Geänderte Offsets und Wartezeiten wirken nicht auf bestehende Touches / gesetzte `next_recycle_at` — anders als die Vorlagen, die live rendern. Nirgends als Absicht notiert. | reminders.ts:56-79 (kein Regenerate) gegen ErinnerungenBoard.tsx:70-78; recycle.ts:120, 171-175 |
| M3 | `scheduleRecycle` setzt `recycle_attempt_count` bei **jedem** Aufruf auf 0 zurück und prüft `recycle_excluded_at` nicht. Ein zweites „Verloren“ startet den `max_attempts`-Deckel neu; eine ausgeschlossene Zeile bekommt wieder ein Datum → Invariante §8 verletzt. | recycle.ts:120-126; 0032:41-59 (Spalten ohne CHECK) |
| M4 | `setAssignee` aktualisiert `reminder_touches.assigned_user_id` nicht. Für erledigte Touches ist der Snapshot gewollt; für **offene, zukünftige** bedeutet es: der Termin gehört Person B, die Erinnerungen bleiben bei A — und bei `data_scope='own'` sieht B sie nie. | assignees.ts:44-83 (kein reminders-Import); Filter reminders.ts:400 |
| M5 | Nachträglich erfasster (oder zurückgezogener) WhatsApp-Consent ändert den Kanal bestehender Touches nicht — `channel` wird beim Insert eingefroren, `updateSettingCall` ruft keine Kaskade. Der Zweck, die Nummer erst im Setting einzusammeln, verpufft für diesen Termin. | reminders.ts:131-145, 199, 232; SettingCallEditor.tsx:671-697 |
| M6 | **Zeitzonen-Bruch:** `p_today`, der 7-Tage-Cutoff und alle Recycling-Datumsrechnungen laufen über `localDateISO()` (Server-TZ, auf Vercel UTC); `bucketOf` rechnet in der **Browser**-TZ; der Rest der App bucketet laut docs §6 über `berlinDateISO`. Zwischen 00:00 und 02:00 Berliner Zeit fragt der Server den Vortag ab. | dates.ts:2-7; nachfassen.ts:77/146/311; recycle.ts:120/175/239; ErinnerungenBoard.tsx:51-53 |
| M7 | `clearContactAppointment` („Termin zurücknehmen“ im LinkedIn-Board) lässt die Kaskade laufen — die Erinnerung mahnt einen Termin an, den der Nutzer gerade zurückgenommen hat. | appointments.ts:474-489; ListBoardV2.tsx:1422 |
| M8 | `regenerateOffsetTouches` ist nicht transaktional: Supersede und Insert sind zwei Statements gegen `uq_reminder_touches_active`. Zwei dicht aufeinanderfolgende Auslöser lassen den ganzen Array-Insert scheitern — fail-soft heißt: `console.error`, und der Termin steht ohne Kaskade da. | reminders.ts:109-127 gegen 0031:199-201 |
| M9 | **Kein einziger Analyse-Block für Recycling.** Keine Wiederbelebungsquote, keine Auswertung von `recycle_attempt_count`/`recycle_excluded_at` — also keine Grundlage, die org-weiten Wartezeiten begründet zu ändern. | `grep -i recycle` über analyseData.ts, analyse.ts, components/analyse/, lib/compare/ → 0 Treffer |
| M10 | `markRecycleResponded` heißt „Lead ist wieder im Spiel“, stoppt aber nur das Recycling: Status bleibt `dead`/`verloren`, FU-Stand bleibt bei 3. Wer reagiert hat, verschwindet aus jeder Liste, statt irgendwo als aktiver Lead aufzutauchen. | recycle.ts:186-200; Button NachfassenBoard.tsx:562 |
| M11 | Der Quellenfilter `?quelle=` des Setting-Tabs wirkt **nicht** auf die Erinnerungs-Disziplin — kanal-gefilterte Termine stehen neben ungefilterten Erinnerungszahlen, ohne Meta-Hinweis. | SettingTab.tsx:340 vs. 460-491, Meta 904 |
| M12 | Keine Badge-Zähler in der Navigation und keine zusammenführende Übersicht: `NavLink` hat kein `badge`-Prop, das Dashboard-Layout lädt keine Fälligkeiten, `/` verlinkt `/erinnerungen` gar nicht, `/termine` blendet keine Touches ein, die Vergleichsseite kennt keine Kennzahl. | Sidebar.tsx:108-140, 947-960; layout.tsx:24-51; `grep href=` in (dashboard)/page.tsx |
| M13 | `followup_templates` ist eine Pro-Nutzer-Tabelle **ohne UI**: die Settings-Karte wurde entfernt, `setFollowupTemplateForm` hat keinen Aufrufer — Altbestände wirken aber weiter und schlagen den Standardtext, ohne dass die Quelle irgendwo sichtbar ist. | settings/page.tsx:520-525; templates.ts:69-73; Lesepfad nachfassen.ts:117-125 |
| M14 | RLS-Schreibgate lockerer als App-Gate: `reminder_settings`/`recycle_settings` prüfen nur `role='owner'`, nicht `data_scope='workspace'` — im Widerspruch zu docs §3. | 0031:100-128, 0032:133-161 vs. access.ts:146, reminders.ts:61, recycle.ts:49 |
| M15 | `reminder_touches.assigned_user_id` ist nullable, obwohl Invariante §8 und der Verifikationsblock der Migration 0 fordern — kein `not null`, kein Trigger; `set_workspace_and_creator()` füllt die Spalte nicht. | 0031:166, 245-247; 0025:222-240 |
| M16 | Keine Constraints auf den 12 Recycling-Spalten: kein gegenseitiger Ausschluss `recycle_excluded_at`/`next_recycle_at`, kein Guard gegen `falsche_zielgruppe` mit Datum, kein `attempt_count >= 0`. Sämtliche Fachregeln hängen an TypeScript. | 0032:41-59; docs §8 formuliert beides nur als Prüf-Query |
| M17 | `entity_id` ist polymorph ohne FK **und ohne Aufräum-Trigger**: ein direkter DB-Delete oder ein vergessener Aufrufpfad hinterlässt Karteileichen, die kein Invarianten-Check findet. | 0031:158; reminders.ts:271-274 |
| M18 | Nutzer-Umzug (0026, 14 Tabellen) und Lösch-Vorschau (0027, 13 Tabellen) kennen `reminder_settings`, `reminder_touches` und `recycle_settings` nicht. Nach einem Umzug bleiben Touches in der alten Org mit `assigned_user_id` auf einen dortigen Nicht-Mitglied; ein Pendant zu `assigned_user_guard` (0028) fehlt. | `grep 'reminder|recycle'` in 0026/0027 → 0 Treffer; FKs 0031:63/154, 0032:82 |
| M19 | **Kein Backfill** (bewusst): Termine vor dem Einspielen haben nie Touches — die Blöcke „Erinnerungs-Disziplin“ beschreiben das Deploy-Datum, nicht die Arbeitsweise. Anders als beim Anruf-Log fängt die UI das nicht mit „—“ ab. | 0031:8-12, 242-243; 0032:19-21, 260-273 |
| M20 | **Kein einziger Test** — im Repo gibt es keine `*.test.ts`. `computeCascadeDueAts`, `templateFieldFor`, `resolveFollowUpChannel`, `recycleIntervalDays` sind reine Funktionen und wären trivial testbar. | Suche `src/**/*.test.ts` → 0 Treffer; gesamte Kaskade aus einem Commit |
| M21 | `setReminderTouchDone` verwirft seinen Rückgabewert: bei einem Fehlschlag bleibt das Häkchen optimistisch gesetzt und die Karte wandert nach „Bereits erledigt“ — korrigiert erst durch vollen Reload. | ErinnerungenBoard.tsx:82-88, 259-264; reminders.ts:463 |
| M22 | Doppelte Defaults ohne Kopplung (SQL-DEFAULT vs. TS-Konstante), kein Seeding bei Workspace-Anlage — bis zum ersten Speichern gilt ausschließlich die TS-Kopie, eine Änderung nur in der SQL-Datei bliebe wirkungslos. | reminderCascade.ts:42-54 vs. 0031:65-79; recycleCadence.ts:38-60 vs. 0032:85-117 |
| M23 | Textvorlagen werden weder getrimmt noch auf Nicht-Leere geprüft — ein leeres Textarea speichert `''` (erfüllt `not null`) und die Erinnerung rendert eine leere Nachricht. `setFollowupTemplate` macht es besser (leer = löschen → Standard). | reminders.ts:91-92, recycle.ts:93-94 vs. templates.ts:42-50 |
| M24 | Keine Kanalwahl trotz Badge „Kanal frei wählen“, kein Snooze, kein Verschieben, kein Verwerfen einzelner Touches — die einzige Mutation der Seite ist das Erledigt-Häkchen. | ErinnerungenBoard.tsx:4, 124-126; `channel` wird nur in reminders.ts:122/341 geschrieben |
| M25 | Platzhalter werden nur als Kleinschrift-Zeile erklärt: kein InfoPopover, keine Live-Vorschau, keine Prüfung auf Tippfehler; `renderReminderTemplate` ersetzt case-sensitiv, `{Vorname}` bleibt wörtlich stehen. `{firma}` wird in keinem der fünf Default-Texte benutzt, `{anlass}` ist nicht beeinflussbar. | settings/page.tsx:410-413, 512-514; reminderCascade.ts:143-153; recycleCadence.ts:84-92 |
| M26 | `updateSettingCall` akzeptiert `appointment_at` im Patch-Typ ohne Regeneration — heute schickt kein Aufrufer das durch, aber der nächste Schreibpfad ließe die Touches auf dem alten Termin stehen (latente Falle). | settingCalls.ts:40, 71-79 gegen closingCalls.ts:103-106 |
| M27 | `max_attempts` wird serverseitig nur nach unten geklemmt (`Math.max(1, …)`), die DB-Obergrenze 5 kennt nur das HTML-Attribut — mit H4 zusammen: stiller Fehlschlag. | recycle.ts:91; 0032:106; settings/page.tsx:463 |

### 5.3 Niedrig

| # | Lücke | Beleg |
|---|---|---|
| N1 | Die Fälligkeit (`due_at`) steht auf keiner Karte — sichtbar ist nur `appointment_at`; in „Heute“/„Diese Woche“ bleibt offen, wann der Touch fällig ist. | ErinnerungenBoard.tsx:79, 139-140 |
| N2 | `computeCascadeDueAts` rechnet in reinen Millisekunden ohne DST-Korrektur — über eine Zeitumstellung liegt der 24-h-Touch in Berliner Wandzeit eine Stunde daneben. | reminderCascade.ts:106 gegen apptTime.ts:40-50 |
| N3 | „Überfällig“ in der Analyse ist ein lexikografischer String-Vergleich (`due_at < nowIso`), kein Date-Vergleich. | SettingTab.tsx:459/471, ClosingTab.tsx:371/383 |
| N4 | Zwei `.or()`-Aufrufe auf derselben Query (Touch-Zustand + Personen-Scope) — einzige solche Stelle in `analyseData.ts`; ohne laufende DB nicht verifizierbar, der Personen-Scope könnte still wirkungslos sein. | analyseData.ts:406-407 |
| N5 | `supersedeTouches` filtert als einziger Schreibpfad **nicht** auf `workspace_id` und verlässt sich allein auf RLS — für Plattform-Admins lässt die Policy alles durch. | reminders.ts:256-263 vs. 156-157/188-189/296-297/451-452 |
| N6 | `setReminderTouchDone` prüft nur die Organisation, nicht die Zuständigkeit: ein Mitglied mit `data_scope='workspace'` kann fremde Erinnerungen abhaken, obwohl die Team-Ansicht nur Ownern angeboten wird. | reminders.ts:448-462; 0031:214-222 |
| N7 | `markRecycleContacted` nimmt den `reason` vom Client (`task.recycle_reason`) statt ihn serverseitig aus `lost_reason_code` zu lesen — jede beliebige Wartezeit auslösbar, und ein verlorener Grund fällt still auf `days_sonstiges`. | NachfassenBoard.tsx:538-542; recycle.ts:154-175 |
| N8 | Die Konstante der drei Offset-Typen existiert dreifach: `REMINDER_OFFSET_TOUCHES` plus je ein lokales `OFFSET_TOUCHES` in `settingCalls.ts` und `closingCalls.ts`. | reminderCascade.ts:20; settingCalls.ts:17; closingCalls.ts:19 |
| N9 | `{firma}` fällt auf einen Leerstring zurück, `{datum}`/`{uhrzeit}` auf „—“ — eine eigene Vorlage „Hallo {vorname} von {firma}," ergibt „Hallo dir von ,". | reminderCascade.ts:149-152 |
| N10 | Beschriftungen laufen dem Umfang hinterher: Meta-Zeile von `/nachfassen` nennt nur „LinkedIn, Telefon und Closing“ (ohne Setting und Recycling), der Sidebar-Tooltip nennt kein Recycling, der Datei-Kopfkommentar ebenso. | nachfassen/page.tsx:25; Sidebar.tsx:959; NachfassenBoard.tsx:29-30 |
| N11 | Die Abgrenzung Erinnerungen/Nachfassen existiert nur als HTML-`title` — im Mobile-Drawer (Touch) erscheint kein Tooltip, dort stehen zwei ähnlich klingende Zeilen kommentarlos untereinander. | Sidebar.tsx:133; MobileHeader.tsx:7,40 |
| N12 | Die Analyse-Sektionen verlinken nicht zurück nach `/erinnerungen`, und von dort führt kein Weg in die Auswertung. | SettingTab.tsx:907-915; ClosingTab.tsx:822-830 |
| N13 | `getNachfassenTasks` feuert bis zu acht sequenzielle Roundtrips (for-Schleifen mit `await`) zusätzlich zu den beiden RPCs — das ist die Latenz der Seite. | nachfassen.ts:95-142, 189-204 |
| N14 | Board und Analyse lesen `reminder_touches` mit unterschiedlichem Personenfilter (`.eq(assigned_user_id)` vs. `assignedOrCreatedBy()`); ein Touch mit `assigned_user_id = null` wäre auf `/erinnerungen` unsichtbar, in der Analyse zählbar. | reminders.ts:400 vs. analyseData.ts:193-195, 407 |
| N15 | Kein Index deckt die Hauptabfrage von `/erinnerungen` ab (`workspace_id` + `superseded_at is null` + `assigned_user_id`, sortiert nach `due_at`). | 0031:189-194; reminders.ts:394-402 |
| N16 | Fehlende Konsistenz-CHECKs in `reminder_touches`: kein `due_at <= appointment_at`, kein gekoppeltes `done_at`/`done_by_user_id`, keine Plausibilisierung von `channel`. | 0031:168-182 |
| N17 | Die Kaskade ist starr dreistufig — alle drei Offsets `not null` und strikt absteigend, keine Stufe abschaltbar, keine Obergrenze. | 0031:65-68 |
| N18 | Keine DELETE-Policy auf `reminder_settings`/`recycle_settings` für Owner — nur Plattform-Admins (FOR ALL) und der FK-Cascade; nirgends als Entscheidung begründet. | 0031:89-133; 0032:123-166 |
| N19 | `updated_at` beider Settings-Tabellen wird von keinem Trigger gepflegt (nur von der Server-Action) — eine direkte SQL-Änderung macht das Audit-Feld unzuverlässig. | 0031:81-82, 0032:117 vs. 0008:214-217 |
| N20 | `owner_name` ist in den RPC-Zweigen `setting` und `closing` fest `null::text` — für zwei der vier Ursprünge zeigt die Karte keine zuständige Person, obwohl sie auflösbar wäre. | 0032:233, 243; nachfassen.ts:223 |
| N21 | `generate*Cascade` kehrt bei fehlendem Termin-Zeitpunkt zurück, **ohne** zu superseden — an drei Aufrufstellen abgefangen, an sechs nicht. | reminders.ts:165, 197, 230 |
| N22 | Kein Auslöser im Telefon-/LinkedIn-Funnel: `phone.ts`, `contacts.ts` und `nachfassen.ts` importieren nichts aus `reminders.ts` — ein Lead, der auf `dead` gesetzt wird, während an ihm eine laufende Kaskade hängt, entwertet deren Touches nicht. | `grep "actions/reminders" src/` → nur appointments/settingCalls/closingCalls + UI |
| N23 | `preview_delete_workspace()` zählt weiter 13 Tabellen; docs §2 nennt „15 Cascade-FKs“ — mit 0031 (2) und 0032 (1) sind es mehr. Gelöscht wird trotzdem alles. | 0027:67-79; 0031:63/154; 0032:82 |
| N24 | Erster Paint zeigt kurz nichts (`nowMs === null` → alle Buckets leer, aber `open.length > 0`, also auch kein Leerzustand) — im Code als bewusster „Wimpernschlag“ kommentiert. | ErinnerungenBoard.tsx:271-277 |
| N25 | Für Owner laufen bei jedem Aufruf zwei überlappende Abfragen (mine ⊂ team); die Team-Ansicht hat weder Personenfilter noch Gruppierung. | erinnerungen/page.tsx:17-21; ErinnerungenBoard.tsx:141-145 |
| N26 | Die Vorlagen, gegen die jeder Nutzer seine Karten gerendert bekommt, sind für Nicht-Owner nicht einsehbar; der `/settings`-Link in der Sidebar ist ungegatet und führt Mitglieder auf eine fast leere Seite. | settings/page.tsx:137, 140, 342; Sidebar.tsx:1159 |
| N27 | Lesepfad der Nutzer-Vorlagen in `nachfassen.ts` filtert nur `user_id` ohne `workspace_id` (anders als `getFollowupTemplates`); `setFollowupTemplate` löscht ebenfalls ohne `workspace_id`. | nachfassen.ts:120-123 vs. templates.ts:18-22, 44-50 |
| N28 | Reihenfolge der `RECYCLE_DAY_FIELDS` widerspricht ihrem eigenen Kommentar („kurze Wartezeit zuerst“): `days_sonstiges` (120) steht vor den 100er-Feldern. | settings/page.tsx:49-65 |

---

## 6. Offene Risiken beim Rollout

1. **Beide Migrationen sind nicht eingespielt und laufen nicht automatisch.** `0031` und `0032` müssen von Hand im Supabase-SQL-Editor ausgeführt werden und liegen zusätzlich nur auf `feature/erinnerungs-kaskade`. `0032` setzt `0031` voraus (die App-Union in `getNachfassenTasks()` erwartet beide RPCs), `0031` setzt `0025`/`0030` voraus (`workspaces`, `auth.users`, `set_workspace_and_creator()`, `can_access_owned_workspace_row()`, `is_platform_admin()`). **Reihenfolge: Merge → Migration → Deploy** — umgekehrt scheitert das Schreiben von `wa_phone`/`wa_consent_at`/`follow_up_due_at` mit einer sichtbaren Fehlermeldung im Editor, während alle Kaskaden-Pfade still fail-soft ins Leere laufen.
2. **Der Live-Stand ist nicht gemessen, sondern nur dokumentiert.** Der Supabase-MCP antwortet mit „Unauthorized … SUPABASE_ACCESS_TOKEN“; dass die 12 Spalten, die drei Tabellen und die RPC nirgends existieren, beruht allein auf docs §7 und dem Branch-Stand. Vor dem Einspielen einmal `list_tables` gegen die Live-DB prüfen.
3. **Kein Backfill, bewusst.** Kaskade und Recycling gelten nur für Termine bzw. Zeilen, die **nach** dem Deploy angelegt werden bzw. terminal werden. Konsequenz: „Erinnerungs-Disziplin“ beschreibt zunächst das Deploy-Datum, nicht die Arbeitsweise — dieselbe Falle wie bei `phone_call_attempts` (0028), dort fängt die UI sie mit „—“ ab, hier nicht (H7, M19).
4. **Ungetestete Query-Pfade.** Nichts davon lief je gegen eine Datenbank: kein Test im Repo (M20), die Doppel-`.or()`-Query der Analyse ist ungeprüft (N4), der partielle Unique-Index gegen den nicht-transaktionalen Supersede+Insert ebenfalls (M8), und der Verifikationsblock beider Migrationen ist reiner Kommentar. **Direkt nach dem Einspielen** die Invarianten aus docs §8 fahren (`reminder_touches.assigned_user_id is null`, die vier Ausschluss/Wiedervorlage-Paare, `falsche_zielgruppe` ohne Datum) und die beiden RPCs einmal manuell aufrufen.
5. **Stille Fehlschläge maskieren einen misslungenen Rollout.** Jeder Kaskaden-Aufruf ist fail-soft (`console.error`), jeder Loader fällt auf Defaults oder `[]` zurück, beide Settings-Formulare verwerfen ihren Fehler. Ein halb eingespieltes Schema (etwa `reminder_settings` da, `reminder_touches` nicht) sieht in der Oberfläche vollständig funktionsfähig aus. Nach dem Deploy deshalb aktiv gegenprüfen: einen Testtermin anlegen und in der DB nachsehen, ob drei Zeilen entstanden sind.
6. **Zwei Datenfehler wirken sofort produktiv, sobald das Schema steht.** H1 (Recycling wird bei Wiederbelebung nicht zurückgenommen) und H2/H3 (Zombie-No-Show-Touches) erzeugen ab dem ersten Tag falsche Aufgaben in den Boards; beide sind reine App-Fehler und vor dem Rollout behebbar, ohne die Migrationen anzufassen.
7. **`/nachfassen` und `/erinnerungen` sind für Plattform-Admins in einer Kunden-Organisation praktisch leer** (er besitzt dort keine Liste und ist keinem Termin zugewiesen), aber Touches, die er dort anlegt, bekommen seine UID als `assigned_user_id` — eine Person, die in dieser Organisation kein Mitglied ist. Für `reminder_touches` gibt es dazu weder eine Invariante noch einen Guard-Trigger (M15, M18).
8. **Reihenfolge-Empfehlung:** (a) H1–H4 und H6 im Code beheben, (b) `0031` einspielen und verifizieren, (c) `0032` einspielen und verifizieren, (d) `/settings` einmal als Owner speichern, damit beide Settings-Zeilen materialisiert sind, (e) Invarianten fahren, (f) erst dann den Branch auf `main` mergen und deployen.
