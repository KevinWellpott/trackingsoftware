import { redirect } from "next/navigation";

// Alte Follow-up-Ansicht: leitet auf die neue Nachfassen-Union-Tasklist um.
export default function FollowUpRedirect() {
  redirect("/nachfassen");
}
