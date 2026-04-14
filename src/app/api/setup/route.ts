import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Einmalige Setup-Route — erstellt Kevin + Simon + Daniel + Workspace
// Aufruf: GET /api/setup
// Danach kann man sich mit Kevin/Kevin, Simon/Simon und Daniel/Daniel einloggen

const USERS = [
  { username: "Kevin", password: "Kevin" },
  { username: "Simon", password: "Simon" },
  { username: "Daniel", password: "Daniel" },
];

export async function GET() {
  const admin = createAdminClient();
  const results: string[] = [];

  // Sicherheit: Nur ausführen wenn noch keine Nutzer existieren
  const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 1 });
  if (existingUsers?.users?.length > 0) {
    const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Setup</title>
    <style>body{font-family:-apple-system,sans-serif;background:#09090b;color:#fafafa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .box{background:#18181b;border:1px solid#27272a;border-radius:16px;padding:2rem 2.5rem;max-width:420px;text-align:center}
    h1{color:#f87171;font-size:1.1rem;margin:0 0 1rem}p{color:#71717a;font-size:.875rem}a{color:#818cf8;font-weight:700}</style></head>
    <body><div class="box"><h1>⚠ Setup nicht nötig</h1><p>Es existieren bereits Nutzer. Nutzer verwaltest du unter <a href="/settings">Einstellungen</a>.</p></div></body></html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 403 });
  }

  const userIds: string[] = [];

  for (const u of USERS) {
    const email = `${u.username.toLowerCase()}@pitchtracker.internal`;

    // Prüfen ob User schon existiert
    const { data: existing } = await admin.auth.admin.listUsers();
    const found = existing?.users?.find((x) => x.email === email);

    let uid: string;

    if (found) {
      uid = found.id;
      // Passwort aktualisieren falls nötig
      await admin.auth.admin.updateUserById(uid, { password: u.password });
      results.push(`✓ ${u.username} existiert bereits (Passwort aktualisiert)`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: u.password,
        email_confirm: true,
      });
      if (error || !data.user) {
        results.push(`✗ ${u.username} Fehler: ${error?.message}`);
        continue;
      }
      uid = data.user.id;
      results.push(`✓ ${u.username} erstellt`);
    }

    // Profil anlegen
    await admin.from("profiles").upsert(
      { user_id: uid, username: u.username },
      { onConflict: "user_id" },
    );

    userIds.push(uid);
  }

  // Workspace anlegen (falls noch keiner existiert)
  const { data: existingWS } = await admin
    .from("workspaces")
    .select("id")
    .limit(1)
    .single();

  let workspaceId: string;

  if (existingWS?.id) {
    workspaceId = existingWS.id;
    results.push(`✓ Workspace existiert bereits`);
  } else {
    const { data: ws, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "LinkedIn Tracking", invite_code: "TITAN24" })
      .select("id")
      .single();

    if (wsErr || !ws) {
      results.push(`✗ Workspace-Fehler: ${wsErr?.message}`);
      return NextResponse.json({ results }, { status: 500 });
    }
    workspaceId = ws.id;
    results.push(`✓ Workspace "LinkedIn Tracking" erstellt`);
  }

  // Beide User als Workspace-Mitglieder eintragen
  for (let i = 0; i < userIds.length; i++) {
    const uid = userIds[i];
    const role = i === 0 ? "owner" : "member";
    await admin
      .from("workspace_members")
      .upsert({ workspace_id: workspaceId, user_id: uid, role }, { onConflict: "workspace_id,user_id" });
    results.push(`✓ ${USERS[i].username} → Workspace (${role})`);
  }

  const html = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>Setup</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #09090b; color: #fafafa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 2rem 2.5rem; max-width: 480px; width: 100%; }
  h1 { font-size: 1.25rem; font-weight: 800; margin: 0 0 1.25rem; color: #4ade80; }
  li { padding: 0.3rem 0; font-size: 0.9rem; color: #a1a1aa; border-bottom: 1px solid #27272a; }
  li:last-child { border: none; }
  .creds { background: #0d1117; border: 1px solid #6366f1; border-radius: 10px; padding: 1rem 1.25rem; margin-top: 1.5rem; }
  .cred { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.875rem; }
  .label { color: #52525b; }
  .val { color: #818cf8; font-weight: 700; font-family: monospace; }
  a { display: block; text-align: center; margin-top: 1.5rem; padding: 0.75rem; background: linear-gradient(135deg,#6366f1,#8b5cf6); color: white; font-weight: 700; border-radius: 10px; text-decoration: none; font-size: 0.9375rem; }
</style>
</head>
<body>
<div class="box">
  <h1>✓ Setup abgeschlossen</h1>
  <ul style="list-style:none;padding:0;margin:0">
    ${results.map((r) => `<li>${r}</li>`).join("")}
  </ul>
  <div class="creds">
    <div style="font-size:0.75rem;font-weight:700;color:#52525b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.75rem">Login-Daten</div>
    <div class="cred"><span class="label">Kevin</span><span class="val">Kevin / Kevin</span></div>
    <div class="cred"><span class="label">Simon</span><span class="val">Simon / Simon</span></div>
    <div class="cred"><span class="label">Daniel</span><span class="val">Daniel / Daniel</span></div>
  </div>
  <a href="/login">→ Jetzt einloggen</a>
</div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
