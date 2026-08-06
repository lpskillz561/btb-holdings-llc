"use client";

/**
 * The discussion on a card.
 *
 * Lifted out of TodoBoard when it grew past being a list of paragraphs. Three
 * things make it readable rather than merely present:
 *
 * 1. **An avatar rail.** The eye finds "who" from a coloured disc far faster
 *    than from an email address at the start of a line, which is what makes a
 *    thread of ten remarks skimmable at all.
 * 2. **Markdown.** People paste lists, links and code fragments into these.
 *    Rendered rather than shown raw — the app already ships a `Markdown`
 *    component for the AI panels, so this costs nothing new.
 * 3. **@mentions.** Resolved against the assignable users and rendered as a
 *    chip, so "ask @david" reads as a reference rather than as punctuation.
 *
 * Mentions do NOT notify anyone. That was a deliberate call — nothing in this
 * app sends mail yet, and a mention that looks like a notification and isn't is
 * worse than one that plainly is not. The chip is a link into that person's
 * work, and the board's "Mine" filter is how you find what is yours.
 *
 * A comment still posts on its own rather than joining the card's dirty-field
 * save: it is an event with an author and a time, so it must not be able to sit
 * unsaved in a form and vanish when someone presses Close.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { fmtAgo, fmtDate } from "@/lib/crm/format";
import type { CrmTodoComment } from "@/lib/crm/todos";
import { apiDelete, apiGet, apiPost } from "./api";
import { AttachButton, useAttachImages } from "./AttachImages";
import { ErrorNote, TextArea } from "./ui";
import type { BoardUser } from "./TodoBoard";

/**
 * A stable colour per person, from their address.
 *
 * Deterministic so the same person is the same colour on every card and in
 * every thread — which is the only thing that makes an avatar rail worth
 * having. Random-per-render would be pure noise.
 */
const AVATAR_TONES = [
  "bg-purple-500",
  "bg-blue-500",
  "bg-teal-500",
  "bg-green-600",
  "bg-orange-500",
  "bg-red-500",
  "bg-indigo-500",
  "bg-pink-500",
];

export function avatarTone(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function initialsFor(name: string | null | undefined, email: string): string {
  const source = name?.trim();
  if (source) {
    const parts = source.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function Avatar({
  email,
  name,
  size = "md",
  title,
}: {
  email: string;
  name?: string | null;
  size?: "sm" | "md";
  title?: string;
}) {
  return (
    <span
      title={title ?? name ?? email}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${avatarTone(
        email,
      )} ${size === "sm" ? "h-5 w-5 text-[0.6rem]" : "h-7 w-7 text-[0.65rem]"}`}
    >
      {initialsFor(name, email)}
    </span>
  );
}

/**
 * Turn `@someone` into a chip, leaving everything else for Markdown.
 *
 * Only matches addresses that resolve to a real user — an unmatched `@foo` is
 * left as plain text rather than being styled as a person who does not exist.
 * The local part is matched too, so `@david` finds `david@…` without anyone
 * having to type a full address into a comment box.
 */
function renderMentions(body: string, users: BoardUser[]): string {
  if (!users.length) return body;
  const byHandle = new Map<string, BoardUser>();
  for (const u of users) {
    byHandle.set(u.email.toLowerCase(), u);
    const local = u.email.split("@")[0]?.toLowerCase();
    if (local && !byHandle.has(local)) byHandle.set(local, u);
  }
  // Bolded rather than wrapped in HTML: the Markdown renderer is configured for
  // prose, and injecting raw HTML into it would mean trusting comment text.
  return body.replace(/@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g, (whole, handle) => {
    const user = byHandle.get(String(handle).toLowerCase());
    return user ? `**@${user.name?.trim() || user.email}**` : whole;
  });
}

export function CommentThread({
  todoId,
  viewer,
  users,
  onCount,
}: {
  todoId: string;
  viewer: string;
  users: BoardUser[];
  onCount: (count: number) => void;
}) {
  const [comments, setComments] = useState<CrmTodoComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const attach = useAttachImages({ value: draft, onChange: setDraft, fieldRef: box });

  const byEmail = useMemo(
    () => new Map(users.map((u) => [u.email.toLowerCase(), u])),
    [users],
  );

  useEffect(() => {
    let live = true;
    apiGet<CrmTodoComment[]>(`/api/crm/todos/${todoId}/comments`)
      .then((rows) => {
        if (!live) return;
        setComments(rows);
        onCount(rows.length);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setComments([]);
        setError(err instanceof Error ? err.message : "Could not load the discussion.");
      });
    // `live` guards the unmount race: closing the dialog before the fetch lands
    // would otherwise set state on a gone component.
    return () => {
      live = false;
    };
    // onCount is a fresh closure each render; depending on it would refetch the
    // thread on every keystroke in the parent form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoId]);

  async function post(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      const row = await apiPost<CrmTodoComment>(`/api/crm/todos/${todoId}/comments`, { body });
      const next = [...(comments ?? []), row];
      setComments(next);
      onCount(next.length);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post that.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(comment: CrmTodoComment) {
    if (!confirm("Delete this comment?")) return;
    setError("");
    try {
      await apiDelete(`/api/crm/todo-comments/${comment.id}`);
      const next = (comments ?? []).filter((c) => c.id !== comment.id);
      setComments(next);
      onCount(next.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that.");
    }
  }

  return (
    <section className="border-t border-ink-200 pt-4">
      <h4 className="mb-3 text-sm font-semibold text-ink-900">
        Comments
        {comments && comments.length > 0 && (
          <span className="ml-2 text-xs font-normal text-ink-600">{comments.length}</span>
        )}
      </h4>

      {error && <ErrorNote>{error}</ErrorNote>}

      {comments === null ? (
        <p className="sf-meta">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="sf-meta">No comments yet. Decisions made here stay with the card.</p>
      ) : (
        <ul className="mb-4 space-y-3">
          {comments.map((c, i) => {
            const user = byEmail.get(c.author_email.toLowerCase());
            const mine = c.author_email.toLowerCase() === viewer.toLowerCase();
            // Consecutive remarks by the same person lose the repeated header —
            // it is one person still talking, and re-stating their name every
            // paragraph is what makes a thread look like a form.
            const sameAsPrevious =
              i > 0 && comments[i - 1].author_email.toLowerCase() === c.author_email.toLowerCase();

            return (
              <li key={c.id} className="group flex gap-2.5">
                <div className="w-7 shrink-0">
                  {sameAsPrevious ? null : (
                    <Avatar email={c.author_email} name={user?.name} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {sameAsPrevious ? null : (
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-xs font-semibold text-ink-900">
                        {user?.name?.trim() || c.author_email}
                      </span>
                      {/* Relative reads fastest; the absolute date is what you
                          quote in a meeting. The title carries the full ISO. */}
                      <span className="text-[0.7rem] text-ink-500" title={c.created_at}>
                        {fmtAgo(c.created_at)} · {fmtDate(c.created_at)}
                      </span>
                      {mine && (
                        <button
                          type="button"
                          onClick={() => void remove(c)}
                          className="ml-auto rounded-full px-1.5 text-[0.7rem] text-ink-500 opacity-0 transition hover:text-err-700 focus:opacity-100 group-hover:opacity-100"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}

                  <div className="mt-1 rounded-2xl rounded-tl-sm border border-ink-200 bg-card-2 px-3 py-2 text-sm text-ink-800">
                    <Markdown>{renderMentions(c.body, users)}</Markdown>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={post} className="space-y-2">
        {attach.error ? <ErrorNote>{attach.error}</ErrorNote> : null}
        <TextArea
          ref={box}
          rows={3}
          value={draft}
          maxLength={5000}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={attach.onPaste}
          onDrop={attach.onDrop}
          {...attach.dragProps}
          className={attach.dragging ? "border-sf-400 ring-4 ring-sf-500/15" : ""}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter posts. Plain Enter is a newline here, unlike the
            // AI panel: a comment is usually more than one line, and losing a
            // half-written paragraph to a stray Return is unforgivable.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void post(e as unknown as React.FormEvent);
            }
          }}
          placeholder="Add a comment… Markdown works, @name mentions someone, and you can paste a screenshot."
          aria-label="Add a comment"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="sf-btn-brand"
            // An upload in flight blocks the post. The Markdown for that image
            // is not in the draft yet, so posting now would send a comment
            // missing the very thing it is about.
            disabled={busy || !draft.trim() || attach.uploading > 0}
          >
            {busy ? "Posting…" : "Comment"}
          </button>
          <AttachButton onPick={attach.pick} uploading={attach.uploading} />
          <span className="text-[0.7rem] text-ink-500">⌘↵ to post · paste or drop an image</span>
        </div>
      </form>
    </section>
  );
}
