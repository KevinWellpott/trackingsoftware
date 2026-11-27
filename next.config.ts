import type { NextConfig } from "next";

// Entfernte Seiten (Release Dezember 2026, docs/data-model.md §0.3) leiten
// weiter, statt alte Lesezeichen auf eine 404 laufen zu lassen. Temporär
// (307): Die Ziele können sich noch ändern.
const ENTFERNT: { source: string; destination: string }[] = [
  { source: "/erinnerungen", destination: "/termine" },
  { source: "/follow-up", destination: "/nachfassen" },
  { source: "/crm/:path*", destination: "/" },
  { source: "/crm", destination: "/" },
  { source: "/organic/:path*", destination: "/" },
  { source: "/organic", destination: "/" },
  { source: "/ansicht/:path*", destination: "/listen" },
];

const nextConfig: NextConfig = {
  async redirects() {
    return ENTFERNT.map((r) => ({ ...r, permanent: false }));
  },
};

export default nextConfig;
