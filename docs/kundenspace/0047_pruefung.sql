-- Nach dem Einspielen von 0047 im SQL-Editor ausführen. Jede Zeile muss ok = true zeigen.

select 'A jeder gewonnene Titan-Deal hat einen Kunden' as pruefung,
       not exists (select 1 from closing_calls cc
                    where cc.workspace_id = intern_workspace_id() and cc.status = 'gewonnen'
                      and not exists (select 1 from kunden k where k.closing_call_id = cc.id)) as ok
union all
select 'B jeder Kunde hat Vertrag und genau ein geplantes Meeting',
       not exists (select 1 from kunden k
                    where not exists (select 1 from kunden_vertraege v where v.kunde_id = k.id)
                       or (select count(*) from kunden_meetings m where m.kunde_id = k.id and m.status = 'geplant') <> 1)
union all
select 'C keine Kaskade auf workspaces',
       not exists (select 1 from pg_constraint c
                    where c.confrelid = 'public.workspaces'::regclass and c.confdeltype = 'c'
                      and c.conrelid::regclass::text ~ '(kunden|kosten|fulfillment|intern_)')
union all
select 'D anon darf keine der Funktionen ausführen',
       not exists (select 1 from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname ~ '^(intern_|is_intern_|kunde|finanz_anwenden|kosten_anlegen|meeting_abschliessen|checkliste_aus|vorlage_dupl|closing_calls_kunde_sync)'
                      and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'E anon darf keine der Tabellen lesen',
       not exists (select 1 from pg_class c
                    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
                      and c.relname ~ '^(kunden|kosten_|fulfillment_|intern_einstellungen)'
                      and has_table_privilege('anon', c.oid, 'select'))
union all
select 'F 18 Tabellen, alle mit RLS',
       (select count(*) = 18 and bool_and(c.relrowsecurity) from pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
           and c.relname ~ '^(kunden|kosten_|fulfillment_|intern_einstellungen)')
union all
select 'G zuständig sind nur Admins',
       not exists (select 1 from kunden k
                    where k.betreuer_user_id is not null and not intern_kann_zustaendig_sein(k.betreuer_user_id))
union all
select 'H Bucket privat',
       exists (select 1 from storage.buckets where id = 'kunden-ablage' and not public);
