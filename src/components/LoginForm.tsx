"use client";

import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // Full navigation — the platform lives in a separate zone, so we must
        // hard-navigate rather than client-route across the boundary.
        window.location.href = next;
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Sign in failed. Please try again.");
    } catch {
      setError("Could not reach the server. Please try again.");
    }
    setLoading(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field"
          placeholder="••••••••"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-err-500/30 bg-err-50 px-3.5 py-2.5 text-sm text-err-700"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="sf-btn-brand w-full py-2.5"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
