# Pitch-Tracker

Next.js-App für gemeinsame Pitch-Listen, Kontakte, Pipeline-Stufen mit Wahrscheinlichkeit, Follow-up-Warnungen und Filter. Daten liegen in **Supabase** (Postgres + Auth + Row Level Security), Deployment auf **Vercel**.

## Voraussetzungen

- Node.js 20+
- Supabase-Projekt
- (Optional) Vercel-Account

## Supabase einrichten

1. Im [Supabase Dashboard](https://supabase.com/dashboard) ein neues Projekt anlegen.
2. **SQL Editor**: Inhalt von [`supabase/migrations/20260404000000_init.sql`](./supabase/migrations/20260404000000_init.sql) ausführen (einmalig).
3. **Authentication → Providers**: E-Mail (Magic Link) aktivieren; optional Google o. Ä.
4. **Authentication → URL configuration**:
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

Es gilt **ein Workspace pro Nutzerkonto** (MVP). Der Partner tritt einem bestehenden Workspace bei, statt einen zweiten anzulegen.

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

- **`.env` ist nicht versioniert** (`.gitignore: .env*`) und war nie in der Git-Historie. Der `SUPABASE_SERVICE_ROLE_KEY` liegt nur lokal / in den Deploy-Env-Vars und wird ausschließlich serverseitig in `src/lib/supabase/admin.ts` aus `process.env` gelesen (nicht hartkodiert) → keine Rotation nötig, solange die lokale `.env` nicht geteilt wurde.
- **Seed-Routen** (`/api/setup`, `/api/add-daniel`, `/api/add-samuel`) legen Nutzer über den Admin-Client an und sind einmalige Bootstrapping-Endpunkte. Da die Nutzer bereits existieren, sollten diese Routen vor dem Produktivbetrieb entfernt oder hinter ein Secret gestellt werden.
