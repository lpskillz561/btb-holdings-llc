"use client";

// The client-scoped AI advisor.
//
// Internal audience: this answers the person who owns the relationship, not the
// client, so it's allowed to be blunt about a weak deal. Every turn rebuilds the
// system prompt from the live client record server-side — see lib/crm/advisor.ts
// — so it stays current as the account changes mid-conversation.

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { fmtAgo } from "@/lib/crm/format";
import type { CrmClient, CrmConversation, CrmMessage } from "@/lib/crm/types";
import { apiGet, apiPost, qs } from "./api";
import { EmptyState, ErrorNote } from "./ui";

const STARTERS = [
  "What's the strongest case I can honestly make to this client?",
  "What will their CPA push back on first?",
  "What's missing from this account before I can send a proposal?",
  "Given what they own already, what should we propose next?",
];

export function AdvisorTab({ client, aiEnabled }: { client: CrmClient; aiEnabled: boolean }) {
  const [conversations, setConversations] = useState<CrmConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CrmMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aiEnabled) return;
    apiGet<CrmConversation[]>(`/api/crm/advisor${qs({ client_id: client.id })}`)
      .then((rows) => {
        setConversations(rows);
        if (rows[0]) {
          setActiveId(rows[0].id);
          return apiGet<CrmMessage[]>(`/api/crm/advisor${qs({ conversation_id: rows[0].id })}`).then(
            setMessages,
          );
        }
      })
      .catch(() => {
        // A failed history load shouldn't block asking a new question.
      });
  }, [client.id, aiEnabled]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

  async function send(content: string) {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    setInput("");

    // Show the question immediately; the server persists it before the model
    // call, so this optimistic row always matches what was stored.
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
        { client_id: client.id, conversation_id: activeId, content: text },
      );
      setMessages(reply.messages);
      setActiveId(reply.conversation.id);
      setConversations((current) =>
        current.some((c) => c.id === reply.conversation.id)
          ? current.map((c) => (c.id === reply.conversation.id ? reply.conversation : c))
          : [reply.conversation, ...current],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "The advisor could not answer.");
      setMessages((current) => current.filter((m) => m.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  async function openThread(id: string) {
    setActiveId(id);
    setMessages(await apiGet<CrmMessage[]>(`/api/crm/advisor${qs({ conversation_id: id })}`));
  }

  if (!aiEnabled) {
    return (
      <EmptyState>
        The AI advisor is unavailable — <code>OPENAI_API_KEY</code> is not set on the web service.
        Add it to the environment and restart to enable proposal drafting, land-fit assessment and
        this advisor.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside>
        <button
          type="button"
          className="btn-outline w-full text-sm"
          onClick={() => {
            setActiveId(null);
            setMessages([]);
          }}
        >
          New thread
        </button>
        <ul className="mt-3 space-y-1">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => void openThread(conversation.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                  conversation.id === activeId
                    ? "bg-navy-900/5 font-medium text-navy-900"
                    : "text-navy-900/65 hover:bg-paper-100"
                }`}
              >
                <span className="line-clamp-2">{conversation.title}</span>
                <span className="mt-0.5 block text-xs text-navy-900/40">
                  {fmtAgo(conversation.updated_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="card flex min-h-[28rem] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && !sending ? (
            <div className="py-6">
              <p className="text-sm text-navy-900/60">
                Ask about {client.name}. The advisor knows their tax profile, land criteria,
                holdings and proposal history.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void send(starter)}
                    className="rounded-full border border-paper-300 px-3 py-1.5 text-xs text-navy-900/70 transition hover:border-gold-500 hover:text-gold-600"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-3 text-sm ${
                    message.role === "user"
                      ? "bg-navy-900 text-paper-50"
                      : "bg-paper-100 text-navy-900/85"
                  }`}
                >
                  {message.role === "user" ? (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  ) : (
                    <Markdown>{message.content}</Markdown>
                  )}
                </div>
              </div>
            ))
          )}
          {sending && (
            <p className="text-sm text-navy-900/45" role="status">
              Thinking…
            </p>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-paper-200 p-4">
          <ErrorNote>{error}</ErrorNote>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="mt-2 flex gap-3"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a newline, as everywhere else.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              placeholder={`Ask about ${client.name}…`}
              className="field flex-1 resize-none"
            />
            <button type="submit" className="btn-gold self-end" disabled={sending || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
