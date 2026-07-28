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
    // Die eine Glaskarte dieser View, mit Fadenkreuz-Marken in den Ecken.
    <div
      className="w-full max-w-sm glass-card glass-sheen corner-ticks"
      style={{ padding: "var(--sp-11) var(--sp-10)" }}
    >
      {/* Brand + Hero-Headline. Genau EIN Wort traegt den Gradient. */}
      <div style={{ marginBottom: "var(--sp-10)" }}>
        <div className="wordmark" style={{ fontSize: "var(--fs-md)", marginBottom: "var(--sp-7)" }}>
          titan
        </div>
        <h1
          style={{
            fontSize: "var(--fs-2xl)",
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "var(--ls-headline)",
            lineHeight: "var(--lh-tight)",
            margin: 0,
          }}
        >
          Pipeline <span className="accent-word">öffnen</span>
        </h1>
        <p style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)", marginTop: "var(--sp-5)" }}>
          Melde dich mit Benutzername und Passwort an.
        </p>
      </div>

      {errMsg && (
        <div
          role="alert"
          style={{
            background: "var(--danger-bg)",
            borderLeft: "2px solid var(--danger)",
            borderRadius: "var(--r-sm)",
            color: "var(--danger-fg)",
            fontSize: "var(--fs-base)",
            padding: "var(--sp-5) var(--sp-6)",
            marginBottom: "var(--sp-7)",
          }}
        >
          {errMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
        <div>
          <label
            htmlFor="username"
            style={{
              display: "block",
              fontSize: "var(--fs-xs)",
              fontWeight: 500,
              color: "var(--text-secondary)",
              marginBottom: "var(--sp-3)",
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
              fontSize: "var(--fs-xs)",
              fontWeight: 500,
              color: "var(--text-secondary)",
              marginBottom: "var(--sp-3)",
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

        {/* Die Signature Pill — der eine Brand-CTA dieser View. */}
        <button
          type="submit"
          disabled={status === "loading"}
          className="btn-primary"
          style={{ marginTop: "var(--sp-3)", width: "100%" }}
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
