-- 0044 — Telefon: Herkunftsliste am Lead (`phone_leads.origin_list_id`)
--
-- 0001–0043 sind eingespielt und eingefroren; keine Zeile dieser Datei ändert
-- eine davon. Neu sind eine Spalte, ein Trigger, eine Lese-RPC.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WARUM
--
--  Jede Telefonliste hat im Call-Mode die Unteransichten Rückruf · Nicht
--  erreicht · Kein Termin · Termin · Dead. Gefüllt waren davon nur Termin und
--  Dead: `setPhoneLeadOutcome` verschiebt einen Lead bei Rückruf, Nicht
--  erreicht und Kein Termin PHYSISCH in die gemeinsame Routing-Liste des
--  Inhabers (`list_id` wird umgeschrieben). Die Importliste fragt nach
--  `list_id` — und verliert den Lead damit genau in dem Moment, in dem er in
--  ihrer Unteransicht auftauchen müsste. Bis zum Neuladen stand er noch dort
--  (lokaler Zustand), danach nie wieder.
--
--  Die Routing-Listen bleiben, wie sie sind (gemeinsame Sammelliste je
--  Inhaber). Neu ist nur, dass der Lead sich merkt, aus welcher Importliste er
--  stammt — dieselbe Umzugsfestigkeit, die `script_label` (0030) und
--  `target_group` schon haben.
-- ═══════════════════════════════════════════════════════════════════════════
--
--  WAS
--
--   1. `phone_leads.origin_list_id` → `phone_lists(id)`, `on delete set null`.
--      Zeigt immer auf eine AKQUISE-Liste. NULL = Herkunft unbekannt (s. u.).
--   2. Trigger `phone_leads_origin_list` setzt sie, ohne dass die App sie je
--      schreibt:
--        * beim INSERT in eine Akquise-Liste  → diese Liste;
--        * beim Umzug (`update of list_id`), solange sie noch leer ist und die
--          ALTE Liste eine Akquise-Liste war → die alte Liste.
--      Einmal gesetzt, bleibt sie stehen: Ein Lead, der von „Nicht erreicht"
--      weiter nach „Rückruf" wandert, gehört weiter zu seiner Importliste.
--      Der Trigger statt eines App-Schreibpfads, damit ein Deploy vor dieser
--      Migration nichts zerbricht (die App schreibt die Spalte nie).
--   3. RPC `rpc_phone_origin_counts` — die Status-Zählung der ABGEWANDERTEN
--      Leads je Herkunftsliste, für die Karten auf /telefon. Eigene RPC statt
--      `rpc_phone_list_counts` umzubauen: Deren Zahlen summiert die Seite zur
--      Gesamtzahl aller Leads; dieselben Leads unter zwei Listen dort
--      hineinzumischen, zählte sie doppelt.
--
--  BACKFILL — zwei Stufen, die zweite mit Ansage:
--
--   a) Leads, die noch in ihrer Akquise-Liste liegen: `origin_list_id = list_id`.
--      Eindeutig.
--   b) Leads, die schon in einer Routing-Liste liegen. Welche Importliste es
--      war, steht in keiner Spalte — auch nicht im Anruf-Log: `logCallAttempt`
--      läuft NACH dem Umzug und schreibt schon die Routing-Liste in den
--      Snapshot. Zugeordnet wird deshalb über den IMPORT: `importPhoneCsv`
--      legt die Liste an und schreibt ihre Leads unmittelbar danach, mit
--      derselben Inhaber-ID. Gewählt wird die jüngste Akquise-Liste derselben
--      Organisation und desselben Inhabers, die höchstens 15 Minuten VOR dem
--      Lead entstanden ist. Zwei Importe desselben Inhabers laufen
--      nacheinander, die Leads des ersten stehen also vor der Liste des
--      zweiten. Was so nicht zuzuordnen ist (einzeln angelegte Leads, Umzüge
--      von vor dem Import-Protokoll), bleibt NULL und erscheint weiter nur in
--      der Routing-Liste — nicht in einer geratenen Importliste.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WANN EINSPIELEN — Reihenfolge ist frei.
--
--   * Vor dem Deploy: folgenlos. Die laufende App kennt die Spalte nicht;
--     der Trigger füllt sie trotzdem schon.
--   * Nach dem Deploy: Die Listen-Seite fällt ohne Spalte auf das alte
--     Verhalten zurück (nur `list_id`), die Karten auf /telefon ohne RPC
--     ebenso. Nichts bricht, es fehlen nur die abgewanderten Leads — also
--     genau der heutige Zustand.
--
--  NICHTS markieren, „Run" auf die ganze Datei (docs §7), danach den
--  Verifikationsblock am Ende fahren. Beliebig oft ausführbar.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.phone_leads
  add column if not exists origin_list_id uuid
    references public.phone_lists (id) on delete set null;

create index if not exists idx_phone_leads_origin_list
  on public.phone_leads (origin_list_id);

comment on column public.phone_leads.origin_list_id is
  'Importliste (list_kind=akquise), aus der der Lead stammt. Überlebt den Umzug in eine Routing-Liste; gesetzt ausschließlich per Trigger phone_leads_origin_list (Migration 0044). NULL = Herkunft unbekannt.';

-- ───────────────────────────────────────────────────────────────────────────
-- Trigger: Herkunft festhalten, bevor list_id sie überschreibt
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.phone_leads_origin_list()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.origin_list_id is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.phone_lists l
                where l.id = new.list_id and l.list_kind = 'akquise') then
      new.origin_list_id := new.list_id;
    end if;
  elsif new.list_id is distinct from old.list_id then
    if exists (select 1 from public.phone_lists l
                where l.id = old.list_id and l.list_kind = 'akquise') then
      new.origin_list_id := old.list_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists phone_leads_origin_list on public.phone_leads;
create trigger phone_leads_origin_list
  before insert or update of list_id on public.phone_leads
  for each row execute function public.phone_leads_origin_list();

-- ───────────────────────────────────────────────────────────────────────────
-- Backfill a) — Leads in ihrer Akquise-Liste
-- ───────────────────────────────────────────────────────────────────────────
update public.phone_leads pl
   set origin_list_id = pl.list_id
  from public.phone_lists l
 where l.id = pl.list_id
   and l.list_kind = 'akquise'
   and pl.origin_list_id is null;

-- ───────────────────────────────────────────────────────────────────────────
-- Backfill b) — schon abgewanderte Leads, über den Importzeitpunkt
-- ───────────────────────────────────────────────────────────────────────────
update public.phone_leads pl
   set origin_list_id = m.origin
  from (
    select p.id as lead_id,
           (select a.id
              from public.phone_lists a
             where a.workspace_id = p.workspace_id
               and a.list_kind = 'akquise'
               and a.created_by_user_id is not distinct from p.created_by_user_id
               and a.created_at <= p.created_at
               and p.created_at - a.created_at < interval '15 minutes'
             order by a.created_at desc
             limit 1) as origin
      from public.phone_leads p
      join public.phone_lists r on r.id = p.list_id
     where r.list_kind <> 'akquise'
       and p.origin_list_id is null
  ) m
 where m.lead_id = pl.id
   and m.origin is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- Zählung der abgewanderten Leads je Herkunftsliste (/telefon)
-- ───────────────────────────────────────────────────────────────────────────
-- Nur Leads, die NICHT mehr in ihrer Herkunftsliste liegen — die übrigen zählt
-- `rpc_phone_list_counts` schon. Personenfilter über den Inhaber der
-- HERKUNFTSliste, dieselbe Regel wie dort (owner_name vor created_by_user_id).
create or replace function public.rpc_phone_origin_counts (
  p_workspace_id uuid,
  p_effective_user_id uuid default null
)
returns table (list_id uuid, status text, cnt bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eff uuid;
begin
  v_eff := public.rpc_effective_user (p_workspace_id, p_effective_user_id);
  return query
    select pl.origin_list_id, pl.status, count(*)::bigint as cnt
    from public.phone_leads pl
    join public.phone_lists o on o.id = pl.origin_list_id
    where pl.workspace_id = p_workspace_id
      and pl.origin_list_id <> pl.list_id
      and (v_eff is null or public.list_owned_by_user(o.owner_name, o.created_by_user_id, v_eff))
    group by pl.origin_list_id, pl.status;
end;
$$;

grant execute on function public.rpc_phone_origin_counts (uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFIKATION (nach dem Einspielen einzeln fahren)
--
-- A1) Jeder Lead in einer Akquise-Liste hat seine Herkunft. Erwartet: 0.
--
--       select count(*) from phone_leads pl join phone_lists l on l.id = pl.list_id
--        where l.list_kind = 'akquise' and pl.origin_list_id is distinct from pl.list_id;
--
-- A2) Wie viele abgewanderte Leads der Backfill zuordnen konnte — und wie
--     viele nicht (die bleiben nur in der Routing-Liste sichtbar):
--
--       select (pl.origin_list_id is not null) as zugeordnet, count(*)
--         from phone_leads pl join phone_lists l on l.id = pl.list_id
--        where l.list_kind <> 'akquise' group by 1;
--
-- A3) Herkunft zeigt nur auf Akquise-Listen DERSELBEN Organisation. Erwartet: 0.
--
--       select count(*) from phone_leads pl join phone_lists o on o.id = pl.origin_list_id
--        where o.list_kind <> 'akquise' or o.workspace_id <> pl.workspace_id;
--
-- A4) Der Trigger hängt. Erwartet: 1 Zeile.
--
--       select tgname from pg_trigger
--        where not tgisinternal and tgname = 'phone_leads_origin_list';
-- ═══════════════════════════════════════════════════════════════════════════
