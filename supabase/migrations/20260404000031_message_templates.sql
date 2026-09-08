-- 0031 — Vorlagen-Katalog und message_templates
--
-- ERSETZT die frühere Fassung 20260404000031_reminder_cascade.sql. Beide alten
-- Migrationen (Kaskade, Recycling) wurden auf KEINER Datenbank eingespielt und
-- werden deshalb neu geschnitten statt durch Korrektur-Migrationen ergänzt.
--
-- Diese Datei legt ausschließlich das Vorlagen-Fundament. Sie ist Voraussetzung
-- für 0032 (Kaskade) und 0033 (Recycling), weil cascade_steps auf
-- template_catalog verweist.
--
-- Warum überhaupt: Die Nachrichtentexte der App lagen auf VIER Speichermodellen
-- nebeneinander — lists.fuN_text, followup_templates (ohne Oberfläche),
-- reminder_settings, recycle_settings, dazu hartkodierte Texte in
-- actions/nachfassen.ts. Ab hier gibt es eine Tabelle, einen Platzhalter-Dialekt
-- (src/lib/messageTemplates.ts) und eine Vorrangkette:
--     Liste  >  persönlich  >  Organisation  >  Auslieferungstext
--
-- Die AUSLIEFERUNGSTEXTE stehen bewusst NICHT hier, sondern ausschließlich in
-- TEMPLATE_DEFAULTS (TypeScript). Eine Zeile in message_templates entsteht erst,
-- wenn jemand einen Text bewusst ändert; ein geleertes Feld löscht sie wieder.
-- Damit können SQL und TS nicht auseinanderlaufen (das war die Doppelung, an der
-- DEFAULT_REMINDER_SETTINGS und die SQL-DEFAULTs hingen), und eine
-- Textverbesserung erreicht jeden Kunden, der den Text nie angefasst hat.

-- ---------------------------------------------------------------------------
-- 1. Ein Prädikat für Organisations-Einstellungen, das App und RLS teilen
-- ---------------------------------------------------------------------------
-- Bisher prüfte die App `role='owner' && data_scope='workspace'` (access.ts),
-- die RLS aber nur `role='owner'`. Ein Owner mit data_scope='own' war in der
-- Oberfläche gesperrt, hätte per direktem PostgREST-Aufruf aber schreiben
-- dürfen. Ein benannter Helfer schließt das dauerhaft statt einmalig.

create or replace function public.can_manage_org_settings (p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
        and coalesce(wm.data_scope, 'workspace') = 'workspace'
    );
$$;

comment on function public.can_manage_org_settings (uuid) is
  'Darf der Aufrufer die Einstellungen dieser Organisation ändern? Owner mit workspace-weiter Datensicht oder Plattform-Admin. App und RLS benutzen wörtlich dasselbe Prädikat.';

grant execute on function public.can_manage_org_settings (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. template_catalog — welche Nachrichten es gibt
-- ---------------------------------------------------------------------------
-- Liefert Beschriftung, Gruppierung und Platzhalter-Hilfe für den Editor und
-- ist FK-Ziel für message_templates und (in 0032) cascade_steps.
--
-- Abweichung von der Plan-Skizze, bewusst: `group_key` kennt keinen Wert 'mail'.
-- Eine Mail-Stufe gehört fachlich zu Erstgespräch bzw. Closing — stünde sie in
-- einer eigenen Gruppe, bräuchte derselbe Key zwei Gruppen. Die Unterscheidung
-- trägt stattdessen `is_mail`, das ohnehin gebraucht wird.

create table if not exists public.template_catalog (
  template_key text primary key,
  label        text not null,
  group_key    text not null check (
                 group_key in ('setting', 'closing', 'followup', 'no_show',
                               'kein_close', 'recycling', 'linkedin', 'aufgaben')
               ),
  placeholders text[] not null default '{}',
  sort_order   integer not null,
  is_mail      boolean not null default false
);

comment on table public.template_catalog is
  'Katalog der Nachrichtenarten. Bewusst OHNE Textkörper — die Auslieferungstexte stehen ausschließlich in TEMPLATE_DEFAULTS (src/lib/messageTemplates.ts).';

-- Der Katalog wird bei jedem Einspielen abgeglichen: neue Keys kommen dazu,
-- bestehende bekommen aktuelle Beschriftung und Platzhalter. Zeilen werden nie
-- gelöscht, damit ein FK aus message_templates nicht ins Leere zeigt.
insert into public.template_catalog (template_key, label, group_key, placeholders, sort_order, is_mail) values
  ('setting_msg_1',        '1. Erinnerung',                          'setting',    array['vorname','name','firma','datum','uhrzeit'],                 10, false),
  ('setting_msg_2',        '2. Erinnerung',                          'setting',    array['vorname','name','firma','datum','uhrzeit'],                 11, false),
  ('setting_msg_3',        '3. Erinnerung',                          'setting',    array['vorname','name','firma','datum','uhrzeit','link'],          12, false),
  ('setting_mail_1',       '1. Erinnerungs-Mail',                    'setting',    array['vorname','name','firma','datum','uhrzeit','absender'],      13, true),
  ('setting_mail_2',       '2. Erinnerungs-Mail',                    'setting',    array['vorname','name','firma','datum','uhrzeit','link','absender'], 14, true),

  ('closing_kickoff',      'Nachricht nach der Qualifizierung',      'closing',    array['vorname','name','firma','datum','uhrzeit'],                 20, false),
  ('closing_msg_1',        '1. Erinnerung',                          'closing',    array['vorname','name','firma','datum','uhrzeit'],                 21, false),
  ('closing_msg_2',        '2. Erinnerung',                          'closing',    array['vorname','name','firma','datum','uhrzeit'],                 22, false),
  ('closing_msg_3',        '3. Erinnerung',                          'closing',    array['vorname','name','firma','datum','uhrzeit','link'],          23, false),
  ('closing_mail_1',       '1. Erinnerungs-Mail',                    'closing',    array['vorname','name','firma','datum','uhrzeit','absender'],      24, true),
  ('closing_mail_2',       '2. Erinnerungs-Mail',                    'closing',    array['vorname','name','firma','datum','uhrzeit','absender'],      25, true),
  ('closing_mail_3',       '3. Erinnerungs-Mail',                    'closing',    array['vorname','name','firma','datum','uhrzeit','link','absender'], 26, true),

  ('followup_msg_1',       '1. Erinnerung',                          'followup',   array['vorname','name','firma','datum','uhrzeit'],                 30, false),
  ('followup_msg_2',       '2. Erinnerung',                          'followup',   array['vorname','name','firma','datum','uhrzeit'],                 31, false),
  ('followup_msg_3',       '3. Erinnerung',                          'followup',   array['vorname','name','firma','datum','uhrzeit'],                 32, false),

  ('no_show_setting_1',    'Erstgespräch — sofort',                  'no_show',    array['vorname','name','firma','datum','uhrzeit'],                 40, false),
  ('no_show_setting_2',    'Erstgespräch — Tag danach',              'no_show',    array['vorname','name','firma','datum','uhrzeit'],                 41, false),
  ('no_show_closing_1',    'Closing — sofort',                       'no_show',    array['vorname','name','firma','datum','uhrzeit'],                 42, false),
  ('no_show_closing_2',    'Closing — Tag danach',                   'no_show',    array['vorname','name','firma','datum','uhrzeit'],                 43, false),

  ('kein_close_1',         'Sofort nach dem Termin',                 'kein_close', array['vorname','name','firma','notiz'],                           50, false),
  ('kein_close_2',         'Tag danach',                             'kein_close', array['vorname','name','firma','notiz'],                           51, false),

  ('recycle_linkedin',     'LinkedIn-Kontakt',                       'recycling',  array['vorname','name','firma','anlass','notiz'],                  60, false),
  ('recycle_telefon',      'Telefon-Lead',                           'recycling',  array['vorname','name','firma','anlass','notiz'],                  61, false),
  ('recycle_setting',      'Erstgespräch',                           'recycling',  array['vorname','name','firma','anlass','notiz'],                  62, false),
  ('recycle_closing',      'Closing',                                'recycling',  array['vorname','name','firma','anlass','notiz'],                  63, false),

  ('linkedin_fu_1',        'Follow-up 1',                            'linkedin',   array['name','vorname','firma'],                                   70, false),
  ('linkedin_fu_2',        'Follow-up 2',                            'linkedin',   array['name','vorname','firma'],                                   71, false),
  ('linkedin_fu_3',        'Follow-up 3',                            'linkedin',   array['name','vorname','firma'],                                   72, false),

  ('telefon_rueckruf',     'Telefon-Rückruf',                        'aufgaben',   array['vorname','name','firma'],                                   80, false),
  ('setting_wiedervorlage','Erstgespräch-Wiedervorlage',             'aufgaben',   array['vorname','name','firma'],                                   81, false),
  ('closing_wiedervorlage','Closing-Wiedervorlage',                  'aufgaben',   array['vorname','name','firma'],                                   82, false)
on conflict (template_key) do update set
  label        = excluded.label,
  group_key    = excluded.group_key,
  placeholders = excluded.placeholders,
  sort_order   = excluded.sort_order,
  is_mail      = excluded.is_mail;

-- Der Katalog ist für jedes angemeldete Konto lesbar (die Oberfläche braucht
-- Beschriftung und Platzhalter-Hilfe) und für niemanden schreibbar — er ändert
-- sich nur mit einer Migration.
alter table public.template_catalog enable row level security;

drop policy if exists template_catalog_select on public.template_catalog;
create policy template_catalog_select on public.template_catalog
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3. message_templates — die abweichenden Texte
-- ---------------------------------------------------------------------------
-- user_id is null  = Standard der Organisation (der Owner pflegt ihn)
-- user_id gesetzt  = persönliche Übersteuerung (jeder pflegt seine eigene)
--
-- Keine channel-Spalte: ein Text je Stufe gilt für WhatsApp, LinkedIn und
-- Telefon gleichermaßen. Wer für einen Kanal anders formulieren will, ändert
-- den Text vor dem Absenden — die Karte ist eine Kopier-Werkbank.

create table if not exists public.message_templates (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  user_id            uuid references auth.users (id) on delete cascade,
  template_key       text not null references public.template_catalog (template_key),
  subject            text,
  body               text not null check (btrim(body) <> ''),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by_user_id uuid references auth.users (id) on delete set null
);

comment on column public.message_templates.user_id is
  'NULL = Standard der Organisation. Gesetzt = persönliche Übersteuerung dieses Nutzers.';
comment on column public.message_templates.subject is
  'Nur für Mail-Vorlagen (template_catalog.is_mail). Trägt die Betreffzeile ohne zweite Tabelle.';

-- Zwei partielle Unique-Indizes trennen die beiden Ebenen, ohne zwei Tabellen
-- zu brauchen. workspace_id steht im persönlichen Index — followup_templates
-- (0011) hat nur unique(user_id, fu_number) und wird dadurch beim Nutzer-Umzug
-- mehrdeutig.
create unique index if not exists uq_message_templates_org
  on public.message_templates (workspace_id, template_key)
  where user_id is null;

create unique index if not exists uq_message_templates_user
  on public.message_templates (workspace_id, user_id, template_key)
  where user_id is not null;

create index if not exists idx_message_templates_ws_user
  on public.message_templates (workspace_id, user_id);

drop trigger if exists message_templates_touch on public.message_templates;
create trigger message_templates_touch
  before update on public.message_templates
  for each row execute function public.touch_updated_at ();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- Der Owner besitzt den Standard, jeder Nutzer besitzt seine Übersteuerung.
-- Fremde persönliche Texte sieht nur, wer sie im Supportfall erklären muss —
-- deshalb select über can_access_owned_workspace_row statt für alle Mitglieder.

alter table public.message_templates enable row level security;

drop policy if exists message_templates_select on public.message_templates;
create policy message_templates_select on public.message_templates
  for select to authenticated
  using (
    user_id is null
      and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = message_templates.workspace_id
          and wm.user_id = auth.uid()
      )
    or public.can_access_owned_workspace_row(workspace_id, user_id)
  );

drop policy if exists message_templates_org on public.message_templates;
create policy message_templates_org on public.message_templates
  for all to authenticated
  using (user_id is null and public.can_manage_org_settings(workspace_id))
  with check (user_id is null and public.can_manage_org_settings(workspace_id));

-- Die eigene Zeile immer auf auth.uid(), NICHT auf die eingestellte Datensicht:
-- sonst überschreibt ein Owner mit aktiver Datensicht unbemerkt den Text eines
-- Kollegen (heutiges Verhalten in actions/templates.ts).
drop policy if exists message_templates_own on public.message_templates;
create policy message_templates_own on public.message_templates
  for all to authenticated
  using (
    user_id = auth.uid()
      and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = message_templates.workspace_id
          and wm.user_id = auth.uid()
      )
  )
  with check (
    user_id = auth.uid()
      and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = message_templates.workspace_id
          and wm.user_id = auth.uid()
      )
  );

drop policy if exists message_templates_platform_admin on public.message_templates;
create policy message_templates_platform_admin on public.message_templates
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Verifikation (nach dem Einspielen im SQL-Editor ausführen)
-- ---------------------------------------------------------------------------
-- Katalog vollständig — muss 31 ergeben:
--   select count(*) from public.template_catalog;
--
-- Kein Text im Katalog (die Auslieferungstexte gehören nach TypeScript):
--   select count(*) from information_schema.columns
--    where table_name = 'template_catalog' and column_name in ('body','text');
--   -- erwartet: 0
--
-- Beide Ebenen sind eindeutig — beide Statements müssen fehlschlagen:
--   insert into public.message_templates (workspace_id, template_key, body)
--     select id, 'setting_msg_1', 'A' from public.workspaces limit 1;
--   insert into public.message_templates (workspace_id, template_key, body)
--     select id, 'setting_msg_1', 'B' from public.workspaces limit 1;
--
-- Leerer Text wird abgewiesen:
--   insert into public.message_templates (workspace_id, template_key, body)
--     select id, 'setting_msg_2', '   ' from public.workspaces limit 1;
