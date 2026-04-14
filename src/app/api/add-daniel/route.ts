import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Einmalige Route — fügt Daniel zum bestehenden Workspace hinzu
// Aufruf: GET /api/add-daniel
// Login danach: Daniel / Daniel

export async function GET() {
  const admin = createAdminClient();

  const email = "daniel@pitchtracker.internal";
  const username = "Daniel";
  const password = "Daniel";

  // Prüfen ob Daniel schon existiert
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

  // Profil anlegen / aktualisieren
  await admin.from("profiles").upsert(
    { user_id: uid, username },
    { onConflict: "user_id" },
  );

  // Workspace ermitteln
  const { data: ws } = await admin.from("workspaces").select("id").limit(1).single();
  if (!ws?.id) {
    return NextResponse.json({ error: "Kein Workspace gefunden." }, { status: 500 });
  }

  // Als Member hinzufügen (falls noch nicht vorhanden)
  await admin
    .from("workspace_members")
    .upsert(
      { workspace_id: ws.id, user_id: uid, role: "member" },
      { onConflict: "workspace_id,user_id" },
    );

  const html = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>Daniel hinzugefügt</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #09090b; color: #fafafa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 2rem 2.5rem; max-width: 420px; width: 100%; text-align: center; }
  h1 { color: #34d399; font-size: 1.25rem; font-weight: 800; margin: 0 0 1rem; }
  .cred { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.875rem; margin-top: 0.5rem; }
  .label { color: #52525b; }
  .val { color: #34d399; font-weight: 700; font-family: monospace; }
  a { display: block; margin-top: 1.5rem; padding: 0.75rem; background: linear-gradient(135deg,#10b981,#34d399); color: white; font-weight: 700; border-radius: 10px; text-decoration: none; font-size: 0.9375rem; }
  p { color: #71717a; font-size: 0.875rem; }
</style>
</head>
<body>
<div class="box">
  <h1>✓ Daniel wurde angelegt</h1>
  <p>${existing ? "Daniel existierte bereits — Passwort wurde aktualisiert." : "Neuer User Daniel wurde erstellt und zum Workspace hinzugefügt."}</p>
  <div class="cred"><span class="label">Login</span><span class="val">Daniel / Daniel</span></div>
  <a href="/">→ Zum Dashboard</a>
</div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
