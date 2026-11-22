# Kundenspace & Finanzen: Analyse und Leitfaden

Stand: 22.11.2026. Grundlage des Kundenspace.

**Beleglage je Aussage**
- **[G]** Seite gelesen
- **[A]** nur Suchauszug gelesen, nicht die Seite
- **[E]** eigene Ableitung

Die Recherche war bewusst klein gehalten (zwei Agenten mit je 8 Suchen, dazu 4 eigene). Kein Produkt
wurde eingeloggt benutzt, Aussagen über UI stammen aus Dokumentation, nicht aus Anschauung.

---

## 1. Wie große Produkte es bauen

### Kunden und Fulfillment

| Produkt | Aufbau / Mechanik | Was wir übernehmen | Beleg |
|---|---|---|---|
| [HubSpot, Datensatzseite](https://knowledge.hubspot.com/records/work-with-records) | drei Zonen: links Identität und Eigenschaften, Mitte Reiter, rechts verknüpfte Objekte | feste Kopfzone, Arbeit in der Mitte, Karten (Geld, Ablage) rechts | A |
| [Vitally, Customer 360](https://docs.vitally.io/en/articles/9967873-customer-360) | Team-Standardansicht, angepinnte Felder, verknüpfte Aufgaben und Dokumente | alles zu einem Kunden auf einer Seite | A |
| [Planhat, Portfolio](https://www.planhat.com/features/organize) | eigenes Portfolio, schneller Wechsel zu dem von Kollegen | „Meine · je Person · Alle“ | A |
| [Certinia, Playbooks](https://help.certinia.com/main/2026.2/Content/CSC/Features/Playbooks/PlaybooksOverview.htm) | Vorlage wird beim Zuweisen als Vorschau gezeigt, Punkte abwählbar, Zuständige werden geerbt | Vorschau mit Abwahl | G |
| [Asana, Vorlagen](https://forum.asana.com/t/updating-created-projects-after-a-template-is-edited/709486) | Änderungen an der Vorlage erreichen angelegte Projekte nicht | Kopie statt Live-Verknüpfung | A |
| [Gainsight, Nutzerwünsche](https://communities.gainsight.com/ideas/update-templates-of-success-plans-after-they-are-active-in-use-5954) | Wunsch nach Nachziehen, Warnung vor Datenverlust dabei | „Neue Punkte ergänzen“, nur anhängend | A |
| [Fellow, Agenden](https://help.fellow.app/en/articles/6255605-agenda-items-not-carrying-forward) | Agenda je Meeting, Offenes wandert mit, Archiviertes nicht | Übernahme mit Herkunftsdatum | A |

### Forderungen und Finanzen

| Produkt | Aufbau / Mechanik | Was wir übernehmen | Beleg |
|---|---|---|---|
| [Stripe, Payment Plans](https://docs.stripe.com/invoicing/payment-plans) | jede Rate mit eigener Fälligkeit, Zahlungen füllen die älteste zuerst, Überschuss wird Guthaben | vorhandenes Modell bleibt | G |
| [Chargebee, Receivables](https://chargebee.com/docs/receivables/dashboard.html) | Kennzahlen: offen, überfällig, zugesagt | Zugesagt getrennt von Überfällig | G |
| [Upflow, Promise to Pay](https://docs.upflow.io/en-us/core-entities/invoices/promise-to-pay) | Zusage mit Datum, verfällt um 23:59, meldet an Zuständige, steht im Verlauf | „Zusage gebrochen“ | G |
| [QuickBooks, Cash Flow Planner](https://quickbooks.intuit.com/learn-support/en-ie/money-movement/cash-flow-planner/01/733995) | Überfälliges zählt erst mit neuem Datum in die Prognose | keine schöngerechnete Prognose | A |
| Xero, Aged Receivables | Altersklassen, Beschwerden über zu rosige Prognose | 1–7 / 8–30 / über 30 Tage (kürzer, weil Monatsraten) | A/E |
| [Float](https://intercom.help/floatapp/en/articles/1884235-does-float-automatically-forecast-for-me) | Ist ersetzt Plan, damit nichts doppelt zählt | Plan und Ist nie addieren | G |

### UI-Technik

| Vorbild | Technik | Für uns | Beleg |
|---|---|---|---|
| Linear ([Sekundäranalyse](https://github.com/Aslam97/reverse-linear-sync-engine)) | lokaler Datenbestand, Änderung sofort sichtbar, Sync danach, Undo je Transaktion | nur das Verhalten übernehmen, keine Sync-Engine | A |
| [Shopify, Layout](https://shopify.dev/docs/apps/design-guidelines/layout) | Listen in voller Breite, Detailseiten zweispaltig | genauso | A |
| [Stripe Apps, Patterns](https://docs.stripe.com/stripe-apps/patterns) | Filter als Chips über der Liste, eigenes Muster für Zustände | genauso | A |
| Next.js 16 (mitgelieferte Docs) | `useOptimistic`; Server Actions laufen **nacheinander** | Haken sofort, Mehrschrittiges in EINER Action | G |

---

## 2. Parameter

| Parameter | Wert |
|---|---|
| Haken setzen | Anzeige sofort, bei Fehler zurück mit Meldung, erneuter Klick nimmt zurück |
| Häufigste Handlungen | Haken: 1 Klick · Eingang buchen: 2 Klicks · Agenda-Punkt: tippen + Enter |
| Übergabe | ohne Scrollen bei 1440×900: Termin, Agenda, offene Aufgaben |
| Handy | 390 px ohne seitliches Scrollen der Seite, Touch-Ziele mindestens 44 px |
| Kennzahlen je Ansicht | höchstens 4 |
| Primäre Aktion je Ansicht | genau eine in Orange |
| Altersklassen | 1–7 · 8–30 · über 30 Tage |
| Meeting braucht Aufmerksamkeit | kein Termin · Termin vorbei ohne Abschluss · unter 48 h ohne Agenda |
| Geld | intern in Cent, Summen müssen auf den Cent aufgehen |
| Zeit | Berliner Kalendertag, Referenztag kommt vom Server |
| Farbe | Rot = überfällig · Gold = handeln · Grün = eingegangen, immer mit Text |

---

## 3. Richtlinien

### Fulfillment
- **F1** Es gibt beliebig viele Vorlagen. Ein Kunde kann mehrere bekommen. [E]
- **F2** Zuweisen kopiert. Eine geänderte Vorlage ändert keinen laufenden Kunden. [A]
- **F3** Nachziehen hängt nur an. Es überschreibt und löscht nie. [A/E]
- **F4** Vor dem Zuweisen: Vorschau, Punkte abwählbar. [G]
- **F5** Ein Punkt ist eine Checkbox. Keine Abhängigkeiten, keine Unterpunkte, kein Gantt. [E]

### Meeting
- **M1** Das nächste Meeting ist ein eigenes Objekt: Termin, Person, Agenda. [A]
- **M2** Die Agenda besteht aus einzelnen Punkten und steht ganz oben in der Akte. [A/E]
- **M3** Abschließen ist ein Ablauf: abhaken, Ergebnis, nächster Termin, nächste Agenda. [E]
- **M4** Offenes wandert mit „übernommen vom …“ weiter und ist wegklickbar. [A]
- **M5** Ein altes Protokoll zu korrigieren ändert nie die Planung. [E]

### Geld
- **G1** Überfällig und die Tage werden abgeleitet, nie gespeichert. [G]
- **G2** Ursprüngliche Fälligkeit, vereinbartes Datum und Zahlungstag sind drei Dinge. [A]
- **G3** Verschieben braucht Datum und Grund, und der alte Monat zeigt „übertragen nach …“. [E]
- **G4** Bei teilbezahlten Raten wird nur der offene Rest verschoben. [E]
- **G5** Ein neuer Plan fasst nur Offenes an. Die Vorschau zeigt vorher und nachher. [E]
- **G6** Plan und Vertragswert müssen aufgehen, sonst steht die Differenz sichtbar da. [E]
- **G7** Prognose trennt: eingegangen, noch planmäßig, überfällig (unsicher). [A]
- **G8** Plan und Ist werden nie addiert. [G]
- **G9** Eine Kostenänderung gilt ab Monat X, frühere Monate bleiben. [A/E]
- **G10** Jede Änderung an Geld steht mit Person und Zeit im Verlauf. [G]
- **G11** Jede mehrschrittige Geldänderung ist eine Datenbank-Transaktion. [E]

### Zuständigkeit
- **Z1** Jeder offene Betrag hat eine zuständige Person oder steht unter „Ohne Zuständigen“. [E]
- **Z2** Zuständigkeit filtert. Rechte vergibt sie nur, wenn das ausdrücklich entschieden ist. [E]
- **Z3** Ein Aufmerksamkeits-Hinweis wird abgeleitet und nennt seinen Grund. [E]

### UI
- **U1** Liste in voller Breite mit Filter-Chips, am Handy als Karten. [A]
- **U2** Akte zweispaltig: links Arbeit, rechts Geld und Stammdaten, am Handy untereinander. [A]
- **U3** Filter und Monat stehen in der URL. [E]
- **U4** „Nicht ermittelbar“ ist nie 0. Ein Ladefehler sieht nie aus wie „nichts offen“. [E]
- **U5** Nur vorhandene Ember-Glass-Tokens und Komponenten. [E]

---

## 4. Bewusst nicht bauen

Das Nachfass-System wurde im September als „Produkt für zwanzig Setter“ zurückgebaut. Deshalb hier nicht:
Health-Scores, Automations-Regeln, Mahnstufen mit Textvorlagen, Verzugszinsen, Bankanbindung,
Mehrwährung, Buchhaltungsexport, Abhängigkeiten zwischen Punkten, Live-Sync von Vorlagen,
Kundenlogin, Sync-Engine.

## 5. Grenzen der Analyse

- Zu Notion, GUIDEcx, Paperbell, Chaser, Agicap, sevdesk und lexoffice gibt es keine belastbaren Befunde.
- „Überfällig“ in der App ist keine Aussage über rechtlichen Verzug (§ 286 BGB).
- Umsatzsteuer-Zeitpunkte klärt der Steuerberater, die App bildet sie nicht ab.
