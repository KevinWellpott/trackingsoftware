-- Antwort-Kategorien: künftig nur noch Positiv / Neutral / Negativ wählbar.
-- Bestandsdaten (alte Kategorien wie "Interessiert", "Zu teuer" …) bleiben
-- UNVERÄNDERT in der Spalte und werden in der UI weiterhin angezeigt.
-- Diese Migration entfernt nur einen evtl. vorhandenen CHECK-Constraint auf
-- contacts.answer_category (aus der nicht im Repo vorhandenen Alt-Migration),
-- damit die neuen Werte gespeichert werden können. Rein additiv, keine
-- Datenmutation, kein neuer Constraint (Werte werden von der UI kontrolliert).

do $$
declare
  v_con record;
begin
  for v_con in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'contacts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%answer_category%'
  loop
    execute format('alter table public.contacts drop constraint %I', v_con.conname);
  end loop;
end $$;
