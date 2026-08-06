"use client";

/**
 * "Who needs me today?" — over the client list.
 *
 * The list itself answers "find me this account". It cannot answer the question
 * people actually open it with in the morning, which is which of forty rows has
 * gone quiet, which proposal was sent and never followed, which contract is
 * still unsigned. That question needs the whole book read at once, and reading
 * forty rows is exactly what a person will not do.
 *
 * Each item links straight to the account, so the panel is a way INTO the list
 * rather than a replacement for it. Nothing here is stored and nothing is
 * written — see lib/crm/assist.ts.
 *
 * Behind a press, like every other AI control in this app. The client list is
 * mounted twice (the dashboard and /crm/clients), so an on-mount call would be
 * two model calls for one page view of the Overview.
 */

import Link from "next/link";
import { useState } from "react";
import { SparkleIcon } from "./AiAssist";
import { apiPost } from "./api";
import { ErrorNote } from "./ui";

interface TriageItem {
  client_id: string;
  headline: string;
  why: string;
  urgency: "now" | "this_week" | "watch";
}

const URGENCY: Record<TriageItem["urgency"], { label: string; tone: string }> = {
  now: { label: "Now", tone: "bg-err-100 text-err-700 ring-err-500/25" },
  this_week: { label: "This week", tone: "bg-warn-100 text-warn-700 ring-warn-500/30" },
  watch: { label: "Watch", tone: "bg-ink-100 text-ink-700 ring-ink-200" },
};

export function AiTriage({ nameFor }: { nameFor: (id: string) => string | undefined }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ summary: string; items: TriageItem[] } | null>(null);

  async function run() {
    setLoading(true);
    setError("");
    try {
      setResult(
        await apiPost<{ summary: string; items: TriageItem[] }>("/api/crm/assist", {
          kind: "triage",
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the book.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void run()} disabled={loading} className="sf-btn-ai">
          <SparkleIcon />
          {loading ? "Reading the book…" : "Who needs attention?"}
        </button>
        {result ? (
          <button type="button" onClick={() => setResult(null)} className="sf-btn-ghost text-xs">
            Clear
          </button>
        ) : null}
      </div>

      <ErrorNote>{error}</ErrorNote>

      {result ? (
        <div className="animate-pop-in mt-3 rounded-card border border-sf-200 bg-sf-50 p-4">
          {result.summary ? (
            <p className="mb-3 text-sm font-medium text-ink-900">{result.summary}</p>
          ) : null}

          {result.items.length === 0 ? (
            <p className="text-sm text-ink-600">
              Nothing on the book is waiting on anyone right now.
            </p>
          ) : (
            <ul className="space-y-2">
              {result.items.map((item) => (
                <li
                  key={item.client_id + item.headline}
                  className="rounded-pill border border-ink-200 bg-card p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide ring-1 ${
                        URGENCY[item.urgency]?.tone ?? URGENCY.watch.tone
                      }`}
                    >
                      {URGENCY[item.urgency]?.label ?? "Watch"}
                    </span>
                    {/* The id is validated server-side against the real client
                        list, so this link always resolves. */}
                    <Link
                      href={`/crm/clients/${item.client_id}`}
                      className="text-sm font-semibold text-ink-900 transition-colors hover:text-sf-600"
                    >
                      {nameFor(item.client_id) ?? "Open account"}
                    </Link>
                  </div>
                  <p className="mt-1 text-sm text-ink-900">{item.headline}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">{item.why}</p>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[0.7rem] text-ink-500">
            A reading of the record, not a record itself. Nothing here is saved.
          </p>
        </div>
      ) : null}
    </div>
  );
}
