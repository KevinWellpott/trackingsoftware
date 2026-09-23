-- 0043 — Telefon: Ergebnis „Kein Termin" mit eigener Routing-Liste
--
-- 0001–0042 sind eingespielt und eingefroren; keine Zeile dieser Datei ändert
-- eine davon. Die drei CHECKs unten werden ERSETZT (gelöscht und mit einem
-- zusätzlichen Wert neu angelegt) — dieselbe Bauart wie der erweiterte
-- `lost_reason_code`-CHECK in 0032.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WARUM
--
--  Der Call-Mode kannte vier Ergebnisse: Termin, Rückruf, Nicht erreicht,
--  Toter Lead. Der häufige Fall „Entscheider war dran, will aber keinen
--  Termin" hatte keinen Knopf — er landete entweder als „Tot" (und damit im
--  Recycling) oder blieb „Aktiv" in der Akquise-Liste und wurde erneut
--  angerufen. Neu: ein fünfter Knopf „Kein Termin", der den Lead — wie
--  Rückruf und Nicht erreicht — physisch in eine eigene Routing-Liste des
--  Inhabers verschiebt.
-- ═══════════════════════════════════════════════════════════════════════════
--
--  WAS
--
--   1. `phone_lists.list_kind`        + 'kein_termin'  (die Routing-Liste)
--   2. `phone_leads.status`           + 'kein_termin'  (der Lead-Zustand)
--   3. `phone_call_attempts.outcome`  + 'kein_termin'  (das Anruf-Ereignis)
--
--  Mehr braucht es nicht, weil die bestehenden Stellen schon generisch sind:
--   * `uq_phone_lists_routing` (0008) gilt für jedes `list_kind <> 'akquise'`
--     — die neue Routing-Liste existiert damit automatisch höchstens einmal
--     je Inhaber.
--   * Der Nutzer-Umzug (0038) prüft ebenfalls `list_kind <> 'akquise'` und
--     nimmt die neue Liste mit.
--   * `rpc_phone_list_counts` gruppiert nach dem rohen Status.
--
--  Bewusst NICHT: Recycling. `schedule_recycle('telefon', …)` und der
--  Telefon-Zweig von `recycle_tasks` verlangen `status='dead'` (0033,
--  eingefroren). Ein „Kein Termin" ist kein totes Ende, sondern liegt in
--  seiner eigenen Liste und wird von dort aus bearbeitet.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WANN EINSPIELEN — VOR dem Deploy des zugehörigen Codes.
--
--   * Zu spät: Der Knopf „Kein Termin" schreibt einen Wert, den der CHECK
--     abweist. Die App fängt das ab und sagt „Migration 0043 fehlt" — aber
--     der Knopf tut dann nichts.
--   * Zu früh ist folgenlos: Die heute laufende App schreibt den Wert nie.
--
--  Die Supabase-Konsole führt bei markiertem Text nur die Markierung aus und
--  hinterlässt Halbzustände ohne Fehlermeldung (docs §7): NICHTS markieren,
--  „Run" auf die ganze Datei, danach den Verifikationsblock am Ende fahren.
--
--  Beliebig oft ausführbar: Gelöscht wird jeder CHECK, der GENAU auf der
--  jeweiligen Spalte sitzt (über `conkey`, nicht über den Namen — die CHECKs
--  aus 0008/0028 sind inline angelegt und tragen einen generierten Namen),
--  danach wird er unter festem Namen neu angelegt.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  t record;
  r record;
begin
  for t in
    select * from (values
      ('public.phone_lists'::regclass,         'list_kind'),
      ('public.phone_leads'::regclass,         'status'),
      ('public.phone_call_attempts'::regclass, 'outcome')
    ) as v(tbl, col)
  loop
    for r in
      select c.conname
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attname = t.col
       where c.conrelid = t.tbl
         and c.contype = 'c'
         and c.conkey = array[a.attnum]
    loop
      execute format('alter table %s drop constraint %I', t.tbl, r.conname);
    end loop;
  end loop;
end
$$;

alter table public.phone_lists
  add constraint phone_lists_list_kind_check
  check (list_kind in ('akquise', 'rueckruf', 'nicht_erreicht', 'kein_termin'));

alter table public.phone_leads
  add constraint phone_leads_status_check
  check (status in ('aktiv', 'rueckruf', 'nicht_erreicht', 'kein_termin', 'termin', 'dead'));

alter table public.phone_call_attempts
  add constraint phone_call_attempts_outcome_check
  check (outcome in ('termin', 'rueckruf', 'nicht_erreicht', 'kein_termin', 'dead', 'kein_ergebnis'));

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFIKATION (nach dem Einspielen einzeln fahren)
--
-- A1) Genau EIN CHECK je Spalte, und jeder kennt 'kein_termin'.
--     Muss GENAU 3 Zeilen liefern, alle mit `t`. Mehr als 3 heißt: ein alter
--     CHECK ist stehen geblieben und weist den neuen Wert weiter ab.
--
--       select c.conrelid::regclass, c.conname,
--              pg_get_constraintdef(c.oid) like '%kein_termin%' as kennt_kein_termin
--         from pg_constraint c
--         join pg_attribute a on a.attrelid = c.conrelid and c.conkey = array[a.attnum]
--        where c.contype = 'c'
--          and (   (c.conrelid = 'public.phone_lists'::regclass         and a.attname = 'list_kind')
--               or (c.conrelid = 'public.phone_leads'::regclass         and a.attname = 'status')
--               or (c.conrelid = 'public.phone_call_attempts'::regclass and a.attname = 'outcome'));
--
-- A2) Bestand unverändert — die Migration bewegt keine Zeile. Muss direkt nach
--     dem Einspielen (vor dem ersten Klick auf „Kein Termin") 0 liefern:
--
--       select (select count(*) from phone_leads where status = 'kein_termin')
--            + (select count(*) from phone_lists where list_kind = 'kein_termin');
-- ═══════════════════════════════════════════════════════════════════════════
