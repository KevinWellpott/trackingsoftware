import { Eye } from "lucide-react";
import { setDataViewForm } from "@/app/actions/workspace";
import { Button } from "@/components/ui/Button";

// Info-Banner, wenn ein Admin gerade die Datensicht eines anderen Nutzers
// betrachtet. "Zurück zu meinen Daten" löscht das View-Cookie (Server-Action).

export function ViewingBanner({ name }: { name: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        flexWrap: "wrap",
        background: "var(--color-info-bg)",
        border: "1px solid var(--color-info-border)",
        borderRadius: "var(--radius-lg)",
        padding: "0.625rem 1rem",
      }}
    >
      <Eye size={15} color="var(--color-info-text)" style={{ flexShrink: 0 }} aria-hidden />
      <span style={{ fontSize: "0.8125rem", color: "var(--color-info-text)", fontWeight: 600, minWidth: 0 }}>
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
