import { redirect } from "next/navigation";

// Siehe /setting: die Übersicht lebt jetzt im Kalender unter /termine.
// /closing/[callId] bleibt unverändert erreichbar.
export default function ClosingPage() {
  redirect("/termine");
}
