---
name: Pitch Tracker Vollausbau
overview: "Vollständiger Umbau der halbfertigen Pitch-Tracking-App: neue Kontaktfelder, Username/Passwort-Login, Nutzer-Verwaltung, Follow-up-Erinnerungen und ein komplett neu gestaltetes, premium UI/UX-System."
todos:
  - id: migration
    content: "Neue DB-Migration: pitched_at, follow_up_number, answered, appointment_set, answer_text auf contacts + profiles-Tabelle + get_email_by_username RPC"
    status: pending
  - id: env
    content: SUPABASE_SERVICE_ROLE_KEY in .env.local ergänzen
    status: pending
  - id: packages
    content: lucide-react und recharts installieren
    status: pending
  - id: admin-client
    content: "src/lib/supabase/admin.ts: Service-Role-Client erstellen"
    status: pending
  - id: types
    content: "src/lib/types.ts: Contact um neue Felder + Profile-Typ ergänzen"
    status: pending
  - id: actions-contacts
    content: "src/app/actions/contacts.ts: neue Felder in createContact / updateContact"
    status: pending
  - id: actions-workspace
    content: "src/app/actions/workspace.ts: createUser + listUsers Actions"
    status: pending
  - id: design-tokens
    content: "src/app/globals.css: Premium-Designsystem mit Indigo-Brand, Elevation-Scale, Transitions"
    status: pending
  - id: login
    content: "src/app/login/LoginForm.tsx + page.tsx: Username+Passwort statt Magic Link"
    status: pending
  - id: layout
    content: "src/app/(dashboard)/layout.tsx: Premium-Sidebar mit aktiven States, Lucide-Icons, Mobile-Drawer"
    status: pending
  - id: dashboard
    content: "src/app/(dashboard)/page.tsx: Stat-Cards, Erinnerungs-Banner, A/B-Tabelle, recharts-Charts"
    status: pending
  - id: listboard
    content: "src/components/ListBoard.tsx: alle 7 Felder, Status-Badges, bessere Table-UX"
    status: pending
  - id: settings
    content: "src/app/(dashboard)/settings/page.tsx: Nutzerverwaltung (Nutzer anlegen, Liste)"
    status: pending
  - id: proxy
    content: src/middleware.ts → src/proxy.ts umbenennen (Next.js 16 Deprecation)
    status: pending
isProject: false
---

# Pitch Tracker – Vollständiger Ausbauplan

## Ist-Zustand (Analyse)

Die App hat bereits:
- Supabase Auth via **Magic Link** (OTP per E-Mail) — muss auf Username+Passwort umgestellt werden
- `lists`, `pipeline_stages`, `contacts`, `workspaces`, `workspace_members` Tabellen
- `ListBoard.tsx` mit Formular für Name, Firma, E-Mail, Telefon, Stufe, Follow-up-Datum, Deal-Wert, Notizen, JSON-Felder — fehlen: Datum des Pitches, FollowUp-Nummer, Antwort J/N, Termin J/N, Antworttext
- Dashboard mit Follow-up-Warnungen und Listen-KPIs — fehlen: Tages-Pitch-Counter, reichhaltige Stats, Charts
- Minimale zinc-Farbgebung ohne Designsystem

---

## 1. Datenbank-Migration (neue Datei)

**`supabase/migrations/20260404000001_contact_fields.sql`**

Neue Spalten auf `contacts`:
- `pitched_at date` — Datum des Pitches
- `follow_up_number int CHECK (1–3)` — welches Follow-up (1/2/3)
- `answered boolean` — hat geantwortet Ja/Nein
- `appointment_set boolean` — Termin vereinbart Ja/Nein
- `answer_text text` — was war die Antwort

Neue Tabelle `public.profiles`:
- `user_id uuid PK → auth.users`
- `username text UNIQUE NOT NULL`
- RLS: SELECT für Workspace-Mitglieder

RPC-Funktion `get_email_by_username(p_username text)` (SECURITY DEFINER, grant to anon): Lookup `auth.users.email` via `profiles.username` — damit kann der Login-Client mit Benutzernamen ohne Passwort-Exposition arbeiten.

Migration **muss via `npm run db:push`** oder SQL-Editor im Supabase-Dashboard eingespielt werden.

---

## 2. Umgebungsvariablen

**`.env.local`** ergänzen um:
```
SUPABASE_SERVICE_ROLE_KEY=<aus Supabase Dashboard → Settings → API>
```
(Server-only, kein `NEXT_PUBLIC`-Prefix — wird für Admin-Nutzererstellung benötigt)

---

## 3. Auth-Umbau: Magic Link → Username + Passwort

### `src/lib/supabase/admin.ts` (NEU)
Admin-Client mit Service-Role-Key für serverseitige Nutzererstellung:
```typescript
import { createClient } from "@supabase/supabase-js";
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
```

### `src/app/login/LoginForm.tsx` (UMBAU)
- Felder: **Benutzername** + **Passwort** (mit Show/Hide Toggle)
- Client-Logik: `supabase.rpc("get_email_by_username", { p_username })` → dann `signInWithPassword({ email, password })`
- Kein Magic-Link mehr

### Nutzer "Kevintitan" anlegen
Über die neue **Admin-Seite in Settings** (Schritt 5) oder einmalig via `seed.sql`:
```sql
-- Nach Migration: in Supabase-Dashboard ausführen
SELECT auth.uid(); -- nur als Referenz
```
Der User wird direkt über das fertige "Nutzer anlegen"-Formular erstellt.

---

## 4. Types aktualisieren

**`src/lib/types.ts`**
- `Contact` + `Profile` Typen um alle neuen Felder erweitern
- `follow_up_number: 1 | 2 | 3 | null`

---

## 5. Server Actions aktualisieren

### `src/app/actions/contacts.ts`
- `ContactInput` und `createContact`/`updateContact`/Form-Varianten um die 5 neuen Felder erweitern

### `src/app/actions/workspace.ts`
- Neue Action `createUser(username, password)`: Admin-Client → `supabase.auth.admin.createUser({ email: username+"@pitchtracker.internal", password, email_confirm: true })` → INSERT into `profiles`
- Neue Action `listUsers()`: für die Settings-Seite (Nutzerliste)

---

## 6. UI-Designsystem

### `src/app/globals.css` (UMBAU)
Premium-Design-Tokens für Tailwind v4:
- Brand-Farbe: **Indigo** (`#6366f1`) als Primär-Akzent
- Semantische Tokens: `--color-brand`, `--color-surface`, `--color-border`, `--color-muted`
- Cards mit `box-shadow` Elevation-Scale
- CSS-Transitions für hover/focus

### Neue Packages
```bash
npm install lucide-react recharts
```
- `lucide-react`: konsistente SVG-Icons (kein Emoji als Icon)
- `recharts`: Charts für Dashboard (Balken- + Liniendiagramm)

---

## 7. Dashboard Layout (`src/app/(dashboard)/layout.tsx`) — UMBAU

- **Sidebar** (Desktop): aktiver Link visuell hervorgehoben (Indigo-Hintergrund + Bold), Icons via Lucide, Workspace-Name + Nutzer-Avatar oben
- **Mobile Drawer**: Hamburger-Button öffnet Sidebar als Overlay, `<dialog>` oder State-gesteuert
- **Trennlinien** zwischen Navigation, Listen, Settings/Logout
- Logout-Button: visuell separiert (rot/danger)

---

## 8. Dashboard-Seite (`src/app/(dashboard)/page.tsx`) — KOMPLETTER UMBAU

### Erinnerungs-Banner
- **"20 Pitches heute"**: zählt `contacts.created_at = today` workspace-weit → Progress-Bar + Text
- **Follow-up-Erinnerungen**: zeigt fällige Follow-ups mit Nummer (FU 1/2/3) und Prioritäts-Farbe

### Stat-Cards (Bento-Grid, 4-spaltig)
- Gesamt-Pitches | Antwortrate (%) | Terminrate (%) | Offene Follow-ups

### A/B-Vergleichs-Tabelle
- Pro Liste: Pitches, Antwortrate, Terminrate — für A/B-Testing-Übersicht

### Charts (recharts)
- Balkendiagramm: Pitches pro Tag (letzte 14 Tage)
- Einfaches Donut: Ja-/Nein-Antworten gesamt

---

## 9. List-Detail-Seite & `ListBoard.tsx` — UMBAU

### Neue Felder im Formular (Kontakt anlegen + bearbeiten)
Alle 7 Felder wie gewünscht:
1. **Name** (Pflicht)
2. **Datum** (`pitched_at` — Datepicker, Standard = heute)
3. **FollowUp-Nummer** (Dropdown: 1 / 2 / 3 / kein)
4. **Antwort?** (Toggle: Ja / Nein / —)
5. **Termin?** (Toggle: Ja / Nein / —)
6. **Was war die Antwort?** (`answer_text`, Textarea)
7. **Notizen** (Textarea)

### Tabellenzeilen
- Status-Badges für Antwort (grün/rot) und Termin (grün/grau)
- Follow-up-Nummer als farbiger Chip

### List-Stats-Header
- Pro Liste: Pitch-Datum-Verteilung, Antwortrate, Terminrate als Mini-Stat-Chips

---

## 10. Settings-Seite (`src/app/(dashboard)/settings/page.tsx`) — UMBAU

- **Workspace-Info**: Name + Einladungscode (wie bisher)
- **Nutzerverwaltung** (nur für `role = 'owner'`):
  - Liste aller Nutzer im Workspace (Name + Username)
  - Formular: Neuen Nutzer anlegen (Benutzername + Passwort)
  - Nutzer kann mit "Kevintitan" / "KW&SP.Commerce!" in diesem Schritt erstellt werden

---

## 11. `src/middleware.ts` — Hinweis

Build zeigt: `"middleware" file convention is deprecated. Please use "proxy" instead.` (Next.js 16). Die Datei wird zu **`src/proxy.ts`** umbenannt — Inhalt bleibt identisch.

---

## Ablauf nach Umsetzung

1. `npm run db:push` (nach Supabase-Login) — Migration einspielen
2. `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` setzen
3. App starten → Onboarding → Workspace anlegen → in Settings "Kevintitan" + Passwort anlegen
4. Login mit Benutzername + Passwort testen