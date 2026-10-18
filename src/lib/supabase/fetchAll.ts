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
