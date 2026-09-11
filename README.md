# Pitch-Tracker

Next.js-App für den Vertriebs-Funnel eines Teams: zwei Akquise-Kanäle (LinkedIn-Pitches und Telefon-Kaltakquise), die in einen gemeinsamen Termin-Funnel münden (Setting → Closing → Umsatz), dazu eine tägliche Arbeitsliste, Kalender und ein mehrstufiger Analyse-Bereich. Mandantenfähig: ein Workspace = eine Organisation. Daten liegen in **Supabase** (Postgres + Auth + Row Level Security), Deployment auf **Vercel**.

Die tägliche Arbeitsfläche ist **`/termine`** mit drei Reitern — **Liste** (Vorgabe) · **Kalender** · **Rückrufe**. Die Liste beantwortet „wen muss ich heute nerven": Jeder Setting- und Closing-Vorgang trägt genau einen **abgeleiteten** Zustand, und wer keinen stehenden Termin hat, leuchtet gold, bis jemand ihn abhakt. Daneben steht **`/nachfassen`** für das Recycling toter Leads (Wochen- bis Monats-Kadenz) und **`/ablage`** für alles, was aus dem Funnel gefallen ist.

> **⚠ Eine Falle, die man vor der ersten Auswertung kennen muss:** Der angezeigte Zustand „Offen" bedeutet das **Gegenteil** des gespeicherten `setting_calls.status='offen'`. Gespeichert heißt er „Termin steht, Ergebnis fehlt", angezeigt heißt er „es steht **kein** Termin". Details in [`docs/data-model.md`](./docs/data-model.md) §1. Die Geschichte dazu — das Nachfass-System war einmal deutlich größer und wurde am 11. September 2026 bewusst zurückgebaut — steht in [`docs/nachfassen-umbau/ENTSCHEIDUNGEN.md`](./docs/nachfassen-umbau/ENTSCHEIDUNGEN.md), Nachtrag „Der Rückbau". Wer dort vier Tabellen ohne Leser findet (`template_catalog`, `message_templates`, `cascade_steps`, `reminder_touches`): Das ist Absicht, nicht Schlamperei.

**Wer hier Code oder Auswertungen schreibt, liest zuerst [`docs/data-model.md`](./docs/data-model.md)** — dort stehen die maßgeblichen Kennzahl-Definitionen (u. a. die drei verschiedenen Bedeutungen von „Termin"), die Zeitzonen-Fallstricke und die Invarianten. Vor einem Release: [`docs/QA-2.0.md`](./docs/QA-2.0.md).

## Voraussetzungen

- Node.js 20+
- Supabase-Projekt
- (Optional) Vercel-Account

## Supabase einrichten

1. Im [Supabase Dashboard](https://supabase.com/dashboard) ein neues Projekt anlegen.
2. **SQL Editor**: Inhalt von [`supabase/migrations/20260404000000_init.sql`](./supabase/migrations/20260404000000_init.sql) ausführen (einmalig).
3. **Ebenfalls im SQL-Editor**: die Migrationen `…0019` bis `…0041` in numerischer Reihenfolge nachziehen. Sie laufen **nicht** automatisch — welche was tut und worauf zu achten ist, steht in [`docs/data-model.md`](./docs/data-model.md) §7. Die Reihenfolge- und Deploy-Regeln:
   - **Abhängigkeiten:** `0030` setzt `0029` voraus; `0032` setzt `0031` voraus, `0033` setzt `0032` voraus, `0034` beide.
   - **Vor dem Deploy:** `0029` und `0032` (`analyseData.ts` selektiert die neuen Spalten namentlich — fehlt eine, weist PostgREST die *gesamte* Abfrage ab und der Analyse-Bereich ist leer statt unvollständig) sowie **`0041`** (ohne sie schreibt der Knopf „Genervt" der Arbeitsliste nicht und das Lead-Dossier meldet „nicht verfügbar").
   - **Nach dem Deploy:** `0035` und `0039` — sie erzwingen Regeln, die erst die neue App einhält. Für `0035` gilt das allerdings nur historisch: Ihre drei Trigger nimmt `0041` wieder weg, weil die Arbeitsliste einen Vorgang ohne Grundcode beendet.
   - **Beim Ausführen nichts markieren.** Die Konsole fährt ein Skript in einer Transaktion, führt bei markiertem Text aber **nur die Markierung** aus und hinterlässt einen Halbzustand ohne Fehlermeldung — genau das ist bei `0031` schon passiert. Danach den Verifikationsblock am Dateiende fahren.

   **Stand der Produktions-DB: alles bis `…0040` ist eingespielt und damit eingefroren; `…0041` ist es NICHT.** Bei einer frischen Datenbank spielt das keine Rolle — dort laufen alle der Reihe nach durch.
4. **Authentication → Providers**: E-Mail (Magic Link) aktivieren; optional Google o. Ä.
5. **Authentication → URL configuration**:
   - **Site URL**: `http://localhost:3000` für lokale Entwicklung.
   - **Redirect URLs**: `http://localhost:3000/auth/callback` und nach Deploy z. B. `https://dein-projekt.vercel.app/auth/callback` (eure echte Production-URL ergänzen).

## Lokale Entwicklung

```bash
cp .env.local.example .env.local
# NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY eintragen

npm install
npm run dev
```

App: [http://localhost:3000](http://localhost:3000)

## Vercel

1. Repository mit diesem Ordner verbinden (Root: `pitch-tracker`, falls das Repo nur diese App enthält, ist das Projektroot korrekt).
2. Unter **Settings → Environment Variables** setzen:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy auslösen.
4. In Supabase die **Redirect URLs** und die **Site URL** um die Production-Domain ergänzen.

## Team / Workspace

- Erste Person: nach Login unter `/onboarding` einen Workspace anlegen.
- Zweite Person: nach Login unter `/onboarding` den **Einladungs-Code** eintragen (sichtbar unter **Einstellungen** für alle Mitglieder).

Es gilt **ein Workspace pro Nutzerkonto** — inzwischen keine MVP-Vereinfachung mehr, sondern eine harte Annahme: Bei zwei Mitgliedschaften sperrt `getAccessContext()` den Nutzer aus. Wer die Organisation wechselt, wird per `admin_move_user_to_workspace()` umgezogen; die alte Mitgliedschaft wird dabei gelöscht, nicht ergänzt.

**Plattform-Admins** (`platform_admins`) stehen *oberhalb* der Organisationen: Sie dürfen jede Organisation lesen und dort schreiben, sind aber in keiner Kunden-Organisation Mitglied — sonst erschienen sie im Team-Dashboard und in der Datensicht-Auswahl des Kunden. Der Org-Umschalter in der Sidebar ist nur für sie sichtbar. Details in [`docs/data-model.md`](./docs/data-model.md) §2.

## Supabase MCP (read-only)

Für Datenanalysen direkt aus Claude Code ist ein **read-only** Supabase-MCP-Server konfiguriert (`.mcp.json`). Er kann nur lesen, keine Schreib-/DDL-Operationen ausführen.

Einrichtung:

1. In Supabase unter **Account → Access Tokens** ein **Personal Access Token** erstellen.
2. Das Token als Umgebungsvariable setzen (nicht committen):
   ```bash
   export SUPABASE_ACCESS_TOKEN=sbp_…      # macOS/Linux
   $env:SUPABASE_ACCESS_TOKEN = "sbp_…"     # PowerShell
   ```
3. Claude Code neu starten — der Server `supabase` erscheint mit `--read-only` und `--project-ref=sazybkgxveddbdaknacp`.

Die `.mcp.json` enthält **kein** Secret (das Token wird zur Laufzeit aus `${SUPABASE_ACCESS_TOKEN}` gelesen).

## Sicherheit

- **`.env` ist nicht versioniert** (`.gitignore: .env*`) und war nie in der Git-Historie. Der `SUPABASE_SERVICE_ROLE_KEY` wird an genau **einer** Stelle gelesen: `src/lib/supabase/admin.ts`, serverseitig, aus `process.env` (nicht hartkodiert). Aufrufer sind nur `workspace.ts` und `platform.ts`.
- **Der Service-Role-Key umgeht RLS vollständig.** Wer ihn außerhalb von `admin.ts` verwendet — in einem Terminal-Befehl, einem `curl`, einem Skript, einem Agenten-Lauf —, hat ihn damit in Shell-History, Prozessliste und Logs geschrieben und muss ihn **rotieren** (Supabase → Project Settings → API, danach `.env` **und** die Vercel-Env-Vars nachziehen). Das ist keine theoretische Regel: Genau dieser Fall ist beim Debuggen der globalen Suche schon eingetreten. Für Datenauswertungen ist der **read-only MCP** (siehe oben) der vorgesehene Weg — er kann nichts schreiben.
- **Seed-Routen entfernt.** Die früheren Bootstrapping-Endpunkte (`/api/setup`, `/api/add-daniel`, `/api/add-samuel`) existieren nicht mehr; unter `src/app/api/` liegt nur noch `export/route.ts`. Neue Nutzer entstehen über Einladungs-Code bzw. die Nutzerverwaltung, nicht über ungeschützte Routen.
