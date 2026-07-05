import {
  bootstrapWorkspaceForm,
  joinWorkspaceForm,
} from "@/app/actions/workspace";
import { getMembership } from "@/lib/workspace";
import { redirect } from "next/navigation";

export default async function OnboardingPage ({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const m = await getMembership();
  if (m) redirect("/");
  const q = await searchParams;
  const err = q.err;

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-1 flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
        Workspace einrichten
      </h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Erstes Mal? Lege einen Workspace an. Dein Partner trägt den
        Einladungs-Code ein (unter Einstellungen sichtbar).
      </p>

      {err && (
        <p className="mt-4 rounded-md border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-3 py-2 text-sm text-[var(--color-error-text)]">
          {err}
        </p>
      )}

      <section className="mt-10 rounded-xl border border-[var(--border)] bg-[var(--surface-100)] p-6 [box-shadow:var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          Neuen Workspace anlegen
        </h2>
        <form action={bootstrapWorkspaceForm} className="mt-4 space-y-3">
          <input
            name="name"
            placeholder="z. B. Titan Sales"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-150)] px-3 py-2 text-sm text-[var(--text-primary)]"
          />
          <button
            type="submit"
            className="rounded-lg bg-[var(--btn-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--btn-primary-fg)]"
          >
            Workspace erstellen
          </button>
        </form>
      </section>

      <section className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface-100)] p-6 [box-shadow:var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          Mit Einladungs-Code beitreten
        </h2>
        <form action={joinWorkspaceForm} className="mt-4 space-y-3">
          <input
            name="code"
            placeholder="Code vom Owner"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-150)] px-3 py-2 font-mono text-sm text-[var(--text-primary)]"
          />
          <button
            type="submit"
            className="rounded-lg border border-[var(--border-bright)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)]"
          >
            Beitreten
          </button>
        </form>
      </section>
    </div>
  );
}
