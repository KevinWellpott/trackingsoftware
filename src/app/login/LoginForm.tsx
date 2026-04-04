"use client";

import { createClient } from "@/lib/supabase/client";
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
    // Intern wird username → username@pitchtracker.internal gemappt (kein RPC nötig)
    const email = `${username.trim().toLowerCase()}@pitchtracker.internal`;

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
      {/* Logo / Brand */}
      <div style={{ marginBottom: "2rem" }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius-md)",
            background: "var(--brand-500)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "1.25rem",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
              fill="white"
              stroke="white"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
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
            placeholder="Kevin oder Simon"
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

      {/* Ersteinrichtung */}
      <div style={{ marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: "1px solid var(--border)", textAlign: "center" }}>
        <p style={{ fontSize: "0.75rem", color: "var(--text-subtle)", marginBottom: "0.625rem" }}>
          Erste Anmeldung? Accounts noch nicht angelegt?
        </p>
        <a
          href="/api/setup"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "#818cf8",
            background: "rgba(99,102,241,0.1)",
            border: "1px solid rgba(99,102,241,0.25)",
            borderRadius: 8,
            padding: "0.4rem 0.875rem",
            textDecoration: "none",
          }}
        >
          ⚡ Setup ausführen (Kevin + Simon anlegen)
        </a>
      </div>
    </div>
  );
}
