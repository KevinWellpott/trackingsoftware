import { LoginForm } from "@/app/login/LoginForm";

// Login ist der einzige Marketing-nahe Moment der App und damit die Stelle,
// an der Ember Glass sein Material zeigt: Near-Black-Canvas mit Dot-Grid,
// der CTA-Glow-Stapel der Landing Page nach unten maskiert und genau EINE
// Glaskarte darueber (DESIGN.md §4.3, §5).

export default function LoginPage() {
  return (
    <div
      className="dot-grid"
      style={{
        position: "relative",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-0)",
        padding: "var(--sp-8)",
        overflow: "hidden",
      }}
    >
      {/* Glut hinter dem Login-Moment. Rein dekorativ, deshalb aria-hidden. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--grad-cta-glow)",
          pointerEvents: "none",
        }}
      />
      {/* Ausblendung nach unten, damit der Glow nicht am Rand abreisst. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "30%",
          background: "var(--grad-fade-bottom)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", zIndex: 1, width: "100%", display: "flex", justifyContent: "center" }}>
        <LoginForm />
      </div>
    </div>
  );
}
