"use client";

import { useState, useMemo } from "react";
import type { ContactWithStage, PitchList } from "@/lib/types";

export type SectionFilterState = {
  period: "week" | "month" | "year" | "all" | "custom";
  from: string;
  to: string;
  selectedListIds: Set<string>;
  owner: "" | "Kevin" | "Simon" | "Daniel";
};

function weekStart(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function addDays(base: string, n: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useSectionFilter(
  contacts: ContactWithStage[],
  lists: PitchList[],
  defaultPeriod: SectionFilterState["period"] = "all",
) {
  const today = localToday();

  const [period, setPeriod] = useState<SectionFilterState["period"]>(defaultPeriod);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(today);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [owner, setOwner] = useState<"" | "Kevin" | "Simon" | "Daniel">("");

  const effectiveFrom: string = useMemo(() => {
    if (period === "custom") return from;
    if (period === "week") return weekStart(today);
    if (period === "month") return `${today.slice(0, 7)}-01`;
    if (period === "year") return `${today.slice(0, 4)}-01-01`;
    return "2000-01-01";
  }, [period, from, today]);

  const effectiveTo: string = period === "custom" ? to : today;

  const ownerListIds = useMemo(
    () => owner ? new Set(lists.filter((l) => l.owner_name === owner).map((l) => l.id)) : null,
    [lists, owner],
  );

  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      const d = c.pitched_at ?? c.created_at.slice(0, 10);
      if (d < effectiveFrom || d > effectiveTo) return false;
      if (selectedListIds.size > 0 && !selectedListIds.has(c.list_id)) return false;
      if (ownerListIds && !ownerListIds.has(c.list_id)) return false;
      return true;
    });
  }, [contacts, effectiveFrom, effectiveTo, selectedListIds, ownerListIds]);

  function selectPeriod(p: SectionFilterState["period"]) {
    setPeriod(p);
    if (p !== "custom") { setFrom(""); setTo(today); }
  }

  function toggleList(id: string) {
    setSelectedListIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function applyCustom(f: string, t: string) {
    setFrom(f); setTo(t); setPeriod("custom");
  }

  const periodLabel =
    period === "week" ? "Woche" :
    period === "month" ? "Monat" :
    period === "year" ? "Jahr" :
    period === "custom" && from ? `${from.slice(5)} → ${to.slice(5)}` :
    "Gesamt";

  return {
    filtered, period, from, to, effectiveFrom, effectiveTo,
    selectedListIds, owner, periodLabel,
    selectPeriod, toggleList, applyCustom, setOwner,
    setFrom, setTo,
  };
}
