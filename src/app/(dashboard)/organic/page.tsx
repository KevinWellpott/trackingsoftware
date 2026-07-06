import { redirect } from "next/navigation";

// Organic wurde entfernt — alte Bookmarks landen auf dem Dashboard.
export default function OrganicRedirectPage() {
  redirect("/");
}
