// Fetches ALL rows for a query by paging past the PostgREST 1000-row cap.
// buildPage must return a fresh Supabase query each call with .range(from,to) applied
// and a STABLE .order() so pages don't overlap/skip.
//
// Paging: Die erste Seite kommt allein. Ist sie voll, folgen die nächsten
// Seiten in parallelen Paketen zu PARALLEL_PAGES statt eine nach der anderen —
// 7 000 Kontakte kosten damit 3 Roundtrips statt 7. Ein Paket, das über das
// Ende hinaus fragt, bekommt leere Seiten zurück; die kosten nichts außer
// einer Abfrage, die parallel ohnehin mitläuft. Die Reihenfolge der Zeilen
// bleibt die der Seiten, also die der stabilen Sortierung.
const PARALLEL_PAGES = 4;

export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const loadPage = async (page: number): Promise<T[]> => {
    const from = page * pageSize;
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const all: T[] = await loadPage(0);
  if (all.length < pageSize) return all;

  for (let next = 1; ; next += PARALLEL_PAGES) {
    const batch = await Promise.all(
      Array.from({ length: PARALLEL_PAGES }, (_, i) => loadPage(next + i)),
    );
    for (const rows of batch) {
      all.push(...rows);
      if (rows.length < pageSize) return all;
    }
  }
}

/**
 * Eine Tages-RPC vollständig laden (`rpc_owner_day_metrics`,
 * `rpc_phone_day_metrics`). Auch Set-Returning-Funktionen kappt PostgREST still
 * bei 1.000 Zeilen — bei Owner×Tag-Zeilen eines Jahres war das 2026 schon zu
 * zwei Dritteln erreicht (Live-Test 26.11., P3-1). Liefert dieselbe Form wie
 * `supabase.rpc()`, damit die Aufrufer ihre Fehlerbehandlung behalten.
 */
export async function rpcAll<T = Record<string, unknown>>(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => unknown },
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  type Page = {
    order: (col: string) => Page;
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  };
  try {
    const data = await fetchAllRows<T>((from, to) =>
      (supabase.rpc(fn, args) as Page).order("day").order("owner_name").range(from, to),
    );
    return { data, error: null };
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }
}
