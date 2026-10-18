// Ladezustand für jede Seite des Dashboard-Bereichs, die keinen eigenen hat
// (COMPONENTS.md §14.2). Ohne ihn blieb ein Klick in der Seitenleiste so lange
// ohne jede Rückmeldung, bis die Zielseite vollständig gerendert war — die
// Navigation wirkte eingefroren. Mit ihm tauscht Next den Inhalt sofort gegen
// dieses Skelett, die Seitenleiste bleibt stehen, und dynamische Seiten werden
// beim Hover vorgeladen (ohne Ladegrenze prefetcht Next sie gar nicht).
//
// Bewusst neutral geformt — Kopf, eine Kachelreihe, ein Block —, weil es vor
// sehr verschiedenen Seiten steht. Seiten mit eigener Form (/analyse) bringen
// ihr eigenes loading.tsx mit, das dieses hier überschreibt.

function Bar({ h, w = "100%" }: { h: number; w?: string | number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: "var(--r-sm)" }} />;
}

export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Seite wird geladen"
      style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
        <Bar h={12} w={90} />
        <Bar h={26} w={220} />
      </div>

      <div className="kpi-row" data-cols={4}>
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="card"
            style={{ padding: "var(--sp-6) var(--sp-7)", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}
          >
            <Bar h={11} w={80} />
            <Bar h={28} w={110} />
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: "var(--sp-8)", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Bar key={i} h={14} w={`${94 - i * 7}%`} />
        ))}
      </div>
    </div>
  );
}
