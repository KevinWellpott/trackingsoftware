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
  const source   = sp.get("source") ?? "contacts";

  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const toCsv = (headers: string[], rows: (string | number | null)[][]) =>
    "﻿" +
    [headers, ...rows].map((row) => row.map((v) => esc(String(v ?? ""))).join(",")).join("\r\n");
  const csvResponse = (csv: string, filename: string) =>
    new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });

  // ── Export 2.0: neue Funnel-Quellen (vollständig, workspace-/owner-gescoped) ──
  if (source !== "contacts") {
    const eff = access.effective_user_id;
    const today = localDateISO();
    try {
      if (source === "telefon") {
        const rows = (await fetchAllRows((f, t) => {
          let q = supabase
            .from("phone_leads")
            .select("first_call_at, decider_name, company, phone, website, call_attempt, gatekeeper_reached, decider_reached, callback_at, answer_sentiment, status, notes, list_id, phone_lists!inner(name, owner_name, created_by_user_id)")
            .eq("workspace_id", access.workspace_id);
          if (eff) q = q.eq("phone_lists.created_by_user_id", eff);
          return q.order("id", { ascending: true }).range(f, t);
        })) as unknown as Array<Record<string, unknown> & { phone_lists: { name: string; owner_name: string | null } | null }>;
        const csv = toCsv(
          ["Erstkontakt", "Ansprechpartner", "Firma", "Telefon", "Website", "Versuch", "Gatekeeper", "Entscheider erreicht", "Rückruf am", "Stimmung", "Status", "Liste", "Owner", "Notizen"],
          rows.map((r) => [
            (r.first_call_at as string) ?? "", (r.decider_name as string) ?? "", (r.company as string) ?? "",
            (r.phone as string) ?? "", (r.website as string) ?? "", (r.call_attempt as number) ?? "",
            (r.gatekeeper_reached as string) ?? "", r.decider_reached === true ? "Ja" : "",
            (r.callback_at as string) ?? "", (r.answer_sentiment as string) ?? "", (r.status as string) ?? "",
            r.phone_lists?.name ?? "", r.phone_lists?.owner_name ?? "", (r.notes as string) ?? "",
          ]),
        );
        return csvResponse(csv, `telefon-export-${today}.csv`);
      }
      if (source === "setting") {
        const rows = (await fetchAllRows((f, t) => {
          let q = supabase
            .from("setting_calls")
            .select("call_at, appointment_at, lead_name, company, source_type, show_status, has_budget_8k, sole_decider, ist_pain, warmth, closing_scheduled, status, notes")
            .eq("workspace_id", access.workspace_id);
          if (eff) q = q.eq("created_by_user_id", eff);
          return q.order("id", { ascending: true }).range(f, t);
        })) as unknown as Array<Record<string, unknown>>;
        const csv = toCsv(
          ["Call am", "Termin", "Lead", "Firma", "Quelle", "Show", "Budget 8k", "Allein-Entscheider", "Ist-Pain", "Wärme", "Closing gelegt", "Status", "Notizen"],
          rows.map((r) => [
            (r.call_at as string) ?? "", (r.appointment_at as string) ?? "", (r.lead_name as string) ?? "",
            (r.company as string) ?? "", (r.source_type as string) ?? "", (r.show_status as string) ?? "",
            (r.has_budget_8k as string) ?? "", r.sole_decider === true ? "Ja" : "", (r.ist_pain as number) ?? "",
            (r.warmth as number) ?? "", r.closing_scheduled === true ? "Ja" : "", (r.status as string) ?? "",
            (r.notes as string) ?? "",
          ]),
        );
        return csvResponse(csv, `setting-export-${today}.csv`);
      }
      if (source === "closing") {
        const rows = (await fetchAllRows((f, t) => {
          let q = supabase
            .from("closing_calls")
            .select("call_at, lead_name, company, show_status, closed, deal_volume, payment_type, signature_received, contract_start, lost_reason, follow_up_due, status, notes")
            .eq("workspace_id", access.workspace_id);
          if (eff) q = q.eq("created_by_user_id", eff);
          return q.order("id", { ascending: true }).range(f, t);
        })) as unknown as Array<Record<string, unknown>>;
        const csv = toCsv(
          ["Call am", "Lead", "Firma", "Show", "Gewonnen", "Deal-Volumen", "Zahlung", "Unterschrift", "Vertragsstart", "Verlustgrund", "Wiedervorlage", "Status", "Notizen"],
          rows.map((r) => [
            (r.call_at as string) ?? "", (r.lead_name as string) ?? "", (r.company as string) ?? "",
            (r.show_status as string) ?? "", r.closed === true ? "Ja" : "", (r.deal_volume as number) ?? "",
            (r.payment_type as string) ?? "", r.signature_received === true ? "Ja" : "", (r.contract_start as string) ?? "",
            (r.lost_reason as string) ?? "", (r.follow_up_due as string) ?? "", (r.status as string) ?? "",
            (r.notes as string) ?? "",
          ]),
        );
        return csvResponse(csv, `closing-export-${today}.csv`);
      }
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Export fehlgeschlagen." }, { status: 500 });
    }
  }

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
