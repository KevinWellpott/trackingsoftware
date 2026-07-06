import { redirect } from "next/navigation";

// CRM wurde entfernt — alte Bookmarks landen auf dem Dashboard.
export default function CrmRedirectPage() {
  redirect("/");
}
