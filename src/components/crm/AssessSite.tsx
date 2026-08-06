"use client";

/**
 * "Assess with AI" on a row of the global land search.
 *
 * A client island inside an otherwise server-rendered page: the table and its
 * figures stay server-side, and only this button needs to be interactive. The
 * whole page is a GET form, so making it a client component to add one button
 * would have thrown that away.
 *
 * It sends the parcel KEY, not the parcel's numbers. The server re-reads the
 * row and recomputes the pad economics before asking the model, so the figures
 * it reasons from come from the database rather than from markup the browser
 * could have been handed anything in.
 */

import { useState } from "react";
import { apiPost } from "./api";
import { Badge } from "./ui";
import { Markdown } from "@/components/Markdown";
import type { ParcelFit } from "@/lib/crm/land";

export function AssessSite({ parcelKey, label }: { parcelKey: string; label: string }) {
  const [fit, setFit] = useState<ParcelFit | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function assess() {
    if (fit) {
      setOpen((o) => !o);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await apiPost<ParcelFit>("/api/crm/land/assess", { parcel_key: parcelKey });
      setFit(result);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assess this parcel.");
    } finally {
      setBusy(false);
    }
  }

  const tone =
    fit?.verdict === "Strong fit" ? "green" : fit?.verdict === "Poor fit" ? "red" : "gold";

  return (
    <>
      <button
        type="button"
        onClick={() => void assess()}
        disabled={busy}
        aria-label={`Assess ${label} with AI`}
        className="whitespace-nowrap text-xs font-semibold text-sf-600 hover:underline disabled:opacity-50"
      >
        {busy ? "Assessing…" : fit ? (open ? "Hide" : "Show") + " assessment" : "Assess with AI"}
      </button>

      {error && <p className="mt-1 text-xs text-err-700">{error}</p>}

      {fit && open && (
        <div className="mt-2 rounded border border-ink-200 bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{fit.verdict}</Badge>
            <span className="sf-meta uppercase tracking-wide">{fit.confidence} confidence</span>
          </div>
          <p className="mt-2 text-sm font-medium text-ink-900">{fit.headline}</p>
          <div className="mt-1 text-sm text-ink-700">
            <Markdown>{fit.rationale}</Markdown>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <FitList title="Strengths" items={fit.strengths} />
            <FitList title="Concerns" items={fit.concerns} />
            <FitList title="Next steps" items={fit.nextSteps} />
            <FitList title="What we can't see" items={fit.dataGaps} />
          </div>
        </div>
      )}
    </>
  );
}

function FitList({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h5 className="text-xs font-semibold uppercase tracking-wide text-ink-600">{title}</h5>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink-700">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
