-- ###########################################################################
-- #  NACHTRÄGLICH ERGÄNZT AM 10. SEPTEMBER 2026 — nur dieser Block.
-- #
-- #  DIESE MIGRATION IST EINGESPIELT UND DAMIT EINGEFROREN.
-- #  Alles ab der nächsten Zeile ist HISTORIE: Warnungen wie "noch nicht
-- #  einspielen" oder "erst nach dem Deploy" beschreiben, warum sie
-- #  seinerzeit warten musste — sie sind keine offenen Anweisungen mehr.
-- #
-- #  Keine Zeile SQL wurde nachträglich geändert. Die nächste
-- #  Schema-Änderung braucht eine neue Nummer, beginnend bei 0041.
-- ###########################################################################
-- ---------------------------------------------------------------------------
-- 0039 — apply_reminder_touches prüft den TERMIN und die ZUWEISUNG
-- ---------------------------------------------------------------------------
--
-- NICHT EINGESPIELT. 0031-0038 liegen fest; diese Datei ist der Nachtrag zu
-- einem Befund an 0032 und läuft erst nach Merge und Deploy.
--
-- Warum überhaupt: `apply_reminder_touches()` ist `security definer` und läuft
-- damit an der Zeilensicherheit vorbei. Geprüft wurde bisher nur, ob der
-- Aufrufer Mitglied von `p_workspace_id` ist — `p_entity_id` und die
-- `assigned_user_id` aus `p_rows` wurden ungeprüft übernommen. Server Actions
-- sind nicht der einzige Weg hierher; ein direkter POST auf
-- /rest/v1/rpc/apply_reminder_touches genügt. Zwei Lücken folgten daraus:
--
--  1. `p_entity_id` durfte ein Termin einer FREMDEN Organisation sein. Der
--     Fremdschlüssel akzeptiert ihn, die Erinnerung landet aber mit der
--     `workspace_id` des Aufrufers in dessen Organisation. Das verletzt die
--     Invariante aus 0036 („keine Erinnerung liegt in einer anderen
--     Organisation als ihr Termin") und kaskadiert beim Löschen der fremden
--     Organisation stillschweigend mit. Auslesen ließ sich die Zeile dabei
--     nicht — die Nachschläge laufen weiter durch die RLS —, der Schaden ist
--     Integrität, nicht Vertraulichkeit.
--
--  2. `assigned_user_id` durfte ein beliebiger Kollege sein, auch für einen
--     Aufrufer mit `data_scope='own'`. Genau das hätte die RLS-Policy
--     `reminder_touches_scoped_member` per WITH CHECK abgewiesen; die
--     Definer-Funktion umgeht sie. Ein Mitglied mit eingeschränkter Datensicht
--     konnte damit in den Posteingang eines Kollegen schreiben und dessen
--     Auswertung „Erinnerungs-Disziplin" verfälschen.
--
-- 0037 hat denselben Prüfblock für `schedule_recycle`/`recycle_attempt`
-- nachgezogen und `apply_reminder_touches` dabei als Vorbild bezeichnet — das
-- Vorbild prüfte aber nur die halbe Frage.
--
-- Signatur und Rückgabetyp bleiben unverändert, `create or replace` genügt;
-- bestehende Grants bleiben bestehen. Der Rumpf ist wörtlich der aus 0032, nur
-- der Prüfblock am Kopf ist länger.
--
-- Zusätzlich hängt `reminder_touches_ws_guard` künftig auch am INSERT. Er stand
-- als `before update of workspace_id, assigned_user_id` und feuerte damit nur
-- beim Nutzer-Umzug — eine heimatlose Erinnerung konnte er zwar nachträglich
-- entwerten, aber nicht verhindern. Die Funktion selbst bleibt unverändert und
-- ist bereits idempotent formuliert.

-- ---------------------------------------------------------------------------
-- 1. apply_reminder_touches — Prüfblock erweitert
-- ---------------------------------------------------------------------------

create or replace function public.apply_reminder_touches (
  p_workspace_id uuid,
  p_entity_type  text,
  p_entity_id    uuid,
  p_cascade_kind text,
  p_rows         jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_scope    text;
begin
  -- (a) Gehört der Aufrufer überhaupt zur Organisation? Unverändert aus 0032.
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  ) and not public.is_platform_admin() then
    raise exception 'Kein Zugriff auf diese Organisation';
  end if;

  if p_entity_type not in ('setting', 'closing', 'closing_followup') then
    raise exception 'Unbekannter Erinnerungs-Ursprung: %', p_entity_type;
  end if;

  -- (b) Liegt der TERMIN in dieser Organisation? Ohne diese Prüfung schreibt
  --     eine fremde Termin-ID eine Erinnerung in die Organisation des
  --     Aufrufers. 'closing_followup' hängt am selben Closing wie 'closing' —
  --     er ist der vereinbarte Nachfass-Kontakt, kein eigener Datensatz.
  if p_entity_type = 'setting' then
    if not exists (
      select 1 from public.setting_calls sc
      where sc.id = p_entity_id and sc.workspace_id = p_workspace_id
    ) then
      raise exception 'Termin gehört nicht zu dieser Organisation';
    end if;
  else
    if not exists (
      select 1 from public.closing_calls cc
      where cc.id = p_entity_id and cc.workspace_id = p_workspace_id
    ) then
      raise exception 'Termin gehört nicht zu dieser Organisation';
    end if;
  end if;

  -- (c) Zeigt jede Zuweisung auf ein Mitglied DIESER Organisation? Sonst
  --     entstünde genau die heimatlose Erinnerung, die 0036 als Invariante
  --     ausschließt: sie taucht in keinem „Meine Erinnerungen" auf und
  --     erscheint in der Team-Ansicht unter einem fremden Namen.
  if p_rows is not null and exists (
    select 1
      from jsonb_array_elements(p_rows) as r
     where (r ->> 'assigned_user_id') is null
        or not exists (
             select 1 from public.workspace_members wm
             where wm.workspace_id = p_workspace_id
               and wm.user_id = (r ->> 'assigned_user_id')::uuid
           )
  ) then
    raise exception 'Zuständige Person gehört nicht zu dieser Organisation';
  end if;

  -- (d) Dieselbe Grenze, die `data_scope='own'` sonst überall zieht: Wer nur
  --     eigene Daten sieht, darf auch nur sich selbst Erinnerungen anlegen.
  --     Genau das steht im WITH CHECK von `reminder_touches_scoped_member`,
  --     das diese Definer-Funktion umgeht. Ein Plattform-Admin hat hier keine
  --     Mitgliedschaft und damit kein `data_scope` — für ihn greift (c).
  select wm.data_scope into v_scope
    from public.workspace_members wm
   where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid();

  if v_scope = 'own' and p_rows is not null and exists (
    select 1 from jsonb_array_elements(p_rows) as r
     where (r ->> 'assigned_user_id')::uuid is distinct from auth.uid()
  ) then
    raise exception 'Mit eingeschränkter Datensicht lassen sich nur eigene Erinnerungen anlegen';
  end if;

  update public.reminder_touches
     set superseded_at = now()
   where workspace_id = p_workspace_id
     and entity_type  = p_entity_type
     and entity_id    = p_entity_id
     and cascade_kind = p_cascade_kind
     and superseded_at is null;

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  insert into public.reminder_touches (
    workspace_id, created_by_user_id,
    setting_call_id, closing_call_id, entity_type,
    touch_kind, cascade_kind, step_no, requires_no_response,
    template_key, assigned_user_id, due_at, appointment_at, channel
  )
  select
    p_workspace_id,
    auth.uid(),
    case when p_entity_type = 'setting' then p_entity_id end,
    case when p_entity_type in ('closing', 'closing_followup') then p_entity_id end,
    p_entity_type,
    coalesce(r ->> 'touch_kind', 'cascade'),
    p_cascade_kind,
    (r ->> 'step_no')::smallint,
    coalesce((r ->> 'requires_no_response')::boolean, false),
    r ->> 'template_key',
    (r ->> 'assigned_user_id')::uuid,
    (r ->> 'due_at')::timestamptz,
    (r ->> 'appointment_at')::timestamptz,
    nullif(r ->> 'channel', '')
  from jsonb_array_elements(p_rows) as r;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

grant execute on function public.apply_reminder_touches (uuid, text, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. reminder_touches_ws_guard zusätzlich am INSERT
-- ---------------------------------------------------------------------------
-- Die Funktion aus 0032 bleibt unangetastet: Zeigt die Zuweisung auf jemanden,
-- der in dieser Organisation kein Mitglied ist, wird die Zeile entwertet statt
-- gelöscht — die Erledigungs-Historie bleibt zählbar. Als reiner UPDATE-Trigger
-- deckte sie nur den Nutzer-Umzug ab; ein direkter INSERT durch die RLS (die
-- über `created_by_user_id` ODER `assigned_user_id` prüft) lief daran vorbei.
--
-- Das ist der zweite, unabhängige Riegel neben (c) oben: die Definer-Funktion
-- wirft, dieser Trigger entwertet — je nachdem, auf welchem Weg die Zeile kommt.

drop trigger if exists reminder_touches_ws_guard_ins on public.reminder_touches;
create trigger reminder_touches_ws_guard_ins
  before insert on public.reminder_touches
  for each row execute function public.reminder_touches_ws_guard ();

-- ---------------------------------------------------------------------------
-- Verifikation
-- ---------------------------------------------------------------------------
--
-- A) Stehen beide neuen Prüfungen in der Funktion? Muss 1 Zeile liefern:
--
--      select p.proname
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname = 'apply_reminder_touches'
--         and pg_get_functiondef(p.oid) like '%Termin gehört nicht zu dieser Organisation%'
--         and pg_get_functiondef(p.oid) like '%Zuständige Person gehört nicht%';
--
-- B) Hängt der Guard jetzt an beiden Ereignissen? Muss 2 Zeilen liefern
--    (reminder_touches_ws_guard = UPDATE, reminder_touches_ws_guard_ins = INSERT):
--
--      select tgname from pg_trigger
--       where tgrelid = 'public.reminder_touches'::regclass
--         and tgname like 'reminder_touches_ws_guard%';
--
-- C) Die Invariante aus 0036 Punkt B — muss weiterhin 0 ergeben:
--
--      select count(*) from public.reminder_touches rt
--       where rt.superseded_at is null
--         and not exists (select 1 from public.workspace_members wm
--                          where wm.user_id = rt.assigned_user_id
--                            and wm.workspace_id = rt.workspace_id);
--
-- D) Gegenprobe, dass die Funktion im Normalbetrieb NICHT wirft: einen Termin
--    speichern oder verschieben und danach prüfen, dass seine Kaskade steht.
--    Nicht im SQL-Editor absetzen — dort ist `auth.uid()` NULL und der erste
--    Prüfblock wirft (derselbe Hinweis wie in 0037).
