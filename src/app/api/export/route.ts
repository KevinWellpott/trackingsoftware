import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { localDateISO } from "@/lib/dates";
import { getAccessContext } from "@/lib/access";

export async function GET(request: NextRequest) {
  const access = await getAccessContext();
  if (!access) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const supabase = await createClient();
  const sp = request.nextUrl.searchParams;

  const from     = sp.get("from") ?? "2000-01-01";
  const to       = sp.get("to")   ?? localDateISO();
  const owner    = sp.get("owner") ?? "";
  const listIds  = (sp.get("listIds") ?? "").split(",").filter(Boolean);

  // Fetch contacts with list info joined
  type Row = {
    id: string; name: string; pitched_at: string | null;
    follow_up_number: number | null; answered: boolean | null;
    appointment_set: boolean | null; answer_category: string | null;
    answer_text: string | null; notes: string | null;
    list_id: string;
    lists: { name: string; owner_name: string | null; pitch_text: string | null } | null;
  };

  let allowedListIds: string[] | null = null;
  if (access.effective_user_id) {
    const { data: lists } = await supabase
      .from("lists")
      .select("id")
      .eq("workspace_id", access.workspace_id)
      .eq("created_by_user_id", access.effective_user_id);
    allowedListIds = (lists ?? []).map((l) => l.id);
  }

  let data;
  try {
    data = await fetchAllRows((rangeFrom, rangeTo) => {
      let query = supabase
        .from("contacts")
        .select("id, name, pitched_at, follow_up_number, answered, appointment_set, answer_category, answer_text, notes, list_id, lists!inner(name, owner_name, pitch_text)")
        .eq("workspace_id", access.workspace_id)
        .gte("pitched_at", from)
        .lte("pitched_at", to)
        .order("pitched_at", { ascending: true });

      if (listIds.length > 0) {
        const scopedListIds = allowedListIds
          ? listIds.filter((id) => allowedListIds.includes(id))
          : listIds;
        query = query.in("list_id", scopedListIds.length ? scopedListIds : ["00000000-0000-0000-0000-000000000000"]);
      } else if (allowedListIds) {
        query = query.in("list_id", allowedListIds.length ? allowedListIds : ["00000000-0000-0000-0000-000000000000"]);
      }

      return query.order("id", { ascending: true }).range(rangeFrom, rangeTo);
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Export fehlgeschlagen." }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Row[];

  // Optional owner filter (applied after join since we can't filter nested in all Supabase clients easily)
  const filtered = owner
    ? rows.filter((r) => r.lists?.owner_name === owner)
    : rows;

  // Build CSV
  const headers = [
    "Datum (pitched_at)",
    "Name",
    "Liste",
    "Owner",
    "FU-Nummer",
    "Kategorie",
    "Antwort erhalten",
    "Termin gesetzt",
    "Was war die Antwort?",
    "Notizen",
  ];

  const csvRows = filtered.map((r) => [
    r.pitched_at ?? "",
    r.name,
    r.lists?.name ?? "",
    r.lists?.owner_name ?? "",
    r.follow_up_number != null ? `FU${r.follow_up_number}` : "",
    r.answer_category ?? "",
    r.answered === true ? "Ja" : "",
    r.appointment_set === true ? "Ja" : "",
    r.answer_text ?? "",
    r.notes ?? "",
  ]);

  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv =
    "\uFEFF" + // BOM for Excel UTF-8
    [headers, ...csvRows]
      .map((row) => row.map((v) => esc(String(v))).join(","))
      .join("\r\n");

  const filename = `pitch-export-${from}-bis-${to}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
