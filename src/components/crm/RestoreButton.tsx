"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPost } from "./api";

/** Bring one archived row back. The only way out of the archive. */
export function RestoreButton({
  kind,
  id,
  title,
}: {
  kind: "proposal" | "contract";
  id: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function restore() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/crm/archive", { kind, id, archived: false });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore that.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void restore()}
        disabled={busy}
        aria-label={`Restore ${title}`}
        className="sf-btn-neutral whitespace-nowrap text-xs"
      >
        {busy ? "Restoring…" : "Restore"}
      </button>
      {error && <span className="ml-2 text-xs text-err-700">{error}</span>}
    </>
  );
}
