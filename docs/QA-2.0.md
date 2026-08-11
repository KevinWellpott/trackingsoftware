# QA-Checkliste vor dem Launch

Stand: August 2026, Branch `main` — nach dem Feedback-Umbau (Personen-Zuordnung,
Analyse-Neubau, Anruf-Log) und der Entschlackung des Analyse-Bereichs.

Durchführen mit `npm run dev`, auf **Desktop und Mobil** (DevTools 360×800 oder
echtes Gerät). Die App ist **dark-only** — es gibt keinen Hell/Dunkel-Umschalter
mehr; wo diese Checkliste früher zwei Themes verlangte, ist das erledigt, nicht
vergessen.

Reihenfolge ist nach Risiko sortiert, nicht nach Menü. Wer abbrechen muss, hat
mit den ersten drei Abschnitten das Wesentliche geprüft.

---

## 0. Voraussetzungen

- [ ] Migrationen `0019`–`0030` im **Supabase-SQL-Editor** ausgeführt (sie laufen
      **nicht** automatisch, siehe `docs/data-model.md` §7). Reihenfolge zwingend;
      `0030` setzt `0029` voraus, `0029` muss **vor** dem Deploy des Codes laufen —
      `analyseData.ts` selektiert die neuen Spalten namentlich, und eine fehlende
      Spalte lässt PostgREST die *gesamte* Abfrage abweisen (leerer Analyse-Bereich
      statt unvollständigem).
- [ ] Invarianten aus `docs/data-model.md` §8 durchlaufen — alle liefern `0`
      bzw. eine leere Menge. Besonders: keine `assigned_user_id is null`, keine
      Zuweisung über eine Org-Grenze, kein Lead ohne Testarm in einer
      Routing-Liste (Ausnahme: Altbestand von vor `0030`).
- [ ] `SUPABASE_ACCESS_TOKEN` gesetzt, falls per MCP gegengerechnet werden soll.

## 1. Automatische Checks (bei jeder Änderung)

```bash
npx tsc --noEmit     # 0 Fehler
npm run lint         # 0 Warnungen
npm run build        # muss grün sein
```

Es gibt **keine Tests und keine CI** — diese drei Befehle sind die gesamte
automatische Absicherung. `next lint` existiert in dieser Next-Version nicht
mehr; das Script ruft `eslint` direkt auf.

## 2. Personen-Zuordnung (das riskanteste Stück)

Der Wechsel von „wer hat angelegt" auf „wem gehört der Termin" verschiebt
Termine und Umsatz zwischen Personen. Das ist gewollt und der wahrscheinlichste
„das ist kaputt"-Report.

- [ ] Gegenprobe aus dem Plan gelaufen (`created_by_user_id` vs.
      `assigned_user_id`, gruppiert) — die Verschiebungen sind erklärbar.
- [ ] Neuer Termin aus LinkedIn/Telefon → zuständig ist der **Owner der
      Quellliste**, nicht der Anlegende.
- [ ] Termin manuell angelegt → zuständig ist die **real angemeldete** Person,
      auch wenn gerade die Datensicht eines Kollegen aktiv ist.
- [ ] Closing aus „Qualifiziert" → erbt die Zuständigkeit vom Setting.
- [ ] Umverteilen über `setAssignee()` nur als `owner` + `data_scope='workspace'`;
      „Niemand" fällt sichtbar auf den Ersteller zurück.
- [ ] **Mit einem `data_scope='own'`-Account gegenprüfen:** Ein Termin, den ein
      Admin FÜR dieses Mitglied angelegt hat, ist für das Mitglied sichtbar. Die
      RLS-Policy war der einzige destruktiv ersetzte Teil von `0028`.
- [ ] Telefon-Zahlen eines Mitglieds erscheinen beim Mitglied, nicht beim Admin,
      der die Liste angelegt hat (`owner_name`-Vorrang, seit `0028` auch im
      Personenfilter der `rpc_phone_*`).

## 3. Analyse-Bereich (`/analyse`, sechs Tabs + `/analyse/vergleich`)

- [ ] Alle sechs Tabs laden: Übersicht · LinkedIn · Telefon · Setting · Closing ·
      Funnel. `?tab=followup` / `?tab=listen` fallen still auf „uebersicht".
- [ ] Filterleiste: auf- und zuklappbar, Zustand überlebt den Reload
      (localStorage, **nicht** URL); im zugeklappten Kopf steht der aktive Filter
      als Satz.
- [ ] „Eigener Zeitraum" öffnet die Datumsfelder und filtert danach wirklich.
- [ ] Beim Tabwechsel verschwinden Parameter, die auf dem Zieltab kein
      Bedienelement haben (kein unsichtbares Weiterfiltern).
- [ ] Sektionen sind einklappbar; die meisten starten zu. Der Klick auf das
      **Info-Icon** öffnet die Erklärung und klappt die Sektion **nicht** um.
- [ ] „Fortschritt" (kumulativ, mit Vorperiode) steht auf jedem Tab oben;
      „… im Verlauf" (Setting/Closing) ist die bucketierte Variante daneben.
- [ ] **Funnel-Tab zeigt für denselben Zeitraum weniger Termine** als Setting-Tab
      und Übersicht — er schneidet bei heute ab. Die Meta-Zeile nennt das
      beschnittene Fenster. Das ist korrekt, kein Fehler.
- [ ] Funnel-Umschalter `modus=kohorte|periode` verändert die Zahlen sichtbar.
- [ ] Telefon-Tab ohne Migration `0028`: Anwahl-Kachel und Anruf-Log zeigen einen
      Hinweis, der Rest des Tabs bleibt stehen (kein Absturz, keine 0).
- [ ] Zeitraum vor dem Log-Start: Anwahlen zeigen „—", nicht 0.
- [ ] `/analyse/vergleich`: zwei Serien per Chip-Filter bauen, Link kopieren,
      in einem neuen Tab öffnen → identisches Bild. Eine strukturell leere
      Kombination („DMs × Kanal Telefon") ist im Dropdown **gesperrt** und
      erzeugt bei gesetztem Filter eine Warnzeile statt eines leeren Diagramms.
- [ ] Eine Liste mit über 1000 Zeilen: Summen stimmen (kein PostgREST-1000er-Cap).

## 4. Termin-Funnel

- [ ] `/termine`: Monat/Woche/Tag; **nichts wird ausgeblendet** — auch
      `dead`/`unqualifiziert` stehen da. Füllung = Typ, Rahmen = Status.
- [ ] Termin anlegen mit Art „Telefon" → Rufnummer ist Pflicht; mit „Link" →
      Meet-Link ist Pflicht.
- [ ] Termin speichern und erneut öffnen → **dieselbe Uhrzeit** (kein Versatz um
      den UTC-Offset). Gegenprobe im Sommer *und* mit einem Winter-Datum.
- [ ] Setting-Outcome: „Qualifiziert" legt sofort das Closing an und setzt
      `closing_gelegt`; Closing löschen → Setting fällt auf `offen` zurück.
- [ ] Closing „Verloren" erzwingt einen **Verlustgrund-Code** (neun Werte), der
      Freitext daneben ist optional.
- [ ] Closing mit Ergebnis, ohne gesetztes `show_status` → wird auf `show`
      abgeleitet; ein bewusst gesetztes `no_show` bleibt stehen.

## 5. Telefon

- [ ] CSV-Import: Duplikate übersprungen; `target_group` und `script_label` der
      Liste landen **auf jedem Lead**.
- [ ] Call-Mode: jeder Outcome-Klick erzeugt genau eine Zeile in
      `phone_call_attempts`; `kind` stimmt (der Anruf, der einen Rückruf
      *verabredet*, ist kein `rueckruf`, der Rückruf selbst schon).
- [ ] „Rückruf" ohne Datum+Uhrzeit blockiert; mit → Lead wandert physisch in die
      Rückruf-Liste **und behält seinen Testarm**.
- [ ] A/B-Sektionen: Arme unter 20 Erstkontakten sind ausgeblendet und in der
      Fußnote gezählt; Leads ohne Label bekommen keine Sammelzeile.
- [ ] Skript einer Liste nachträglich ändern → Label zieht auf die Leads durch,
      die noch in der Liste liegen.

## 6. Mandantenfähigkeit & Plattform-Admin

- [ ] In der **eigenen** Organisation: `/team` zeigt nur eigene Mitglieder ·
      Datensicht-Auswahl ohne fremde Namen · `/termine` ohne fremde Termine ·
      Suche nach einem fremden Lead liefert 0 Treffer · Sidebar ohne fremde Listen.
- [ ] Org-Umschalter (rot) wechselt die Organisation und löscht dabei **immer**
      den Datensicht-Cookie; das rote Warnbanner steht in fremder Org.
- [ ] In fremder Org angelegte Termine haben `assigned_user_id is null` — das ist
      der einzige legitime NULL-Fall.
- [ ] `/admin/org/[id]`: Nutzer-Umzug und Org-Löschung zeigen zuerst eine
      Vorschau; Löschen verlangt das Abtippen des Namens und verweigert, solange
      noch Mitglieder da sind.
- [ ] Zeilen-Aktionen erscheinen beim Hover als Icons, nicht als drei
      Text-Buttons.

## 7. Dashboards

- [ ] `/` (persönlich): Perioden-Umschalter greift auf **alle** Zahlen der Seite,
      nicht nur auf die oberen Kacheln. Sektionen: Ziele · Trend · Funnel · Telefon.
- [ ] Kein dunkler Balken über dem Seitenkopf (`ember-glow` gehört auf eine
      Fläche, nie auf den nackten Canvas — DESIGN.md §5).
- [ ] `/team`: nur Wochenduell und Team-Vergleich, **alle** Zahlen im Fenster der
      laufenden Woche Mo–So. Keine Funnel-Sektion.
- [ ] `/team` trägt nur Markenfarben — Orange-Stufen und Neutraltöne, keine
      Fremd-Hues (DESIGN.md §3.7).
- [ ] „Dashboard ansehen" wechselt die Datensicht; Banner „Zurück zu meinen
      Daten" erscheint.

## 8. Design & Responsive

- [ ] 360px: nirgends horizontales Scrollen der Seite (Ausnahme: bewusste
      Scroller wie die Wochen-Historie).
- [ ] Zahlen stehen sofort da — kein Hochzählen (der `NumberTicker` ist eine
      reine Formatierung; zehn gleichzeitig animierte Kacheln zeigten in der
      ersten Sekunde zehn Nullen und ignorierten `prefers-reduced-motion`).
- [ ] Navigation markiert auch Detailseiten (`/setting/<id>` hebt „Setting" hervor).
- [ ] Dropdowns (Organisation, Datensicht) schieben die Seitennavigation nicht.

## 9. Bekannte Lücken — geprüft, bewusst offen, nicht launch-blockierend

Sie stehen hier, damit sie nicht als Neuentdeckung zurückkommen:

- **CSV-Export kennt `lost_reason_code` nicht** — er exportiert weiter den
  Freitext `lost_reason`.
- **`move_user_scope()` kennt die Zuweisung nicht**: Der Besitz an Terminen wird
  beim Nutzer-Umzug über `created_by_user_id` ermittelt. Ein Termin, der dem
  Umziehenden nur *zugewiesen* ist, bleibt zurück (Invariante in §8 fängt das ab).
- **`phone_call_attempts` fehlt in der Umzugs- und Löschvorschau** — das
  Anruf-Log zieht beim Umzug nicht mit; gelöscht wird es beim Org-Delete trotzdem
  (Cascade).
- **„Termin manuell" hat kein Zuweisungsfeld** — er landet immer beim Anlegenden
  und muss danach über `setAssignee()` umverteilt werden.
- **`closing_calls` hat keine Rufnummer** — die Telefonnummer steht nur am Setting.
- **Das Listen-Board füllt eine bekannte Rufnummer nicht vor.**
- **Verlustgründe der Bestandsdaten stehen alle auf `sonstiges`** (Backfill
  `0029`, bewusst kein Rate-Mapping). Bis zur Nachpflege ist die Verteilung eine
  Aussage über das Deploy-Datum, nicht über die Einwände.
- **Closing-Show-Quote steht nahe 100 %** — `show_status` wurde für Bestandsdaten
  aus dem Ergebnis abgeleitet; echte Alt-No-Shows sind nicht rekonstruierbar.
- **„Zu Closing geschickt" steht fast immer auf 100 %** — der Zwischenschritt
  „qualifiziert, aber noch kein Closing gelegt" ist in der Oberfläche nicht
  erreichbar (`docs/data-model.md` §4).
