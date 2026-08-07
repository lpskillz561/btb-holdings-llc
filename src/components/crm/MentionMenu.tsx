"use client";

/**
 * The `@` menu in the chat composer.
 *
 * Type `@` and a list appears; arrow keys move, Enter or Tab picks, Escape
 * dismisses. The same gesture as Slack, Teams, GitHub and every other place
 * these people type an `@`, which is the entire justification — nobody should
 * have to learn that this app's chat has an assistant in it and that `@ai` is
 * how you reach it. The menu says so the first time anyone types the character.
 *
 * ## What is deliberate here
 *
 * **The assistant is always first and always shown.** It is not filtered out by
 * a query that does not match it — typing `@sar` narrows to Sarah, but the
 * assistant stays visible while the query is empty or is a prefix of "ai" or
 * "assistant". Its row is violet with the ✦ mark, because in this app the violet
 * gradient means AI and nothing else, and "am I about to summon a model or
 * address a colleague" is exactly the distinction that must never need a second
 * look.
 *
 * **The list says what each mention DOES**, and the two are not the same thing.
 * `@ai` posts a question the assistant answers. A person's mention is bold text
 * in a message and nothing more — nothing in this app sends mail yet, so a
 * mention that looked like a notification would be a promise the app does not
 * keep. The footer says so once rather than repeating it on every row.
 *
 * **Enter is claimed while the menu is open.** In the composer Enter sends, and
 * that must not happen mid-selection: a half-typed `@sar` would be posted as a
 * message. The composer asks this component first — see `handleKeyDown` — and
 * only sends if the menu did not take the key.
 *
 * **The panel is `position: fixed`, placed from the textarea's rect**, the same
 * choice `InfoTip` and `Dropdown` make and for the same reason: the composer
 * sits inside the chat card's own borders and an absolutely-positioned menu
 * would be clipped by them. The cost is that scrolling has to close it, which is
 * fine here — the composer does not scroll under the reader.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "./CommentThread";
import type { BoardUser } from "./TodoBoard";

/** The assistant's own entry. Not a `BoardUser` — it has no account, and giving
 *  it one would put it in every assignee dropdown on the board. */
export const AI_MENTION = {
  handle: "ai",
  name: "Assistant",
  hint: "Ask the in-house assistant — it has read the memorandum and knows our deal",
};

export interface MentionTarget {
  /** What gets typed: `@` + this. */
  handle: string;
  name: string;
  email: string | null;
  hint: string;
  isAi: boolean;
}

/**
 * The `@word` the caret is currently inside, or null.
 *
 * Three conditions, and each rules out a real false positive:
 *
 * - The `@` must start the line or follow whitespace, so an email address typed
 *   into the box does not open a menu at its domain.
 * - The text between the `@` and the caret must have no whitespace in it. Once
 *   someone types a space the mention is finished, whether or not it matched.
 * - It caps at 32 characters, so a pasted paragraph containing an `@` does not
 *   scan backwards forever.
 */
export function mentionQueryAt(value: string, caret: number): { query: string; start: number } | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at < 0) return null;
  if (caret - at > 32) return null;
  const before = at === 0 ? "" : upto[at - 1];
  if (before && !/\s/.test(before)) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

/** Everyone `@` could mean, assistant first, filtered by what has been typed. */
export function mentionTargets(users: BoardUser[], query: string): MentionTarget[] {
  const q = query.trim().toLowerCase();

  const ai: MentionTarget = {
    handle: AI_MENTION.handle,
    name: AI_MENTION.name,
    email: null,
    hint: AI_MENTION.hint,
    isAi: true,
  };

  const people: MentionTarget[] = users.map((u) => {
    const local = u.email.split("@")[0];
    return {
      handle: local,
      name: u.name?.trim() || local,
      email: u.email,
      hint: u.email,
      isAi: false,
    };
  });

  const matches = (t: MentionTarget) =>
    !q ||
    t.handle.toLowerCase().startsWith(q) ||
    t.name.toLowerCase().includes(q) ||
    (t.email ? t.email.toLowerCase().startsWith(q) : false) ||
    // "assistant" finds the assistant even though the handle is "ai". People
    // reach for the word before they reach for the abbreviation.
    (t.isAi && "assistant".startsWith(q));

  return [ai, ...people].filter(matches);
}

const PANEL_WIDTH = 340;
const MARGIN = 12;

export function MentionMenu({
  targets,
  active,
  anchor,
  onPick,
  onHover,
}: {
  targets: MentionTarget[];
  /** Index into `targets`. Owned by the composer, because the composer owns the
   *  arrow keys — the textarea keeps focus throughout and this never takes it. */
  active: number;
  /** The textarea's rect. The menu opens above it, the way every chat app does:
   *  the composer sits at the bottom of the window and a menu below it would be
   *  off-screen. */
  anchor: DOMRect;
  onPick: (target: MentionTarget) => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the highlighted row visible when the arrow keys walk past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!targets.length) return null;

  const left = Math.max(
    MARGIN,
    Math.min(anchor.left, window.innerWidth - PANEL_WIDTH - MARGIN),
  );

  return (
    <div
      role="listbox"
      aria-label="Who to mention"
      style={{
        position: "fixed",
        // Anchored to the BOTTOM of the viewport-relative top of the composer,
        // so the list grows upward from a fixed edge and the row under the
        // cursor does not move as the list is filtered.
        bottom: window.innerHeight - anchor.top + 8,
        left,
        width: PANEL_WIDTH,
        zIndex: 60,
      }}
      className="overflow-hidden rounded-card border border-ink-200 bg-card shadow-pop"
    >
      <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
        {targets.map((t, i) => (
          <button
            key={t.isAi ? "ai" : t.email || t.handle}
            type="button"
            role="option"
            aria-selected={i === active}
            data-index={i}
            // `onMouseDown` with preventDefault, not `onClick`: a click would
            // first blur the textarea, and blurring the textarea is what closes
            // this menu — so the click would land on an element that had already
            // gone. preventDefault keeps focus in the composer throughout.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(t);
            }}
            onMouseEnter={() => onHover(i)}
            className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition ${
              i === active ? "bg-sf-100" : "hover:bg-ink-100/60"
            }`}
          >
            {t.isAi ? (
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-grad-ai text-xs text-white">
                ✦
              </span>
            ) : (
              <Avatar email={t.email || t.handle} name={t.name} />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5">
                <span className="truncate text-sm font-semibold text-ink-900">{t.name}</span>
                <span className="shrink-0 text-xs text-ink-500">@{t.handle}</span>
                {t.isAi && (
                  <span className="shrink-0 rounded-pill bg-grad-ai px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-white">
                    AI
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-[0.7rem] text-ink-500">{t.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="border-t border-ink-200 bg-card-2 px-2.5 py-1.5 text-[0.65rem] leading-relaxed text-ink-500">
        <span className="font-semibold text-ink-700">↑↓</span> to choose ·{" "}
        <span className="font-semibold text-ink-700">↵</span> to insert ·{" "}
        <span className="font-semibold text-ink-700">esc</span> to dismiss
        <br />
        {/* Said once, here, rather than on every row. A mention that looks like a
            notification and is not is worse than one that is plainly not. */}
        Only <span className="font-semibold text-ink-700">@ai</span> replies — mentioning a
        colleague highlights their name, it does not notify them.
      </div>
    </div>
  );
}

/**
 * Everything the composer needs to drive the menu.
 *
 * A hook rather than a self-contained widget because the textarea is not ours:
 * the composer owns the value, the caret and the Enter key, and a component that
 * reached in to manage all three would be a second owner of the draft. This
 * watches, computes and hands back a key handler; the composer decides.
 */
export function useMentionMenu({
  value,
  onChange,
  fieldRef,
  users,
}: {
  value: string;
  onChange: (next: string) => void;
  fieldRef: React.RefObject<HTMLTextAreaElement | null>;
  users: BoardUser[];
}) {
  const [state, setState] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  /** Set when Escape dismissed the menu for the CURRENT token, so it does not
   *  reopen on the very next keystroke inside the same word. Cleared as soon as
   *  the caret leaves that token. */
  const dismissed = useRef<number | null>(null);

  const targets = useMemo(
    () => (state ? mentionTargets(users, state.query) : []),
    [state, users],
  );

  const close = useCallback(() => {
    setState(null);
    setAnchor(null);
    setActive(0);
  }, []);

  /** Re-read the caret and decide whether the menu should be open. Called after
   *  every input, click and arrow key — anything that can move the caret. */
  const sync = useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    const found = mentionQueryAt(el.value, el.selectionStart ?? el.value.length);
    if (!found) {
      dismissed.current = null;
      close();
      return;
    }
    if (dismissed.current === found.start) return;
    dismissed.current = null;
    setState((prev) => {
      // Reset the highlight when the token CHANGES, not on every sync: holding
      // the selection while the list is re-filtered is what makes typing to
      // narrow feel stable rather than jumpy.
      if (!prev || prev.start !== found.start || prev.query !== found.query) setActive(0);
      return found;
    });
    setAnchor(el.getBoundingClientRect());
  }, [close, fieldRef]);

  // Scrolling has to close it, because a fixed panel cannot follow its anchor.
  // `capture`, because a scroll inside the message list does not bubble to the
  // window — the same trap `InfoTip` and `Dropdown` document.
  useEffect(() => {
    if (!state) return;
    const onScroll = () => close();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [state, close]);

  const pick = useCallback(
    (target: MentionTarget) => {
      const el = fieldRef.current;
      if (!el || !state) return;
      const caret = el.selectionStart ?? el.value.length;
      // A trailing space, so the next word is not swallowed into the mention —
      // and so `mentionsAi()` on the server, which is word-boundaried, matches.
      const inserted = `@${target.handle} `;
      const next = `${value.slice(0, state.start)}${inserted}${value.slice(caret)}`;
      const at = state.start + inserted.length;
      onChange(next);
      close();
      queueMicrotask(() => {
        el.focus();
        el.setSelectionRange(at, at);
      });
    },
    [close, fieldRef, onChange, state, value],
  );

  /**
   * The composer's keydown, first refusal.
   *
   * Returns true when the menu consumed the key, which is the composer's cue not
   * to send. Enter and Tab both pick — Tab because that is what an autocomplete
   * does everywhere else, and because someone who has arrowed to a name and
   * pressed Tab should not have their focus leave the box.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!state || !targets.length) return false;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActive((i) => (i + 1) % targets.length);
          return true;
        case "ArrowUp":
          event.preventDefault();
          setActive((i) => (i - 1 + targets.length) % targets.length);
          return true;
        case "Enter":
        case "Tab":
          event.preventDefault();
          pick(targets[Math.min(active, targets.length - 1)]);
          return true;
        case "Escape":
          event.preventDefault();
          dismissed.current = state.start;
          close();
          return true;
        default:
          return false;
      }
    },
    [active, close, pick, state, targets],
  );

  return {
    /** Render `<MentionMenu>` when this is set. */
    anchor: state ? anchor : null,
    targets,
    active,
    setActive,
    pick,
    sync,
    close,
    handleKeyDown,
    open: Boolean(state && targets.length && anchor),
  };
}
