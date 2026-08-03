"use client";

/**
 * Archive one proposal or contract from a list.
 *
 * Confirms first. Archiving removes the row from every list and from the
 * dashboard totals, so it is not the kind of thing to do on a stray click — but
 * it is reversible from the archive, which is why this warns rather than
 * demanding someone type the title.
 *
 * Refreshes the server components rather than splicing the row out locally: the
 * counts and money totals beside the list are computed on the server and would
 * otherwise disagree with the table they sit next to.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPost } from "./api";

export function ArchiveButton({
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

  async function archive() {
    if (busy) return;
    if (
      !window.confirm(
        `Archive "${title}"?\n\nIt disappears from the list and from the totals. You can bring it back from Archive.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/crm/archive", { kind, id, archived: true });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive that.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void archive()}
        disabled={busy}
        aria-label={`Archive ${title}`}
        className="whitespace-nowrap text-xs font-semibold text-ink-500 hover:text-err-700 disabled:opacity-50"
      >
        {busy ? "Archiving…" : "Archive"}
      </button>
      {error && <span className="ml-2 text-xs text-err-700">{error}</span>}
    </>
  );
}
