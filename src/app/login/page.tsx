import { LoginForm } from "@/app/login/LoginForm";

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-50)",
        padding: "1.5rem",
      }}
    >
      <LoginForm />
    </div>
  );
}
