"use client";

import { useState } from "react";

export function RegisterForm({
  next,
  codeRequired,
}: {
  next: string;
  codeRequired: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password, code }),
      });
      if (res.ok) {
        // Hard navigation across the zone boundary into the platform.
        window.location.href = next;
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not create your account. Please try again.");
    } catch {
      setError("Could not reach the server. Please try again.");
    }
    setLoading(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="name" className="field-label">
          Full name
        </label>
        <input
          id="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field"
          placeholder="Jane Partner"
        />
      </div>

      <div>
        <label htmlFor="email" className="field-label">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field"
          placeholder="you@company.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="field-label">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field"
          placeholder="At least 8 characters"
        />
      </div>

      {codeRequired && (
        <div>
          <label htmlFor="code" className="field-label">
            Access code
          </label>
          <input
            id="code"
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="field"
            placeholder="Provided by Ziora"
          />
          <p className="mt-1.5 text-xs text-ink-900/50">
            Provided by your Ziora relationship manager.
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-err-500/30 bg-err-50 px-3.5 py-2.5 text-sm text-err-700"
        >
          {error}
        </p>
      )}

      <button type="submit" disabled={loading} className="sf-btn-brand w-full py-2.5">
        {loading ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
