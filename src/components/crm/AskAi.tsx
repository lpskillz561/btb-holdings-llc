"use client";

/**
 * The assistant that rides on every /crm page.
 *
 * Mounted from app/crm/layout.tsx, which is what makes it persistent: a layout
 * is not re-rendered when a child segment changes, so the panel stays open and
 * the thread stays on screen while you click from Overview to a client card to
 * a contract. Move this into a page and every navigation closes it.
 *
 * The scope comes from the URL, so the assistant is looking at whatever you are:
 * a client card asks about that client, a proposal about that proposal, a list
 * page about the whole book. The server resolves the scope into record context
 * on every turn — see lib/crm/ai.ts — so nothing here needs to know what a
 * proposal contains.
 *
 * Every answer is grounded in src/lib/crm/knowledge/SKILL.md, which is prepended
 * to the system prompt of this and every other AI surface.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { fmtAgo } from "@/lib/crm/format";
import { isClientFacingRoute } from "@/lib/crm/routes";
import type { CrmConversation, CrmMessage } from "@/lib/crm/types";
import {
  attachmentIdsIn,
  attachmentUrl,
  withoutAttachmentMarkdown,
} from "@/lib/crm/attachments";
import { apiGet, apiPost, qs } from "./api";
import { AttachButton, useAttachFiles } from "./AttachFiles";
import { ErrorNote } from "./ui";

type ScopeType = "global" | "client" | "proposal" | "contract";

interface Scope {
  type: ScopeType;
  id: string | null;
  label: string;
  starters: string[];
}

const GLOBAL_STARTERS = [
  "Which contracts are still unsigned?",
  "Where is the pipeline concentrated right now?",
  "How much pad capacity is left, and where?",
  "Explain the structure the way I'd say it to a CPA.",
];

/**
 * URL → scope. A detail route is `/crm/<section>/<id>`; anything shorter, or a
 * section without a record, is the workspace.
 *
 * The `contracts` branch is wired but not reachable today: there is no
 * `/crm/contracts/[id]` page, only `/crm/contracts/[id]/print`, and the panel
 * never renders on a print route. Contracts are still fully answerable — they
 * are part of both the client context and the workspace context in lib/crm/ai.ts
 * — and this branch starts working the day a contract detail page exists.
 */
function scopeFrom(pathname: string): Scope {
  const [, , section, id] = pathname.split("/");
  const record = id && id !== "new" ? id : null;

  if (record && section === "clients") {
    return {
      type: "client",
      id: record,
      label: "This client",
      starters: [
        "What's the strongest case I can honestly make to this client?",
        "What will their CPA push back on first?",
        "What's missing from this account before I can send a proposal?",
        "Given what they own already, what should we propose next?",
      ],
    };
  }
  if (record && section === "proposals") {
    return {
      type: "proposal",
      id: record,
      label: "This proposal",
      starters: [
        "Walk me through these numbers the way the client will hear them.",
        "What will their CPA question in this proposal?",
        "Is the deduction leverage here in line with the rest of the book?",
        "What has to happen before this becomes a contract set?",
      ],
    };
  }
  if (record && section === "contracts") {
    return {
      type: "contract",
      id: record,
      label: "This contract",
      starters: [
        "Explain this document's key terms in plain English.",
        "Is this execution set complete?",
        "What happens if the rent doesn't cover the note?",
        "What does the client actually own when this is signed?",
      ],
    };
  }
  return { type: "global", id: null, label: "Whole workspace", starters: GLOBAL_STARTERS };
}

export function AskAi({ aiEnabled }: { aiEnabled: boolean }) {
  const pathname = usePathname();
  const scope = scopeFrom(pathname);
  const scopeKey = `${scope.type}:${scope.id ?? ""}`;

  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<CrmConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CrmMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showThreads, setShowThreads] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // A pasted screenshot becomes Markdown in the box, exactly as it does in a
  // comment. The server turns that Markdown back into a real vision part on the
  // way to the model — see toModelMessages in lib/crm/advisor.ts — so the image
  // is both a thing the model looks at and a thing that stays in the visible
  // transcript. One storage path, no second concept of "an attachment".
  const attach = useAttachFiles({ value: input, onChange: setInput, fieldRef: inputRef });

  // Cmd/Ctrl+K anywhere in the CRM. Bound on the window rather than a field so
  // it works without the panel having focus, which is the whole point of it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A new record is a new subject. Drop the thread rather than carrying one
  // client's conversation onto another client's card.
  useEffect(() => {
    setActiveId(null);
    setMessages([]);
    setError("");
    setShowThreads(false);
    setConversations([]);
    if (!aiEnabled || !open) return;
    let cancelled = false;
    apiGet<CrmConversation[]>(
      `/api/crm/advisor${qs({ scope_type: scope.type, scope_id: scope.id })}`,
    )
      .then((rows) => {
        if (!cancelled) setConversations(rows);
      })
      .catch(() => {
        // A failed history load must not block asking a new question.
      });
    return () => {
      cancelled = true;
    };
  }, [scopeKey, open, aiEnabled, scope.type, scope.id]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || sending) return;
      setSending(true);
      setError("");
      setInput("");

      // Shown immediately. The server persists the question before it calls the
      // model, so this optimistic row always matches what was stored.
      const optimistic: CrmMessage = {
        id: `pending-${Date.now()}`,
        conversation_id: activeId ?? "",
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimistic]);

      try {
        const reply = await apiPost<{ conversation: CrmConversation; messages: CrmMessage[] }>(
          "/api/crm/advisor",
          {
            scope_type: scope.type,
            scope_id: scope.id,
            conversation_id: activeId,
            content: text,
          },
        );
        setMessages(reply.messages);
        setActiveId(reply.conversation.id);
        setConversations((current) =>
          current.some((c) => c.id === reply.conversation.id)
            ? current.map((c) => (c.id === reply.conversation.id ? reply.conversation : c))
            : [reply.conversation, ...current],
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "The assistant could not answer.");
        setMessages((current) => current.filter((m) => m.id !== optimistic.id));
        setInput(text);
      } finally {
        setSending(false);
      }
    },
    [activeId, scope.id, scope.type, sending],
  );

  async function openThread(id: string) {
    setShowThreads(false);
    setActiveId(id);
    setMessages(await apiGet<CrmMessage[]>(`/api/crm/advisor${qs({ conversation_id: id })}`));
  }

  // The print routes and the presentation are the client's, not a screen of
  // ours. Same rule as CrmChrome — nothing of the application's furniture
  // belongs on them, and a floating "Ask AI" button in a screen share is
  // exactly the kind of thing a prospect should never see.
  if (isClientFacingRoute(pathname)) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ask the advisor (⌘K)"
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-grad-ai px-5 py-3.5 text-sm font-semibold text-white shadow-[0_10px_30px_-8px_rgb(var(--ai-to)/0.6)] transition duration-200 ease-spring hover:-translate-y-0.5 hover:brightness-110"
      >
        <AskIcon />
        Ask AI
      </button>
    );
  }

  return (
    <>
      {/* Dimmer. Deliberately click-through-free: an accidental click outside
          shouldn't discard a half-typed question, so it closes on purpose. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 bg-ink-900/30 backdrop-blur-sm"
      />

      <aside
        role="dialog"
        aria-label="Ask the advisor"
        className="animate-slide-in-right fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-ink-200 bg-card shadow-pop"
      >
        <header className="flex items-center justify-between gap-3 bg-grad-ai px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Ask AI</p>
            <p className="truncate text-xs text-white/70">
              {scope.label} · answers from the house knowledge base
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowThreads((v) => !v)}
              className="rounded-pill px-2 py-1 text-xs text-white/75 transition hover:bg-white/15 hover:text-white"
            >
              History
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveId(null);
                setMessages([]);
                setShowThreads(false);
              }}
              className="rounded-pill px-2 py-1 text-xs text-white/75 transition hover:bg-white/15 hover:text-white"
            >
              New
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-pill px-2 py-1 text-lg leading-none text-white/75 transition hover:bg-white/15 hover:text-white"
            >
              ×
            </button>
          </div>
        </header>

        {showThreads ? (
          <div className="max-h-56 overflow-y-auto border-b border-ink-200 bg-ink-100">
            {conversations.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-500">No earlier threads here.</p>
            ) : (
              <ul>
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => void openThread(conversation.id)}
                      className={`w-full px-4 py-2 text-left text-sm transition hover:bg-card ${
                        conversation.id === activeId ? "bg-card font-medium" : ""
                      }`}
                    >
                      <span className="line-clamp-1 text-ink-800">{conversation.title}</span>
                      <span className="text-xs text-ink-500">{fmtAgo(conversation.updated_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!aiEnabled ? (
            <p className="text-sm text-ink-600">
              The assistant is unavailable — <code>OPENAI_API_KEY</code> is not set on the web
              service. Add it to the environment and redeploy to enable this, proposal drafting
              and land-fit assessment.
            </p>
          ) : messages.length === 0 && !sending ? (
            <div>
              <p className="text-sm text-ink-600">
                Ask about clients, proposals, contracts, land or the structure itself. Answers are
                grounded in the programme&rsquo;s own legal opinion, executed agreements and pro
                forma — and the assistant never calculates a figure, it reports the ones on the
                record.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {scope.starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void send(starter)}
                    className="rounded-full border border-ink-200 px-3 py-1.5 text-left text-xs text-ink-700 transition hover:border-sf-500 hover:text-sf-600"
                  >
                    {starter}
                  </button>
                ))}
              </div>
              {scope.type !== "global" ? (
                <p className="mt-4 text-xs text-ink-500">
                  Scoped to the record you are on.{" "}
                  <Link href="/crm" className="text-sf-600 underline">
                    Go to Overview
                  </Link>{" "}
                  to ask about the whole book instead.
                </p>
              ) : null}
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    message.role === "user"
                      ? "bg-grad-brand text-white"
                      : "bg-ink-200/55 text-ink-800"
                  }`}
                >
                  {message.role === "user" ? (
                    <UserMessage content={message.content} />
                  ) : (
                    <Markdown>{message.content}</Markdown>
                  )}
                </div>
              </div>
            ))
          )}
          {sending && (
            <p className="text-sm text-ink-500" role="status">
              Thinking…
            </p>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-ink-200 p-3">
          <ErrorNote>{error}</ErrorNote>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="mt-2 flex gap-2"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={attach.onPaste}
              onDrop={attach.onDrop}
              {...attach.dragProps}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a newline, as everywhere else.
                //
                // An upload in flight swallows Enter rather than sending. The
                // image's Markdown is not in the box yet, so "what is wrong
                // here?" would reach the model with nothing to look at — and
                // the natural rhythm is paste-then-immediately-Enter, so this
                // is the common case rather than a corner.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (attach.uploading > 0) return;
                  void send(input);
                }
              }}
              rows={2}
              disabled={!aiEnabled}
              placeholder="Ask about clients, proposals, contracts… or paste a screenshot."
              className={`field flex-1 resize-none ${
                attach.dragging ? "border-sf-400 ring-4 ring-sf-500/15" : ""
              }`}
            />
            <button
              type="submit"
              className="sf-btn-brand self-end"
              disabled={!aiEnabled || sending || !input.trim() || attach.uploading > 0}
            >
              Send
            </button>
          </form>
          {attach.error ? (
            <p className="mt-2 text-xs text-err-700">{attach.error}</p>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-2">
            <AttachButton onPick={attach.pick} uploading={attach.uploading} label="Image" />
            <p className="text-[0.7rem] text-ink-500">
              Internal tool. Not tax advice — the client&rsquo;s CPA confirms the position.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * One of the reader's own messages.
 *
 * Their text is shown VERBATIM rather than as Markdown — it is what they typed,
 * and rendering a stray asterisk as emphasis in their own bubble is both wrong
 * and confusing. Attached images are the exception, and they are pulled out and
 * drawn rather than left as `![](…)`: the model is looking at the picture, so
 * the transcript has to show the picture, or the two are having different
 * conversations.
 */
function UserMessage({ content }: { content: string }) {
  const text = withoutAttachmentMarkdown(content);
  const ids = attachmentIdsIn(content);
  return (
    <>
      {text ? <p className="whitespace-pre-wrap">{text}</p> : null}
      {ids.length > 0 && (
        <span className={`flex flex-wrap gap-1.5 ${text ? "mt-2" : ""}`}>
          {ids.map((id) => (
            <a
              key={id}
              href={attachmentUrl(id)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open full size"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the
                  optimizer would fetch this server-side without the reader's
                  session and get a 401. See Markdown.tsx. */}
              <img
                src={attachmentUrl(id)}
                alt="Attached"
                loading="lazy"
                // White, because this bubble is the indigo gradient. The ink
                // tokens would vanish into it in one appearance or the other.
                className="h-24 w-auto max-w-full rounded-lg border border-white/30 object-cover"
              />
            </a>
          ))}
        </span>
      )}
    </>
  );
}

function AskIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4" fill="currentColor">
      <path d="M10 2a8 8 0 0 0-6.9 12.03L2 18l4.1-1.06A8 8 0 1 0 10 2Zm0 3.4c1.6 0 2.8 1 2.8 2.4 0 1.1-.6 1.7-1.5 2.3-.6.4-.8.7-.8 1.2v.3H8.8v-.4c0-1 .4-1.6 1.3-2.2.7-.5 1-.8 1-1.3 0-.6-.5-1-1.2-1s-1.2.4-1.3 1.1H7C7.1 6.4 8.3 5.4 10 5.4Zm-.6 7.3h1.4v1.4H9.4v-1.4Z" />
    </svg>
  );
}
