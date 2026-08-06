"use client";

/**
 * The shared kanban board, at /crm/todos.
 *
 * One board for the whole office: everyone sees the same cards and everyone can
 * add, move, assign, annotate and delete them. There is no per-card owner in the
 * permission sense and no second permission model — reaching the CRM at all is
 * the permission. `assignee` says who is *doing* it, which is a different thing
 * from who may change it.
 *
 * Comments are the one narrower rule: anyone may add to a thread, and only the
 * author may delete their own remark. See deleteTodoComment.
 *
 * It lives on its own page rather than on the dashboard, where it was the only
 * editable block on a screen of read-only reporting and pushed the client list
 * below the fold. The dashboard now carries a short read-only list that links
 * here, and `?card=<id>` opens one card directly so that link can land on the
 * thing it named.
 *
 * Dragging is the HTML5 drag-and-drop API rather than a library. It is a
 * three-column board with no reordering inside a column, which that API handles
 * without the weight and the ownership a drag library brings.
 *
 * The arrow buttons are NOT a lesser fallback, they are the primary path for
 * everyone HTML5 drag leaves out: it does not fire on touch at all, so on a
 * phone the board would otherwise be read-only, and a drop target is unreachable
 * by keyboard. Both routes call the same move().
 *
 * Cards are not hand-orderable within a column — that needs a position column
 * and fractional indexing to survive two people dragging at once, which is a
 * bigger change than it looks. Newest first, per column.
 *
 * Every colour on the board comes from TONE below, keyed on status. Nothing
 * here hard-codes `sf-` any more: a card's spine, its column heading and its
 * move arrows all recolour together when it moves column, and adding a fourth
 * status is one entry in that map.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { AiSuggestCards } from "./AiSuggestCards";
import { AttachButton, useAttachImages } from "./AttachImages";
import { apiDelete, apiDeleteJson, apiGet, apiPatch, apiPost, qs } from "./api";
// The avatar is the SHARED one, hashed from the address, not a status-coloured
// chip. One person is one colour everywhere — on a card, in a thread, in the
// details panel — which is the only thing that makes an avatar worth reading.
// The card's status is already said by its spine and its column.
import { Avatar, CommentThread } from "./CommentThread";
import { Dropdown } from "./Dropdown";
import { SubtaskList } from "./SubtaskList";
import { TagChip, TagPicker } from "./TagChip";
import { formatTicket, parseTicket } from "@/lib/crm/ticket";
import { Dialog, ErrorNote, SectionHeading, TextArea } from "./ui";
import { fmtAgo, fmtDate } from "@/lib/crm/format";
import { LABELS, TODO_STATUSES, type TodoStatus } from "@/lib/crm/types";
import type { CrmSubtask, CrmTag, CrmTodo } from "@/lib/crm/todos";

export interface BoardUser {
  email: string;
  name: string | null;
}

/**
 * Status colour: To do blue, In progress amber, Done green.
 *
 * THE CARD ITSELF IS NEUTRAL NOW — a plain `bg-card` surface with a layered
 * shadow, and the status is a 3px coloured SPINE down its left edge. It used to
 * be a full tinted wash plus a heavy left border, which was legible from across
 * a room and also meant three different pastel fills stacked in three columns:
 * loud, and nothing like the rest of the app, which is white cards on a
 * recessed page. The spine is the Calendar/Reminders idiom — the object is the
 * material, the colour is a marker on it — and the status is still stated four
 * times over: the spine, the column's heading, its dot, and its count pill.
 *
 * In progress was GREY and could not stay grey. Grey is what "no state" looks
 * like, and the middle column is the one people actually scan. Amber reads as
 * "in flight" without competing with the brand indigo for the primary-action
 * slot.
 *
 * `lozenge` is the status pill in the card dialog, and it is a real control —
 * the `100` fill with `700` text, which is the app's badge convention and
 * clears contrast in both appearances.
 *
 * `title` is a treatment, not a colour: only Done has one. On the old tinted
 * fill it had to be `ink-700` to stay legible; on the neutral card `ink-600` is
 * ~4.9:1 on white and inverts correctly, and the strike-through is what says
 * "done" anyway.
 */
const TONE: Record<
  TodoStatus,
  {
    spine: string;
    dot: string;
    heading: string;
    count: string;
    title: string;
    lozenge: string;
    control: string;
    over: string;
  }
> = {
  todo: {
    spine: "bg-sf-500",
    dot: "bg-sf-500",
    heading: "text-sf-700",
    count: "bg-sf-100 text-sf-700",
    title: "text-ink-900",
    lozenge: "border-sf-200 bg-sf-100 text-sf-700 hover:bg-sf-200/70",
    control: "text-ink-400 hover:bg-sf-100 hover:text-sf-700",
    over: "bg-sf-50 ring-2 ring-inset ring-sf-300",
  },
  doing: {
    spine: "bg-warn-500",
    dot: "bg-warn-500",
    heading: "text-warn-700",
    count: "bg-warn-100 text-warn-700",
    title: "text-ink-900",
    lozenge: "border-warn-200 bg-warn-100 text-warn-700 hover:bg-warn-200/70",
    control: "text-ink-400 hover:bg-warn-100 hover:text-warn-700",
    over: "bg-warn-50 ring-2 ring-inset ring-warn-200",
  },
  done: {
    spine: "bg-ok-500",
    dot: "bg-ok-500",
    heading: "text-ok-700",
    count: "bg-ok-100 text-ok-700",
    title: "text-ink-600 line-through",
    lozenge: "border-ok-200 bg-ok-100 text-ok-700 hover:bg-ok-200/70",
    control: "text-ink-400 hover:bg-ok-100 hover:text-ok-700",
    over: "bg-ok-50 ring-2 ring-inset ring-ok-200",
  },
};

/**
 * The card's footer glyphs.
 *
 * Drawn, not typed. These were `≡`, `☑` and `💬` — and an emoji is rendered by
 * the OS in full colour at whatever weight it feels like, which on a card of
 * 11px grey metadata is the loudest thing on the board and the one element that
 * looks different on every machine in the office.
 */
const ICON: Record<"notes" | "subtasks" | "comments", string> = {
  notes: "M4 6h16M4 11h16M4 16h9",
  subtasks: "M4 7l2.5 2.5L11 5M4 17l2.5 2.5L11 15M14 8h6M14 18h6",
  comments: "M20 12a7 7 0 01-7 7H8l-4 3v-4.5A7 7 0 018 5h5a7 7 0 017 7z",
};

function Meta({
  icon,
  label,
  children,
}: {
  icon: keyof typeof ICON;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[0.7rem] text-ink-600" title={label}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ICON[icon]} />
      </svg>
      <span className="sr-only">{label}</span>
      {children}
    </span>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={dir === "left" ? "M14 6l-6 6 6 6" : "M10 6l6 6-6 6"} />
    </svg>
  );
}

/**
 * How the columns are ordered. Applied to all three at once — sorting one
 * column differently from its neighbours would make the board unreadable as a
 * left-to-right flow.
 */
type SortKey = "newest" | "oldest" | "ticket" | "title";

function label(person: BoardUser | undefined, email: string): string {
  return person?.name?.trim() || email;
}

export function TodoBoard({
  initial,
  users,
  viewer,
}: {
  initial: CrmTodo[];
  users: BoardUser[];
  /** Signed-in email, so the thread can offer delete only on your own remarks. */
  viewer: string;
}) {
  const [todos, setTodos] = useState<CrmTodo[]>(initial);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TodoStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // ---- The vocabulary, and the filters over it ----
  const [allTags, setAllTags] = useState<CrmTag[]>([]);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [who, setWho] = useState<string>(""); // "" = anyone, "@me", "@none", or an email
  const [sort, setSort] = useState<SortKey>("newest");

  const loadTags = useCallback(async () => {
    try {
      setAllTags(await apiGet<CrmTag[]>("/api/crm/tags"));
    } catch (err) {
      // The board must still work with no tag vocabulary loaded — the picker
      // just offers creation instead of a list — so this does not surface in
      // the UI. But it is LOGGED rather than swallowed: an empty `catch {}` here
      // is how an expired session came to look like one broken widget, because
      // this and the subtask load were failing at the same moment as the
      // comment thread and only the comment thread said so. `api.ts` raises the
      // global signal for a 401; this line is what makes anything else
      // diagnosable from the console.
      console.error("[board] tag vocabulary failed to load", err);
    }
  }, []);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  // `?card=<id>` opens a card straight from a link — how the dashboard list
  // gets you to the card you clicked rather than dumping you on the board.
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedCard = searchParams.get("card");
  useEffect(() => {
    if (linkedCard) setOpenId(linkedCard);
  }, [linkedCard]);

  function closeCard() {
    setOpenId(null);
    // Drop ?card= so a refresh, or a Back later, does not reopen the dialog.
    // replace, not push: the open dialog was never a separate history entry.
    if (linkedCard) router.replace("/crm/todos", { scroll: false });
  }

  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const openCount = todos.filter((t) => t.status !== "done").length;
  // Looked up in the FULL list, not the filtered one: a card opened from
  // `?card=` must still open when the current filter would hide it, or a link
  // from the dashboard silently does nothing.
  const open = todos.find((t) => t.id === openId) ?? null;

  /**
   * Search, filter, sort — applied to every column at once.
   *
   * A ticket key typed into the box is treated as a jump rather than as text:
   * "BTB-42", "btb 42", "#42" and a bare "42" all mean that one card. That is
   * the whole reason for having keys, and matching them as a substring instead
   * would return BTB-42, BTB-142 and BTB-420 together.
   */
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ticketQuery = parseTicket(q);
    const wanted = new Set(tagFilter);

    const matches = todos.filter((t) => {
      if (ticketQuery !== null) {
        if (t.ticket_number !== ticketQuery) return false;
      } else if (needle) {
        const haystack = [
          t.title,
          t.notes ?? "",
          ...(t.tags ?? []).map((g) => g.label),
          t.assignee ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }

      // AND across selected tags: picking two means "cards carrying both",
      // which is what narrowing is for. OR would widen as you click, which
      // reads as the filter not working.
      if (wanted.size) {
        const on = new Set((t.tags ?? []).map((g) => g.id));
        for (const id of wanted) if (!on.has(id)) return false;
      }

      if (who === "@me" && t.assignee?.toLowerCase() !== viewer.toLowerCase()) return false;
      if (who === "@none" && t.assignee) return false;
      if (who && who !== "@me" && who !== "@none" && t.assignee?.toLowerCase() !== who) return false;

      return true;
    });

    const sorted = [...matches];
    switch (sort) {
      case "oldest":
        sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case "ticket":
        sorted.sort((a, b) => (a.ticket_number ?? 0) - (b.ticket_number ?? 0));
        break;
      case "title":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return sorted;
  }, [todos, q, tagFilter, who, sort, viewer]);

  const filtering = Boolean(q.trim() || tagFilter.length || who);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const row = await apiPost<CrmTodo>("/api/crm/todos", { title: text });
      setTodos((rows) => [row, ...rows]);
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that.");
    } finally {
      setBusy(false);
    }
  }

  /** Optimistic patch, rolled back with the reason if the server disagrees. */
  async function patch(todo: CrmTodo, changes: Partial<CrmTodo>) {
    const before = todos;
    setTodos((rows) => rows.map((r) => (r.id === todo.id ? { ...r, ...changes } : r)));
    setError("");
    try {
      const saved = await apiPatch<CrmTodo>(`/api/crm/todos/${todo.id}`, changes);
      // Spread over the row we hold: a write returns the card without its
      // comment count (that is a read-time aggregate), and replacing wholesale
      // would blank the badge until the next full load.
      setTodos((rows) => rows.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)));
      return saved;
    } catch (err) {
      setTodos(before);
      setError(err instanceof Error ? err.message : "Could not save that.");
      return null;
    }
  }

  /** Keep the card badge in step when its thread grows or shrinks. */
  function setCommentCount(todoId: string, count: number) {
    setTodos((rows) => rows.map((r) => (r.id === todoId ? { ...r, comment_count: count } : r)));
  }

  async function move(todo: CrmTodo, status: TodoStatus) {
    if (todo.status === status) return;
    await patch(todo, { status });
  }

  async function remove(todo: CrmTodo) {
    const before = todos;
    if (openId === todo.id) closeCard();
    setTodos((rows) => rows.filter((r) => r.id !== todo.id));
    setError("");
    try {
      await apiDelete(`/api/crm/todos/${todo.id}`);
    } catch (err) {
      setTodos(before);
      setError(err instanceof Error ? err.message : "Could not delete that.");
    }
  }

  function onDrop(status: TodoStatus) {
    setOverColumn(null);
    const todo = todos.find((t) => t.id === dragId);
    setDragId(null);
    if (todo) void move(todo, status);
  }

  return (
    <div>
      <SectionHeading
        title="To do"
        count={openCount}
        action={<span className="sf-meta">Everyone can see and edit this board</span>}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Behind a press, never on mount — this is the screen the team opens
          every morning and a model call on every open is a bill and a wait. */}
      <AiSuggestCards
        onAdd={async (card) => {
          const row = await apiPost<CrmTodo>("/api/crm/todos", card);
          setTodos((rows) => [row, ...rows]);
        }}
      />

      <form onSubmit={add} className="sf-card mb-3 flex gap-2 p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add something the team needs to do…"
          maxLength={300}
          aria-label="New card"
          className="sf-input flex-1"
        />
        <button type="submit" className="sf-btn-brand shrink-0" disabled={busy || !title.trim()}>
          Add
        </button>
      </form>

      {/* ---- Search, filter, sort ---- */}
      <div className="sf-card mb-4 space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search BTB-42, a title, a tag…"
            aria-label="Search the board"
            className="sf-input max-w-xs flex-1"
          />
          <Dropdown
            value={who}
            onChange={setWho}
            aria-label="Filter by assignee"
            className="w-48"
            options={[
              { value: "", label: "Anyone" },
              { value: "@me", label: "Mine" },
              { value: "@none", label: "Unassigned" },
              ...users.map((u) => ({
                value: u.email.toLowerCase(),
                label: u.name?.trim() || u.email,
                hint: u.name?.trim() ? u.email : undefined,
              })),
            ]}
          />
          <Dropdown
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            aria-label="Sort cards"
            className="w-44"
            options={[
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
              { value: "ticket", label: "Ticket number" },
              { value: "title", label: "Title A–Z" },
            ]}
          />
          {filtering ? (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setTagFilter([]);
                setWho("");
              }}
              className="sf-btn-ghost text-xs"
            >
              Clear filters
            </button>
          ) : null}
          <span className="sf-meta ml-auto">
            {filtering ? `${visible.length} of ${todos.length}` : `${todos.length} cards`}
          </span>
        </div>

        {allTags.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {allTags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                size="xs"
                active={tagFilter.includes(tag.id)}
                onClick={() =>
                  setTagFilter((current) =>
                    current.includes(tag.id)
                      ? current.filter((id) => id !== tag.id)
                      : [...current, tag.id],
                  )
                }
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {TODO_STATUSES.map((status) => {
          const cards = visible.filter((t) => t.status === status);
          const index = TODO_STATUSES.indexOf(status);
          const prev = TODO_STATUSES[index - 1];
          const next = TODO_STATUSES[index + 1];
          return (
            <section
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                setOverColumn(status);
              }}
              onDragLeave={() => setOverColumn((c) => (c === status ? null : c))}
              onDrop={() => onDrop(status)}
              aria-label={`${LABELS.todoStatus[status]} column`}
              /* A RECESSED tray, not a card: the cards are the objects and the
                 column is the surface they sit on, so it steps back from the
                 page rather than lifting off it. `ink-200/40` is a step darker
                 than the page in light mode and a step lighter in dark, which
                 is what keeps "recessed" reading the same way in both.

                 The drop state REPLACES the fill rather than adding one beside
                 it. Two `bg-*` utilities on one element is a coin toss decided
                 by the order Tailwind happened to emit them in, not by the
                 order they are written here. */
              className={`rounded-2xl border border-ink-200/70 p-2.5 transition duration-200 ${
                overColumn === status ? TONE[status].over : "bg-ink-200/40"
              }`}
            >
              <h3 className="flex items-center gap-2 px-1.5 pb-2.5 pt-1">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${TONE[status].dot}`}
                />
                <span
                  className={`text-[0.7rem] font-bold uppercase tracking-[0.08em] ${TONE[status].heading}`}
                >
                  {LABELS.todoStatus[status]}
                </span>
                <span
                  className={`sf-num ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[0.7rem] font-bold ${TONE[status].count}`}
                >
                  {cards.length}
                </span>
              </h3>

              <ul className="space-y-2 empty:hidden">
                {cards.map((todo) => {
                  const person = todo.assignee ? byEmail.get(todo.assignee) : undefined;
                  return (
                    <li
                      key={todo.id}
                      draggable
                      onDragStart={() => setDragId(todo.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverColumn(null);
                      }}
                      /* The app's OWN card material, not a board-local
                         imitation of it: `.sf-card` for the surface and
                         `.sf-card-interactive` for the spring lift — which is
                         also where the `prefers-reduced-motion` override lives,
                         so an inlined copy of those utilities would have quietly
                         opted this screen out of it. `overflow-hidden` is what
                         lets the spine below be a flush rectangle and still take
                         the card's corners. */
                      className={`sf-card sf-card-interactive group relative overflow-hidden ${
                        dragId === todo.id ? "opacity-40 shadow-none" : ""
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`absolute inset-y-0 left-0 w-[3px] ${TONE[status].spine}`}
                      />

                      {/* The card body is the click target; the controls below
                          are not, so moving a card never opens it. */}
                      <button
                        type="button"
                        onClick={() => setOpenId(todo.id)}
                        className="block w-full cursor-grab px-3.5 pb-2 pt-2.5 text-left active:cursor-grabbing"
                      >
                        {/* The key sits ABOVE the title, the way Jira does it:
                            it is the card's name, and reading it should not mean
                            scanning to the end of a sentence. The assignee rides
                            on the same line, so the busy footer below is only
                            ever facts about the work. */}
                        <span className="flex items-start justify-between gap-2">
                          <span className="sf-num text-[0.68rem] font-semibold tracking-[0.04em] text-ink-600">
                            {formatTicket(todo.ticket_number)}
                          </span>
                          {todo.assignee && (
                            <Avatar
                              email={todo.assignee}
                              name={person?.name}
                              size="sm"
                              title={`Assigned to ${label(person, todo.assignee)}`}
                            />
                          )}
                        </span>

                        <p
                          className={`mt-1 text-[0.9375rem] font-medium leading-snug ${TONE[status].title}`}
                        >
                          {todo.title}
                        </p>

                        {todo.tags?.length ? (
                          <span className="mt-2 flex flex-wrap gap-1">
                            {todo.tags.map((tag) => (
                              <TagChip key={tag.id} tag={tag} size="xs" />
                            ))}
                          </span>
                        ) : null}

                        {/* Back to plain `.sf-meta`: the class is tuned for a
                            white card, which is what this is again. */}
                        <p className="sf-meta mt-2">
                          {status === "done"
                            ? `Done by ${todo.done_by ?? "someone"} ${fmtAgo(todo.done_at)}`
                            : `Added by ${todo.created_by ?? "someone"} ${fmtAgo(todo.created_at)}`}
                        </p>
                      </button>

                      {/* The footer is one hairline-separated strip: what the
                          card carries on the left, where it can go on the right.
                          The arrows stay VISIBLE rather than appearing on hover
                          — HTML5 drag does not fire on touch at all, so on a
                          phone these are the only way to move a card. */}
                      <div className="flex items-center gap-2.5 border-t border-ink-200/70 px-3.5 py-1.5">
                        {todo.notes && <Meta icon="notes" label="Has a description" />}
                        {(todo.subtask_count ?? 0) > 0 && (
                          <Meta
                            icon="subtasks"
                            label={`${todo.subtask_done_count ?? 0} of ${todo.subtask_count} subtasks done`}
                          >
                            <span className="sf-num">
                              {todo.subtask_done_count ?? 0}/{todo.subtask_count}
                            </span>
                          </Meta>
                        )}
                        {(todo.comment_count ?? 0) > 0 && (
                          <Meta
                            icon="comments"
                            label={`${todo.comment_count} comment${todo.comment_count === 1 ? "" : "s"}`}
                          >
                            <span className="sf-num">{todo.comment_count}</span>
                          </Meta>
                        )}

                        <span className="ml-auto flex items-center gap-0.5">
                          {prev && (
                            <button
                              type="button"
                              onClick={() => void move(todo, prev)}
                              aria-label={`Move "${todo.title}" to ${LABELS.todoStatus[prev]}`}
                              title={`Move to ${LABELS.todoStatus[prev]}`}
                              className={`rounded-full p-1 transition ${TONE[status].control}`}
                            >
                              <Chevron dir="left" />
                            </button>
                          )}
                          {next && (
                            <button
                              type="button"
                              onClick={() => void move(todo, next)}
                              aria-label={`Move "${todo.title}" to ${LABELS.todoStatus[next]}`}
                              title={`Move to ${LABELS.todoStatus[next]}`}
                              className={`rounded-full p-1 transition ${TONE[status].control}`}
                            >
                              <Chevron dir="right" />
                            </button>
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {cards.length === 0 && (
                <p className="rounded-card border border-dashed border-ink-300 px-1 py-6 text-center text-xs text-ink-500">
                  {filtering
                    ? "Nothing here matches."
                    : status === "todo"
                      ? "Nothing queued."
                      : "Drop a card here."}
                </p>
              )}
            </section>
          );
        })}
      </div>

      {open && (
        <CardDialog
          key={open.id}
          todo={open}
          users={users}
          viewer={viewer}
          allTags={allTags}
          onClose={closeCard}
          onSave={(changes) => patch(open, changes)}
          onDelete={() => void remove(open)}
          onCommentCount={(n) => setCommentCount(open.id, n)}
          onSubtaskCount={(total, done) =>
            setTodos((rows) =>
              rows.map((r) =>
                r.id === open.id
                  ? { ...r, subtask_count: total, subtask_done_count: done }
                  : r,
              ),
            )
          }
          onTagsChange={(tags) =>
            setTodos((rows) => rows.map((r) => (r.id === open.id ? { ...r, tags } : r)))
          }
          onTagsCreated={() => void loadTags()}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Card detail                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The expanded card, laid out as an issue view: the work down the left, the
 * facts about it in a Details panel down the right.
 *
 * WHAT BATCHES AND WHAT DOES NOT is the rule that governs this whole dialog,
 * and it is drawn on one line: **prose batches, everything else applies at
 * once.**
 *
 * Title and description are held locally and saved on submit. They are the two
 * fields people type paragraphs into, and a PATCH per keystroke would both
 * hammer the API and let two people editing the same card overwrite each other
 * mid-sentence. Everything else — status, assignee, tags, subtask ticks — is a
 * single click with an obvious result, and holding one of those behind a Save
 * button is how a change gets lost by pressing Close. The parent's patch is
 * optimistic, so they land instantly and roll back with a reason if the server
 * disagrees.
 *
 * COMMENTS are the strictest case. A comment posts on its own the moment it is
 * sent: it is an event with an author and a time, so it must not be able to sit
 * unsaved in a form, and it must not ride along with an unrelated title edit.
 *
 * The STATUS LOZENGE in the header is new, and it is the reason the dialog is
 * worth opening from a link. `?card=` lands you here from the dashboard, and
 * until now the only way to move the card you had just been sent to was to
 * close the dialog and find it on the board behind it.
 */
function CardDialog({
  todo,
  users,
  viewer,
  allTags,
  onClose,
  onSave,
  onDelete,
  onCommentCount,
  onSubtaskCount,
  onTagsChange,
  onTagsCreated,
}: {
  todo: CrmTodo;
  users: BoardUser[];
  viewer: string;
  /** The whole vocabulary, for the picker. */
  allTags: CrmTag[];
  onClose: () => void;
  onSave: (changes: Partial<CrmTodo>) => Promise<CrmTodo | null>;
  onDelete: () => void;
  onCommentCount: (count: number) => void;
  onSubtaskCount: (total: number, done: number) => void;
  /** This card's tags changed — the board re-renders its chips. */
  onTagsChange: (tags: CrmTag[]) => void;
  /** A tag was created here; the board adds it to the vocabulary. */
  onTagsCreated: () => void;
}) {
  const [title, setTitle] = useState(todo.title);
  const [notes, setNotes] = useState(todo.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Opens showing the description rather than a form full of it. A card with
  // notes is usually opened to READ them.
  const [preview, setPreview] = useState(Boolean(todo.notes?.trim()));
  const notesBox = useRef<HTMLTextAreaElement>(null);
  const attach = useAttachImages({ value: notes, onChange: setNotes, fieldRef: notesBox });

  const [subtasks, setSubtasks] = useState<CrmSubtask[]>([]);
  const [subtaskError, setSubtaskError] = useState("");
  const [tags, setTags] = useState<CrmTag[]>(todo.tags ?? []);
  const [tagError, setTagError] = useState("");

  const ticket = formatTicket(todo.ticket_number);

  // Subtasks are loaded when the card opens rather than with the board: most
  // cards are never opened, and 500 lists fetched to render a progress bar is
  // the wrong trade. The counts on the cards come from aggregates on the board
  // query — same reasoning as the comment thread.
  useEffect(() => {
    let live = true;
    apiGet<CrmSubtask[]>(`/api/crm/todos/${todo.id}/subtasks`)
      .then((rows) => live && setSubtasks(rows))
      .catch((err: unknown) => {
        // A failed subtask load must not stop someone reading the card, so this
        // is not fatal — but it is reported. Swallowing it silently is what let
        // a signed-out session read as "comments are broken": this list simply
        // rendered empty, which is indistinguishable from a card that has no
        // subtasks. See SessionWatch.tsx.
        if (!live) return;
        setSubtaskError(
          err instanceof Error ? err.message : "The subtasks could not be loaded.",
        );
      });
    return () => {
      live = false;
    };
  }, [todo.id]);

  // Someone else moved or edited this card while it was open.
  useEffect(() => {
    setTitle(todo.title);
    setNotes(todo.notes ?? "");
  }, [todo.title, todo.notes]);

  async function addTag(body: Record<string, unknown>) {
    setTagError("");
    try {
      const next = await apiPost<CrmTag[]>(`/api/crm/todos/${todo.id}/tags`, body);
      setTags(next);
      onTagsChange(next);
      // A brand-new tag has to reach the vocabulary too, or the picker will not
      // offer it on the next card until the page is reloaded.
      if (body.label) onTagsCreated();
    } catch (err) {
      setTagError(err instanceof Error ? err.message : "Could not add that tag.");
    }
  }

  async function removeTag(tag: CrmTag) {
    setTagError("");
    try {
      const next = await apiDeleteJson<CrmTag[]>(
        `/api/crm/todos/${todo.id}/tags${qs({ tag_id: tag.id })}`,
      );
      setTags(next);
      onTagsChange(next);
    } catch (err) {
      setTagError(err instanceof Error ? err.message : "Could not remove that tag.");
    }
  }

  const dirty =
    title.trim() !== todo.title || (notes.trim() || null) !== (todo.notes ?? null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setSaved(false);
    const row = await onSave({
      title: title.trim(),
      // null, not "", so the API clears the column rather than storing a blank.
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (row) {
      setSaved(true);
      // Back to the rendered form, which is where a saved description belongs
      // — and the only place a pasted image is actually visible.
      setPreview(Boolean(notes.trim()));
      window.setTimeout(() => setSaved(false), 2000);
    }
  }

  const reporter = todo.created_by
    ? users.find((u) => u.email.toLowerCase() === todo.created_by?.toLowerCase())
    : undefined;
  const tone = TONE[todo.status];

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      // The dialog is still NAMED by its key and its title — that is what a
      // screen reader announces on open, and "BTB-42" alone names a row rather
      // than a piece of work.
      title={ticket ? `${ticket} — ${todo.title}` : todo.title}
      titleContent={
        // A breadcrumb, the way an issue tracker heads its view: what kind of
        // thing this is, what it is called, and what state it is in — the last
        // of which is a control, not a caption.
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-grad-brand text-white shadow-glow"
            title="Task"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <span className="sf-num text-sm font-semibold tracking-[0.04em] text-ink-700">
            {ticket ?? "Card"}
          </span>
          <span aria-hidden className="text-ink-300">
            /
          </span>
          {/* The status control. It writes on choice rather than on a Save —
              see the rule at the top of this component. */}
          <Dropdown
            value={todo.status}
            onChange={(v) => void onSave({ status: v as TodoStatus })}
            aria-label="Status"
            className="shrink-0"
            triggerClassName={`inline-flex rounded-pill border px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-[0.06em] transition ${tone.lozenge}`}
            options={TODO_STATUSES.map((s) => ({
              value: s,
              label: LABELS.todoStatus[s],
            }))}
          />
        </div>
      }
    >
      {/* The issue-view shape: the work on the left, the facts about it on the
          right. One column below md — a two-up detail panel on a phone is
          neither of the two things it is trying to be. */}
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6">
          <form onSubmit={submit} className="space-y-4">
            {/* The title is the heading, not a boxed field. It is borderless
                until you touch it, which is what makes it read as the name of
                the thing rather than as the first row of a form. */}
            <input
              value={title}
              maxLength={300}
              aria-label="Task title"
              onChange={(e) => setTitle(e.target.value)}
              className="-mx-2 w-[calc(100%+1rem)] rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold leading-snug text-ink-900 outline-none transition hover:border-ink-300 hover:bg-card-2 focus:border-sf-400 focus:bg-card focus:ring-4 focus:ring-sf-500/15"
            />

            <div>
              {/* A real <label>, at heading weight — the section title and the
                  field's name are the same words, and splitting them into an
                  <h4> plus an aria-label leaves one of the two wrong. */}
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor="card-notes" className="text-sm font-semibold text-ink-900">
                  Description
                </label>
                {notes.trim() ? (
                  <button
                    type="button"
                    onClick={() => setPreview((p) => !p)}
                    className="sf-btn-ghost text-xs"
                  >
                    {preview ? "Edit" : "Preview"}
                  </button>
                ) : null}
              </div>

              {/* THE DESCRIPTION IS RENDERED, not just edited. It has always
                  been Markdown and was only ever shown inside a textarea, which
                  was survivable while it was prose and is not now that an image
                  can be pasted into it — `![](…)` in a monospaced box is not a
                  screenshot. Preview is the default whenever there is something
                  to look at, and the field is one click away. */}
              {preview ? (
                <div
                  onClick={() => setPreview(false)}
                  className="cursor-text rounded-card border border-transparent px-2 py-1.5 text-sm text-ink-800 transition hover:border-ink-200 hover:bg-card-2"
                  title="Click to edit"
                >
                  <Markdown>{notes}</Markdown>
                </div>
              ) : (
                <>
                  {attach.error ? <ErrorNote>{attach.error}</ErrorNote> : null}
                  <TextArea
                    ref={notesBox}
                    id="card-notes"
                    rows={6}
                    value={notes}
                    maxLength={5000}
                    placeholder="Context, links, what done looks like… paste a screenshot straight in."
                    onChange={(e) => setNotes(e.target.value)}
                    onPaste={attach.onPaste}
                    onDrop={attach.onDrop}
                    {...attach.dragProps}
                    className={attach.dragging ? "border-sf-400 ring-4 ring-sf-500/15" : ""}
                  />
                  <div className="mt-1.5">
                    <AttachButton onPick={attach.pick} uploading={attach.uploading} />
                  </div>
                </>
              )}
            </div>

            {/* Only present while there is something to do with it. A Save
                button that is disabled nine visits out of ten is furniture. */}
            {(dirty || saving || saved) && (
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="sf-btn-brand"
                  // An upload in flight blocks the save for the same reason it
                  // blocks a comment: the image's Markdown is not in the field
                  // yet, so saving now writes the description without it.
                  disabled={!dirty || saving || attach.uploading > 0}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                {dirty && !saving && (
                  <button
                    type="button"
                    className="sf-btn-ghost"
                    onClick={() => {
                      setTitle(todo.title);
                      setNotes(todo.notes ?? "");
                      setPreview(Boolean(todo.notes?.trim()));
                    }}
                  >
                    Cancel
                  </button>
                )}
                {saved && !dirty && <span className="sf-meta text-ok-700">Saved</span>}
              </div>
            )}
          </form>

          <div className="border-t border-ink-200 pt-4">
            {subtaskError ? <ErrorNote>{subtaskError}</ErrorNote> : null}
            <SubtaskList
              todoId={todo.id}
              subtasks={subtasks}
              users={users}
              viewer={viewer}
              onChange={(rows) => {
                setSubtasks(rows);
                // Keep the board's "2 of 5" badge in step without a refetch.
                onSubtaskCount(rows.length, rows.filter((s) => s.done_at).length);
              }}
            />
          </div>

          <CommentThread
            todoId={todo.id}
            viewer={viewer}
            users={users}
            onCount={onCommentCount}
          />
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-ink-200 bg-card-2">
            <p className="border-b border-ink-200 px-3.5 py-2 text-xs font-semibold text-ink-700">
              Details
            </p>
            <dl className="space-y-3.5 px-3.5 py-3.5">
              <DetailRow label="Assignee">
                {/* `aria-label`, not an htmlFor: the `dt` above is a term in a
                    definition list, and a <label> is not valid there. */}
                <Dropdown
                  id="card-assignee"
                  aria-label="Assignee"
                  value={todo.assignee ?? ""}
                  onChange={(v) => void onSave({ assignee: v || null })}
                  placeholder="Unassigned"
                  options={[
                    { value: "", label: "Unassigned" },
                    ...users.map((u) => ({
                      value: u.email,
                      label: u.name?.trim() || u.email,
                      hint: u.name?.trim() ? u.email : undefined,
                    })),
                  ]}
                />
              </DetailRow>

              {/* Tags write IMMEDIATELY, like the assignee and the status above
                  and the subtask ticks opposite. Only prose batches. */}
              <DetailRow label="Labels">
                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((tag) => (
                    <TagChip
                      key={tag.id}
                      tag={tag}
                      size="xs"
                      onRemove={() => void removeTag(tag)}
                    />
                  ))}
                  <TagPicker
                    all={allTags}
                    selected={tags}
                    onAdd={(tag) => void addTag({ tag_id: tag.id })}
                    onCreate={(label, color) => void addTag({ label, color })}
                  />
                </div>
                {tagError ? <p className="mt-1.5 text-xs text-err-700">{tagError}</p> : null}
              </DetailRow>

              <DetailRow label="Reporter">
                {todo.created_by ? (
                  <span className="flex items-center gap-2">
                    <Avatar email={todo.created_by} name={reporter?.name} size="sm" />
                    <span className="min-w-0 break-words">
                      {reporter?.name?.trim() || todo.created_by}
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-600">Unknown</span>
                )}
              </DetailRow>

              {todo.done_at && (
                <DetailRow label="Completed by">
                  <span className="break-words">{todo.done_by ?? "someone"}</span>
                  <span className="mt-0.5 block text-xs text-ink-500">
                    {fmtDate(todo.done_at)}
                  </span>
                </DetailRow>
              )}
            </dl>

            {/* The timestamps sit BELOW the panel's own rule, in the smallest
                type on the screen — the same place an issue tracker puts them,
                because they are what you check last and never edit. */}
            <p className="border-t border-ink-200 px-3.5 py-2 text-[0.7rem] text-ink-500">
              Created {fmtDate(todo.created_at)}
            </p>
          </div>

          <div className="flex gap-2">
            <button type="button" className="sf-btn-neutral flex-1" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="sf-btn-danger"
              onClick={() => {
                if (!confirm(`Delete "${todo.title}"? Its comments go with it.`)) return;
                onDelete();
                onClose();
              }}
            >
              Delete
            </button>
          </div>
        </aside>
      </div>
    </Dialog>
  );
}

/** One row of the Details panel: a quiet caps label over its value. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-ink-500">
        {label}
      </dt>
      <dd className="text-sm text-ink-900">{children}</dd>
    </div>
  );
}
