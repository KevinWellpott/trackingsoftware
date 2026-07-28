import { redirect } from "next/navigation";

// Setting und Closing sind im Kalender unter /termine zusammengeführt.
// Die Detailrouten /setting/[callId] bleiben bestehen — nur die Übersicht
// leitet weiter, damit alte Links und Lesezeichen funktionieren.
export default function SettingPage() {
  redirect("/termine");
}
