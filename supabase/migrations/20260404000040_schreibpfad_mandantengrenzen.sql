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
-- 0040 — Drei Schreibpfade, die die Mandantengrenze nicht zu Ende ziehen
-- ---------------------------------------------------------------------------
--
-- NICHT EINGESPIELT. 0031-0034, 0036 und 0037 liegen auf der Produktions-
-- Datenbank und sind eingefroren; 0035, 0038 und 0039 sind geschrieben und
-- warten. Korrigiert wird ausschließlich über diese Datei.
--
-- WANN EINSPIELEN: vor ODER nach dem Deploy, beides ist gefahrlos — aber am
-- besten VORHER. Die Datei verschärft ausschließlich Prüfungen und nimmt
-- niemandem etwas weg, was die Oberfläche heute tut:
--
--   * Teil 1 wirft erst bei `data_scope='own'` UND einer fremden Zeile. Genau
--     diese Zeile liefert `recycle_tasks()` einem solchen Nutzer nie aus — die
--     Prüfung ist wortgleich mit dem Personenfilter, der die Aufgabe überhaupt
--     erst erzeugt. Wer die Karte sieht, darf sie auch anfassen.
--   * Teil 2 entzieht ein Ausführungsrecht, das keine Zeile Anwendungscode
--     benutzt.
--   * Teil 3 hängt denselben Trigger an zwei weitere Ereignisse. Er greift nur,
--     wenn eine Zuweisung über die Organisationsgrenze zeigt — was die App
--     seit 0028 an keiner Stelle mehr schickt (siehe unten).
--
-- Der begleitende App-Fix in `src/app/actions/recycle.ts` (Vorprüfung in
-- `scheduleRecycle`) und diese Migration ergänzen einander, sie brauchen
-- einander nicht: Die App schützt den Weg durch die App, die Datenbank den
-- direkten POST auf die RPC. Deshalb ist die Reihenfolge frei.
--
-- Wiederholbar: `create or replace` auf zwei Funktionen mit unveränderter
-- Signatur, zwei `revoke`, vier `drop trigger if exists` + `create trigger`.
-- Keine DDL auf Tabellenspalten, kein Backfill, keine Datenbewegung. Zwei der
-- vier Trigger tragen die Namen aus 0028 und ersetzen sie unter demselben
-- Namen — die DATEI 0028 bleibt unangetastet, ihr Trigger bekommt eine
-- erweiterte Spaltenliste.
--
-- ===========================================================================
-- BEFUND 1 (ernst) — schreibende Recycling-RPCs prüfen die Mitgliedschaft,
--                    aber nicht den BESITZ
-- ===========================================================================
--
-- 0037 hat `schedule_recycle()` und `recycle_attempt()` den Mitgliedschafts-
-- block vorangestellt. Der beantwortet „gehört der Aufrufer zu dieser
-- Organisation" — nicht „gehört ihm diese Zeile". Beide Funktionen sind
-- `security definer` und laufen an der Zeilensicherheit vorbei; ihr einziger
-- Zeilenfilter ist `where id = ... and workspace_id = ...`, und der trennt
-- Organisationen, nicht Kollegen.
--
-- Der Weg: Ein Mitglied mit `data_scope='own'` kennt die UUID eines fremden
-- Closings — die Ablage-Sperrliste liefert bewusst org-weit aus (docs §1), ein
-- Kontaktverbot, das nur sein Besitzer sieht, wäre keines. Damit ruft es
-- `schedule_recycle()` auf und setzt `next_recycle_at` und
-- `recycle_reason_code` in eine Zeile, die es nicht einmal lesen darf.
-- `recycle_attempt()` ist der teurere Zwilling: Er dreht den Versuchszähler
-- hoch, und sobald `recycle_attempt_count + 1 >= max_attempts` gilt, nullt
-- DIESELBE Anweisung `next_recycle_at`. Die Wiedervorlage des Kollegen
-- verschwindet lautlos — kein Statuswechsel, keine Spur, und die
-- Wiederbelebungsquote in `/analyse` (docs §5) rechnet danach auf Zahlen, die
-- jemand anderes gesetzt hat.
--
-- Die Regel für „Besitz" ist nicht neu, sie steht in docs §2 und in beiden
-- lesenden RPCs aus 0033: Bei `contacts`/`phone_leads` entscheidet die Liste
-- über `list_owned_by_user()` (owner_name hat Vorrang vor created_by_user_id),
-- bei `setting_calls`/`closing_calls` `coalesce(assigned_user_id,
-- created_by_user_id)`. Wörtlich dieselben Prädikate benutzt `recycle_tasks()`
-- für seinen Personenfilter — deshalb kann diese Prüfung keine Aufgabe
-- blockieren, die die Oberfläche jemandem anzeigt.
--
-- Eingeschränkt wird NUR bei `data_scope='own'`. Ein Owner mit
-- `data_scope='workspace'` darf weiterhin jede Zeile seiner Organisation
-- anfassen, und ein Plattform-Admin hat in einer Kunden-Organisation gar keine
-- Mitgliedschaft und damit kein `data_scope` — für ihn bleibt es beim
-- Mitgliedschaftsblock aus 0037. Das ist wörtlich die Bauart von Absatz (d)
-- in 0039: dieselbe Grenze, die `data_scope='own'` sonst überall zieht,
-- nachgezogen an einer Funktion, die die RLS umgeht.
--
-- Die Prüfung steht INLINE in beiden Funktionen statt in einem gemeinsamen
-- Helfer. Ein Helfer wäre die dritte `security definer`-Funktion an dieser
-- Stelle und müsste entweder `authenticated` offenstehen — dann wäre er ein
-- Orakel, das jedem Angemeldeten „gehört Zeile X dem Nutzer Y" beantwortet —
-- oder er hinge davon ab, dass er denselben Eigentümer hat wie seine beiden
-- Aufrufer. Zwei wortgleiche Blöcke sind hier das kleinere Risiko; dass sie
-- wortgleich bleiben, prüft `tests/schreibpfadGrenzen.test.ts`.

-- ---------------------------------------------------------------------------
-- 1. schedule_recycle — Rumpf aus 0037, ergänzt um die Besitzprüfung
-- ---------------------------------------------------------------------------

create or replace function public.schedule_recycle (
  p_workspace_id uuid,
  p_origin       text,
  p_entity_id    uuid,
  p_today        date default (now() at time zone 'Europe/Berlin')::date
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  s          public.pipeline_settings%rowtype;
  v_days     integer;
  v_reason   text;
  v_attempts integer := 0;
  v_blocked  boolean := false;
  v_due      date;
  v_scope    text;
  v_owned    boolean;
begin
  -- (a) Gehört der Aufrufer zur Organisation? Unverändert aus 0037.
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  ) and not public.is_platform_admin() then
    raise exception 'Kein Zugriff auf diese Organisation';
  end if;

  -- (b) Gehört ihm auch die ZEILE? Innerhalb einer Organisation sagt
  --     `workspace_id` darüber nichts. Kein `data_scope` (Plattform-Admin) und
  --     `data_scope='workspace'` lassen die Prüfung bewusst aus.
  select wm.data_scope into v_scope
    from public.workspace_members wm
   where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid();

  if v_scope = 'own' then
    v_owned := case p_origin
      when 'linkedin' then exists (
        select 1 from public.contacts c
          join public.lists l on l.id = c.list_id
         where c.id = p_entity_id and c.workspace_id = p_workspace_id
           and public.list_owned_by_user(l.owner_name, l.created_by_user_id, auth.uid()))
      when 'telefon' then exists (
        select 1 from public.phone_leads pl
          join public.phone_lists pll on pll.id = pl.list_id
         where pl.id = p_entity_id and pl.workspace_id = p_workspace_id
           and public.list_owned_by_user(pll.owner_name, pll.created_by_user_id, auth.uid()))
      when 'setting' then exists (
        select 1 from public.setting_calls sc
         where sc.id = p_entity_id and sc.workspace_id = p_workspace_id
           and coalesce(sc.assigned_user_id, sc.created_by_user_id) = auth.uid())
      when 'closing' then exists (
        select 1 from public.closing_calls cc
         where cc.id = p_entity_id and cc.workspace_id = p_workspace_id
           and coalesce(cc.assigned_user_id, cc.created_by_user_id) = auth.uid())
      -- Unbekannter Ursprung: hier durchlassen, damit unten die vorhandene,
      -- sprechende Meldung wirft statt einer über die Datensicht.
      else true
    end;

    if not v_owned then
      raise exception 'Mit eingeschränkter Datensicht lässt sich nur der eigene Lead wiedervorlegen';
    end if;
  end if;

  select * into s from public.pipeline_settings where workspace_id = p_workspace_id;
  if not found then
    return null;  -- ohne Konfiguration kein Recycling; seed_workspace_defaults legt sie an
  end if;

  if p_origin = 'closing' then
    select cc.lost_reason_code, cc.recycle_attempt_count,
           (cc.recycle_excluded_at is not null or cc.revived_at is not null or cc.status <> 'verloren')
      into v_reason, v_attempts, v_blocked
      from public.closing_calls cc
     where cc.id = p_entity_id and cc.workspace_id = p_workspace_id;

    v_days := case coalesce(v_reason, 'sonstiges')
                when 'timing'      then s.days_timing
                when 'preis'       then s.days_preis
                when 'kein_bedarf' then s.days_kein_bedarf
                when 'entscheider' then s.days_entscheider
                when 'wettbewerb'  then s.days_wettbewerb
                when 'vertrauen'   then s.days_vertrauen
                -- Ghosting ist zweistufig: erst ein kurzer Breakup-Touch,
                -- danach das lange Intervall.
                when 'ghosting'    then case when v_attempts = 0 then s.days_ghosting_breakup else s.days_ghosting end
                when 'sonstiges'   then s.days_sonstiges
                else s.days_default_closing_lost
              end;

    if coalesce(v_reason, '') in ('falsche_zielgruppe', 'kein_fit') then
      v_days := null;
    end if;

  elsif p_origin = 'setting' then
    -- Die Absage ohne Aussicht steht gleichberechtigt neben den beiden Status:
    -- Sie lässt `status` bewusst unangetastet (meist 'offen'), damit ein
    -- abgesagter Termin über `show_status is null` aus dem Nenner der Show- und
    -- Quali-Quote fällt, statt sie zu verfälschen (0032, Abschnitt 3). Ohne
    -- diesen Zweig wäre genau der Preis dafür, dass die Ablage „Abgesagt ohne
    -- Aussicht" NIE eine Wiedervorlage bekommt — obwohl `recycle_tasks` unten
    -- genau diesen Zweig abfragt und ihn damit anzeigen könnte.
    --
    -- Die Wartezeit teilt sie sich mit dem toten Lead
    -- (`days_default_setting_dead`). Ein eigener Absage-Wert wäre eine weitere
    -- Zahl in den Einstellungen, deren Unterschied zum Nachbarn niemand
    -- erklären kann — eine geteilte Frist ist ehrlicher als eine erfundene.
    -- 'unqualifiziert' behält seinen eigenen Wert und geht vor: ein Termin, der
    -- stattfand und den Lead aussortiert hat, sagt mehr als seine Absage.
    -- Dasselbe gilt für den No-Show ohne Antwort: Die Kette endet laut Konzept
    -- bei „Ziel ist es eine klare Antwort zu erhalten" und danach „Ablauf geht
    -- erneut von vorne los" — das Recycling IST dieses Von-vorne. Auch hier
    -- bleibt `status` unangetastet, damit die No-Show-Quote stimmt.
    select sc.disqualify_reason_code, sc.recycle_attempt_count,
           (sc.recycle_excluded_at is not null or sc.revived_at is not null
            or (sc.status not in ('dead', 'unqualifiziert')
                and sc.cancel_outlook is distinct from 'ohne_aussicht'
                and sc.no_show_resolution is distinct from 'ohne_antwort')),
           case when sc.status = 'unqualifiziert'
                then s.days_default_setting_disqualified
                else s.days_default_setting_dead end
      into v_reason, v_attempts, v_blocked, v_days
      from public.setting_calls sc
     where sc.id = p_entity_id and sc.workspace_id = p_workspace_id;

    -- „Zusammenarbeit macht keinen Sinn" ist die rote Notiz „kein weiteres
    -- kontaktieren!" — sie bekommt kein Datum, sondern ein Kontaktverbot.
    if coalesce(v_reason, '') in ('falsche_zielgruppe', 'keine_zusammenarbeit') then
      v_days := null;
    end if;

  elsif p_origin = 'telefon' then
    select pl.recycle_attempt_count, (pl.recycle_excluded_at is not null or pl.status <> 'dead')
      into v_attempts, v_blocked
      from public.phone_leads pl
     where pl.id = p_entity_id and pl.workspace_id = p_workspace_id;
    v_reason := 'dead';
    v_days := s.days_default_phone_dead;

  elsif p_origin = 'linkedin' then
    select c.recycle_attempt_count,
           (c.recycle_excluded_at is not null or c.blocked_at is not null
            or c.answered is true or c.appointment_set is true)
      into v_attempts, v_blocked
      from public.contacts c
     where c.id = p_entity_id and c.workspace_id = p_workspace_id;
    v_reason := 'fu_exhausted';
    v_days := s.days_default_linkedin_exhausted;

  else
    raise exception 'Unbekannter Recycling-Ursprung: %', p_origin;
  end if;

  if v_blocked or v_days is null or v_attempts >= s.max_attempts then
    return null;
  end if;

  v_due := p_today + v_days;

  execute format(
    'update public.%I set next_recycle_at = $1, recycle_reason_code = $2 where id = $3 and workspace_id = $4',
    case p_origin when 'closing' then 'closing_calls'
                  when 'setting' then 'setting_calls'
                  when 'telefon' then 'phone_leads'
                  else 'contacts' end
  ) using v_due, v_reason, p_entity_id, p_workspace_id;

  return v_due;
end;
$$;

grant execute on function public.schedule_recycle (uuid, text, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. recycle_attempt — Rumpf aus 0037, ergänzt um dieselbe Besitzprüfung
-- ---------------------------------------------------------------------------
-- Der Block steht hier NACH der Ursprungs-Prüfung, nicht davor: Diese Funktion
-- leitet die Tabelle schon in ihrem `declare`-Teil ab, und ein unbekannter
-- Ursprung soll weiterhin die eigene Meldung bekommen. Die Reihenfolge
-- gegenüber der Mitgliedschaftsprüfung bleibt davon unberührt — die steht
-- weiterhin zuerst, aus dem in 0037 genannten Grund.

create or replace function public.recycle_attempt (
  p_workspace_id uuid,
  p_origin       text,
  p_entity_id    uuid,
  p_today        date default (now() at time zone 'Europe/Berlin')::date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text := case p_origin when 'closing' then 'closing_calls'
                                when 'setting' then 'setting_calls'
                                when 'telefon' then 'phone_leads'
                                when 'linkedin' then 'contacts'
                                else null end;
  v_max   smallint;
  v_count integer;
  v_scope text;
  v_owned boolean;
begin
  -- Zugriffsprüfung als ERSTE Anweisung, wortgleich zu
  -- apply_reminder_touches() (0032) und zur Prüfung in schedule_recycle()
  -- oben. Sie steht VOR der Ursprungs-Prüfung: Wer nicht zur Organisation
  -- gehört, soll nicht einmal erfahren, welche Ursprünge es gibt.
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  ) and not public.is_platform_admin() then
    raise exception 'Kein Zugriff auf diese Organisation';
  end if;

  if v_table is null then
    raise exception 'Unbekannter Recycling-Ursprung: %', p_origin;
  end if;

  -- Besitzprüfung — wortgleich zu schedule_recycle() oben. Ohne sie dreht ein
  -- Aufruf mit fremder Zeilen-UUID den Versuchszähler des Kollegen hoch, bis
  -- der Deckel greift und dieselbe Anweisung dessen Wiedervorlage nullt.
  select wm.data_scope into v_scope
    from public.workspace_members wm
   where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid();

  if v_scope = 'own' then
    v_owned := case p_origin
      when 'linkedin' then exists (
        select 1 from public.contacts c
          join public.lists l on l.id = c.list_id
         where c.id = p_entity_id and c.workspace_id = p_workspace_id
           and public.list_owned_by_user(l.owner_name, l.created_by_user_id, auth.uid()))
      when 'telefon' then exists (
        select 1 from public.phone_leads pl
          join public.phone_lists pll on pll.id = pl.list_id
         where pl.id = p_entity_id and pl.workspace_id = p_workspace_id
           and public.list_owned_by_user(pll.owner_name, pll.created_by_user_id, auth.uid()))
      when 'setting' then exists (
        select 1 from public.setting_calls sc
         where sc.id = p_entity_id and sc.workspace_id = p_workspace_id
           and coalesce(sc.assigned_user_id, sc.created_by_user_id) = auth.uid())
      when 'closing' then exists (
        select 1 from public.closing_calls cc
         where cc.id = p_entity_id and cc.workspace_id = p_workspace_id
           and coalesce(cc.assigned_user_id, cc.created_by_user_id) = auth.uid())
      else true
    end;

    if not v_owned then
      raise exception 'Mit eingeschränkter Datensicht lässt sich nur der eigene Lead wiedervorlegen';
    end if;
  end if;

  select max_attempts into v_max from public.pipeline_settings where workspace_id = p_workspace_id;
  v_max := coalesce(v_max, 2);

  -- Lesen, Rechnen und Schreiben in EINER Anweisung: zwei gleichzeitige Klicks
  -- erhöhen den Zähler zweimal, statt beide von demselben Ausgangswert zu
  -- rechnen und einer den anderen überschreiben zu lassen.
  execute format($f$
    update public.%I
       set recycle_attempt_count     = recycle_attempt_count + 1,
           recycle_last_contacted_at = now(),
           next_recycle_at           = case
             when recycle_attempt_count + 1 >= $1 then null
             else next_recycle_at
           end
     where id = $2 and workspace_id = $3
     returning recycle_attempt_count
  $f$, v_table) into v_count using v_max, p_entity_id, p_workspace_id;

  return v_count;
end;
$$;

grant execute on function public.recycle_attempt (uuid, text, uuid, date) to authenticated;

-- ===========================================================================
-- BEFUND 2 (mittel) — seed_workspace_defaults() steht jedem angemeldeten
--                     Konto offen
-- ===========================================================================
--
-- 0034 hat die Funktion `security definer` angelegt und `grant execute ... to
-- authenticated` gesetzt, ohne Mitgliedschaftsblock. Ein beliebiger
-- angemeldeter Nutzer, der eine fremde Workspace-UUID kennt, kann sie damit
-- für diese fremde Organisation aufrufen.
--
-- Sie überschreibt nichts — beide Inserts tragen `on conflict do nothing`.
-- Aber sie LEGT NEU AN, was dort gelöscht wurde: eine entfernte
-- `pipeline_settings`-Zeile und jede der 21 Standard-Kaskadenstufen. Die
-- Oberfläche kann Stufen bis heute nur anzeigen, nicht bearbeiten (docs §3) —
-- eine Kaskade abzuschalten heißt deshalb, ihre Zeilen per SQL zu löschen. Ein
-- Kunde, der das getan hat, verschickte danach wieder Erinnerungen, die er
-- bewusst abgestellt hatte. Kein Datenverlust, aber ein Vertrauensverlust, und
-- niemand käme auf die Ursache.
--
-- Die Behebung ist der Entzug des Ausführungsrechts, nicht ein Prüfblock:
-- Es gibt keinen legitimen Aufruf aus der App. Der einzige Aufrufer ist der
-- AFTER-INSERT-Trigger `workspaces_seed_defaults` auf `workspaces`, und der
-- braucht das Recht nicht — seine Triggerfunktion ist selbst `security
-- definer`, in ihrem Rumpf ist der aktuelle Benutzer also ihr Eigentümer, und
-- der besitzt das Ausführungsrecht auf `seed_workspace_defaults()` implizit
-- als deren Eigentümer. Beide Funktionen sind in derselben Migration (0034)
-- von derselben Rolle angelegt worden, haben also denselben Eigentümer. Genau
-- dieselbe Mechanik trägt heute schon `is_platform_admin()` und
-- `can_access_pitch_list()` — nur werden die zusätzlich von außen gerufen und
-- brauchen deshalb ihren Grant.
--
-- `revoke from public` ist dabei nicht optional, sondern der eigentliche
-- Schritt: PostgreSQL grantet EXECUTE auf eine neue Funktion per Vorgabe an
-- PUBLIC. Ein `revoke ... from authenticated` allein nähme nur den expliziten
-- Eintrag aus 0034 weg — über PUBLIC dürfte `authenticated` weiter aufrufen,
-- und `anon` obendrein. Der Nachweis dafür steht unten in der Verifikation:
-- geprüft wird die Zugriffsliste, nicht die Absicht.
--
-- `service_role` bekommt das Recht ausdrücklich zurück. Vor dieser Datei hatte
-- es die Rolle nur über PUBLIC; der Schlüssel erreicht nie einen Browser, und
-- ein Nachziehen von Hand über den Admin-Client soll möglich bleiben.

revoke all on function public.seed_workspace_defaults (uuid) from public;
revoke all on function public.seed_workspace_defaults (uuid) from authenticated;
grant execute on function public.seed_workspace_defaults (uuid) to service_role;

comment on function public.seed_workspace_defaults (uuid) is
  'Legt Konfiguration und Standard-Kaskaden einer Organisation an. Idempotent — bereits geänderte Stufen bleiben unangetastet. Legt bewusst keine Textzeilen an. Seit 0040 NUR für den Trigger workspaces_seed_defaults und den Admin-Schlüssel: ein Aufruf durch `authenticated` konnte per SQL abgeschaltete Kaskadenstufen einer fremden Organisation wiederherstellen.';

-- ===========================================================================
-- BEFUND 3 (mittel) — der Zuweisungs-Wächter deckt nur den Nutzer-Umzug ab
-- ===========================================================================
--
-- `assigned_user_guard()` (0028, Abschnitt 11) nullt eine `assigned_user_id`,
-- die auf ein Nicht-Mitglied der Organisation der Zeile zeigt. Er hängt an
-- `before update of workspace_id` — also ausschließlich am Nutzer-Umzug. Damit
-- bleiben ZWEI Wege offen, auf denen dieselbe heimatlose Zeile entsteht, die
-- docs §8 als Invariante ausschließt: Sie taucht in keinem „Meine Termine" auf
-- und erscheint in der Team-Ansicht unter einem Namen, den es dort nicht gibt.
--
--  (1) INSERT. Keine Policy springt ein: `setting_calls_scoped_member` erlaubt
--      die Zeile schon dann, wenn `created_by_user_id` passt — und genau
--      diesen Zweig bedient ein direkter POST auf /rest/v1/setting_calls, der
--      `assigned_user_id` auf eine Nutzer-UUID aus einer anderen Organisation
--      setzt.
--  (2) UPDATE, das NUR `assigned_user_id` anfasst. Der vorhandene Trigger
--      feuert nicht (`workspace_id` steht nicht im SET), und das WITH CHECK
--      derselben Policy ist über `created_by_user_id` bereits erfüllt. Ein
--      PATCH auf dieselbe Route erreicht denselben Endzustand wie (1), nur an
--      einer Zeile, die schon existiert. Abgesichert war dieser Weg allein in
--      `setAssignee()` (`src/app/actions/assignees.ts`), das die Mitgliedschaft
--      selbst prüft — die App ist aber nicht der einzige Weg zur Tabelle.
--
-- Beides schließt dieselbe Triggerfunktion. Für (1) kommt je Tabelle ein
-- INSERT-Trigger dazu, für (2) wird die Spaltenliste des bestehenden
-- UPDATE-Triggers auf `workspace_id, assigned_user_id` erweitert. Die Datei
-- 0028 bleibt dabei unangetastet — geändert wird hier, per `drop trigger if
-- exists` + `create trigger`, wie bei den INSERT-Triggern auch. Denselben
-- Zuschnitt trägt `reminder_touches_ws_guard` seit 0032 (`before update of
-- workspace_id, assigned_user_id`); der Präzedenzfall steht also im Projekt.
--
-- Warum 0028 den INSERT bewusst ausgelassen hat und warum das heute anders zu
-- entscheiden ist: Der dort genannte Grund war, ein Plattform-Admin sei in
-- einer Kunden-Organisation kein Mitglied, der Guard würde beim Anlegen also
-- seine Zuweisung „still verwerfen". Diesen Fall gibt es nicht mehr — die App
-- schickt in einer fremden Organisation gar keine Zuweisung: `manuell` und
-- `createClosingFromSetting` setzen `access.is_foreign_org ? null :
-- access.user.id`, und `assignedUserForList()` gibt `null` zurück, sobald
-- weder der Listen-Owner noch der Anmeldende Mitglied der aktiven Organisation
-- ist. Der Guard kann also nichts mehr verwerfen, was ein regulärer Pfad
-- geschickt hat; er greift nur noch bei dem, was kein regulärer Pfad schickt.
--
-- Die Funktion selbst bleibt unangetastet und arbeitet in BEIDEN neuen Fällen
-- korrekt — das ist keine Annahme, sondern liest sich an ihrem Rumpf ab:
--
--   * Sie liest ausschließlich `new` (`new.assigned_user_id`,
--     `new.workspace_id`) und kennt kein `OLD`. Bei einem INSERT wäre `OLD`
--     nicht belegt und ein Zugriff darauf ein Laufzeitfehler — es gibt keinen.
--   * Sie vergleicht NICHT alt gegen neu, sondern prüft den Endzustand gegen
--     die Mitgliedschaft. Ein regulärer Wechsel innerhalb der Organisation
--     (`setAssignee()` auf ein Mitglied) besteht diese Prüfung und bleibt
--     unangetastet; „Niemand" (`assigned_user_id = null`) fällt schon an der
--     ersten Bedingung heraus. Abgeräumt wird ausschließlich eine Zuweisung,
--     die über die Organisationsgrenze zeigt — also genau der Fall, für den
--     die Funktion in 0028 geschrieben wurde, nur jetzt an allen drei
--     Ereignissen statt an einem.
--
-- Zu beachten: `update of <spalte>` feuert, sobald die Spalte im SET-Teil
-- VORKOMMT, auch wenn sich ihr Wert nicht ändert. Der Trigger läuft nach der
-- Erweiterung also bei jedem `setAssignee()` mit — und lässt dessen Ergebnis
-- unverändert, weil die Action ohnehin nur Mitglieder oder `null` schreibt.

-- (2) UPDATE — Spaltenliste erweitert. Ersetzt den Trigger aus 0028 unter
--     demselben Namen; die Triggerfunktion bleibt dieselbe.
drop trigger if exists setting_calls_assigned_guard on public.setting_calls;
create trigger setting_calls_assigned_guard
  before update of workspace_id, assigned_user_id on public.setting_calls
  for each row execute function public.assigned_user_guard ();

drop trigger if exists closing_calls_assigned_guard on public.closing_calls;
create trigger closing_calls_assigned_guard
  before update of workspace_id, assigned_user_id on public.closing_calls
  for each row execute function public.assigned_user_guard ();

-- (1) INSERT — eigener Name mit Suffix `_ins`, damit beide Ereignisse
--     getrennt sichtbar bleiben (Muster `reminder_touches_ws_guard_ins`, 0039).
drop trigger if exists setting_calls_assigned_guard_ins on public.setting_calls;
create trigger setting_calls_assigned_guard_ins
  before insert on public.setting_calls
  for each row execute function public.assigned_user_guard ();

drop trigger if exists closing_calls_assigned_guard_ins on public.closing_calls;
create trigger closing_calls_assigned_guard_ins
  before insert on public.closing_calls
  for each row execute function public.assigned_user_guard ();

-- Neue Rechte und Trigger sofort über PostgREST sichtbar machen.
notify pgrst, 'reload schema';

-- ===========================================================================
-- VERIFIKATION — nach dem Einspielen im SQL-Editor ausführen
-- ===========================================================================
--
-- LIES DAS ZUERST. Der Verifikationsblock von 0037 hat eine Falle, die diese
-- Datei bewusst vermeidet: Im SQL-Editor ist man `postgres`, `auth.uid()` ist
-- NULL, und deshalb scheitert JEDER Aufruf einer dieser RPCs — auch der, der
-- durchlaufen müsste. Ein Test, bei dem beide Seiten scheitern, sieht wie ein
-- bestandener aus und beweist nichts. Jede Probe unten hat deshalb eine
-- POSITIVE Gegenprobe, die MISSLINGT, wenn man sie ohne gesetzte JWT-Claims
-- fährt. Bestanden ist erst, wenn die Verweigerung verweigert UND die Erlaubnis
-- erlaubt.
--
-- ---------------------------------------------------------------------------
-- A) Statisch — stehen die Änderungen überhaupt in der Datenbank?
-- ---------------------------------------------------------------------------
-- Diese vier laufen ohne Sitzung und ohne Vorbereitung.
--
-- A1) Beide RPCs tragen beide Prüfungen. Muss GENAU 2 Zeilen liefern:
--
--       select p.proname
--         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public'
--          and p.proname in ('schedule_recycle', 'recycle_attempt')
--          and pg_get_functiondef(p.oid) like '%Kein Zugriff auf diese Organisation%'
--          and pg_get_functiondef(p.oid) like '%nur der eigene Lead wiedervorlegen%'
--          and pg_get_functiondef(p.oid) like '%list_owned_by_user%';
--
--     Weniger als 2 heißt: Die Datei lief nur zur Hälfte durch (docs §7,
--     Teil-Ausführung bei markiertem Text im Editor).
--
-- A2) seed_workspace_defaults ist für `authenticated`, `anon` und PUBLIC
--     gesperrt. Die Zugriffsliste darf weder einen Eintrag ohne Rollennamen
--     (das ist PUBLIC) noch `authenticated` oder `anon` enthalten — muss 0
--     Zeilen liefern:
--
--       select p.proname, acl
--         from pg_proc p
--         join pg_namespace n on n.oid = p.pronamespace
--         cross join lateral unnest(coalesce(p.proacl, '{}')) as acl
--        where n.nspname = 'public' and p.proname = 'seed_workspace_defaults'
--          and (acl::text like '=%' or acl::text like 'authenticated=%'
--               or acl::text like 'anon=%');
--
--     ACHTUNG, zweite Falle: Ist `proacl` NULL, ist die Vorgabe aktiv und
--     PUBLIC darf ausführen — die Abfrage oben liefert dann trotzdem 0 Zeilen.
--     Deshalb zusätzlich, muss `f` (also: nicht null) ergeben:
--
--       select p.proacl is null as vorgabe_noch_aktiv
--         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public' and p.proname = 'seed_workspace_defaults';
--
-- A3) Der Zuweisungs-Wächter hängt an VIER Triggern — je Tabelle einmal
--     INSERT und einmal UPDATE. Die Abfrage unten zählt aber nicht Trigger,
--     sondern überwachte Spalten (`pg_trigger.tgattr`), und der UPDATE-Trigger
--     horcht auf ZWEI davon: Aus den vier Triggern werden deshalb 6 Zeilen
--     (2 × INSERT ohne Spalte, 2 × `workspace_id`, 2 × `assigned_user_id`):
--
--       select c.relname, t.tgname, a.attname
--         from pg_trigger t
--         join pg_class c on c.oid = t.tgrelid
--         left join lateral unnest(t.tgattr::int2[]) as col(num) on true
--         left join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.num
--        where not t.tgisinternal
--          and t.tgfoid = 'public.assigned_user_guard()'::regprocedure
--        order by 1, 2, 3;
--
--     ERWARTET, genau diese 6 Zeilen:
--       closing_calls | closing_calls_assigned_guard     | assigned_user_id
--       closing_calls | closing_calls_assigned_guard     | workspace_id
--       closing_calls | closing_calls_assigned_guard_ins | (null)
--       setting_calls | setting_calls_assigned_guard     | assigned_user_id
--       setting_calls | setting_calls_assigned_guard     | workspace_id
--       setting_calls | setting_calls_assigned_guard_ins | (null)
--
--     Fehlen die beiden `assigned_user_id`-Zeilen, ist der UPDATE-Trigger noch
--     der aus 0028 und ein PATCH, der nur die Zuweisung anfasst, läuft weiter
--     an ihm vorbei.
--
-- A4) Die Invarianten aus docs §8, die diese Datei künftig hält — beide 0:
--
--       select count(*) from public.setting_calls sc where sc.assigned_user_id is not null
--         and not exists (select 1 from public.workspace_members wm
--                          where wm.user_id = sc.assigned_user_id and wm.workspace_id = sc.workspace_id);
--       select count(*) from public.closing_calls cc where cc.assigned_user_id is not null
--         and not exists (select 1 from public.workspace_members wm
--                          where wm.user_id = cc.assigned_user_id and wm.workspace_id = cc.workspace_id);
--
-- ---------------------------------------------------------------------------
-- B) Der gefährlichste Teil: seedet der Trigger noch, OHNE den Grant?
-- ---------------------------------------------------------------------------
-- Wenn hier etwas schiefgeht, bekommt keine neu angelegte Kundenorganisation
-- mehr Konfiguration und Kaskaden — und es fällt erst auf, wenn beim ersten
-- Kunden keine einzige Erinnerung entsteht. Diese Probe ist deshalb PFLICHT,
-- nicht optional. Sie läuft als `postgres` und ist trotzdem aussagekräftig:
-- Eine Organisation entsteht immer über `bootstrap_workspace()` oder
-- `platform_create_workspace()`, beide `security definer` — das INSERT in
-- `workspaces` findet also genau in dieser Rolle statt.
--
--   begin;
--     insert into public.workspaces (name) values ('ZZZ 0040 Grant-Probe');
--     -- Zweites Statement, nicht als CTE: ein AFTER-INSERT-Trigger feuert erst
--     -- am Ende des Statements, im selben Statement sähe man seine Zeilen nicht.
--     select (select count(*) from public.pipeline_settings ps where ps.workspace_id = w.id) as settings,
--            (select count(*) from public.cascade_steps cs where cs.workspace_id = w.id) as stufen
--       from public.workspaces w where w.name = 'ZZZ 0040 Grant-Probe';
--   rollback;
--
--   ERWARTET: settings = 1 und stufen = 21. Kommt 0/0 oder wirft das INSERT
--   `permission denied for function seed_workspace_defaults`, ist der Entzug
--   zu weit gegangen — dann `grant execute on function
--   public.seed_workspace_defaults (uuid) to authenticated;` als Sofortmaßnahme
--   zurücknehmen und den Befund neu bewerten.
--
--   Das `rollback` ist wichtig: Die Probe darf keine Organisation hinterlassen.
--
-- B2) Die Gegenprobe zum Entzug — `authenticated` darf NICHT mehr aufrufen.
--     Diese hat die auth.uid()-Falle NICHT: Ein fehlendes Ausführungsrecht
--     schlägt unabhängig von der Sitzung zu, und die Meldung ist eindeutig.
--
--       begin;
--         set local role authenticated;
--         select public.seed_workspace_defaults('<beliebige-ws>');
--       rollback;
--
--     ERWARTET: `ERROR: permission denied for function seed_workspace_defaults`.
--     Läuft der Aufruf durch (oder meldet er etwas anderes), ist der Entzug
--     nicht angekommen.
--
-- ---------------------------------------------------------------------------
-- C) Die Besitzprüfung — mit Sitzung, und mit Gegenprobe
-- ---------------------------------------------------------------------------
-- Vorbereitung: <own-user> ist ein Mitglied mit `data_scope='own'` und KEIN
-- Plattform-Admin; <fremdes-closing> ein Closing derselben Organisation, das
-- über `coalesce(assigned_user_id, created_by_user_id)` jemand anderem gehört;
-- <eigenes-closing> eines, das ihm gehört. Passende Zeilen findet man so:
--
--   select cc.id, coalesce(cc.assigned_user_id, cc.created_by_user_id) as gehoert
--     from public.closing_calls cc where cc.workspace_id = '<eigene-ws>' limit 20;
--
-- C1) FREMDE Zeile, eingeschränkte Datensicht — MUSS scheitern:
--
--       begin;
--         set local role authenticated;
--         set local request.jwt.claims = '{"sub":"<own-user>","role":"authenticated"}';
--         select public.schedule_recycle('<eigene-ws>', 'closing', '<fremdes-closing>');
--       rollback;
--
--     ERWARTET: `ERROR: Mit eingeschränkter Datensicht lässt sich nur der
--     eigene Lead wiedervorlegen`. Dasselbe noch einmal mit
--     `public.recycle_attempt(...)` in einer EIGENEN Transaktion (die erste
--     Exception bricht den Block ab).
--
--     Kommt stattdessen `Kein Zugriff auf diese Organisation`, sind die
--     JWT-Claims nicht angekommen — dann misst man `auth.uid() is null` und
--     nicht die neue Prüfung. Das ist genau die Falle aus 0037; C2 deckt sie
--     auf.
--
-- C2) DIE GEGENPROBE, ohne die C1 nichts beweist. EIGENE Zeile, derselbe
--     Nutzer — MUSS ohne Exception durchlaufen:
--
--       begin;
--         set local role authenticated;
--         set local request.jwt.claims = '{"sub":"<own-user>","role":"authenticated"}';
--         select public.schedule_recycle('<eigene-ws>', 'closing', '<eigenes-closing>');
--         select public.recycle_attempt('<eigene-ws>', 'closing', '<eigenes-closing>');
--       rollback;   -- der Probelauf soll keinen Versuch verbrennen
--
--     Ein zurückgegebenes NULL aus `schedule_recycle` ist hier KEIN Fehler,
--     sondern die reguläre Antwort „kein Recycling" (Status, Ausschluss, Grund
--     oder erreichter Deckel, siehe 0033). Entscheidend ist allein, dass keine
--     Exception fliegt. Scheitert C2, ist die Prüfung zu scharf und blockiert
--     echte Arbeit — dann NICHT ausliefern.
--
-- C3) Team-Sicht bleibt unberührt: dieselben Aufrufe wie C1, aber mit einem
--     Nutzer mit `data_scope='workspace'`, MÜSSEN durchlaufen. Und dieselben
--     Aufrufe mit der UUID eines Plattform-Admins auf eine FREMDE Organisation
--     ebenfalls — daran hängt der Org-Umschalter (docs §2).
--
-- ---------------------------------------------------------------------------
-- D) Der Zuweisungs-Wächter am INSERT und am reinen Zuweisungs-UPDATE
-- ---------------------------------------------------------------------------
-- Als `postgres`, also an der RLS vorbei — genau der Weg, den ein direkter
-- POST bzw. PATCH nimmt. <fremder-user> ist ein Mitglied einer ANDEREN
-- Organisation. Alle vier Proben laufen in einer Transaktion und werden
-- zurückgerollt.
--
-- D1) INSERT mit einer Zuweisung über die Organisationsgrenze:
--
--   begin;
--     insert into public.setting_calls (workspace_id, created_by_user_id, assigned_user_id, lead_name)
--     values ('<eigene-ws>', '<own-user>', '<fremder-user>', 'ZZZ 0040 Guard-Probe');
--     select assigned_user_id is null as guard_hat_gegriffen
--       from public.setting_calls where lead_name = 'ZZZ 0040 Guard-Probe';
--   rollback;
--
--   ERWARTET: `t`. Kommt `f`, hängt der INSERT-Trigger nicht (siehe A3).
--
-- D2) Gegenprobe, damit der Guard nicht einfach alles nullt — mit einem
--     Zuständigen, der SEHR WOHL Mitglied der Organisation ist:
--
--   begin;
--     insert into public.setting_calls (workspace_id, created_by_user_id, assigned_user_id, lead_name)
--     values ('<eigene-ws>', '<own-user>', '<own-user>', 'ZZZ 0040 Guard-Gegenprobe');
--     select assigned_user_id is not null as zuweisung_blieb
--       from public.setting_calls where lead_name = 'ZZZ 0040 Guard-Gegenprobe';
--   rollback;
--
--   ERWARTET: `t`. Käme hier `f`, verlöre jeder neu angelegte Termin seine
--   zuständige Person.
--
-- D3) UPDATE, das NUR die Zuweisung anfasst — der Weg, den der Trigger aus
--     0028 nicht sah. <eigener-termin> ist ein bestehender Termin der eigenen
--     Organisation:
--
--   begin;
--     update public.setting_calls set assigned_user_id = '<fremder-user>'
--      where id = '<eigener-termin>';
--     select assigned_user_id is null as guard_hat_gegriffen
--       from public.setting_calls where id = '<eigener-termin>';
--   rollback;
--
--   ERWARTET: `t`. Kommt `f`, trägt der UPDATE-Trigger noch die alte
--   Spaltenliste — A3 zeigt dann nur 4 statt 6 Zeilen.
--
-- D4) Die wichtigere Gegenprobe zu D3: Eine reguläre Umverteilung INNERHALB
--     der Organisation darf der Trigger nicht abräumen — sonst frisst er die
--     Arbeit von `setAssignee()`. <kollege> ist ein Mitglied derselben
--     Organisation:
--
--   begin;
--     update public.setting_calls set assigned_user_id = '<kollege>'
--      where id = '<eigener-termin>';
--     select assigned_user_id = '<kollege>' as zuweisung_blieb
--       from public.setting_calls where id = '<eigener-termin>';
--     update public.setting_calls set assigned_user_id = null
--      where id = '<eigener-termin>';   -- „Niemand" muss ebenfalls durchgehen
--   rollback;
--
--   ERWARTET: `t`, und das zweite UPDATE ohne Fehler. Schlägt D4 fehl, NICHT
--   ausliefern — dann verliert jede Umverteilung ihre zuständige Person.
--
-- D1 bis D4 zusätzlich für `closing_calls` wiederholen; dort hängen dieselben
-- zwei Trigger auf derselben Funktion.
