# Modul „Automatisierter Erinnerungs-Mailversand"

Bauplan, Stand 08.09.2026. Grundlage: vier Sondierungen (Scheduler, Versandweg, Recht, Datenmodell)
plus eigener Repo-Abgleich auf Branch `feature/erinnerungs-kaskade`.
**Reine Planung — es wurde nichts implementiert, keine Datei geändert, kein Paket installiert.**

Verifizierter Ausgangsstand (im Repo geprüft):

- Keine `vercel.json` im Root → **kein einziger Cron Job**, keine Hintergrundverarbeitung.
- Unter `src/app/api/` liegt genau **ein** Verzeichnis: `export/` (`src/app/api/export/route.ts`).
  Daneben nur `src/app/auth/callback/route.ts`. Keine öffentliche Schreibroute.
- Keine Mail-Bibliothek in `package.json` (kein resend/nodemailer/postmark/sendgrid/googleapis).
- `supabase/functions/` existiert **nicht**; kein `pg_cron`/`pg_net` in irgendeiner der 31 Migrationen.
- Vorhanden und nutzbar: `src/lib/supabase/admin.ts` (Service-Role-Client),
  `src/lib/apptTime.ts` (einzige Zeitzonen-Konvertierung), `src/lib/reminderCascade.ts`
  (Vorlagen-Rendering, Kanal-Auflösung), `src/app/actions/reminders.ts` (Touch-Erzeugung/-Entwertung).
- `supabase/migrations/20260404000031_reminder_cascade.sql:176` erlaubt per CHECK nur
  `channel in ('linkedin','telefon','whatsapp')` — **`email` ist heute nicht vorgesehen**.
- Migrationen 0031/0032 sind laut `docs/data-model.md` §7 **noch nicht auf der produktiven DB**
  eingespielt und liegen nur auf diesem Branch.
- **Es gibt weder eine Empfänger- noch eine Absenderadresse.** `setting_calls`/`closing_calls`
  haben keine E-Mail-Spalte (`supabase/migrations/20260404000008_tracking_2_core.sql`, auch
  0029/0031/0032 fügen keine hinzu). Nutzer-Logins sind synthetisch:
  `<slug>@pitchtracker.internal` (`src/lib/internal-email.ts`).

---

## 1. Was das Modul leistet — in acht Sätzen

1. Sobald ein Erst- oder Abschlussgespräch angelegt wird und für den Lead eine E-Mail-Adresse
   mit dokumentierter Einwilligung vorliegt, plant die App die Erinnerungsmails automatisch ein
   — Setting 1 Tag und 1 Stunde vorher, Closing 2 Tage, 1 Tag und 1 Stunde vorher.
2. Die Mails gehen ohne weiteres Zutun raus und sehen aus wie persönliche Post des zuständigen
   Vertrieblers: sein Name, seine echte Adresse als Absender und als Antwortadresse.
3. Inhalt ist eine schlichte Terminbestätigung — Datum, Uhrzeit in Berliner Zeit, Meeting-Link
   oder Einwahlnummer, Absenderkennung, Abmeldelink; keine Werbung, kein Öffnungs-Pixel.
4. Der Vertriebler sieht auf `/erinnerungen` und am Termin selbst, welche Mail geplant ist,
   welche raus ist und welche fehlgeschlagen oder abgebrochen wurde — mit Uhrzeit und Adresse.
5. Damit hat der Auftraggeber den Sendenachweis, den er wollte: je Mail ein unveränderlicher
   Eintrag mit dem tatsächlich versendeten Text, der Provider-Antwort und dem Zustellstatus.
6. Wird ein Termin verschoben, abgesagt oder als Ergebnis eingetragen, verfallen alle noch nicht
   gesendeten Mails automatisch — dieselbe Mechanik, die die manuelle Kaskade heute schon nutzt.
7. Fehlt Adresse oder Einwilligung, wird nichts verschickt: der Termin fällt sauber auf den
   bestehenden manuellen Touch zurück, die Mail-Spur ist ein Aufsatz und nie ein Ersatz.
8. Für den Kunden bedeutet das weniger No-Shows ohne zusätzliche Handarbeit — und pro
   Organisation abschaltbar, ohne Google-Konto, ohne Kalender-Zwang.

---

## 2. Empfohlene Architektur — ein zusammenhängender Ablauf

### Überblick in einem Satz

Der bestehende Touch bleibt der **Plan**, ein neues Journal `email_sends` wird der **Nachweis**,
ein Vercel-Cron im 5-Minuten-Takt ruft **eine** geschützte Route auf, die per Service-Role
fällige Aufträge atomar claimt und über einen Transaktions-Mailanbieter mit
`From = Vertriebler@Kundendomain` versendet.

### Schritt 0 — Voraussetzung: Adressen entstehen überhaupt erst

Ohne diesen Schritt hat der Versand nichts zu senden.

- **Empfänger:** neue Spalten auf `setting_calls` und `closing_calls`:
  `lead_email`, `mail_consent_at`, `mail_consent_text` (Wortlaut-Snapshot),
  `mail_consent_by_user_id`, `mail_consent_source` (`dm`|`telefon`|`formular`),
  `mail_consent_withdrawn_at`. Muster ist exakt `wa_phone`/`wa_consent_at` aus Migration 0031
  (`setting_calls`), aber mit Nachweis-Tiefe: heute setzt
  `src/components/scripts/SettingCallEditor.tsx` beim Abhaken nur einen Zeitstempel und beim
  Abwählen `null` — der Beleg löscht sich also selbst. Das genügt für eine manuell verschickte
  WhatsApp-Nachricht, nicht für einen automatisierten Versand.
  Die Adresse gehört an den **Termin**, nicht an den Lead: nur dort laufen LinkedIn-, Telefon-
  und manuell gebuchte Termine zusammen, und manuelle Termine haben gar keine Lead-Zeile.
- **Vorbelegung:** `convertContactToSetting` / `convertPhoneLeadToSetting`
  (`src/app/actions/appointments.ts`) snapshotten heute nur Name und Firma. Sie können
  `contacts.email` als Vorschlag mitgeben — **niemals** `phone_leads.email`: die stammt aus dem
  CSV-Scraper (`src/lib/phone-csv.ts`, Regex-Erkennung ohne Spaltenkopf) und ist typisch `info@`.
  Diese Quelle bleibt hart vom Versandpfad getrennt (siehe §5).
- **Absender:** neue Tabelle `user_mail_identities` (`user_id`, `workspace_id`, `from_name`,
  `from_email`, `reply_to`, `verified_at`). Notwendig, weil die einzige heute gespeicherte
  Nutzeradresse `<slug>@pitchtracker.internal` ist und damit unzustellbar.
- **Org-Pflichtangaben:** neue Tabelle `org_mail_identity` je Workspace (Firma, Rechtsform,
  Anschrift, Vertretungsberechtigter, Register + Nummer, USt-IdNr., zweiter Kontaktweg,
  Link Datenschutzerklärung, verifizierte Absenderdomain). `workspaces` trägt heute nur
  `id/name/invite_code/created_at`; ein fest verdrahtetes Impressum wäre bei Weitergabe an
  Kunden falsch und nach § 33 DDG bußgeldbewehrt.

### Schritt 1 — Termin wird angelegt → Plan entsteht

`createSettingCall` / `createClosingFromSetting` rufen bereits `generateSettingCascade()` bzw.
`generateClosingCascade()` (`src/app/actions/reminders.ts`). Dort kommt ein zweiter Aufruf
`generateMailTrack()` dazu:

- Prüft das Gate: `lead_email` **und** `mail_consent_at` **und** kein
  `mail_consent_withdrawn_at` **und** Org-Mailspur aktiv **und** Absenderidentität verifiziert.
  Fehlt eines davon → **kein** Mail-Touch, der manuelle Touch bleibt wie bisher.
  Vorbild ist `resolveFollowUpChannel()` in `src/lib/reminderCascade.ts`, das WhatsApp genauso
  hart verweigert, wenn Nummer oder Consent fehlen.
- Legt Zeilen in `reminder_touches` an mit neuen `touch_type`-Werten `mail_1`/`mail_2`/`mail_3`
  und `channel='email'`. Der bestehende Unique-Index
  `uq_reminder_touches_active (entity_type, entity_id, touch_type) where superseded_at is null`
  trägt das unverändert, weil `touch_type` Teil des Schlüssels ist.
- Die Offsets kommen **nicht** aus `reminder_settings`: dessen CHECK erzwingt genau ein
  absteigendes Tripel je Organisation für alle Termin-Arten gemeinsam (0031:65–68). Gefordert
  sind aber 2 Stufen beim Setting und 3 beim Closing. Neue Zeile je Workspace in
  `email_settings` (Muster `recycle_settings` aus 0032, gleiches Schreib-Prädikat
  `role='owner' && data_scope='workspace'`): `setting_offsets int[]`, `closing_offsets int[]`,
  `enabled bool`, Betreff- und Textvorlagen, `quiet_hours_from`/`_to`.
- Für jeden Mail-Touch entsteht sofort eine Zeile in **`email_sends`** mit `status='geplant'`
  und `scheduled_at = touch.due_at`.

### Schritt 2 — `email_sends`, das Nachweis-Journal

Neue Tabelle, 1:1 am Touch (`touch_id uuid not null references reminder_touches(id) on delete
cascade`, `unique(touch_id)`), zusätzlich denormalisiert `workspace_id`, `entity_type`,
`entity_id`, `assigned_user_id`.

Zwei getrennte Achsen — bewusst nicht eine Spalte:

- `status in ('geplant','in_zustellung','gesendet','fehlgeschlagen','abgebrochen')`
  — was **wir** getan haben. „Fällig" wird nicht gespeichert, sondern aus
  `scheduled_at <= now()` abgeleitet.
- `delivery_state in (null,'angenommen','zugestellt','bounced','beschwerde')` mit
  `delivered_at`/`bounced_at` — was der **Empfänger-Server** gemeldet hat.
  Beides in eine Spalte zu legen wäre derselbe Fehler wie die abgeleitete Closing-Show-Quote
  (`docs/data-model.md` §4), die deshalb nahe 100 % steht und nichts mehr aussagt.

Snapshot-Felder, alle zum **Sendezeitpunkt** eingefroren: `to_email`, `from_name`, `from_email`,
`reply_to`, `subject_rendered`, `body_text_rendered`, `body_html_rendered`.
Begründung: `renderReminderTemplate()` (`src/lib/reminderCascade.ts`) rendert absichtlich bei
jedem Anzeigen neu gegen die aktuelle Vorlage — ein Nachweis, der sich ändert, sobald jemand
die Vorlage editiert, ist kein Nachweis.

Betriebsfelder: `provider`, `provider_message_id`, `provider_response jsonb`, `attempt_count`,
`last_error`, `next_attempt_at`, `claimed_at`, `sent_at`, `canceled_at`, `cancel_reason`.

RLS: lesen dürfen Mitglieder nach dem Muster der Termin-Policies; **schreiben nur Service-Role**.

### Schritt 3 — Der Takt

Neue Datei **`vercel.json`** im Root:

```json
{ "crons": [{ "path": "/api/cron/reminder-mails", "schedule": "*/5 * * * *" }] }
```

Warum Intervall statt Wandzeit: `due_at` und `appointment_at` sind seit Migration
`20260404000021_appointment_timezone_fix.sql` echtes UTC, `scheduled_at <= now()` ist damit
zonenfrei. Ein Cron mit fester Uhrzeit („täglich 8:00") liefe auf Vercel in UTC und im Winter
um 9:00 Berliner Zeit — genau der Fehler, den 0021 schon einmal beheben musste.
Berlin wird ausschließlich im Mailtext gebraucht, dort über `formatTerminParts()`
(`src/lib/apptTime.ts`, Offset per `Intl` mit fester IANA-Zone).

**Planabhängigkeit:** minutennahe Crons gibt es auf Vercel erst ab Pro; auf Hobby läuft ein Cron
nur einmal täglich, und damit ist „1 Stunde vorher" unmöglich. Das Vercel-Projekt ist lokal
nicht verlinkt (kein `.vercel/`-Verzeichnis) — der Plan ist **unbestätigt** und vor Baubeginn
zu klären. Ausweichweg ohne Codeänderung: `pg_cron` + `pg_net` rufen dieselbe Route auf
(Alternative 1 in §3).

### Schritt 4 — Die Route (der einzige Eintrittspunkt)

Neu: **`src/app/api/cron/reminder-mails/route.ts`**, gebaut nach dem Muster der vorhandenen
`src/app/api/export/route.ts`, aber ohne Session:

1. `Authorization: Bearer $CRON_SECRET` prüfen, sonst 401. Das wäre die **erste öffentlich
   erreichbare schreibende Route** dieser App — die README hält ausdrücklich fest, dass die
   alten ungeschützten Seed-Routen entfernt wurden. Neue Env-Var `CRON_SECRET`; heute existieren
   exakt drei Env-Variablen.
2. `export const runtime = 'nodejs'`, `maxDuration` gedeckelt, Batch auf 50 Mails je Lauf
   (Rest holt der nächste Takt in 5 Minuten).
3. `createAdminClient()` (`src/lib/supabase/admin.ts`) — der Job läuft **an RLS vorbei**.
   `getAccessContext()` (`src/lib/access.ts`) liefert ohne Session `null` und ist hier
   unbrauchbar. Jede Query führt `workspace_id` explizit mit, sonst mailt Mandant A an die
   Leads von Mandant B.
4. **Atomarer Claim** über eine neue SECURITY-DEFINER-Funktion `claim_due_emails(p_limit int)`:
   `select … where status in ('geplant','fehlgeschlagen') and coalesce(next_attempt_at,
   scheduled_at) <= now() order by scheduled_at for update skip locked`
   + `update … set status='in_zustellung', claimed_at=now(), attempt_count=attempt_count+1
   returning *`. PostgREST/supabase-js kann `for update skip locked` nicht ausdrücken; ein
   zweistufiges „selektieren, dann markieren" ist bei überlappenden Läufen exakt der
   Doppelversand. Muster: `nachfassen_tasks`/`recycle_tasks` (§5 der Doku).
5. **Altersgrenze:** gesendet wird nur, wenn zusätzlich `appointment_at > now()` und
   `now() - scheduled_at` unter einer Grenze liegt (für die T-1h-Mail z. B. 2 Stunden). Sonst
   feuert nach jeder Ausfallzeit der gesamte Rückstau und die „1 Stunde vorher"-Mail landet
   nach dem Termin. Was darüber liegt → `status='abgebrochen'`, `cancel_reason='veraltet'`.
6. **Elterntermin unmittelbar vor dem Senden erneut prüfen** (Existenz, `appointment_at`
   unverändert, Status nicht `dead`/`no_show`). `reminder_touches.entity_id` hat bewusst keinen
   Fremdschlüssel, und `deleteSettingCall` löscht den Termin **vor** dem Aufräumen der Touches —
   ein verwaister Auftrag ist real möglich und muss `abgebrochen` heißen, nicht „Fehler + Retry".
7. Text rendern über `renderReminderTemplate()` + `formatTerminParts()`, Snapshot schreiben,
   dann senden.
8. Ergebnis zurückschreiben: `gesendet` + `provider_message_id`, oder `fehlgeschlagen` +
   `last_error` + `next_attempt_at` (exponentiell, max. 3 Versuche).
   **Nicht fail-soft:** das gesamte Reminder-Modul loggt Fehler heute nur
   (`src/app/actions/reminders.ts`); für den Versand ist stilles Scheitern fatal, weil dann
   genau der Sendenachweis fehlt, der der Anlass des Vorhabens ist.
9. **Reaper** im selben Lauf: `in_zustellung` älter als 15 Minuten zurück auf `geplant`.

### Schritt 5 — Der Versandweg

Neu: `src/lib/mail/sender.ts` mit einem schmalen Interface
`MailSender.send(payload) -> { providerMessageId }`, erste und einzige Implementierung
`src/lib/mail/providers/resend.ts` (bzw. Postmark). Ein Plattform-Account, je Kundenorganisation
eine **verifizierte Absenderdomain**; gesendet wird mit `From: vorname.nachname@kunde.de`,
`Reply-To:` dieselbe Adresse. `email_sends.id` geht als **Idempotency-Key** an den Provider —
ohne den ist der Fall „Mail ging raus, Antwort ging im Timeout verloren" mit Datenbankmitteln
allein nicht dicht zu bekommen.

Der Adapter-Schnitt wird sofort gezogen, obwohl es zunächst nur einen Adapter gibt: Gmail-OAuth
und Microsoft Graph lassen sich später als zusätzliche Implementierungen nachrüsten, ohne die
Sendelogik anzufassen (siehe §3, Alternative 2).

### Schritt 6 — Zustellnachweis zurück in die App

Neu: `src/app/api/webhooks/mail/route.ts` — nimmt Provider-Ereignisse entgegen
(`delivered`, `bounced`, `complained`), verifiziert die Signatur und schreibt
`delivery_state`/`delivered_at`/`bounced_at` auf die Zeile mit passender
`provider_message_id`. Ohne diesen Webhook darf keine Kachel „Zustellquote" heißen, sondern nur
„vom Provider angenommen" — sonst entsteht eine falsch beschriftete Nahe-100-%-Quote.

Ein Bounce setzt zusätzlich alle noch offenen Mail-Aufträge desselben Leads auf `abgebrochen`
und markiert die Adresse am Termin als unzustellbar; eine Spam-Beschwerde wirkt wie ein Widerruf.

### Schritt 7 — Verschieben, Absagen, Ergebnis eintragen

Die Entwertung ist bereits vollständig verdrahtet: `supersedeTouches()` bzw.
`deleteTouchesForEntity()` werden aus `src/app/actions/settingCalls.ts` und
`src/app/actions/closingCalls.ts` an acht Stellen gerufen. Diese Verdrahtung wird **geerbt**,
nicht dupliziert. Zusätzlich als hartes Netz ein DB-Trigger
`after update of superseded_at on reminder_touches`, der ein noch nicht gesendetes `email_sends`
auf `abgebrochen` setzt — nötig, weil der App-Pfad fail-soft ist und ein stiller Fehler sonst
eine Mail zu einem längst verschobenen Termin herauslässt.

Ist die Mail **schon raus**, wird nichts entwertet: die Zeile bleibt als Nachweis stehen, und
eine Verschiebung erzeugt **genau einen** neuen Auftrag vom Typ `mail_korrektur`
(„Ihr Termin wurde verschoben auf …"), nicht die volle Kaskade erneut.
Eine Absage-Mail bei gelöschtem Termin ist ein Org-Schalter mit **Default aus** — ein
versehentliches Löschen darf dem Lead keine Absage schicken.

### Schritt 8 — Was der Nutzer sieht

- `/erinnerungen` (`src/components/erinnerungen/ErinnerungenBoard.tsx`): Mail-Touches erscheinen
  als eigene Kategorie „läuft automatisch" mit Status, nicht als offene Handarbeit. Die
  Unterscheidung manuell/automatisch wird in `src/lib/reminderCascade.ts` gekapselt.
- Termin-Detailseiten `/setting/[id]` und `/closing/[id]`: eine Zeitleiste der Mails mit
  Adresse, Zeitpunkt, Status und dem tatsächlich gesendeten Text zum Aufklappen.
- `/settings`: Mail-Spur an/aus, Offsets je Termin-Art, Vorlagen, Org-Pflichtangaben,
  Domain-Verifizierungsstatus, eigene Absenderidentität mit Testversand.

### Betroffene Dateien in der Übersicht

**Neu:** `vercel.json` · `supabase/migrations/20260404000033_mail_track.sql` ·
`src/app/api/cron/reminder-mails/route.ts` · `src/app/api/webhooks/mail/route.ts` ·
`src/lib/mail/sender.ts` · `src/lib/mail/providers/resend.ts` · `src/lib/mail/renderMail.ts` ·
`src/app/actions/mailIdentity.ts` · `src/app/actions/mailSends.ts` ·
`src/components/settings/MailSettings.tsx` · `src/components/termine/MailTimeline.tsx`

**Geändert:** `src/lib/reminderCascade.ts` (Mail-Offsets, Kanal `email`, manuell/automatisch) ·
`src/app/actions/reminders.ts` (`generateMailTrack`) · `src/app/actions/appointments.ts`
(Adress-Vorbelegung) · `src/app/actions/settingCalls.ts` / `closingCalls.ts`
(Korrektur-Auftrag nach Versand) · `src/components/scripts/SettingCallEditor.tsx`
(Adresse + Einwilligung) · `src/components/erinnerungen/ErinnerungenBoard.tsx` ·
`src/lib/analyseData.ts` (Mail-Touches aus der „Erinnerungs-Disziplin" ausschließen) ·
`docs/data-model.md` · `README.md` (neue Env-Vars).

---

## 3. Zwei Alternativen — und warum nicht

### Alternative 1: Supabase Edge Function + `pg_cron`/`pg_net` statt Vercel-Cron + Route

Der Takt käme aus der Datenbank (`cron.schedule`), die Sendelogik liefe als Deno-Funktion unter
`supabase/functions/reminder-mails/`. Vorteil: unabhängig vom Vercel-Plan und von einem
Frontend-Deploy.

**Nicht empfohlen, weil** dadurch ein **zweiter Deploy-Pfad** entsteht, den es heute nicht gibt
(`supabase/functions/` existiert nicht; `package.json` kennt als DB-Skript nur `db:push`) —
zweite Laufzeit, zweiter Secret-Store, zweites CI-Artefakt. Vor allem aber liegen
Vorlagen-Rendering (`renderReminderTemplate`, `templateFieldFor`) und Berliner Zeitformatierung
(`formatTerminParts`) in TypeScript unter `src/lib/`; eine Deno-Funktion kann diese Module nicht
ohne Weiteres mitbenutzen und müsste sie duplizieren. Zwei Kopien derselben Vorlagenlogik
driften auseinander — dann steht in der Mail ein anderer Text als in der Vorschau auf
`/erinnerungen`, und beim Kunden ist genau das der Vertrauensbruch.
**Aber:** `pg_cron` + `pg_net` als reiner **Auslöser** vor derselben Route ist ausdrücklich der
vorgesehene Ausweichweg, falls der Vercel-Plan keine minutennahen Crons hergibt — das kostet
keine Zeile Sendecode. Ob die Extensions im Projekt aktivierbar sind, konnte nicht geprüft
werden (Supabase-MCP ohne `SUPABASE_ACCESS_TOKEN`, in keiner Migration angefordert).

### Alternative 2: Versand aus dem echten Postfach des Vertrieblers (Gmail-API / Microsoft Graph)

Jeder Vertriebler verbindet sein Google- oder Microsoft-Konto per OAuth, die App ruft
`users.messages.send` bzw. `POST /me/sendMail`. Die Mail käme wirklich aus seinem Postfach, läge
in seinem Ordner „Gesendet", DKIM der Kundendomain griffe ohne DNS-Arbeit, Antworten liefen im
gewohnten Thread, Bounces landeten in seinem Posteingang.

**Nicht als erste Stufe empfohlen, weil** drei Dinge zusammenkommen. Erstens der Google-Zwang:
Kunden ohne Google oder Microsoft — laut Randbedingung ausdrücklich zu vermeiden — hätten gar
keinen Versandweg; man bräuchte beide Adapter plus einen Rückfall, also drei Wege statt einem.
Zweitens die Wartezeit: `gmail.send` ist zwar nur ein sensibler Scope (kein CASA-Audit), aber die
OAuth-App-Verifizierung dauert Wochen, und solange die App im Status „Testing" steht, **verfallen
Refresh-Tokens nach 7 Tagen** — die Funktion hörte eine Woche nach jedem Onboarding
stillschweigend auf zu senden. Drittens der Sendenachweis: über OAuth-Postfächer gibt es keinen
maschinenlesbaren Zustellstatus; Bounces sieht nur ein Mensch im Posteingang, und das Auslesen
wäre `gmail.readonly`, ein restricted Scope mit CASA-Pflicht. Genau der Sendenachweis war aber
der Auftragsgrund.
**Deshalb:** Adapter-Schnitt jetzt ziehen, OAuth-Wege später als optionales Upgrade nachrüsten,
falls der Ordner „Gesendet" hart gefordert bleibt.

*Nicht bauen:* SMTP mit hinterlegtem Postfach-Passwort. Google hat Passwort-Zugriff für
Workspace-Konten abgeschaltet, Microsoft Basic Auth ebenso; die Mail landet trotzdem nicht in
„Gesendet", und ein gespeichertes Postfach-Passwort in einer an Kunden weitergegebenen Software
ist das größte Haftungsrisiko für den geringsten Zugewinn.

---

## 4. Onboarding eines neuen Kunden

**Einmalig pro Organisation (macht der Owner, `role='owner'` + `data_scope='workspace'`):**

1. `/settings` → „E-Mail-Erinnerungen" öffnen und die **Anbieterkennzeichnung** ausfüllen:
   Firma, Rechtsform, Anschrift, Vertretungsberechtigter, Register + Nummer, USt-IdNr.,
   zweiter Kontaktweg, Link zur eigenen Datenschutzerklärung.
2. **Absenderdomain angeben** (z. B. `kunde.de` oder `mail.kunde.de`). Die App zeigt die drei
   DNS-Einträge an, die einzutragen sind (DKIM, SPF, optional DMARC), und pollt den
   Verifizierungsstatus. Das ist der Schritt, der beim Kunden am häufigsten hakt — er braucht
   DNS-Zugriff oder jemanden, der ihn hat.
3. **Kadenz und Vorlagen** prüfen: Setting 24 h / 1 h, Closing 48 h / 24 h / 1 h,
   Betreff und Text mit den Platzhaltern `{vorname}`, `{firma}`, `{datum}`, `{uhrzeit}`, `{link}`.
   Optional Nachtruhe-Fenster.
4. **Mail-Spur scharfschalten.** Der Schalter bleibt gesperrt, solange Impressumsfelder leer oder
   die Domain nicht verifiziert ist.

**Einmalig pro Vertriebler:**

5. Unter „Meine Absenderadresse" die echte Geschäftsadresse eintragen (muss auf der verifizierten
   Domain liegen) und **Testmail an sich selbst** schicken. Erst nach erfolgreichem Testversand
   gilt die Identität als `verified_at`.

**Laufend, je Termin:**

6. Beim Vereinbaren des Termins die E-Mail-Adresse des Entscheiders erfassen und die
   Einwilligungsfrage stellen („Darf ich Ihnen die Terminbestätigung und Erinnerungen an diese
   Adresse mailen?"). Häkchen im Setting-Editor setzt Zeitstempel, Wortlaut-Snapshot und
   erfassende Person.

**Wenn der Kunde das alles nicht tut — der Rückfall, sauber und still:**

- Org-Felder leer oder Domain unverifiziert → Mail-Spur **bleibt aus**, es entstehen keine
  Mail-Touches, `/erinnerungen` verhält sich exakt wie heute (manuelle Kaskade).
- Domain verifiziert, aber ein Vertriebler hat keine eigene Absenderidentität → **nur seine**
  Termine laufen manuell, die der Kollegen mailen.
- Alles eingerichtet, aber ein einzelner Termin hat keine Adresse oder keine Einwilligung →
  **dieser Termin** fällt auf den manuellen Touch zurück, sichtbar mit Hinweis
  „keine Mail möglich: Adresse fehlt" bzw. „Einwilligung fehlt".
- Nirgends entsteht ein Fehlerzustand, eine leere Liste oder eine stumme Lücke: Der Zustand
  „nicht adressierbar" ist ein eigener, sichtbarer Zustand — sonst sähe genau die
  Sendenachweis-Liste, die der Auftraggeber will, aus wie ein Fehlerprotokoll.

---

## 5. Rechtliche Umsetzungspflichten — Checkliste

Grundlage: § 7 UWG, DSGVO, § 5 DDG. Maßgeblicher Fall: **LG Köln, Urteil vom 07.04.2022,
81 O 88/21** — Terminbestätigungen **und** Terminerinnerungen dienen der Absatzförderung und
sind damit Werbung im Sinne des § 7 Abs. 2 Nr. 2 UWG, auch wenn der Empfänger den Termin selbst
gebucht hat. Die Annahme „das ist doch nur eine Transaktionsmail" trägt hier nicht. Die
Bestandskundenausnahme (§ 7 Abs. 3 UWG) trägt ebenfalls nicht: sie verlangt einen bereits
erfolgten Verkauf — ein Lead vor dem Erstgespräch ist Interessent, kein Bestandskunde.

| # | Pflicht | Was in der Software dafür gebaut wird |
|---|---|---|
| 1 | Vorherige ausdrückliche Einwilligung (§ 7 Abs. 2 Nr. 2 UWG) | Hartes Gate: ohne `lead_email` **und** `mail_consent_at` entsteht kein Mail-Touch — dieselbe Strenge wie `resolveFollowUpChannel()` bei WhatsApp. |
| 2 | Nachweisbarkeit der Einwilligung (Art. 7 Abs. 1, Art. 5 Abs. 2 DSGVO) | Gespeichert werden Zeitstempel, **Wortlaut-Snapshot**, erfassende Person und Quelle — nicht nur ein Häkchen wie heute bei `wa_consent_at`. |
| 3 | Widerruf so einfach wie die Erteilung (Art. 7 Abs. 3 DSGVO) | Ein-Klick-Abmeldelink ohne Login in jeder Mail, dazu `List-Unsubscribe`-Header. |
| 4 | Aufforderung, Nachrichten einzustellen (§ 7 Abs. 2 Nr. 3 UWG) | Der Abmeldeklick setzt `mail_consent_withdrawn_at` und bricht **alle** offenen Mail-Aufträge dieses Leads über **alle** seine Termine ab, nicht nur den einen Touch. |
| 5 | Widerruf darf den Beleg nicht löschen | Widerruf schreibt ein eigenes Feld; `mail_consent_at` bleibt stehen (heute setzt der Setting-Editor beim Abwählen `null` und vernichtet den Beweis). |
| 6 | Anbieterkennzeichnung, § 5 DDG (Bußgeld bis 50.000 €, § 33 DDG) | Org-Pflichtfelder je Workspace, in jede Mail gerendert; ohne sie lässt sich die Spur nicht scharfschalten. |
| 7 | Keine Verschleierung des Absenders | `From`/`Reply-To` ist eine echte, verifizierte, erreichbare Adresse des Vertrieblers — nie die synthetische `@pitchtracker.internal`. |
| 8 | Keine Werbung im Erinnerungstext | Vorlagen tragen nur Datum, Uhrzeit, Link, Absenderkennung, Abmeldehinweis; Vorlagen-Editor mit entsprechendem Hinweis. |
| 9 | Kein einwilligungsbedürftiges Tracking | **Kein** Öffnungs-Pixel, **kein** Klick-Redirect. Gemessen werden nur Versand und Provider-Zustellstatus. |
| 10 | Gescrapte Adressen nicht anschreiben | `phone_leads.email` (aus `src/lib/phone-csv.ts`, Regex ohne Spaltenkopf, typisch `info@`) wird **nie** als Empfänger vorbelegt — genau die vom LG Köln beanstandete Konstellation. |
| 11 | Kein rückwirkender Rollout | Kein Backfill: die Spur greift nur für Termine, die **nach** dem Deploy angelegt oder verschoben werden — dieselbe Entscheidung wie in Migration 0031, hier mit echtem Mailversand als Einsatz. |
| 12 | Löschfristen (Art. 5 Abs. 1 lit. e DSGVO) | Aufräum-Job im selben Cron: Einwilligungsbelege und Versandprotokolle nach 3 Jahren (Nachweisfrist, TLfDI), Provider-Rohantworten nach 90 Tagen. Eine Löschautomatik existiert im Projekt heute **nirgends**. |
| 13 | Auftragsverarbeitung (Art. 28 DSGVO) | Kunde = Verantwortlicher/Versender, wir = Auftragsverarbeiter, Mailanbieter = Unterauftragsverarbeiter; versionierbare Unterauftragnehmerliste in der App, Kundeninformation bei Wechsel. |
| 14 | Drittlandtransfer (Kap. V DSGVO) | Bei EU-Anbieter entfällt die Prüfkette; bei US-Anbieter unter DPF (EuG T-553/23; Rechtsmittel C-703/25 P beim EuGH anhängig) müssen Standardvertragsklauseln + Transfer Impact Assessment als Reserve hinterlegt sein. |
| 15 | Export für den Streitfall | Je Lead exportierbarer Nachweis: Einwilligung mit Wortlaut + alle gesendeten Mails im Originaltext. |

**Anwaltlich zu prüfen bleibt ausdrücklich:**

- **Genügt Single-Opt-In mit dokumentiertem Beleg, oder verlangt LG Köln 81 O 88/21 in dieser
  Konstellation Double-Opt-In?** Das ist die teuerste offene Frage. Empfehlung: Single-Opt-In
  bauen, die Datenstruktur aber so anlegen (`mail_confirmed_at`, Token), dass Double-Opt-In ohne
  Umbau nachrüstbar ist. Zu bedenken: DOI kostet genau die Leads, die nicht bestätigen — also
  die, die die Erinnerung am nötigsten hätten; und die Bestätigungsmail selbst ist rechtlich
  nicht unumstritten (LG Stendal, OLG München 29 U 1682/12) und muss strikt werbefrei sein.
- Wortlaut der Einwilligungserklärung und der Pflichttexte in der Mail.
- Wer rechtlich Versender ist: der Vertriebler persönlich oder die Kundenorganisation — davon
  hängt ab, wessen Anbieterkennzeichnung in die Mail muss und wen eine Abmahnung trifft.
- AVV samt Unterauftragsverarbeiter-Regelung und die Haftungsverteilung zwischen uns als
  Softwareanbieter und dem Kunden als Versender. In die AGB gehört, dass wir die Wirksamkeit
  einer konkreten Einwilligung nicht prüfen.
- Aufbewahrungsfristen (Vorschlag 3 Jahre / 3 Jahre / 90 Tage) verbindlich festlegen.

---

## 6. Arbeitspakete

Reihenfolge ist bindend, wo Abhängigkeiten genannt sind.

| # | Paket | Aufwand | Abhängig von |
|---|---|---|---|
| 0 | **Vorbedingungen klären** (kein Code): Vercel-Plan prüfen, Branch `feature/erinnerungs-kaskade` mergen, Migrationen 0031+0032 produktiv einspielen, Mailanbieter wählen, Single- vs. Double-Opt-In entscheiden | S | — |
| 1 | **Migration 0033**: Mail-Spalten + Consent-Felder auf `setting_calls`/`closing_calls`, `user_mail_identities`, `org_mail_identity`, `email_settings`, `email_sends`, CHECK-Erweiterung `touch_type`/`channel`, `claim_due_emails()`, Superseded-Trigger, RLS | M | 0 |
| 2 | **Adress- und Einwilligungs-Erfassung** im Setting-/Closing-Editor, Vorbelegung aus `contacts.email`, harte Trennung von `phone_leads.email` | M | 1 |
| 3 | **Absender- und Org-Identität**: `/settings`-Bereich, Domain-Verifizierung mit DNS-Anzeige und Statusabfrage, Testversand je Nutzer | M | 1 |
| 4 | **Planung**: `generateMailTrack()`, Mail-Offsets je Termin-Art in `email_settings`, Gate-Funktion, Erweiterung `reminderCascade.ts` | M | 1, 2, 3 |
| 5 | **Versandweg**: `MailSender`-Interface, Provider-Adapter, Mail-Rendering mit Impressum und Abmeldelink, Idempotency-Key | M | 3 |
| 6 | **Dispatcher**: `vercel.json`, Cron-Route mit `CRON_SECRET`, Claim, Altersgrenze, Elternprüfung, Retry, Reaper | M | 1, 4, 5 |
| 7 | **Abmeldung**: öffentliche Abmelde-Route ohne Login, signiertes Token, Widerruf schreibt und bricht alle offenen Aufträge ab | M | 5 |
| 8 | **Zustellnachweis**: Webhook-Route mit Signaturprüfung, `delivery_state`, Bounce-Behandlung | M | 5, 6 |
| 9 | **Sichtbarkeit**: Mail-Zeitleiste am Termin, `/erinnerungen` unterscheidet automatisch/manuell, Mail-Touches aus der „Erinnerungs-Disziplin" in `src/lib/analyseData.ts` ausschließen | M | 6 |
| 10 | **Korrektur- und Absagepfad**: `mail_korrektur` nach Verschiebung, Org-Schalter Absagemail (Default aus) | S | 6 |
| 11 | **Löschautomatik** im Cron (3 Jahre / 90 Tage) + Export der Einwilligungs- und Versandbelege je Lead | S | 6 |
| 12 | **Doku und Betrieb**: `docs/data-model.md` §3/§5/§7, README (neue Env-Vars `CRON_SECRET`, Provider-Key, Webhook-Secret), Kunden-Onboarding-Anleitung, AVV-Unterlagen | S | alles |
| 13 | *Optional, später:* Double-Opt-In-Aufsatz | L | 7 |
| 14 | *Optional, später:* Gmail-/Graph-Adapter als Postfach-Upgrade | L (je) | 5 |

**Kern (0–12): rund 9 M + 3 S ≈ 4–6 Wochen** bei einer Person, ohne die Wartezeit auf
Domain-Verifizierung beim Kunden und ohne anwaltliche Prüfung.
Mit den optionalen Paketen 13/14: 8–11 Wochen.

---

## 7. Fehlerbilder und was der Nutzer davon sieht

| Fehlerbild | Was passiert technisch | Was der Nutzer sieht |
|---|---|---|
| **Domain nicht (mehr) verifiziert** | Gate greift, es entstehen keine Mail-Touches | Roter Hinweis in `/settings` und am Termin: „Mail-Spur inaktiv — Domain nicht verifiziert". Termine laufen manuell weiter, es geht nichts verloren |
| **Absenderidentität fehlt/ungeprüft** | Nur die Termine dieses Vertrieblers ohne Mail-Spur | Hinweis am eigenen Termin: „Deine Absenderadresse fehlt — Testmail senden" |
| **Provider-Key ungültig/abgelaufen** | `status='fehlgeschlagen'`, `last_error`, bis zu 3 Retrys, dann Endstatus | Warnbanner auf `/erinnerungen` („3 Erinnerungsmails konnten nicht gesendet werden") + roter Eintrag in der Mail-Zeitleiste des Termins mit Fehlertext und Knopf „Erneut versuchen" |
| **OAuth-Token abgelaufen** (nur im späteren Postfach-Upgrade relevant) | Adapter meldet `invalid_grant`, Rückfall auf Provider-Adapter falls konfiguriert | „Dein Google-Konto ist nicht mehr verbunden — bitte neu verbinden"; die Mail geht in der Zwischenzeit über den Standardweg raus |
| **Bounce** (Adresse falsch, Postfach voll) | Webhook setzt `delivery_state='bounced'`, offene Aufträge desselben Leads auf `abgebrochen`, Adresse am Termin als unzustellbar markiert | „Die Erinnerung an max@firma.de kam nicht an (unbekannter Empfänger). Bitte Adresse prüfen — weitere Mails an diesen Lead sind gestoppt." Der manuelle Touch erscheint wieder |
| **Spam-Beschwerde** | Wirkt wie ein Widerruf: `mail_consent_withdrawn_at`, alle Aufträge abgebrochen | „Der Lead hat den Empfang abgelehnt. Es gehen keine weiteren Mails an ihn." |
| **Cron stand (Deploy, Ausfall)** | Rückstau; die Altersgrenze bricht zu alte Aufträge mit `cancel_reason='veraltet'` ab, der Rest geht verspätet raus | Grauer Eintrag „nicht gesendet — Zeitpunkt verstrichen" statt einer Mail, die nach dem Termin ankommt. Verzugskennzahl `sent_at − scheduled_at` in `/settings` sichtbar |
| **Zustellung verzögert** (Graylisting) | `status='gesendet'`, `delivery_state` bleibt zunächst `angenommen` | Zeitleiste zeigt „abgeschickt 09:02 — Zustellung noch nicht bestätigt". Bewusst nicht als Fehler dargestellt |
| **Termin verschoben, Mail war schon raus** | Gesendete Zeile bleibt als Nachweis stehen; **ein** neuer Auftrag `mail_korrektur` mit neuem Datum | „Erinnerung für den alten Termin ging am 04.09. raus — Korrekturmail für den neuen Termin ist eingeplant für 09.09., 10:00" |
| **Termin gelöscht, Mail war schon raus** | Nichts wird automatisch verschickt (Org-Schalter Default aus) | Hinweis: „Der Lead hat bereits eine Erinnerung erhalten. Bitte manuell absagen." — mit vorbereitetem Text zum Kopieren |
| **Termin gelöscht, Mail noch nicht raus** | Trigger + App-Pfad brechen den Auftrag ab | Nichts. Kein Rauschen, keine Mail |
| **Zwei Cron-Läufe überlappen** | `for update skip locked` im Claim verhindert die Doppelentnahme; Provider-Idempotency-Key fängt den Timeout-Retry | Nichts — genau das ist der Punkt |

---

## 8. Was das Modul bewusst nicht tut

- **Keine WhatsApp- und LinkedIn-Automatisierung.** Diese Touches bleiben manuell, wie in
  `docs/data-model.md` §1 festgelegt: die App liefert Text und Häkchen, verschickt nichts.
- **Kein Öffnungs- und Klick-Tracking.** Ein Pixel misst unter Apple Mail Privacy Protection und
  dem Gmail-Bildproxy systematisch falsch, ist DSGVO-seitig eine eigene Einwilligungsfrage und
  widerspricht der Vorgabe „muss wie eine persönliche Mail aussehen" — persönliche Mails tragen
  keine 1×1-Pixel und geraten mit einem eher in den Spam.
- **Kein Backfill für Bestandstermine.** Kein rückwirkender Rollout, sonst gingen echte Mails an
  Leads, die nie gefragt wurden.
- **Keine Mails an gescrapte Adressen.** `phone_leads.email` bleibt vom Versandpfad getrennt.
- **Kein Kalender-Anschluss, keine `.ics`-Einladung, keine Google-Integration.** Die Mail-Spur ist
  vollständig kalenderfrei; ein `.ics`-Anhang wäre eine eigene, separat zu entscheidende Erweiterung.
- **Kein automatischer Ersatz der manuellen Kaskade.** Die Mail-Spur ist ein Aufsatz; fehlt eine
  Voraussetzung, bleibt der manuelle Touch stehen.
- **Kein Massenmail-Werkzeug.** Nur terminbezogene Erinnerungen, keine Kampagnen, keine
  Verteilerlisten, keine Newsletter.
- **Keine automatische Absagemail** bei gelöschtem Termin, solange der Org-Schalter aus ist.
- **Keine Prüfung, ob eine Einwilligung wirksam eingeholt wurde.** Die Software dokumentiert sie,
  die Verantwortung dafür trägt der Kunde als Versender.
- **Kein Postfach-Zugriff.** Weder Lesen noch SMTP-Zugangsdaten von Kundenmitarbeitern.
