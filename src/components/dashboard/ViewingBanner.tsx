import { Eye } from "lucide-react";
import { setDataViewForm } from "@/app/actions/workspace";
import { Button } from "@/components/ui/Button";

// Info-Banner, wenn ein Admin gerade die Datensicht eines anderen Nutzers
// betrachtet. "Zurück zu meinen Daten" löscht das View-Cookie (Server-Action).

export function ViewingBanner({ name }: { name: string }) {
  return (
    // Banner-Muster: linker 2px-Rail in der Semantikfarbe, Icon + Text.
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-5)",
        flexWrap: "wrap",
        background: "var(--info-bg)",
        borderLeft: "2px solid var(--info)",
        borderRadius: "var(--r-md)",
        padding: "var(--sp-5) var(--sp-6)",
      }}
    >
      <Eye size={15} color="var(--info-fg)" style={{ flexShrink: 0 }} aria-hidden />
      <span style={{ fontSize: "var(--fs-base)", color: "var(--info-fg)", fontWeight: 500, minWidth: 0 }}>
        Du siehst die Daten von {name}
      </span>
      <form action={setDataViewForm} style={{ marginLeft: "auto", display: "flex", flexShrink: 0 }}>
        <input type="hidden" name="next" value="/" />
        <input type="hidden" name="view_user_id" value="" />
        <Button type="submit" variant="secondary" size="sm">
          Zurück zu meinen Daten
        </Button>
      </form>
    </div>
  );
}
