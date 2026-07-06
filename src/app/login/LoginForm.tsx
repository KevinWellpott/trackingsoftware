"use client";

import { createClient } from "@/lib/supabase/client";
import { usernameToInternalEmail } from "@/lib/internal-email";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useState } from "react";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrMsg("");

    const supabase = createClient();
    const email = usernameToInternalEmail(username);

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInErr) {
      setStatus("error");
      setErrMsg("Benutzername oder Passwort falsch.");
      return;
    }

    window.location.href = "/";
  }

  return (
    <div
      className="w-full max-w-sm"
      style={{
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)",
        boxShadow: "var(--shadow-lg)",
        padding: "2.5rem",
      }}
    >
      {/* Brand */}
      <div style={{ marginBottom: "2rem" }}>
        <h1
          style={{
            fontSize: "1.375rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          Pitch Tracker
        </h1>
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--text-muted)",
            marginTop: "0.375rem",
          }}
        >
          Benutzername + Passwort eingeben.
        </p>
      </div>

      {errMsg && (
        <div
          style={{
            background: "var(--color-error-bg)",
            border: "1px solid var(--color-error-border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-error-text)",
            fontSize: "0.875rem",
            padding: "0.625rem 0.875rem",
            marginBottom: "1.25rem",
          }}
        >
          {errMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label
            htmlFor="username"
            style={{
              display: "block",
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--text-secondary)",
              marginBottom: "0.375rem",
            }}
          >
            Benutzername
          </label>
          <input
            id="username"
            type="text"
            required
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input"
            placeholder="z. B. Kevin oder Samuel Kerber"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            style={{
              display: "block",
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--text-secondary)",
              marginBottom: "0.375rem",
            }}
          >
            Passwort
          </label>
          <div style={{ position: "relative" }}>
            <input
              id="password"
              type={showPw ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              style={{ paddingRight: "2.75rem" }}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Passwort verbergen" : "Passwort anzeigen"}
              style={{
                position: "absolute",
                right: "0.75rem",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                padding: 0,
              }}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={status === "loading"}
          className="btn-primary"
          style={{
            marginTop: "0.5rem",
            justifyContent: "center",
            padding: "0.75rem",
            opacity: status === "loading" ? 0.7 : 1,
            fontSize: "0.9375rem",
          }}
        >
          {status === "loading" ? (
            <span>Anmelden…</span>
          ) : (
            <>
              <LogIn size={16} />
              <span>Anmelden</span>
            </>
          )}
        </button>
      </form>

    </div>
  );
}
