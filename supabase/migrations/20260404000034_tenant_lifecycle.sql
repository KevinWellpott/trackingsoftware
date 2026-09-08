-- 0034 — Mandanten-Lebenszyklus: Standard-Kaskaden für jede Organisation
--
-- Setzt 0031 (template_catalog) und 0032 (pipeline_settings, cascade_steps) voraus.
--
-- Hier entstehen die Kaskaden aus der Ausarbeitung als DATEN: 3 Tage / 1 Tag /
-- 1 Stunde vor dem Termin, dazu die Ketten nach No-Show und nach einem
-- geplatzten Abschluss. Ohne diesen Schritt hätte eine neu angelegte
-- Kundenorganisation überhaupt keine Kaskade.
--
-- ABWEICHUNG VOM PLAN, bewusst: Der Plan wollte bootstrap_workspace() und
-- platform_create_workspace() beide anfassen. Stattdessen hängt das Seeding an
-- einem AFTER-INSERT-Trigger auf `workspaces`. Begründung ist genau die des
-- Plans — „ein Kunde entsteht über den einen Pfad, ein anderer über den
-- anderen": ein Trigger deckt beide ab und zusätzlich jeden künftigen Pfad,
-- ohne dass jemand daran denken muss. Die beiden Funktionen bleiben dadurch
-- unangetastet, was das Verifikationsfenster vor dem Merge schont.

-- ---------------------------------------------------------------------------
-- 1. seed_workspace_defaults — idempotent
-- ---------------------------------------------------------------------------
-- Legt die STRUKTUR an (eine pipeline_settings-Zeile, die Kaskadenstufen),
-- aber KEINE message_templates-Zeile: eine geseedete Textkopie je Organisation
-- friert den Auslieferungstext ein, erreicht Bestandskunden nicht mehr und
-- macht den Quelle-Badge blind für „nie angefasst" gegen „bewusst geändert".

create or replace function public.seed_workspace_defaults (p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pipeline_settings (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  -- offset_minutes in Minuten, damit „3 Tage vorher" (4320) und „1 Stunde
  -- vorher" (60) in derselben Einheit liegen.
  insert into public.cascade_steps
    (workspace_id, cascade_kind, step_no, trigger_event, anchor, offset_minutes,
     requires_no_response, enabled, template_key)
  values
    -- Erstgespräch: Bestätigung, Vorfreude, Link
    (p_workspace_id, 'setting_msg',  1, 'scheduled', 'before_appointment', 4320, false, true,  'setting_msg_1'),
    (p_workspace_id, 'setting_msg',  2, 'scheduled', 'before_appointment', 1440, false, true,  'setting_msg_2'),
    (p_workspace_id, 'setting_msg',  3, 'scheduled', 'before_appointment',   60, false, true,  'setting_msg_3'),

    -- Mail-Spur: als Struktur vorhanden, aber abgeschaltet (Phase 2)
    (p_workspace_id, 'setting_mail', 1, 'scheduled', 'before_appointment', 1440, false, false, 'setting_mail_1'),
    (p_workspace_id, 'setting_mail', 2, 'scheduled', 'before_appointment',   60, false, false, 'setting_mail_2'),

    -- Closing: gleiche Abstände, eigene Texte
    (p_workspace_id, 'closing_msg',  1, 'scheduled', 'before_appointment', 4320, false, true,  'closing_msg_1'),
    (p_workspace_id, 'closing_msg',  2, 'scheduled', 'before_appointment', 1440, false, true,  'closing_msg_2'),
    (p_workspace_id, 'closing_msg',  3, 'scheduled', 'before_appointment',   60, false, true,  'closing_msg_3'),

    -- Closing-Mail beginnt laut Ausarbeitung zwei Tage vorher, nicht einen
    (p_workspace_id, 'closing_mail', 1, 'scheduled', 'before_appointment', 2880, false, false, 'closing_mail_1'),
    (p_workspace_id, 'closing_mail', 2, 'scheduled', 'before_appointment', 1440, false, false, 'closing_mail_2'),
    (p_workspace_id, 'closing_mail', 3, 'scheduled', 'before_appointment',   60, false, false, 'closing_mail_3'),

    -- Vereinbarter Nachfass-Kontakt
    (p_workspace_id, 'followup_msg', 1, 'scheduled', 'before_appointment', 4320, false, true,  'followup_msg_1'),
    (p_workspace_id, 'followup_msg', 2, 'scheduled', 'before_appointment', 1440, false, true,  'followup_msg_2'),
    (p_workspace_id, 'followup_msg', 3, 'scheduled', 'before_appointment',   60, false, true,  'followup_msg_3'),

    -- „HIER WIRD IMMER EINE TELEFONNUMMER EINGESAMMELT — direkt eine
    -- WhatsApp-Nachricht im oder nach dem Meeting": sofort beim Anlegen fällig.
    (p_workspace_id, 'closing_kickoff', 1, 'created', 'after_appointment', 0, false, true, 'closing_kickoff'),

    -- No-Show: sofort im Termin, dann einen Tag später — die zweite Stufe nur,
    -- wenn keine Antwort kam. Das ist wörtlich der Pfeil „keine Antwort"
    -- zwischen Nachfassen 1 und Nachfassen 2.
    (p_workspace_id, 'no_show_setting', 1, 'no_show', 'after_appointment',    0, false, true, 'no_show_setting_1'),
    (p_workspace_id, 'no_show_setting', 2, 'no_show', 'after_appointment', 1440, true,  true, 'no_show_setting_2'),
    (p_workspace_id, 'no_show_closing', 1, 'no_show', 'after_appointment',    0, false, true, 'no_show_closing_1'),
    (p_workspace_id, 'no_show_closing', 2, 'no_show', 'after_appointment', 1440, true,  true, 'no_show_closing_2'),

    -- Kein Close: dieselbe Zweistufigkeit
    (p_workspace_id, 'kein_close', 1, 'no_close', 'after_appointment',    0, false, true, 'kein_close_1'),
    (p_workspace_id, 'kein_close', 2, 'no_close', 'after_appointment', 1440, true,  true, 'kein_close_2')
  on conflict (workspace_id, cascade_kind, step_no) do nothing;
end;
$$;

comment on function public.seed_workspace_defaults (uuid) is
  'Legt Konfiguration und Standard-Kaskaden einer Organisation an. Idempotent — bereits geänderte Stufen bleiben unangetastet. Legt bewusst keine Textzeilen an.';

grant execute on function public.seed_workspace_defaults (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Jede neue Organisation wird geseedet — unabhängig vom Anlagepfad
-- ---------------------------------------------------------------------------

create or replace function public.workspaces_seed_defaults ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_workspace_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists workspaces_seed_defaults on public.workspaces;
create trigger workspaces_seed_defaults
  after insert on public.workspaces
  for each row execute function public.workspaces_seed_defaults ();

-- ---------------------------------------------------------------------------
-- 3. Bestehende Organisationen nachziehen
-- ---------------------------------------------------------------------------

do $$
declare
  w record;
begin
  for w in select id from public.workspaces loop
    perform public.seed_workspace_defaults(w.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. followup_templates übernehmen
-- ---------------------------------------------------------------------------
-- Die alte Pro-Nutzer-Tabelle hat keine Oberfläche mehr, ihre Zeilen wirken
-- aber weiter und schlagen den Standardtext — unsichtbar für den Nutzer. Sie
-- ziehen hier in message_templates um.
--
-- Die Tabelle selbst BLEIBT vorerst stehen (Muster call_assignees): ein
-- `drop table` vor dem Merge träfe das ausgelieferte main, das sie in
-- actions/nachfassen.ts ohne Fehlerprüfung liest — Nutzer mit eigenen Texten
-- bekämen im Verifikationsfenster stillschweigend den Standardtext. Gedroppt
-- wird sie in einer späteren Migration nach verifiziertem Rollout.

insert into public.message_templates (workspace_id, user_id, template_key, body)
select ft.workspace_id,
       ft.user_id,
       'linkedin_fu_' || ft.fu_number,
       ft.body
  from public.followup_templates ft
 where btrim(coalesce(ft.body, '')) <> ''
   and ft.fu_number between 1 and 3
   and exists (select 1 from public.workspace_members wm
               where wm.workspace_id = ft.workspace_id and wm.user_id = ft.user_id)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Verifikation (nach dem Einspielen im SQL-Editor ausführen)
-- ---------------------------------------------------------------------------
-- Jede Organisation hat Konfiguration und Kaskaden — beide müssen 0 ergeben:
--   select count(*) from public.workspaces w
--    where not exists (select 1 from public.pipeline_settings ps where ps.workspace_id = w.id);
--   select count(*) from public.workspaces w
--    where not exists (select 1 from public.cascade_steps cs where cs.workspace_id = w.id);
--
-- Je Organisation 21 Stufen, davon 5 abgeschaltete Mail-Stufen:
--   select workspace_id, count(*) filter (where enabled) as aktiv, count(*) as gesamt
--     from public.cascade_steps group by 1;
--   -- erwartet: aktiv = 16, gesamt = 21
--
-- Die Ketten-Zweitstufen verlangen ausbleibende Antwort — 3 je Organisation:
--   select workspace_id, count(*) from public.cascade_steps
--    where requires_no_response group by 1;
--   -- erwartet je Zeile: 3 (no_show_setting_2, no_show_closing_2, kein_close_2)
--
-- Übernommene Nutzer-Vorlagen:
--   select count(*) from public.message_templates where user_id is not null;
--
-- NOCH OFFEN (Modul M17, eigener Schritt): move_user_scope() und
-- preview_delete_workspace() kennen message_templates, cascade_steps,
-- pipeline_settings und reminder_touches noch nicht. Bis dahin bleiben beim
-- Nutzer-Umzug persönliche Vorlagen in der alten Organisation zurück, und die
-- Löschvorschau nennt weniger Tabellen als sie löscht. Beides ist heute schon
-- so und wird durch diese Migration nicht schlimmer — aber es ist offen.
