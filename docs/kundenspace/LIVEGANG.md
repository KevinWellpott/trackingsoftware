# Kundenspace: Livegang

Reihenfolge: **erst SQL, dann Merge.** Andersherum bleibt der Kundenspace nur unsichtbar.

1. Den ganzen Inhalt von `supabase/migrations/20260404000047_umsatz_fulfillment.sql` in den
   Supabase-SQL-Editor einfügen, nichts markieren, „Run“. Die Warnung vor „destructive operations“
   meint die `drop policy/trigger if exists`, es werden keine Daten gelöscht. Die Datei läuft in
   einer Transaktion.
2. `docs/kundenspace/0047_pruefung.sql` ausführen: acht Zeilen, alle `ok = true`.
3. Nach `main` mergen. Es sind keine neuen Umgebungsvariablen nötig.
4. In der App unter Umsatz, Verträge je Kunde den Plan samt bezahlter Raten erfassen, Vorlagen
   anlegen, Steuerrücklage und Kosten eintragen.

Zurück: Deploy zurückrollen. Soll auch das automatische Anlegen von Kunden enden:
`drop trigger if exists closing_calls_kunde_sync on public.closing_calls;`
