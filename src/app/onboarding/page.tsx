import {
  bootstrapWorkspaceForm,
  joinWorkspaceForm,
} from "@/app/actions/workspace";
import { getAccessContext } from "@/lib/access";
import { redirect } from "next/navigation";

// Onboarding teilt den Hero-Moment mit dem Login: Wortmarke, Headline mit
// genau einem Gradient-Wort, darunter zwei ruhige Solid-Cards. Die Signature
// Pill gehoert zur primaeren Handlung („Workspace erstellen") — Beitreten
// bleibt sekundaer.

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const access = await getAccessContext();
  if (access) redirect("/");
  const q = await searchParams;
  const err = q.err;

  return (
    <div
      className="dot-grid"
      style={{
        minHeight: "100dvh",
        display: "flex",
        justifyContent: "center",
        background: "var(--surface-0)",
        padding: "var(--sp-12) var(--sp-8)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: "var(--sp-9)" }}>
        <header>
          <div className="wordmark" style={{ fontSize: "var(--fs-md)", marginBottom: "var(--sp-7)" }}>
            titan
          </div>
          <h1
            style={{
              fontSize: "var(--fs-2xl)",
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "var(--ls-headline)",
              lineHeight: "var(--lh-tight)",
              margin: 0,
            }}
          >
            Workspace <span className="accent-word">einrichten</span>
          </h1>
          <p style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)", marginTop: "var(--sp-5)" }}>
            Erstes Mal? Leg einen Workspace an. Dein Team tritt danach mit dem Einladungs-Code bei — du findest ihn in
            den Einstellungen.
          </p>
        </header>

        {err && (
          <div
            role="alert"
            style={{
              background: "var(--danger-bg)",
              borderLeft: "2px solid var(--danger)",
              borderRadius: "var(--r-sm)",
              color: "var(--danger-fg)",
              fontSize: "var(--fs-base)",
              padding: "var(--sp-5) var(--sp-6)",
            }}
          >
            {err}
          </div>
        )}

        <section className="card" style={{ padding: "var(--sp-8)" }}>
          <div className="eyebrow" style={{ marginBottom: "var(--sp-3)" }}>
            Schritt 1
          </div>
          <h2
            style={{
              fontSize: "var(--fs-md)",
              fontWeight: 600,
              letterSpacing: "var(--ls-tight)",
              color: "var(--text-primary)",
            }}
          >
            Neuen Workspace anlegen
          </h2>
          <form
            action={bootstrapWorkspaceForm}
            style={{ marginTop: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}
          >
            <input name="name" placeholder="z. B. Titan Sales" className="ui-input" aria-label="Workspace-Name" />
            <button type="submit" className="btn-primary" style={{ alignSelf: "flex-start" }}>
              Workspace erstellen
            </button>
          </form>
        </section>

        <section className="card" style={{ padding: "var(--sp-8)" }}>
          <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-3)" }}>
            Alternative
          </div>
          <h2
            style={{
              fontSize: "var(--fs-md)",
              fontWeight: 600,
              letterSpacing: "var(--ls-tight)",
              color: "var(--text-primary)",
            }}
          >
            Mit Einladungs-Code beitreten
          </h2>
          <form
            action={joinWorkspaceForm}
            style={{ marginTop: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}
          >
            <input
              name="code"
              placeholder="Code vom Owner"
              className="ui-input"
              aria-label="Einladungs-Code"
              style={{ fontFamily: "var(--font-mono-stack)" }}
            />
            <button type="submit" className="btn-secondary" style={{ alignSelf: "flex-start" }}>
              Beitreten
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
