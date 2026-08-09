// Erst-Load des Vergleichs (COMPONENTS.md §14.2): Skeleton in der Form des
// echten Layouts — Kopf, Serien-Baukasten, Chart, Tabelle. Die Seite lädt vier
// Tabellen vollständig; ohne Skeleton stünde sie bis zur letzten Zeile leer.

function Bar({ h, w = "100%", r }: { h: number; w?: string | number; r?: string }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r ?? "var(--r-sm)" }} />;
}

function CardSkeleton({ height }: { height: number }) {
  return (
    <div className="card" style={{ padding: "var(--sp-8)", display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <Bar h={16} w={160} />
      <Bar h={height} />
    </div>
  );
}

export default function VergleichLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }} aria-busy="true">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
        <Bar h={12} w={90} />
        <Bar h={26} w={180} />
      </div>

      {/* Baukasten: Zeitraumleiste + zwei Serienzeilen */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <div style={{ display: "flex", gap: "var(--sp-5)", flexWrap: "wrap" }}>
          <Bar h={28} w={280} r="var(--r-full)" />
          <Bar h={28} w={180} r="var(--r-full)" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap" }}>
            <Bar h={28} w={190} r="var(--r-md)" />
            <Bar h={28} w={160} r="var(--r-md)" />
            <Bar h={28} w={160} r="var(--r-md)" />
          </div>
        ))}
      </div>

      <CardSkeleton height={300} />
      <CardSkeleton height={120} />
    </div>
  );
}
