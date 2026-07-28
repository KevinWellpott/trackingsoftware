import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Ember Glass laedt ausschliesslich 400/500/600 — Gewicht 700 existiert im
// System nicht, Hierarchie kommt aus Groesse (DESIGN.md §6.2).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "titan. — Pitch-Tracker",
  description: "Follow-ups und Pitch-Pipelines im Team tracken",
};

export const viewport = {
  themeColor: "#0a0a0b",
  colorScheme: "dark" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Ember Glass ist Dark-only — es gibt keinen Light Mode und damit auch
    // kein Theme-Skript, das vor dem ersten Paint umschalten muesste.
    <html lang="de" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
