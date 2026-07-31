// Erst-Load des Analyse-Bereichs (COMPONENTS.md §14.2): Skeleton in der Form
// des echten Layouts — Kopfzeile, Filterleiste, KPI-Reihe, zwei Sektionen.
// Die Abfragen hier gehen über mehrere Tabellen; ohne Skeleton steht die Seite
// bis zur letzten Zeile leer.

/** Ein Skeleton-Block in der Höhe des echten Elements. */
function Bar({ h, w = "100%", r }: { h: number; w?: string | number; r?: string }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r ?? "var(--r-sm)" }} />;
}

function CardSkeleton({ lines }: { lines: number }) {
  return (
    <div className="card" style={{ padding: "var(--sp-8)", display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <Bar h={16} w={180} />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        {Array.from({ length: lines }, (_, i) => (
          <Bar key={i} h={12} w={`${92 - i * 9}%`} />
        ))}
      </div>
    </div>
  );
}

export default function AnalyseLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }} aria-busy="true">
      {/* Kopf */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
        <Bar h={12} w={90} />
        <Bar h={26} w={160} />
      </div>

      {/* Filterleiste */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <Bar h={14} w="60%" />
        <div style={{ display: "flex", gap: "var(--sp-5)", flexWrap: "wrap" }}>
          <Bar h={28} w={260} r="var(--r-full)" />
          <Bar h={28} w={180} r="var(--r-full)" />
          <Bar h={28} w={220} r="var(--r-full)" />
        </div>
      </div>

      {/* KPI-Reihe — vier Kacheln in Zielhöhe */}
      <div className="kpi-row" data-cols={4}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card" style={{ padding: "var(--sp-6) var(--sp-7)", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <Bar h={11} w={80} />
            <Bar h={28} w={110} />
            <Bar h={12} w={130} />
          </div>
        ))}
      </div>

      {/* Zwei Sektionen */}
      <CardSkeleton lines={5} />
      <div className="analyse-row">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={4} />
      </div>
    </div>
  );
}
