"use client";

/**
 * The team chat room.
 *
 * Built for people who do not use software for a living, which drove almost
 * every decision here:
 *
 * - **One obvious box at the bottom, always focused.** No modes, no slash
 *   commands to learn, no "compose" button.
 * - **Day separators and a "New messages" line**, so someone opening it after
 *   lunch can see where they left off without reading upward.
 * - **Reactions on hover AND on a visible button**, because hover-only controls
 *   do not exist on a phone and are not discoverable on a laptop either.
 * - **Plain language everywhere.** "Nobody has said anything yet" beats an
 *   empty state that says "No records found".
 * - **The AI is a person in the room**, with a face and a name, summoned by
 *   typing `@ai`. That is one thing to remember rather than a separate panel
 *   with its own rules.
 *
 * Live updates arrive over SSE — see /api/crm/chat/stream. The list is the
 * server's rows, keyed by id, so a message that arrives twice (once from the
 * POST response and once from the stream echo) collapses into one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { fmtAgo } from "@/lib/crm/format";
import { withoutAttachmentMarkdown } from "@/lib/crm/attachments";
import {
  documentIdsIn,
  withoutDocumentMarkdown,
  type CrmDocumentSummary,
} from "@/lib/crm/documents";
import { dayKeyInTz } from "@/lib/crm/tz";
import type { CrmChatMessage, ChannelSummary } from "@/lib/crm/chat";
import { apiDelete, apiGet, apiPost } from "./api";
import { AttachButton, useAttachFiles } from "./AttachFiles";
import { Avatar } from "./CommentThread";
import { DocumentCard } from "./DocumentCard";
import { EmojiPicker, QUICK_REACTIONS } from "./EmojiPicker";
import { LinkCard, type PreviewData } from "./LinkCard";
import { MentionMenu, useMentionMenu } from "./MentionMenu";
import { ErrorNote } from "./ui";
import type { BoardUser } from "./TodoBoard";

const AI_AUTHOR = "ai@btbholdingsllc.com";

/**
 * Does this draft summon the assistant?
 *
 * The SAME expression as `mentionsAi` in lib/crm/chat-ai.ts, and the two must
 * stay identical: this one decides whether the composer says "the assistant will
 * answer", and that one decides whether it actually does. A composer that
 * promises an answer nobody gets is worse than no indicator at all.
 *
 * It is duplicated rather than imported because chat-ai.ts is server-only — it
 * pulls in the OpenAI client, the S3 client and the whole prompt layer, none of
 * which belongs in a chat bundle.
 */
function summonsAi(body: string): boolean {
  return /(^|[\s(>*_`])@ai\b/i.test(body);
}

interface Payload {
  channel: ChannelSummary;
  messages: CrmChatMessage[];
  previews: PreviewData[];
  documents: CrmDocumentSummary[];
  viewer: string;
  last_read_at: string | null;
}

/* -------------------------------------------------------------------------- */
/* Time, in the OFFICE's zone rather than the reader's                         */
/*                                                                             */
/* Every formatter here takes an explicit `tz`, and it is threaded down from    */
/* the page as a prop. Reader-local formatting would be a hydration mismatch    */
/* by construction: this component is server-rendered first, the container runs */
/* UTC, and nobody who works here does — so React would build the markup with   */
/* one set of times and hydrate over it with another. It is also the wrong      */
/* answer on its own merits. "Yesterday" has to mean the same day to everyone   */
/* in the room, or two people reading the same message disagree about when it   */
/* was said. Same rule, same file, as the meetings calendar: see lib/crm/tz.ts. */
/* -------------------------------------------------------------------------- */

/** "Today", "Yesterday", or a written date. Reads like a person wrote it. */
function dayLabel(iso: string, tz: string): string {
  const key = dayKeyInTz(iso, tz);
  const today = dayKeyInTz(new Date().toISOString(), tz);
  if (key === today) return "Today";

  // Day arithmetic on the KEYS, not on Date objects shifted by an offset —
  // which is where off-by-one-day bugs live, as tz.ts says.
  const yesterday = dayKeyInTz(new Date(Date.now() - 86_400_000).toISOString(), tz);
  if (key === yesterday) return "Yesterday";

  const d = new Date(iso);
  const withinWeek = Date.now() - d.getTime() < 6 * 86_400_000;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    ...(withinWeek
      ? { weekday: "long" }
      : {
          day: "numeric",
          month: "long",
          ...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
        }),
  }).format(d);
}

function clockOf(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

const sameDay = (a: string, b: string, tz: string) => dayKeyInTz(a, tz) === dayKeyInTz(b, tz);

/** Consecutive messages from one person within five minutes are one block. */
const RUN_WINDOW_MS = 5 * 60 * 1000;

/* -------------------------------------------------------------------------- */

export function ChatRoom({
  initial,
  users,
  viewer,
  timeZone,
}: {
  initial: Payload;
  users: BoardUser[];
  viewer: string;
  /** The office zone. A prop, because `process.env` is unreadable in a client
   *  component — the same reason ClientCard takes it. */
  timeZone: string;
}) {
  const [messages, setMessages] = useState<CrmChatMessage[]>(initial.messages);
  const [previews, setPreviews] = useState<Map<string, PreviewData>>(
    () => new Map(initial.previews.map((p) => [p.url, p])),
  );
  const [documents, setDocuments] = useState<Map<string, CrmDocumentSummary>>(
    () => new Map(initial.documents.map((d) => [d.id, d])),
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState(true);
  const [picker, setPicker] = useState<{ messageId: string | null; rect: DOMRect } | null>(null);
  const [thinking, setThinking] = useState(false);

  const box = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const rememberDocument = useCallback((row: CrmDocumentSummary) => {
    setDocuments((m) => new Map(m).set(row.id, row));
  }, []);

  const attach = useAttachFiles({
    value: draft,
    onChange: setDraft,
    fieldRef: box,
    // The chat room is the one surface that takes documents. A card description
    // or a comment silently uploading a counterparty's PDF into the assistant's
    // reading queue would be a feature nobody asked that surface for.
    documents: true,
    // Held the moment the upload returns, so the card under the message is there
    // saying "being read" rather than appearing several seconds later out of the
    // stream. The row it is given is the pending one; the `document` event
    // replaces it when the read finishes.
    onDocument: (row) =>
      rememberDocument({
        ...row,
        skill_md: null,
        skill_model: null,
        learned_at: null,
        error: null,
        extracted_chars: 0,
        activated_by: null,
        uploaded_by: viewer,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
  });

  // The `@` menu. It watches the caret rather than the value, so it opens on a
  // click into an existing `@word` as well as on typing one.
  const mentions = useMentionMenu({ value: draft, onChange: setDraft, fieldRef: box, users });
  const summoning = summonsAi(draft);

  const channelId = initial.channel.id;
  const byEmail = useMemo(
    () => new Map(users.map((u) => [u.email.toLowerCase(), u])),
    [users],
  );

  // Where this reader had got to when the page loaded. Captured ONCE, in
  // initial state: it is the divider's position, and recomputing it as messages
  // arrive would slide the "New messages" line down the screen while you read,
  // which is precisely the thing it exists to stop. It also must not move when
  // `markRead` fires a second later — by then the marker has already served its
  // purpose and the line should stay where it is until the next visit.
  const [unreadMark] = useState<string | null>(() => {
    const readAt = initial.last_read_at;
    if (!readAt) return null;
    const first = initial.messages.find(
      (m) => m.created_at > readAt && m.author_email.toLowerCase() !== viewer.toLowerCase(),
    );
    return first?.id ?? null;
  });

  /* ---- scrolling ---- */

  // "Is the reader at the bottom?" decides whether a new message scrolls them.
  // Yanking someone to the bottom while they are reading history is the single
  // most irritating thing a chat window can do.
  const atBottom = useRef(true);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const scrollToBottom = useCallback((smooth = true) => {
    bottom.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
    // Only on mount: opening a room should land at the newest message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- read state ---- */

  const markRead = useCallback(() => {
    void apiPost(`/api/crm/chat/channels/${channelId}/read`, {
      at: new Date().toISOString(),
    }).catch(() => {
      // Losing a read marker means a badge lingers. Not worth a message.
    });
  }, [channelId]);

  useEffect(() => {
    markRead();
    // Mark read again when the tab regains focus — someone who left it open in
    // the background has not read anything that arrived meanwhile.
    const onFocus = () => markRead();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [markRead]);

  /* ---- the live stream ---- */

  useEffect(() => {
    const source = new EventSource("/api/crm/chat/stream");

    const upsert = (message: CrmChatMessage) => {
      if (message.channel_id !== channelId) return;
      setMessages((rows) => {
        const i = rows.findIndex((r) => r.id === message.id);
        if (i >= 0) {
          const next = [...rows];
          next[i] = message;
          return next;
        }
        // Inserted by timestamp rather than appended: the AI's reply and a fast
        // typist can land out of order, and a room that reorders itself on the
        // next render is worse than one that puts them in the right place now.
        const next = [...rows, message];
        next.sort((a, b) => a.created_at.localeCompare(b.created_at));
        return next;
      });
      if (message.author_email === AI_AUTHOR) setThinking(false);
      if (atBottom.current) window.setTimeout(() => scrollToBottom(), 30);
      if (document.hasFocus()) markRead();
    };

    source.addEventListener("message", (e) => upsert(JSON.parse(e.data).message));
    source.addEventListener("update", (e) => upsert(JSON.parse(e.data).message));
    source.addEventListener("delete", (e) => {
      const { channelId: id, messageId } = JSON.parse(e.data);
      if (id !== channelId) return;
      setMessages((rows) => rows.filter((r) => r.id !== messageId));
    });
    source.addEventListener("preview", (e) => {
      const { preview } = JSON.parse(e.data) as { preview: PreviewData };
      setPreviews((m) => new Map(m).set(preview.url, preview));
    });
    // NOT filtered by channel, unlike everything above: a document event has no
    // channel. The same file can be linked from several rooms and from the
    // library, and every card carrying that id should stop saying "being read"
    // at the same moment. See the note on ChatEvent in lib/crm/chat-bus.ts.
    source.addEventListener("document", (e) => {
      const { document: row } = JSON.parse(e.data) as { document: CrmDocumentSummary };
      setDocuments((m) => new Map(m).set(row.id, row));
    });
    source.addEventListener("ready", () => setLive(true));
    source.onerror = () => {
      // EventSource reconnects on its own; this only drives the banner. A deploy
      // restarts the container and every open room shows "Reconnecting…" for a
      // few seconds rather than silently going stale.
      setLive(false);
    };

    return () => source.close();
  }, [channelId, markRead, scrollToBottom]);

  /* ---- sending ---- */

  async function send() {
    const body = draft.trim();
    if (!body || sending || attach.uploading > 0) return;
    setSending(true);
    setError("");
    const summoned = summonsAi(body);
    try {
      const row = await apiPost<CrmChatMessage>(
        `/api/crm/chat/channels/${channelId}/messages`,
        { body },
      );
      setMessages((rows) => (rows.some((r) => r.id === row.id) ? rows : [...rows, row]));
      setDraft("");
      if (summoned) setThinking(true);
      atBottom.current = true;
      window.setTimeout(() => scrollToBottom(), 30);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That message did not send.");
    } finally {
      setSending(false);
      box.current?.focus();
    }
  }

  async function react(messageId: string, emoji: string) {
    setPicker(null);
    try {
      const row = await apiPost<CrmChatMessage>(`/api/crm/chat/messages/${messageId}`, { emoji });
      setMessages((rows) => rows.map((r) => (r.id === row.id ? row : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That reaction did not save.");
    }
  }

  async function remove(messageId: string) {
    if (!confirm("Delete this message?")) return;
    const before = messages;
    setMessages((rows) => rows.filter((r) => r.id !== messageId));
    try {
      await apiDelete(`/api/crm/chat/messages/${messageId}`);
    } catch (err) {
      setMessages(before);
      setError(err instanceof Error ? err.message : "That message could not be deleted.");
    }
  }

  /* ---- older history ---- */

  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exhausted, setExhausted] = useState(initial.messages.length < 50);

  async function loadOlder() {
    if (loadingOlder || exhausted || !messages.length) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const heightBefore = el?.scrollHeight ?? 0;
    try {
      const page = await apiGet<Payload>(
        `/api/crm/chat/channels/${channelId}/messages?before=${encodeURIComponent(messages[0].created_at)}`,
      );
      if (!page.messages.length) setExhausted(true);
      else {
        setMessages((rows) => [...page.messages, ...rows]);
        setPreviews((m) => {
          const next = new Map(m);
          for (const p of page.previews) next.set(p.url, p);
          return next;
        });
        // Hold the reader's place: prepending content would otherwise shove
        // what they were reading down by the height of everything added.
        window.requestAnimationFrame(() => {
          if (el) el.scrollTop += el.scrollHeight - heightBefore;
        });
      }
    } catch {
      setExhausted(true);
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <div className="sf-card flex h-[calc(100vh-13rem)] min-h-[32rem] flex-col overflow-hidden">
      {/* ---- header ---- */}
      <div className="flex items-center gap-3 border-b border-ink-200 bg-card-2 px-5 py-3">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-grad-brand text-base text-white shadow-glow"
        >
          💬
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink-900">{initial.channel.name}</h2>
          <p className="truncate text-xs text-ink-600">
            {initial.channel.topic || "The whole office. Everyone sees everything here."}
          </p>
        </div>
        {!live && (
          <span className="shrink-0 rounded-pill bg-warn-100 px-2.5 py-1 text-xs font-medium text-warn-700">
            Reconnecting…
          </span>
        )}
      </div>

      {/* ---- messages ---- */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-4 sm:px-5"
      >
        {!exhausted && (
          <div className="mb-3 flex justify-center">
            <button type="button" onClick={loadOlder} className="sf-btn-neutral text-xs" disabled={loadingOlder}>
              {loadingOlder ? "Loading…" : "Show earlier messages"}
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="text-4xl">👋</p>
              <p className="mt-3 text-sm font-medium text-ink-900">
                Nobody has said anything yet.
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-ink-600">
                This is the whole team&rsquo;s room. Paste a screenshot, drop a Crexi link, or type{" "}
                <span className="rounded bg-sf-100 px-1 font-medium text-sf-700">@</span> to reach
                the assistant — it has read the memorandum and knows our deal. Drop a PDF or a Word
                file in and it will read that too.
              </p>
            </div>
          </div>
        ) : (
          messages.map((message, i) => {
            const previous = messages[i - 1];
            const newDay = !previous || !sameDay(previous.created_at, message.created_at, timeZone);
            const isAi = message.kind === "ai";
            const runs =
              !newDay &&
              previous &&
              previous.author_email === message.author_email &&
              new Date(message.created_at).getTime() -
                new Date(previous.created_at).getTime() <
                RUN_WINDOW_MS;

            return (
              <div key={message.id}>
                {newDay && (
                  <div className="my-4 flex items-center gap-3">
                    <span className="h-px flex-1 bg-ink-200" />
                    <span className="rounded-pill bg-ink-200/70 px-3 py-1 text-[0.7rem] font-semibold text-ink-700">
                      {dayLabel(message.created_at, timeZone)}
                    </span>
                    <span className="h-px flex-1 bg-ink-200" />
                  </div>
                )}

                {unreadMark === message.id && (
                  <div className="my-3 flex items-center gap-3">
                    <span className="h-px flex-1 bg-err-500/40" />
                    <span className="rounded-pill bg-err-50 px-3 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-err-700">
                      New
                    </span>
                    <span className="h-px flex-1 bg-err-500/40" />
                  </div>
                )}

                <Message
                  message={message}
                  runs={Boolean(runs)}
                  isAi={isAi}
                  mine={message.author_email.toLowerCase() === viewer.toLowerCase()}
                  viewer={viewer}
                  person={byEmail.get(message.author_email.toLowerCase())}
                  users={users}
                  previews={previews}
                  documents={documents}
                  onDocumentChange={rememberDocument}
                  onReact={react}
                  onDelete={remove}
                  onOpenPicker={(rect) => setPicker({ messageId: message.id, rect })}
                  timeZone={timeZone}
                />
              </div>
            );
          })
        )}

        {thinking && (
          <div className="mt-2 flex items-center gap-2.5 px-1">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-grad-ai text-xs text-white">
              ✦
            </span>
            <span className="flex items-center gap-1 text-sm text-ink-600">
              The assistant is thinking
              <span className="inline-flex gap-0.5">
                <Dot delay="0ms" />
                <Dot delay="150ms" />
                <Dot delay="300ms" />
              </span>
            </span>
          </div>
        )}

        <div ref={bottom} />
      </div>

      {/* ---- composer ---- */}
      <div className="border-t border-ink-200 bg-card-2 px-4 py-3 sm:px-5">
        {error && <ErrorNote>{error}</ErrorNote>}
        {attach.error && <ErrorNote>{attach.error}</ErrorNote>}

        {/* The summoned banner.
            The one thing this had to fix: `@ai` in the middle of a sentence is
            three grey characters, and whether the assistant is about to answer
            is the single most consequential fact about the message being
            written. It sits ABOVE the box rather than inside it so it cannot be
            mistaken for placeholder text, and it is the violet gradient, which
            in this app means AI and nothing else. */}
        {summoning && (
          <div className="mb-1.5 flex items-center gap-2 rounded-t-xl bg-grad-ai px-3 py-1.5 text-xs font-medium text-white shadow-glow">
            <span aria-hidden className="text-sm leading-none">
              ✦
            </span>
            <span>The assistant will answer this message.</span>
            <button
              type="button"
              // Removes the summons rather than the message. Someone who typed
              // `@ai` by reflex and then thought better of it should not have to
              // hunt for three characters in the middle of a paragraph.
              onClick={() => {
                setDraft((d) => d.replace(/(^|[\s(>*_`])@ai\b/gi, "$1").replace(/ {2,}/g, " ").trimStart());
                box.current?.focus();
              }}
              className="ml-auto rounded-pill px-2 py-0.5 text-[0.7rem] font-semibold text-white/90 transition hover:bg-white/20 hover:text-white"
            >
              Don&rsquo;t ask
            </button>
          </div>
        )}

        <div
          className={`rounded-2xl border bg-card transition ${
            attach.dragging
              ? "border-sf-400 ring-4 ring-sf-500/15"
              : summoning
                ? "border-[rgb(var(--ai-to)/0.55)] ring-4 ring-[rgb(var(--ai-to)/0.12)]"
                : "border-ink-300"
          }`}
        >
          <textarea
            ref={box}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              mentions.sync();
            }}
            // The caret moves for reasons other than typing — a click into an
            // existing `@word`, an arrow key, a selection. The menu tracks the
            // CARET, not the value, so it has to be re-synced on all of them.
            onClick={() => mentions.sync()}
            onKeyUp={(e) => {
              if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") mentions.sync();
            }}
            // Closes on blur, so clicking away does not leave a fixed panel
            // floating over the room. The menu's own rows use `onMouseDown` with
            // preventDefault precisely so that picking one does not blur first.
            onBlur={() => mentions.close()}
            onPaste={attach.onPaste}
            onDrop={attach.onDrop}
            {...attach.dragProps}
            onKeyDown={(e) => {
              // The mention menu gets first refusal, and this ordering is the
              // whole reason it can exist: Enter sends in this composer, so a
              // menu that did not claim the key would post "@sar" as a message
              // the moment someone pressed Enter to choose Sarah.
              if (mentions.handleKeyDown(e)) return;
              // Enter sends, Shift+Enter is a newline. The opposite of a card
              // comment, and deliberately: chat is one line at a time, and the
              // people using this expect Enter to send because every other chat
              // app they use does.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            maxLength={8000}
            placeholder="Write a message…  type @ to reach the assistant or a colleague · paste a screenshot or drop a PDF straight in"
            aria-label="Write a message"
            className="w-full resize-none bg-transparent px-3.5 py-2.5 text-sm text-ink-900 outline-none placeholder:text-ink-400"
          />
          <div className="flex items-center gap-1 border-t border-ink-200 px-2 py-1.5">
            <EmojiButton onPick={(emoji) => setDraft((d) => `${d}${emoji}`)} />
            <AttachButton
              onPick={attach.pick}
              uploading={attach.uploading}
              label="Attach"
              documents
            />
            {/* The discoverable half of the pair. The menu opens on `@`, and a
                button that types the character is how someone who has never seen
                it finds out. Violet, because what it summons is the AI. */}
            <button
              type="button"
              onClick={() => {
                const el = box.current;
                const at = el?.selectionStart ?? draft.length;
                const before = draft.slice(0, at);
                // A space first when there is a word before the caret: the
                // server's `@ai` test is word-boundaried, so "done@ai" would be
                // typed happily and then never answered.
                const lead = before && !/\s$/.test(before) ? " " : "";
                const next = `${before}${lead}@${draft.slice(at)}`;
                setDraft(next);
                const caret = at + lead.length + 1;
                queueMicrotask(() => {
                  el?.focus();
                  el?.setSelectionRange(caret, caret);
                  mentions.sync();
                });
              }}
              className="sf-btn-ghost text-xs"
              title="Mention the assistant or a colleague"
            >
              <span aria-hidden className="text-sm font-semibold leading-none">
                @
              </span>
              Mention
            </button>
            <span className="ml-auto hidden text-[0.7rem] text-ink-500 sm:block">
              Enter sends · Shift+Enter for a new line
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() || sending || attach.uploading > 0}
              className={`ml-2 ${summoning ? "sf-btn-ai" : "sf-btn-brand"}`}
            >
              {sending ? "Sending…" : summoning ? "Ask the assistant" : "Send"}
            </button>
          </div>
        </div>
      </div>

      {mentions.open && mentions.anchor && (
        <MentionMenu
          targets={mentions.targets}
          active={mentions.active}
          anchor={mentions.anchor}
          onPick={mentions.pick}
          onHover={mentions.setActive}
        />
      )}

      {picker && (
        <EmojiPicker
          anchor={picker.rect}
          onClose={() => setPicker(null)}
          onPick={(emoji) => {
            if (picker.messageId) void react(picker.messageId, emoji);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1 w-1 animate-bounce rounded-full bg-ink-500"
      style={{ animationDelay: delay }}
    />
  );
}

/** The composer's own emoji button — inserts into the draft rather than reacting. */
function EmojiButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={(e) => setRect(e.currentTarget.getBoundingClientRect())}
        className="sf-btn-ghost text-base leading-none"
        title="Emoji"
        aria-label="Insert an emoji"
      >
        🙂
      </button>
      {rect && (
        <EmojiPicker
          anchor={rect}
          onClose={() => setRect(null)}
          onPick={(emoji) => {
            onPick(emoji);
            setRect(null);
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* One message                                                                 */
/* -------------------------------------------------------------------------- */

function Message({
  message,
  runs,
  isAi,
  mine,
  viewer,
  person,
  users,
  previews,
  documents,
  onDocumentChange,
  onReact,
  onDelete,
  onOpenPicker,
  timeZone,
}: {
  message: CrmChatMessage;
  runs: boolean;
  isAi: boolean;
  mine: boolean;
  viewer: string;
  person: BoardUser | undefined;
  users: BoardUser[];
  previews: Map<string, PreviewData>;
  documents: Map<string, CrmDocumentSummary>;
  onDocumentChange: (next: CrmDocumentSummary) => void;
  onReact: (messageId: string, emoji: string) => void;
  onDelete: (messageId: string) => void;
  onOpenPicker: (rect: DOMRect) => void;
  timeZone: string;
}) {
  const name = isAi
    ? "Assistant"
    : person?.name?.trim() || message.author_email.split("@")[0];

  const documentIds = useMemo(() => documentIdsIn(message.body), [message.body]);

  // Mentions are bolded rather than wrapped in HTML — the Markdown renderer is
  // configured for prose and injecting HTML would mean trusting message text.
  //
  // The document links come OUT first: each one gets a card below, and leaving
  // the link in as well prints the file name twice, three pixels apart.
  const rendered = useMemo(() => {
    const byHandle = new Map<string, string>();
    for (const u of users) {
      byHandle.set(u.email.toLowerCase(), u.name?.trim() || u.email);
      const local = u.email.split("@")[0]?.toLowerCase();
      if (local) byHandle.set(local, u.name?.trim() || u.email);
    }
    return withoutDocumentMarkdown(message.body).replace(
      /@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g,
      (whole, handle: string) => {
        if (handle.toLowerCase() === "ai") return "**@ai**";
        const label = byHandle.get(handle.toLowerCase());
        return label ? `**@${label}**` : whole;
      },
    );
  }, [message.body, users]);

  const urls = useMemo(() => {
    const out: string[] = [];
    for (const m of withoutAttachmentMarkdown(message.body).matchAll(/https?:\/\/[^\s<>()[\]"']+/g)) {
      const url = m[0].replace(/[.,;:!?]+$/, "");
      if (!out.includes(url)) out.push(url);
      if (out.length >= 3) break;
    }
    return out;
  }, [message.body]);

  return (
    <div className={`group relative flex gap-3 rounded-xl px-1 py-1 hover:bg-ink-100/60 ${runs ? "" : "mt-3"}`}>
      <div className="w-8 shrink-0 pt-0.5">
        {runs ? (
          <span className="hidden text-[0.65rem] leading-6 text-ink-400 group-hover:block">
            {clockOf(message.created_at, timeZone)}
          </span>
        ) : isAi ? (
          <span
            className="grid h-8 w-8 place-items-center rounded-full bg-grad-ai text-sm text-white"
            title="The in-house assistant"
          >
            ✦
          </span>
        ) : (
          <Avatar email={message.author_email} name={person?.name} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!runs && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-ink-900">{name}</span>
            {/* Violet, because in this app the violet gradient means AI and
                nothing else. A reader must never have to work out whether the
                thing they are reading came from a colleague or a model. */}
            {isAi && (
              <span className="rounded-pill bg-grad-ai px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-white">
                AI
              </span>
            )}
            <span className="text-[0.7rem] text-ink-500" title={message.created_at}>
              {clockOf(message.created_at, timeZone)} · {fmtAgo(message.created_at)}
            </span>
          </div>
        )}

        {/* A message that was ONLY a dropped document has nothing left after the
            link is stripped, and an empty paragraph above the card is a stray
            gap rather than a message. */}
        {rendered.trim() && (
          <div className="mt-0.5 text-sm leading-relaxed text-ink-800">
            <Markdown>{rendered}</Markdown>
          </div>
        )}

        {documentIds.map((id) => (
          <DocumentCard
            key={id}
            document={documents.get(id)}
            onChange={onDocumentChange}
            compact
          />
        ))}

        {urls.map((url) => {
          const preview = previews.get(url);
          // Nothing is rendered until the unfurl lands. A skeleton that resolves
          // to "we could not read this page" is two layout shifts for no gain,
          // and the link itself is already visible in the message text.
          return preview && preview.status !== "blocked" ? (
            <LinkCard key={url} preview={preview} />
          ) : null;
        })}

        {message.reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {message.reactions.map((r) => {
              const mineToo = r.actors.some((a) => a.toLowerCase() === viewer.toLowerCase());
              return (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => onReact(message.id, r.emoji)}
                  title={r.actors.map((a) => a.split("@")[0]).join(", ")}
                  className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs transition ${
                    mineToo
                      ? "border-sf-300 bg-sf-100 text-sf-700"
                      : "border-ink-200 bg-card text-ink-700 hover:border-ink-300 hover:bg-card-2"
                  }`}
                >
                  <span className="text-sm leading-none">{r.emoji}</span>
                  <span className="sf-num font-medium">{r.actors.length}</span>
                </button>
              );
            })}
          </div>
        )}

      </div>

      {/* The hover toolbar. Also reachable by keyboard: focus-within keeps it
          open once tabbed into, so it is not a mouse-only feature. */}
      <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-pill border border-ink-200 bg-card p-0.5 shadow-soft group-hover:flex group-focus-within:flex">
        {QUICK_REACTIONS.slice(0, 3).map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(message.id, emoji)}
            title={`React ${emoji}`}
            className="rounded-full px-1.5 py-0.5 text-sm leading-none transition hover:bg-sf-100"
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          onClick={(e) => onOpenPicker(e.currentTarget.getBoundingClientRect())}
          title="More reactions"
          aria-label="More reactions"
          className="rounded-full px-1.5 py-1 text-ink-500 transition hover:bg-sf-100 hover:text-sf-700"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9 10h.01M15 10h.01M8.5 14.5a4.5 4.5 0 007 0" />
          </svg>
        </button>
        {mine && (
          <button
            type="button"
            onClick={() => onDelete(message.id)}
            title="Delete this message"
            aria-label="Delete this message"
            className="rounded-full px-1.5 py-1 text-ink-500 transition hover:bg-err-50 hover:text-err-700"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
