-- ═══════════════════════════════════════════════════════════════════════════
-- 0030 · Skript-Testarm am Lead festhalten
-- ---------------------------------------------------------------------------
-- Voraussetzung: 0029 eingespielt. Rein additiv.
-- Läuft NICHT automatisch (docs §7) — im Supabase-SQL-Editor ausführen.
--
-- WARUM DAS NÖTIG IST — sonst lügt der A/B-Test systematisch:
--
-- Migration 0029 hat den Testarm als `phone_lists.script_label` eingeführt, also
-- an der LISTE. Das funktioniert nur, solange ein Lead in seiner Liste bleibt —
-- und genau das tut er nicht: `setPhoneLeadOutcome` verschiebt ihn bei
-- „Rückruf" und „Nicht erreicht" physisch in die Routing-Liste des Owners
-- (src/app/actions/phone.ts). Die trägt kein Label.
--
-- Folge: Aus jedem Testarm verschwinden ausgerechnet die schlechten Ausgänge,
-- während Termine und tote Leads in der Akquise-Liste bleiben. Jeder Arm sieht
-- besser aus als er ist — und weil die Abwanderung je nach Skript
-- unterschiedlich stark ausfällt, sind die Arme auch untereinander nicht mehr
-- vergleichbar. Ein A/B-Test mit dieser Verzerrung ist schlechter als keiner,
-- weil man ihm glaubt.
--
-- Lösung: Der Testarm wird beim Import am LEAD festgeschrieben. Er ist damit
-- umzugsfest — dieselbe Eigenschaft, die `phone_leads.target_group` (Branche)
-- schon hat und die diese Achse von Anfang an korrekt gemacht hat.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.phone_leads
  add column if not exists script_label text;

-- Für die Gruppierung in der Auswertung.
create index if not exists idx_phone_leads_ws_script_label
  on public.phone_leads (workspace_id, script_label);

-- ───────────────────────────────────────────────────────────────────────────
-- Backfill: Label der aktuellen Liste übernehmen
-- ---------------------------------------------------------------------------
-- Nur für Leads, die noch in einer Liste MIT Label liegen. Bereits abgewanderte
-- Leads (Routing-Listen) bekommen nichts — ihr ursprünglicher Arm ist nicht
-- mehr rekonstruierbar. Sie zählen künftig als „ohne Testarm" und werden in der
-- Auswertung getrennt ausgewiesen, statt einen Arm zu verfälschen.
-- ───────────────────────────────────────────────────────────────────────────
update public.phone_leads pl
   set script_label = l.script_label
  from public.phone_lists l
 where l.id = pl.list_id
   and pl.script_label is null
   and l.script_label is not null;

notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFIKATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Wie viele Leads tragen einen Testarm?
--   select coalesce(script_label, '— ohne Testarm') as arm, count(*)
--     from phone_leads group by 1 order by 2 desc;
--
-- Abgewanderte Leads ohne Arm, deren Liste eine Routing-Liste ist
-- (erwartet > 0 bei Bestandsdaten, künftig 0 für neu importierte):
--   select count(*) from phone_leads pl
--     join phone_lists l on l.id = pl.list_id
--    where pl.script_label is null and l.list_kind <> 'akquise';
-- ═══════════════════════════════════════════════════════════════════════════
