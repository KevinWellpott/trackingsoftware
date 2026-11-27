import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { GlassPointer } from "@/components/ui/GlassPointer";
import {
  CANVAS_COLOR,
  MATERIAL_COOKIE,
  THEME_COOKIE,
  THEME_INIT_SCRIPT,
  parseMaterialPref,
  parseThemePref,
} from "@/lib/appearance";
import "./globals.css";

// Inter als variable Schrift mit optischer Groesse (Achse `opsz`): kleine
// Zeilen bekommen offenere Formen, grosse Zahlen engere. Gewichte im Einsatz:
// 400 · 500 · 550 · 600 — nie 700, Hierarchie kommt aus der Groesse.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "titan. — Pitch-Tracker",
  description: "Follow-ups und Pitch-Pipelines im Team tracken",
};

export const viewport: Viewport = {
  // Browser-Leiste in der Farbe des Canvas — je nach Systemmodus.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: CANVAS_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: CANVAS_COLOR.dark },
  ],
  colorScheme: "dark light",
  // Vollflaechig bis an Notch und Home-Indikator; die Abstaende holen sich
  // Kopfzeile und Tab-Leiste ueber env(safe-area-inset-*) zurueck.
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Darstellung je Geraet (lib/appearance.ts). `data-theme` selbst setzt das
  // Skript im <head> vor dem ersten Paint — bei „System" kennt nur der
  // Browser die Antwort, und ein serverseitig geratener Wert blitzte auf.
  const store = await cookies();
  const themePref = parseThemePref(store.get(THEME_COOKIE)?.value);
  const material = parseMaterialPref(store.get(MATERIAL_COOKIE)?.value);

  return (
    <html
      lang="de"
      className={`${inter.variable} h-full antialiased`}
      data-theme-pref={themePref}
      data-material={material}
      // Das Kopf-Skript ergaenzt `data-theme` vor der Hydration.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <GlassPointer />
      </body>
    </html>
  );
}
