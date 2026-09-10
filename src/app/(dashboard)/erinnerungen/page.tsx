import { redirect } from "next/navigation";

// Die Erinnerungs-Kaskade ist mit dem Rückbau gefallen: keine Stufen, keine
// Vorlagen, keine stundengenauen Touches vor einem Termin. Was von der Frage
// „um wen muss ich mich kümmern?" bleibt, beantwortet die Terminliste.
//
// Die Route bleibt als Weiterleitung stehen, statt gelöscht zu werden — Muster
// /organic, /crm, /follow-up, /setting: Lesezeichen und offene Tabs sollen
// nicht ins Leere laufen, sondern dort landen, wo die Arbeit jetzt liegt.
export default function ErinnerungenRedirectPage() {
  redirect("/termine");
}
