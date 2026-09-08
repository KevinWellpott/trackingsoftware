// Auflösungs-Hook für den Pfad-Alias `@/` aus tsconfig.json.
//
// Warum überhaupt: Node kennt die `paths`-Abbildung des TypeScript-Compilers
// nicht — ein `import "@/lib/apptTime"` schlägt im Test-Runner fehl, obwohl es
// im Next-Build trägt. Die Alternative wäre ein Bundler-gestützter Test-Runner
// als neue Abhängigkeit; das hier sind zwanzig Zeilen und kein Paket.
//
// `module.register()` lädt diese Datei in einem eigenen Hook-Thread, deshalb
// darf sie nichts aus dem Projekt importieren.

import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

// Reihenfolge wie bei moduleResolution "bundler": erst der Pfad selbst (falls
// er schon eine Endung trägt), dann die Endungen, zuletzt die index-Datei.
const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx"];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

  const base = path.join(SRC, specifier.slice(2));
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (isFile(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
  }
  // Laut scheitern statt still auf npm-Auflösung zurückzufallen: ein Tippfehler
  // im Alias sähe sonst wie ein fehlendes Paket aus.
  throw new Error(`Alias "@/" nicht auflösbar: ${specifier} (gesucht unter ${base})`);
}
