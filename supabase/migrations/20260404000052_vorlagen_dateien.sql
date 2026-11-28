-- 0052 — Dateien an Fulfillment-Vorlagen
--
-- 0001–0051 sind eingespielt bzw. geschrieben; keine Zeile dieser Datei ändert
-- eine davon. Rein additiv: eine Tabelle, ein privater Storage-Bucket, RLS.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WARUM
--
--  Zu einer Vorlage (/kunden/vorlagen) gehören oft Unterlagen: Onboarding-PDF,
--  Briefing-Vorlage, Präsentation. Bisher ließ sich nur die Checkliste pflegen.
--  Jetzt hängen Dateien direkt an der Vorlage.
--
--  ENTWURF (Muster kunden_ablage, 0047)
--  · Tabelle `fulfillment_vorlage_dateien`: eine Zeile je Datei, FK auf die
--    Vorlage mit `on delete cascade` (Vorlage gelöscht → Zeilen weg; die
--    Objekte im Bucket räumt die App mit).
--  · Bucket `vorlagen-dateien`, PRIVAT, 50 MB je Datei. Pfad:
--    <vorlage_id>/<zufall>-<dateiname>. Hochladen nur in eine existierende
--    Vorlage (erstes Pfadsegment = Vorlagen-ID).
--  · Lesen, Schreiben, Löschen: nur Mitglieder des internen Bereichs
--    (`is_intern_member()`, wie Vorlagen selbst). Kein workspace_id —
--    Vorlagen sind Titans internes Werkzeug, keine Kundendaten.
--
--  EINSPIELEN: Reihenfolge zum Deploy frei. Ohne die Datei zeigt die Vorlage
--  einen Hinweis statt der Dateiliste, Hochladen meldet „Migration 0052 fehlt“.
--  Ganze Datei, nichts markieren, danach den Verifikationsblock.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.fulfillment_vorlage_dateien (
  id                 uuid primary key default gen_random_uuid(),
  vorlage_id         uuid not null references public.fulfillment_vorlagen(id) on delete cascade,
  titel              text not null check (length(btrim(titel)) > 0),
  dateiname          text not null,
  storage_path       text not null unique,
  groesse_bytes      bigint check (groesse_bytes is null or groesse_bytes >= 0),
  mime               text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists fulfillment_vorlage_dateien_idx on public.fulfillment_vorlage_dateien (vorlage_id, created_at);

comment on table public.fulfillment_vorlage_dateien is
  'Dateien an Fulfillment-Vorlagen (0052). Objekte im privaten Bucket vorlagen-dateien, Pfad <vorlage_id>/<datei>.';

alter table public.fulfillment_vorlage_dateien enable row level security;
drop policy if exists fulfillment_vorlage_dateien_intern on public.fulfillment_vorlage_dateien;
create policy fulfillment_vorlage_dateien_intern on public.fulfillment_vorlage_dateien for all to authenticated
  using ((select public.is_intern_member())) with check ((select public.is_intern_member()));

-- ── Storage ────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('vorlagen-dateien', 'vorlagen-dateien', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists vorlagen_dateien_objects_select on storage.objects;
create policy vorlagen_dateien_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'vorlagen-dateien' and (select public.is_intern_member()));
drop policy if exists vorlagen_dateien_objects_insert on storage.objects;
create policy vorlagen_dateien_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vorlagen-dateien'
              and (select public.is_intern_member())
              and split_part(name, '/', 1) in (select id::text from public.fulfillment_vorlagen));
drop policy if exists vorlagen_dateien_objects_delete on storage.objects;
create policy vorlagen_dateien_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vorlagen-dateien' and (select public.is_intern_member()));

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFIKATION (nach dem Einspielen einzeln ausführen)
--
--  V1  Tabelle mit RLS — erwartet: 1 Zeile, relrowsecurity = t
--      select relname, relrowsecurity from pg_class where relname = 'fulfillment_vorlage_dateien';
--
--  V2  Bucket privat — erwartet: 1 Zeile, public = f, 52428800
--      select id, public, file_size_limit from storage.buckets where id = 'vorlagen-dateien';
--
--  V3  Drei Storage-Policies — erwartet: 3
--      select count(*) from pg_policies where schemaname = 'storage' and policyname like 'vorlagen_dateien_objects_%';
-- ═══════════════════════════════════════════════════════════════════════════
