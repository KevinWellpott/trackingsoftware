import { getAccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { loadDropoutList } from "@/app/actions/dropout";
import { dropoutListMeta, parseDropoutList } from "@/lib/dropoutLists";
import { AblageBoard } from "@/components/ablage/AblageBoard";
import { AblageNav } from "@/components/ablage/AblageNav";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { InfoPopover } from "@/components/ui/InfoPopover";

// Ablage: ein Bereich, zwei Ansichten, umgeschaltet über `?liste=`.
//
// Hier landet, was aus dem Funnel gefallen ist — abgesagt ohne Aussicht,
// disqualifiziert, kein Close, No-Show ohne Antwort — und daneben die
// Sperrliste. Die Zugehörigkeit steht in keiner Tabelle, sondern leitet
// `dropout_lists()` (Migration 0033) aus dem Zeilenzustand ab; dadurch sind die
// Listen am ersten Tag gefüllt und können nicht neben `status` und
// `cancelled_at` auseinanderlaufen.
//
// Der Zustand liegt vollständig in der URL — jede Ansicht ist teilbar, und der
// Zurück-Knopf des Browsers tut das Erwartete. Die alten Reiter-Adressen führen
// weiter auf die Ansicht, in der ihr Inhalt jetzt liegt (`parseDropoutList`).

export const dynamic = "force-dynamic";

export default async function AblagePage({
  searchParams,
}: {
  searchParams: Promise<{ liste?: string }>;
}) {
  const access = await getAccessContext();
  if (!access) return null;

  const sp = await searchParams;
  const list = parseDropoutList(sp.liste);
  const meta = dropoutListMeta(list);

  const result = await loadDropoutList(list);

  // „Heute" kommt vom Server, nicht aus dem Browser: die Karte entscheidet
  // damit, ob eine Wiedervorlage bereits fällig ist, und der Browser kann in
  // einer anderen Zeitzone stehen (docs §6).
  const today = berlinDateISO(new Date().toISOString());

  const scopeNote = meta.orgWide
    ? "Org-weit, unabhängig von der Datensicht."
    : access.effective_user_id
      ? `Datensicht: ${access.effective_username ?? "ausgewählte Person"}.`
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <BackLink href="/" label="Dashboard" />

      <PageHeader
        eyebrow="Ablage"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            {meta.title}
            <InfoPopover label={`${meta.title}: Woraus die Liste entsteht`} width={380}>
              {meta.derivation}
            </InfoPopover>
          </span>
        }
        meta={
          <>
            {meta.meta}
            {result.available && (
              <>
                {" "}
                {result.rows.length} {result.rows.length === 1 ? "Vorgang" : "Vorgänge"}.
              </>
            )}
            {scopeNote && ` ${scopeNote}`}
          </>
        }
      >
        <AblageNav active={list} />
      </PageHeader>

      <AblageBoard
        list={list}
        rows={result.rows}
        available={result.available}
        maxAttempts={result.maxAttempts}
        today={today}
      />
    </div>
  );
}
