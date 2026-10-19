import type { MetadataRoute } from "next";

// Web-App-Manifest: „Zum Home-Bildschirm" startet die App ohne Browserleiste,
// wie eine installierte App — mehr Platz fuer Liste und Call-Modus, und der
// Wechsel zum Telefon und zurueck landet wieder genau hier. Bewusst ohne
// Service Worker: Offline gibt es nichts zu tun, jede Zahl kommt live.
//
// Die Datei ist im Proxy-Matcher ausgenommen (src/proxy.ts) — Browser holen
// das Manifest ohne Cookies, der Login-Redirect haette es sonst verschluckt.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "titan. Pitch-Tracker",
    short_name: "titan.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    lang: "de",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
