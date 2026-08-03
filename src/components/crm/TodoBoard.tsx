"use client";

/**
 * The shared kanban board on the dashboard.
 *
 * One board for the whole office: everyone sees the same cards and everyone can
 * add, move, assign, annotate and delete them. There is no per-card owner in the
 * permission sense and no second permission model — reaching the CRM at all is
 * the permission. `assignee` says who is *doing* it, which is a different thing
 * from who may change it.
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
 */

import { useEffect, useState } from "react";
import { apiDelete, apiPatch, apiPost } from "./api";
import { Dialog, ErrorNote, SectionHeading, TextArea, TextInput } from "./ui";
import { fmtAgo, fmtDate } from "@/lib/crm/format";
import { LABELS, TODO_STATUSES, type TodoStatus } from "@/lib/crm/types";
import type { CrmTodo } from "@/lib/crm/todos";

export interface BoardUser {
  email: string;
  name: string | null;
}

/**
 * Column accent: To do blue, In progress grey, Done green.
 *
 * The rule carries the heading too, so the colour is legible to anyone reading
 * the words rather than only to whoever can tell two greys apart at a glance.
 */
const COLUMN_TONE: Record<TodoStatus, { rule: string; heading: string }> = {
  todo: { rule: "border-t-sf-500", heading: "text-sf-600" },
  doing: { rule: "border-t-ink-400", heading: "text-ink-600" },
  done: { rule: "border-t-ok-500", heading: "text-ok-700" },
};

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
}: {
  initial: CrmTodo[];
  users: BoardUser[];
}) {
  const [todos, setTodos] = useState<CrmTodo[]>(initial);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TodoStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const openCount = todos.filter((t) => t.status !== "done").length;
  const open = todos.find((t) => t.id === openId) ?? null;

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
      setTodos((rows) => rows.map((r) => (r.id === saved.id ? saved : r)));
      return saved;
    } catch (err) {
      setTodos(before);
      setError(err instanceof Error ? err.message : "Could not save that.");
      return null;
    }
  }

  async function move(todo: CrmTodo, status: TodoStatus) {
    if (todo.status === status) return;
    await patch(todo, { status });
  }

  async function remove(todo: CrmTodo) {
    const before = todos;
    setOpenId((id) => (id === todo.id ? null : id));
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
        title="Shared board"
        count={openCount}
        action={<span className="sf-meta">Everyone can see and edit this board</span>}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <form onSubmit={add} className="sf-card mb-4 flex gap-2 p-3">
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

      <div className="grid gap-4 md:grid-cols-3">
        {TODO_STATUSES.map((status) => {
          const cards = todos.filter((t) => t.status === status);
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
              className={`rounded border border-t-4 border-ink-200 ${COLUMN_TONE[status].rule} bg-ink-100/60 p-2 transition ${
                overColumn === status ? "bg-sf-50 ring-2 ring-sf-200" : ""
              }`}
            >
              <h3 className="flex items-baseline justify-between px-1 pb-2 pt-1">
                <span className={`text-sm font-bold ${COLUMN_TONE[status].heading}`}>
                  {LABELS.todoStatus[status]}
                </span>
                <span className="sf-meta">{cards.length}</span>
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
                      className={`group rounded border border-ink-200 bg-white ${
                        dragId === todo.id ? "opacity-40" : ""
                      }`}
                    >
                      {/* The card body is the click target; the controls below
                          are not, so moving a card never opens it. */}
                      <button
                        type="button"
                        onClick={() => setOpenId(todo.id)}
                        className="block w-full cursor-grab p-2.5 text-left active:cursor-grabbing"
                      >
                        <p
                          className={`text-sm ${
                            status === "done" ? "text-ink-500 line-through" : "text-ink-900"
                          }`}
                        >
                          {todo.title}
                        </p>
                        <p className="sf-meta mt-1">
                          {status === "done"
                            ? `Done by ${todo.done_by ?? "someone"} ${fmtAgo(todo.done_at)}`
                            : `Added by ${todo.created_by ?? "someone"} ${fmtAgo(todo.created_at)}`}
                        </p>
                        {(todo.assignee || todo.notes) && (
                          <p className="mt-1.5 flex items-center gap-1.5">
                            {todo.assignee && (
                              <span
                                title={label(person, todo.assignee)}
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sf-500 text-[0.6rem] font-bold text-white"
                              >
                                {initials(person, todo.assignee)}
                              </span>
                            )}
                            {todo.notes && (
                              <span className="sf-meta" title="Has notes">
                                ≡ notes
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
                            className="rounded px-1.5 py-0.5 text-xs text-ink-600 hover:bg-ink-100 hover:text-sf-600"
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
                            className="rounded px-1.5 py-0.5 text-xs text-ink-600 hover:bg-ink-100 hover:text-sf-600"
                          >
                            →
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setOpenId(todo.id)}
                          aria-label={`Open "${todo.title}"`}
                          className="ml-auto rounded px-1.5 py-0.5 text-xs text-ink-500 hover:bg-ink-100 hover:text-sf-600"
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
                  {status === "todo" ? "Nothing queued." : "Drop a card here."}
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
          onClose={() => setOpenId(null)}
          onSave={(changes) => patch(open, changes)}
          onDelete={() => void remove(open)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Card detail                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The expanded card: title, who it is assigned to, and the notes.
 *
 * Edits are held locally and saved on submit rather than on every keystroke.
 * Notes are the one field people will type paragraphs into, and a PATCH per
 * character would both hammer the API and let two people editing the same card
 * overwrite each other mid-sentence.
 */
function CardDialog({
  todo,
  users,
  onClose,
  onSave,
  onDelete,
}: {
  todo: CrmTodo;
  users: BoardUser[];
  onClose: () => void;
  onSave: (changes: Partial<CrmTodo>) => Promise<CrmTodo | null>;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(todo.title);
  const [assignee, setAssignee] = useState(todo.assignee ?? "");
  const [notes, setNotes] = useState(todo.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Someone else moved or edited this card while it was open.
  useEffect(() => {
    setTitle(todo.title);
    setAssignee(todo.assignee ?? "");
    setNotes(todo.notes ?? "");
  }, [todo.title, todo.assignee, todo.notes]);

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
    <Dialog open onClose={onClose} title={LABELS.todoStatus[todo.status]}>
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
          <label className="sf-label" htmlFor="card-assignee">
            Assigned to
          </label>
          <select
            id="card-assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="sf-input"
          >
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.email} value={u.email}>
                {u.name ? `${u.name} (${u.email})` : u.email}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="sf-label" htmlFor="card-notes">
            Notes and detail
          </label>
          <TextArea
            id="card-notes"
            rows={8}
            value={notes}
            maxLength={5000}
            placeholder="Context, links, what done looks like…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-ink-200 pt-3 text-xs text-ink-600">
          <dt>Added by</dt>
          <dd className="text-ink-800">
            {todo.created_by ?? "someone"} · {fmtDate(todo.created_at)}
          </dd>
          {todo.done_at && (
            <>
              <dt>Completed by</dt>
              <dd className="text-ink-800">
                {todo.done_by ?? "someone"} · {fmtDate(todo.done_at)}
              </dd>
            </>
          )}
        </dl>

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" className="sf-btn-brand" disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="sf-btn-neutral" onClick={onClose}>
            Close
          </button>
          {saved && <span className="sf-meta text-sf-600">Saved</span>}
          <button
            type="button"
            className="sf-btn-danger ml-auto"
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            Delete
          </button>
        </div>
      </form>
    </Dialog>
  );
}
