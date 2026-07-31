import { Building2 } from "lucide-react";
import { setActiveOrgForm } from "@/app/actions/platform";
import { Button } from "@/components/ui/Button";

// Warnbanner, wenn ein Plattform-Admin gerade IN einer fremden Organisation
// arbeitet. Bewusst auf Seitenebene und nicht nur in der Sidebar: auf Mobile
// steckt die Sidebar hinter dem Drawer — ohne diesen Banner koennte man dort
// in Kundendaten schreiben, ohne es zu sehen.
//
// Rot statt des Info-Blaus von ViewingBanner: eine fremde Datensicht ist ein
// Blickwinkel, eine fremde Organisation ist ein Schreibkontext.

export function ForeignOrgBanner({ name }: { name: string }) {
  return (
    // Banner-Muster: linker 2px-Rail in der Semantikfarbe, Icon + Text.
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-5)",
        flexWrap: "wrap",
        background: "var(--danger-bg)",
        borderLeft: "2px solid var(--danger)",
        borderRadius: "var(--r-md)",
        padding: "var(--sp-5) var(--sp-6)",
        marginBottom: "var(--sp-8)",
      }}
    >
      <Building2 size={15} color="var(--danger-fg)" style={{ flexShrink: 0 }} aria-hidden />
      <span style={{ fontSize: "var(--fs-base)", color: "var(--danger-fg)", fontWeight: 500, minWidth: 0 }}>
        Du arbeitest in der Organisation <strong>{name}</strong> — alle Änderungen
        treffen deren Daten.
      </span>
      <form action={setActiveOrgForm} style={{ marginLeft: "auto", display: "flex", flexShrink: 0 }}>
        <input type="hidden" name="workspace_id" value="" />
        <Button type="submit" variant="secondary" size="sm">
          Zurück zu meiner Organisation
        </Button>
      </form>
    </div>
  );
}
