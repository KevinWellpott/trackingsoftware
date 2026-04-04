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
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Workspace einrichten
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Erstes Mal? Lege einen Workspace an. Dein Partner trägt den
        Einladungs-Code ein (unter Einstellungen sichtbar).
      </p>

      {err && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {err}
        </p>
      )}

      <section className="mt-10 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Neuen Workspace anlegen
        </h2>
        <form action={bootstrapWorkspaceForm} className="mt-4 space-y-3">
          <input
            name="name"
            placeholder="z. B. Titan Sales"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Workspace erstellen
          </button>
        </form>
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Mit Einladungs-Code beitreten
        </h2>
        <form action={joinWorkspaceForm} className="mt-4 space-y-3">
          <input
            name="code"
            placeholder="Code vom Owner"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
          >
            Beitreten
          </button>
        </form>
      </section>
    </div>
  );
}
