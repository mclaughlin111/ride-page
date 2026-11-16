"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBase } from "@/lib/basePath";

export function LoginForm({ expired = false }: { expired?: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withBase("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        router.push("/admin");
        router.refresh();
        return;
      }
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Could not log in.");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-4 p-5">
      <h1 className="text-lg font-bold uppercase">Admin login</h1>
      {expired && (
        <p className="text-sm" role="status">
          Your session expired. Log in again to continue.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>
      {error && (
        <p id="login-error" className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-solid" disabled={busy || !password}>
        {busy ? "Checking…" : "Log in"}
      </button>
    </form>
  );
}
