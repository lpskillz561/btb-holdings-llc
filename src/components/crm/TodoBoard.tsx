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
 * here hard-codes `sf-` any more: a card, its avatar chip and its move arrows
 * all recolour together when it moves column, and adding a fourth status is one
 * entry in that map.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AiSuggestCards } from "./AiSuggestCards";
import { apiDelete, apiDeleteJson, apiGet, apiPatch, apiPost, qs } from "./api";
import { CommentThread } from "./CommentThread";
import { Dropdown } from "./Dropdown";
import { SubtaskList } from "./SubtaskList";
import { TagChip, TagPicker } from "./TagChip";
import { formatTicket, parseTicket } from "@/lib/crm/ticket";
import { Dialog, ErrorNote, SectionHeading, TextArea, TextInput } from "./ui";
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
 * THE WHOLE CARD carries it — fill, border and a heavy left rail — not just a
 * dot or a badge, so the state of the board is readable from across a room and
 * a card that has been dragged into the wrong column looks wrong immediately.
 *
 * In progress was GREY and could not stay grey. A grey wash on a card sitting
 * in a grey column (`bg-ink-100`) is the one status that would have read as
 * "no colour applied" rather than as a state, and the middle column is the one
 * people actually scan. Amber also reads as "in flight" without competing with
 * the brand indigo for the primary-action slot.
 *
 * The rule carries the column heading and its count too, so the colour is
 * legible to anyone reading the words rather than only to whoever can tell two
 * pale tints apart at a glance. Every fill here is a `50`, chosen so ink-900
 * body text still clears contrast on it — see the palette note in
 * `tailwind.config.ts`.
 *
 * `avatar` is deliberately the 600/700 and not the 500: white initials on
 * `warn-500` (#fe9339) is about 2.3:1, which is not a legible chip.
 */
const TONE: Record<
  TodoStatus,
  {
    rule: string;
    heading: string;
    count: string;
    card: string;
    title: string;
    avatar: string;
    control: string;
    over: string;
  }
> = {
  todo: {
    rule: "border-t-sf-500",
    heading: "text-sf-700",
    count: "bg-sf-100 text-sf-700",
    card: "border-ink-200 border-l-sf-500 bg-sf-50 hover:border-sf-200 hover:border-l-sf-500 hover:bg-sf-100",
    title: "text-sf-900",
    avatar: "bg-sf-600",
    control: "text-sf-700 hover:bg-card-2 hover:text-sf-800",
    over: "bg-sf-50 ring-2 ring-sf-300",
  },
  doing: {
    rule: "border-t-warn-500",
    heading: "text-warn-700",
    count: "bg-warn-100 text-warn-700",
    card: "border-ink-200 border-l-warn-500 bg-warn-50 hover:border-warn-200 hover:border-l-warn-500 hover:bg-warn-100",
    title: "text-ink-900",
    avatar: "bg-warn-700",
    control: "text-warn-700 hover:bg-card-2 hover:text-warn-700",
    over: "bg-warn-50 ring-2 ring-warn-200",
  },
  done: {
    rule: "border-t-ok-500",
    heading: "text-ok-700",
    count: "bg-ok-100 text-ok-700",
    card: "border-ink-200 border-l-ok-500 bg-ok-50 hover:border-ok-200 hover:border-l-ok-500 hover:bg-ok-100",
    // ink-500 was 2.86:1 on this fill. The strike-through is what says "done";
    // the grey does not also have to, and at ink-500 it stopped being legible.
    title: "text-ink-700 line-through",
    avatar: "bg-ok-700",
    control: "text-ok-700 hover:bg-card-2 hover:text-ok-700",
    over: "bg-ok-50 ring-2 ring-ok-200",
  },
};

/**
 * How the columns are ordered. Applied to all three at once — sorting one
 * column differently from its neighbours would make the board unreadable as a
 * left-to-right flow.
 */
type SortKey = "newest" | "oldest" | "ticket" | "title";

/** "David Belousov" -> DB; an email with no name -> its first two letters. */
function initials(person: BoardUser | undefined, email: string): string {
  const source = person?.name?.trim();
  if (source) {
    const parts = source.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

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
    } catch {
      // The board must still work with no tag vocabulary loaded — the picker
      // just offers creation instead of a list.
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
              className={`rounded border border-t-4 border-ink-200 ${TONE[status].rule} bg-ink-100/60 p-2 transition ${
                overColumn === status ? TONE[status].over : ""
              }`}
            >
              <h3 className="flex items-center justify-between px-1 pb-2 pt-1">
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${TONE[status].heading}`}
                >
                  {LABELS.todoStatus[status]}
                </span>
                <span
                  className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[0.7rem] font-bold ${TONE[status].count}`}
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
                      className={`group rounded border border-l-4 shadow-sm transition hover:shadow-md ${
                        TONE[status].card
                      } ${dragId === todo.id ? "opacity-40 shadow-none" : ""}`}
                    >
                      {/* The card body is the click target; the controls below
                          are not, so moving a card never opens it. */}
                      <button
                        type="button"
                        onClick={() => setOpenId(todo.id)}
                        className="block w-full cursor-grab p-2.5 text-left active:cursor-grabbing"
                      >
                        {/* The key sits ABOVE the title, the way Jira does it:
                            it is the card's name, and reading it should not mean
                            scanning to the end of a sentence. */}
                        <p className="sf-num mb-1 text-[0.7rem] font-bold tracking-wide text-ink-500">
                          {formatTicket(todo.ticket_number)}
                        </p>
                        <p className={`text-sm font-medium ${TONE[status].title}`}>{todo.title}</p>

                        {todo.tags?.length ? (
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {todo.tags.map((tag) => (
                              <TagChip key={tag.id} tag={tag} size="xs" />
                            ))}
                          </span>
                        ) : null}

                        {/* text-ink-700 over .sf-meta's ink-600: the class is
                            tuned for white cards, and on a tinted fill it falls
                            to ~4.2:1. Small text, so that is under AA. */}
                        <p className="sf-meta mt-1.5 text-ink-700">
                          {status === "done"
                            ? `Done by ${todo.done_by ?? "someone"} ${fmtAgo(todo.done_at)}`
                            : `Added by ${todo.created_by ?? "someone"} ${fmtAgo(todo.created_at)}`}
                        </p>
                        {(todo.assignee ||
                          todo.notes ||
                          (todo.comment_count ?? 0) > 0 ||
                          (todo.subtask_count ?? 0) > 0) && (
                          <p className="mt-1.5 flex items-center gap-1.5">
                            {todo.assignee && (
                              <span
                                title={label(person, todo.assignee)}
                                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[0.6rem] font-bold text-white ${TONE[status].avatar}`}
                              >
                                {initials(person, todo.assignee)}
                              </span>
                            )}
                            {todo.notes && (
                              <span className="sf-meta text-ink-700" title="Has notes">
                                ≡ notes
                              </span>
                            )}
                            {(todo.subtask_count ?? 0) > 0 && (
                              <span
                                className="sf-meta text-ink-700"
                                title={`${todo.subtask_done_count ?? 0} of ${todo.subtask_count} subtasks done`}
                              >
                                ☑ {todo.subtask_done_count ?? 0}/{todo.subtask_count}
                              </span>
                            )}
                            {(todo.comment_count ?? 0) > 0 && (
                              <span
                                className="sf-meta text-ink-700"
                                title={`${todo.comment_count} comment${todo.comment_count === 1 ? "" : "s"}`}
                              >
                                💬 {todo.comment_count}
                              </span>
                            )}
                          </p>
                        )}
                      </button>

                      <div className="flex items-center gap-1 px-2.5 pb-2">
                        {prev && (
                          <button
                            type="button"
                            onClick={() => void move(todo, prev)}
                            aria-label={`Move "${todo.title}" to ${LABELS.todoStatus[prev]}`}
                            title={`Move to ${LABELS.todoStatus[prev]}`}
                            className={`rounded px-1.5 py-0.5 text-xs ${TONE[status].control}`}
                          >
                            ←
                          </button>
                        )}
                        {next && (
                          <button
                            type="button"
                            onClick={() => void move(todo, next)}
                            aria-label={`Move "${todo.title}" to ${LABELS.todoStatus[next]}`}
                            title={`Move to ${LABELS.todoStatus[next]}`}
                            className={`rounded px-1.5 py-0.5 text-xs ${TONE[status].control}`}
                          >
                            →
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setOpenId(todo.id)}
                          aria-label={`Open "${todo.title}"`}
                          className={`ml-auto rounded px-1.5 py-0.5 text-xs ${TONE[status].control}`}
                        >
                          Details
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {cards.length === 0 && (
                <p className="px-1 py-4 text-center text-xs text-ink-500">
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
 * The expanded card: title, assignee, notes, and the comment thread.
 *
 * Edits to the FIELDS are held locally and saved on submit rather than on every
 * keystroke. Notes are the one field people will type paragraphs into, and a
 * PATCH per character would both hammer the API and let two people editing the
 * same card overwrite each other mid-sentence.
 *
 * COMMENTS DO NOT WORK THAT WAY, deliberately. A comment posts on its own the
 * moment it is sent and is never part of the dirty-field save: it is an event
 * with an author and a time, so it must not be able to sit unsaved in a form
 * and be lost when someone hits Close, and it must not ride along with an
 * unrelated title edit.
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
  const [assignee, setAssignee] = useState(todo.assignee ?? "");
  const [notes, setNotes] = useState(todo.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [subtasks, setSubtasks] = useState<CrmSubtask[]>([]);
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
      .catch(() => {
        // A failed subtask load must not stop someone reading the card.
      });
    return () => {
      live = false;
    };
  }, [todo.id]);

  // Someone else moved or edited this card while it was open.
  useEffect(() => {
    setTitle(todo.title);
    setAssignee(todo.assignee ?? "");
    setNotes(todo.notes ?? "");
  }, [todo.title, todo.assignee, todo.notes]);

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
    title.trim() !== todo.title ||
    (assignee || null) !== todo.assignee ||
    (notes.trim() || null) !== (todo.notes ?? null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setSaved(false);
    const row = await onSave({
      title: title.trim(),
      // null, not "", so the API clears the column rather than storing a blank.
      assignee: assignee || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (row) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      // The KEY is the title now, not the column. "BTB-42" is what someone says
      // out loud and what they came here to confirm; which column it is in is
      // already visible on the board behind the dialog.
      title={ticket ? `${ticket} · ${LABELS.todoStatus[todo.status]}` : LABELS.todoStatus[todo.status]}
    >
      {/* Jira's shape: the work on the left, the facts about it on the right.
          One column below md — a two-up detail panel on a phone is neither. */}
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 space-y-4">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="sf-label" htmlFor="card-title">
                Task
              </label>
              <TextInput
                id="card-title"
                value={title}
                maxLength={300}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="sf-label" htmlFor="card-notes">
                Notes and detail
              </label>
              <TextArea
                id="card-notes"
                rows={6}
                value={notes}
                maxLength={5000}
                placeholder="Context, links, what done looks like…"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <button type="submit" className="sf-btn-brand" disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              {saved && <span className="sf-meta text-sf-600">Saved</span>}
              {dirty && !saving && <span className="sf-meta">Unsaved changes</span>}
            </div>
          </form>

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

          <CommentThread
            todoId={todo.id}
            viewer={viewer}
            users={users}
            onCount={onCommentCount}
          />
        </div>

        <aside className="space-y-4 md:border-l md:border-ink-200 md:pl-6">
          <div>
            <label className="sf-label" htmlFor="card-assignee">
              Assigned to
            </label>
            <Dropdown
              id="card-assignee"
              value={assignee}
              onChange={setAssignee}
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
            <p className="sf-meta mt-1">Save to apply.</p>
          </div>

          {/* Tags write IMMEDIATELY rather than joining the dirty-field save.
              Adding one is a single click with an obvious result, and holding it
              behind a Save button is how a tag gets lost by pressing Close. The
              title and notes still batch — see the note on CardDialog. */}
          <div className="border-t border-ink-200 pt-3">
            <p className="sf-label">Tags</p>
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
          </div>

          <dl className="space-y-2 border-t border-ink-200 pt-3 text-xs text-ink-600">
            <div>
              <dt>Column</dt>
              <dd className="text-ink-800">{LABELS.todoStatus[todo.status]}</dd>
            </div>
            <div>
              <dt>Added by</dt>
              <dd className="break-words text-ink-800">
                {todo.created_by ?? "someone"}
                <span className="block text-ink-500">{fmtDate(todo.created_at)}</span>
              </dd>
            </div>
            {todo.done_at && (
              <div>
                <dt>Completed by</dt>
                <dd className="break-words text-ink-800">
                  {todo.done_by ?? "someone"}
                  <span className="block text-ink-500">{fmtDate(todo.done_at)}</span>
                </dd>
              </div>
            )}
          </dl>

          <div className="flex flex-col gap-2 border-t border-ink-200 pt-3">
            <button type="button" className="sf-btn-neutral" onClick={onClose}>
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
              Delete card
            </button>
          </div>
        </aside>
      </div>
    </Dialog>
  );
}
