import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToInternalEmail } from "@/lib/internal-email";

// Einmalige Route - fuegt Samuel Kerber mit eigener Datensicht hinzu.
// Aufruf: GET /api/add-samuel
// Login danach: Samuel Kerber / Samuel

export async function GET() {
  const admin = createAdminClient();

  const username = "Samuel Kerber";
  const email = usernameToInternalEmail(username);
  const password = "Samuel";

  const { data: allUsers } = await admin.auth.admin.listUsers();
  const existing = allUsers?.users?.find((u) => u.email === email);

  let uid: string;

  if (existing) {
    uid = existing.id;
    await admin.auth.admin.updateUserById(uid, { password });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      return NextResponse.json({ error: error?.message ?? "Unbekannter Fehler" }, { status: 500 });
    }
    uid = data.user.id;
  }

  await admin.from("profiles").upsert(
    { user_id: uid, username },
    { onConflict: "user_id" },
  );

  const { data: ws } = await admin.from("workspaces").select("id").limit(1).single();
  if (!ws?.id) {
    return NextResponse.json({ error: "Kein Workspace gefunden." }, { status: 500 });
  }

  await admin
    .from("workspace_members")
    .upsert(
      { workspace_id: ws.id, user_id: uid, role: "member", data_scope: "own" },
      { onConflict: "workspace_id,user_id" },
    );

  const html = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>Samuel hinzugefuegt</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #09090b; color: #fafafa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 2rem 2.5rem; max-width: 420px; width: 100%; text-align: center; }
  h1 { color: #0ea5e9; font-size: 1.25rem; font-weight: 800; margin: 0 0 1rem; }
  .cred { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.875rem; margin-top: 0.5rem; }
  .label { color: #52525b; }
  .val { color: #0ea5e9; font-weight: 700; font-family: monospace; }
  a { display: block; margin-top: 1.5rem; padding: 0.75rem; background: linear-gradient(135deg,#0ea5e9,#38bdf8); color: #09090b; font-weight: 800; border-radius: 10px; text-decoration: none; font-size: 0.9375rem; }
  p { color: #71717a; font-size: 0.875rem; }
</style>
</head>
<body>
<div class="box">
  <h1>Samuel Kerber wurde angelegt</h1>
  <p>${existing ? "Samuel existierte bereits - Passwort und Datensicht wurden aktualisiert." : "Neuer User Samuel wurde erstellt und mit eigener Datensicht zum Workspace hinzugefuegt."}</p>
  <div class="cred"><span class="label">Login</span><span class="val">Samuel Kerber / Samuel</span></div>
  <div class="cred"><span class="label">Datensicht</span><span class="val">Nur eigene Daten</span></div>
  <a href="/">Zum Dashboard</a>
</div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
