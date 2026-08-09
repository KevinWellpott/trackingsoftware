// Der Fakten-Mapper: vier Quelltabellen → eine flache Faktenzeile.
//
// Hier steckt die eigentliche Arbeit des Vergleichs-Bereichs. Registry
// (metrics.ts) und Aggregation (series.ts) sind danach je ein Dutzend Zeilen,
// weil sie nur noch mit `CompareFact` reden und keine Tabelle mehr kennen.
//
// SERVER-ONLY: importiert Typen und Tages-Helfer aus @/lib/analyseData, das
// seinerseits `@/lib/supabase/server` zieht. Nur aus Server Components
// importieren — das Modell (model.ts) und die Registry (metrics.ts) sind
// bewusst frei davon und dürfen im Browser landen.
//
// Zwei Regeln, die man beim Erweitern nicht brechen darf:
//  1. Die Personenachse ist IMMER eine `user_id`. LinkedIn/Telefon lösen über
//     den Listen-Owner auf (`owner_name` vor `created_by_user_id`), Termine
//     über `personOf()` (Zuweisung vor Ersteller). Beide Wege enden in
//     derselben Identität — sonst hieße eine Serie „Kevin" je nach Quelle
//     etwas anderes.
//  2. Der Tag einer Zeile ist derselbe wie in den Analyse-Tabs
//     (`contactDay`, `phoneLeadDay`, `settingEffDate`, `closingEffDate`).
//     Sonst zählt der Vergleich anders als der Tab daneben.

import { ownerKey } from "@/lib/analyse";
import { closingEffDate, settingEffDate } from "@/lib/analyse";
import {
  contactDay,
  phoneLeadDay,
  type AnalyseClosingCall,
  type AnalyseContact,
  type AnalysePhoneLead,
  type AnalyseSettingCall,
} from "@/lib/analyseData";
import { channelLabel, channelOf, type ChannelKey } from "@/lib/channels";
import { personOf } from "@/lib/personResolution";
import { BRANCHE_LABEL } from "@/lib/settingLabels";
import {
  DIMENSION_KEYS,
  type CompareData,
  type CompareFact,
  type CompareOption,
  type DimensionKey,
  type Measures,
} from "@/lib/compare/model";

export type CompareMember = { user_id: string; username: string };

export type CompareSources = {
  contacts: AnalyseContact[];
  phoneLeads: AnalysePhoneLead[];
  settings: AnalyseSettingCall[];
  closings: AnalyseClosingCall[];
  /** Die sichtbaren Mitglieder — nur auf sie löst die Personenachse auf. */
  members: CompareMember[];
};

/**
 * Ein Setting gilt als qualifiziert, wenn der Lead da war und es weiterging.
 *
 * Definition 1:1 aus dem Setting-Tab übernommen (`isQualified` in
 * src/components/analyse/tabs/SettingTab.tsx) — bewusst nicht neu erfunden,
 * sonst zeigte dieselbe Kennzahl an zwei Stellen zwei Zahlen. Sie gehört
 * mittelfristig nach src/lib/analyse.ts; die Datei liegt in einem anderen
 * Paket und wird hier nicht angefasst.
 */
export function isQualifiedSetting(r: {
  show_status: "show" | "no_show" | null;
  status: string;
}): boolean {
  return r.show_status === "show" && (r.status === "qualifiziert" || r.status === "closing_gelegt");
}

/** Leere Dimensionen — jede Faktenzeile trägt alle fünf Achsen explizit. */
function emptyDims(): Record<DimensionKey, string | null> {
  return { person: null, kanal: null, liste: null, zielgruppe: null, skript: null };
}

/** Trimmt und macht aus Leerstring `null` (die App speichert beides). */
function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

/** Sammelt Ausprägungen je Dimension und hält das erste Label fest. */
class OptionIndex {
  private readonly maps: Record<DimensionKey, Map<string, CompareOption>>;

  constructor() {
    this.maps = {
      person: new Map(),
      kanal: new Map(),
      liste: new Map(),
      zielgruppe: new Map(),
      skript: new Map(),
    };
  }

  add(dim: DimensionKey, value: string | null, label: string, hint?: string): void {
    if (!value) return;
    if (!this.maps[dim].has(value)) this.maps[dim].set(value, { value, label, hint });
  }

  build(): Record<DimensionKey, CompareOption[]> {
    const out = {} as Record<DimensionKey, CompareOption[]>;
    for (const dim of DIMENSION_KEYS) {
      out[dim] = [...this.maps[dim].values()].sort((a, b) => a.label.localeCompare(b.label, "de"));
    }
    return out;
  }
}

/** Kanal-Schlüssel einer Termin-Zeile; Unbekanntes fällt auf „sonstige". */
function channelKeyOf(sourceType: string | null | undefined): ChannelKey {
  return (channelOf(sourceType)?.key as ChannelKey | undefined) ?? "sonstige";
}

/**
 * Anzeigetext einer Zielgruppe. `setting_calls.branche` ist ein Enum mit
 * deutschem Label, `target_group` an Kontakt/Lead ist Freitext — beide landen
 * auf derselben Achse, weil beide dieselbe Frage beantworten („wen sprechen
 * wir an"). Der Schlüssel bleibt der Rohwert, damit ein Deep-Link stabil ist.
 */
function zielgruppeLabel(value: string): string {
  return BRANCHE_LABEL[value] ?? value;
}

/**
 * Baut die Faktentabelle. Reine Funktion — sie lädt nichts, sondern bekommt
 * die bereits über `fetchAllRows` geholten Zeilen (Pflicht: PostgREST
 * schneidet sonst still bei 1000 Zeilen ab, docs §5.1).
 */
export function buildFacts(src: CompareSources): CompareData {
  const facts: CompareFact[] = [];
  const opts = new OptionIndex();

  // ── Personen-Index ─────────────────────────────────────────
  // `byOwnerKey` ist case-insensitiv, weil `owner_name` ein von Hand
  // gepflegter Name ist und die Analyse-Tabs ihn überall über `ownerKey()`
  // vergleichen. `nameById` liefert die Beschriftung der Dropdown-Einträge.
  const byOwnerKey = new Map<string, string>();
  const nameById = new Map<string, string>();
  for (const m of src.members) {
    byOwnerKey.set(ownerKey(m.username), m.user_id);
    nameById.set(m.user_id, m.username);
  }

  /** user_id → Dimensionswert; Fremde/Gelöschte werden zu `null`. */
  const personDim = (userId: string | null): string | null => {
    if (!userId || !nameById.has(userId)) return null;
    opts.add("person", userId, nameById.get(userId)!);
    return userId;
  };

  /**
   * Listen-Owner → user_id. `owner_name` hat Vorrang vor dem Ersteller —
   * dieselbe Regel wie `list_owned_by_user()` in SQL, `buildOwnScope()` in
   * access.ts und `ownerUserIdOfList()` beim Schreiben (docs §2).
   *
   * Ein Unterschied zur Schreib-Variante ist Absicht: Steht dort ein Name,
   * der zu keinem Mitglied der aktiven Organisation gehört (ausgeschieden,
   * Tippfehler, nach einem Org-Umzug), fällt diese Auflösung NICHT auf den
   * Ersteller zurück, sondern auf `null`. Genau so lesen LinkedIn- und
   * Telefon-Tab: Der Rückfall schriebe das Volumen dem Admin zu, der die
   * Liste angelegt hat — und hebelte damit den owner_name-Vorrang aus, für
   * den es ihn überhaupt gibt.
   */
  const ownerOf = (list: { owner_name: string | null; created_by_user_id: string | null } | null): string | null => {
    const name = ownerKey(list?.owner_name);
    if (name) return byOwnerKey.get(name) ?? null;
    return list?.created_by_user_id ?? null;
  };

  const addKanal = (key: ChannelKey): ChannelKey => {
    opts.add("kanal", key, channelLabel(key));
    return key;
  };

  const addZielgruppe = (raw: string | null): string | null => {
    const v = clean(raw);
    if (!v) return null;
    opts.add("zielgruppe", v, zielgruppeLabel(v));
    return v;
  };

  const push = (day: string, dims: Record<DimensionKey, string | null>, m: Measures): void => {
    facts.push({ day, dims, m });
  };

  // ── LinkedIn: contacts ─────────────────────────────────────
  // Messgrößen exakt wie rpc_owner_day_metrics: jede Zeile ist eine DM,
  // `answered`/`appointment_set` sind nullable und zählen nur bei `true`
  // (docs §7, Nullable-Falle).
  for (const c of src.contacts) {
    const dims = emptyDims();
    dims.person = personDim(ownerOf(c.lists));
    dims.kanal = addKanal("linkedin");
    if (c.list_id) {
      opts.add("liste", c.list_id, clean(c.lists?.name) ?? "Ohne Namen", "LinkedIn");
      dims.liste = c.list_id;
    }
    dims.zielgruppe = addZielgruppe(c.target_group);
    push(contactDay(c), dims, {
      dms: 1,
      answers: c.answered === true ? 1 : 0,
      li_appts: c.appointment_set === true ? 1 : 0,
    });
  }

  // ── Telefon: phone_leads ───────────────────────────────────
  // `calls` zählt nur Leads MIT Erstkontakt-Datum — ein importierter, nie
  // angerufener Lead darf die Anwahl-Zahl nicht aufblähen (Semantik von
  // rpc_phone_day_metrics). Sein Tag kommt trotzdem aus `created_at`, damit
  // er in Status-Kennzahlen sichtbar bleibt.
  for (const l of src.phoneLeads) {
    const list = l.phone_lists;
    const dims = emptyDims();
    // Telefonlisten kennen nur `owner_name`; ohne Namen greift der Ersteller
    // des LEADS (so macht es auch der Telefon-Tab). `phone_lists` liefert
    // kein `created_by_user_id` an dieser Stelle — siehe Bericht.
    dims.person = personDim(ownerOf({ owner_name: list?.owner_name ?? null, created_by_user_id: l.created_by_user_id }));
    dims.kanal = addKanal("telefon");
    const listName = clean(list?.name);
    if (listName && l.list_id) {
      // Schlüssel ist die list_id, nicht der Name: Zwei Telefonlisten dürfen
      // gleich heißen (die Routing-Listen „Rückruf" und „Nicht erreicht"
      // existieren je Owner einmal) und fielen über den Namen zusammen.
      // Präfix gegen Kollisionen mit den LinkedIn-Listen-UUIDs.
      const key = `tel:${l.list_id}`;
      opts.add("liste", key, listName, "Telefonliste");
      dims.liste = key;
    }
    dims.zielgruppe = addZielgruppe(l.target_group ?? list?.target_group ?? null);
    // Testarm vom LEAD, nicht von der Liste (Migration 0030) — deckungsgleich
    // mit dem Telefon-Tab. Ueber die Liste gelesen fielen Leads, die bei
    // „Rueckruf"/„Nicht erreicht" in eine Routing-Liste ohne Label gewandert
    // sind, aus ihrem Arm heraus: also ausgerechnet die schlechten Ausgaenge.
    // Der Listenwert bleibt Rueckfall fuer Bestandsleads von vor 0030.
    const script = clean(l.script_label ?? list?.script_label);
    if (script) {
      opts.add("skript", script, script);
      dims.skript = script;
    }
    push(phoneLeadDay(l), dims, {
      calls: l.first_call_at ? 1 : 0,
      gatekeeper: l.gatekeeper_reached === "ja" || l.gatekeeper_reached === "direkt" ? 1 : 0,
      decider: l.decider_reached === true ? 1 : 0,
      phone_appts: l.appointment_set === true ? 1 : 0,
    });
  }

  // ── Setting-Calls ──────────────────────────────────────────
  // Nebenprodukt: Kanal und Zielgruppe je Setting-ID. Die Closings erben
  // beides von ihrem Setting — ohne diese Kette landete jeder Umsatz unter
  // „ohne Kanal", und „Umsatz pro DM" wäre nicht kanalrein.
  const kanalOfSetting = new Map<string, ChannelKey>();
  const zielgruppeOfSetting = new Map<string, string>();

  for (const r of src.settings) {
    const dims = emptyDims();
    dims.person = personDim(personOf(r));
    const kanal = addKanal(channelKeyOf(r.source_type));
    dims.kanal = kanal;
    kanalOfSetting.set(r.id, kanal);
    const zg = addZielgruppe(r.branche);
    dims.zielgruppe = zg;
    if (zg) zielgruppeOfSetting.set(r.id, zg);
    push(settingEffDate(r), dims, {
      settings: 1,
      setting_shows: r.show_status === "show" ? 1 : 0,
      // Nenner der Show-Quote: nur Termine MIT erfasstem Ergebnis. Waeren es
      // alle Termine, sackte jeder laufende Zeitraum ab, nur weil ein Teil der
      // Termine noch bevorsteht. Deckungsgleich mit Setting- und Uebersichtstab.
      setting_decided: r.show_status === "show" || r.show_status === "no_show" ? 1 : 0,
      setting_quali: isQualifiedSetting(r) ? 1 : 0,
      setting_dead: r.status === "dead" ? 1 : 0,
    });
  }

  // ── Closing-Calls ──────────────────────────────────────────
  for (const r of src.closings) {
    const dims = emptyDims();
    dims.person = personDim(personOf(r));
    const kanal = r.setting_call_id ? kanalOfSetting.get(r.setting_call_id) : undefined;
    if (kanal) dims.kanal = addKanal(kanal);
    const zg = r.setting_call_id ? zielgruppeOfSetting.get(r.setting_call_id) : undefined;
    if (zg) dims.zielgruppe = addZielgruppe(zg);
    const won = r.status === "gewonnen";
    push(closingEffDate(r), dims, {
      closings: 1,
      closing_shows: r.show_status === "show" ? 1 : 0,
      won: won ? 1 : 0,
      lost: r.status === "verloren" ? 1 : 0,
      revenue: won ? Number(r.deal_volume) || 0 : 0,
    });
  }

  return { facts, options: opts.build() };
}
