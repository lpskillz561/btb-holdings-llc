"use client";

/**
 * A document, under the message that attached it.
 *
 * This card is the whole of the "teach the assistant something" workflow as most
 * people will ever meet it: drop a PDF into the chat, watch it be read, press
 * one button to adopt what the assistant made of it. The library at
 * `/crm/knowledge` is the same set of actions with room to read the note first.
 *
 * **Adoption is a deliberate click and it says what it does.** The button is not
 * "Save" or "Add" — it is "Teach the assistant", and the line under it names the
 * consequence, which is that the note joins the knowledge base on every AI
 * surface in the app. That is the same act as editing `SKILL.md`, and the person
 * pressing it should know that is what they are doing. See lib/crm/knowledge-docs.ts.
 *
 * **Violet means AI here, as everywhere else in this app.** The adopt button is
 * the violet gradient because it is an AI action; opening the file is not, and
 * is a plain link.
 */

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import {
  documentUrl,
  fmtDocumentBytes,
  type CrmDocumentSummary,
} from "@/lib/crm/documents";
import { LABELS } from "@/lib/crm/types";
import { apiPatch, apiPost } from "./api";

/** What the card shows for a document nothing knows about — deleted, usually. */
function Missing() {
  return (
    <div className="mt-2 rounded-card border border-ink-200 bg-card-2 px-3 py-2 text-xs text-ink-600">
      That document is no longer available.
    </div>
  );
}

export function DocumentCard({
  document,
  onChange,
  compact = false,
}: {
  document: CrmDocumentSummary | undefined;
  /** Told about the fresh row after an adopt or a re-read, so the parent's map
   *  updates without waiting for the stream to echo it back. */
  onChange?: (next: CrmDocumentSummary) => void;
  /** Inside a chat message rather than on the library page. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showNote, setShowNote] = useState(false);

  if (!document) return <Missing />;

  const adopted = Boolean(document.active_at);
  const readable = document.status === "ready" && Boolean(document.skill_md?.trim());
  const working = document.status === "pending" || document.status === "learning";

  async function setActive(active: boolean) {
    setBusy(true);
    setError("");
    try {
      const next = await apiPatch<CrmDocumentSummary>(`/api/crm/documents/${document!.id}`, {
        active,
      });
      onChange?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  async function readAgain() {
    setBusy(true);
    setError("");
    try {
      // Answers 202 immediately with the row set to `learning` — it does NOT
      // wait for the model. See the route for why (the ALB closes an idle
      // connection at 60 seconds and a long memorandum takes longer than that).
      // The finished row arrives on the stream, which is also what flips this
      // card out of its "being read" state.
      const next = await apiPost<CrmDocumentSummary>(`/api/crm/documents/${document!.id}/learn`);
      onChange?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That document could not be read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`mt-2 overflow-hidden rounded-card border bg-card ${
        // An adopted document is outlined in the AI violet, which in this app
        // means AI and nothing else. Written as an arbitrary value against the
        // same CSS variable `.sf-btn-ai` uses rather than as a token: there is
        // no `ai` ramp in tailwind.config.ts, only `--ai-from`/`--ai-to`, and
        // inventing a two-value ramp for one border would be sixteen tokens of
        // theme surface for a single outline.
        adopted ? "border-[rgb(var(--ai-to)/0.45)]" : "border-ink-200"
      }`}
    >
      <div className="flex items-start gap-3 px-3 py-2.5">
        <span
          aria-hidden
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-200/60 text-ink-700"
        >
          {/* Drawn, not an emoji: this is chrome, and the board's rule applies —
              an OS emoji renders at whatever weight it likes and looks different
              on every machine in the office. */}
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
            <path d="M14 3v5h5M9 13h6M9 17h4" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <a
              href={documentUrl(document.id)}
              className="truncate text-sm font-semibold text-ink-900 underline-offset-2 hover:underline"
            >
              {document.title || document.file_name || "Document"}
            </a>
            {adopted ? (
              <span className="rounded-pill bg-grad-ai px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-white">
                In the knowledge base
              </span>
            ) : (
              <span
                className={`rounded-pill px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide ${
                  document.status === "failed"
                    ? "bg-err-50 text-err-700"
                    : working
                      ? "bg-warn-100 text-warn-700"
                      : "bg-ok-100 text-ok-700"
                }`}
              >
                {LABELS.documentStatus[document.status]}
              </span>
            )}
          </div>

          <p className="mt-0.5 text-[0.7rem] text-ink-500">
            {fmtDocumentBytes(document.byte_size)}
            {document.extracted_chars > 0 &&
              ` · ${document.extracted_chars.toLocaleString("en-GB")} characters of text`}
            {document.skill_model && ` · read by ${document.skill_model}`}
          </p>

          {/* The failure reason, in full. It is written for the person reading
              it — "this is probably a scan, run it through OCR" — and hiding it
              behind a generic status would waste the one useful thing here. */}
          {document.status === "failed" && document.error && (
            <p className="mt-1.5 text-xs leading-relaxed text-err-700">{document.error}</p>
          )}

          {working && (
            <p className="mt-1.5 text-xs text-ink-600">
              The assistant is reading it. This takes a few seconds; the card updates itself.
            </p>
          )}

          {error && <p className="mt-1.5 text-xs text-err-700">{error}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {readable && !adopted && (
              <button
                type="button"
                onClick={() => void setActive(true)}
                disabled={busy}
                className="sf-btn-ai text-xs"
              >
                {busy ? "Teaching…" : "Teach the assistant this"}
              </button>
            )}
            {adopted && (
              <button
                type="button"
                onClick={() => void setActive(false)}
                disabled={busy}
                className="sf-btn-neutral text-xs"
              >
                {busy ? "Removing…" : "Remove from the knowledge base"}
              </button>
            )}
            {/* Offered for three different situations, which is why it is not
                simply "retry": a failed read once the cause is dealt with, a row
                stuck at `learning` because a deploy landed mid-read, and a good
                note written by an older OPENAI_MODEL. Only the first is worth
                putting in front of someone reading a chat message; the other two
                are library housekeeping. */}
            {(document.status === "failed" || (!compact && !working)) && (
              <button
                type="button"
                onClick={() => void readAgain()}
                disabled={busy}
                className="sf-btn-neutral text-xs"
              >
                {busy
                  ? "Starting…"
                  : document.status === "failed"
                    ? "Try reading it again"
                    : "Read it again"}
              </button>
            )}
            {!compact && document.status === "learning" && (
              <button
                type="button"
                onClick={() => void readAgain()}
                disabled={busy}
                className="sf-btn-ghost text-xs"
                title="A deploy during a read leaves a document stuck here. Nothing sweeps those up."
              >
                {busy ? "Starting…" : "Stuck? Start it again"}
              </button>
            )}
            {readable && (
              <button
                type="button"
                onClick={() => setShowNote((s) => !s)}
                className="sf-btn-ghost text-xs"
              >
                {showNote ? "Hide what it learned" : "See what it learned"}
              </button>
            )}
            {!compact && (
              <a href={documentUrl(document.id)} className="sf-btn-ghost text-xs">
                Download
              </a>
            )}
          </div>

          {/* Said only where the action is offered, and said plainly. Adopting a
              document changes the answers on every AI surface in the app, and
              nobody should have to go and read a page to discover that. */}
          {readable && !adopted && (
            <p className="mt-1.5 text-[0.7rem] leading-relaxed text-ink-500">
              Teaching adds this to what the assistant knows everywhere — proposals, the client
              advisor, meeting summaries and this chat. Until then it is only read when the
              document is in the conversation.
            </p>
          )}
        </div>
      </div>

      {showNote && document.skill_md && (
        <div className="border-t border-ink-200 bg-card-2 px-3 py-2.5">
          <p className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-ink-500">
            The assistant&rsquo;s note on this document
          </p>
          <div className="max-h-80 overflow-auto text-xs leading-relaxed text-ink-800">
            <Markdown>{document.skill_md}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}
