"use client";

/**
 * The shared kanban board on the dashboard.
 *
 * One board for the whole office: everyone sees the same cards and everyone can
 * add, move, reword and delete them. There is no per-card owner and no second
 * permission model — reaching the CRM at all is the permission.
 *
 * Dragging is the HTML5 drag-and-drop API rather than a library. It is a
 * three-column board with no reordering inside a column, which that API handles
 * without the ~30kB and the ownership a drag library brings.
 *
 * The arrow buttons are NOT a lesser fallback, they are the primary path for
 * everyone HTML5 drag leaves out: it does not fire on touch at all, so on a
 * phone or an iPad the board would otherwise be read-only, and a drag target is
 * unreachable by keyboard. Both routes call the same move().
 *
 * Cards are not hand-orderable within a column — that needs a position column
 * and fractional indexing to survive two people dragging at once, which is a
 * bigger change than it looks. Newest first, per column.
 */

import { useState } from "react";
import { apiDelete, apiPatch, apiPost } from "./api";
import { ErrorNote, SectionHeading } from "./ui";
import { fmtAgo } from "@/lib/crm/format";
import { LABELS, TODO_STATUSES, type TodoStatus } from "@/lib/crm/types";
import type { CrmTodo } from "@/lib/crm/todos";

/** Column accent. Done is grey on purpose: finished work should recede. */
const COLUMN_TONE: Record<TodoStatus, string> = {
  todo: "border-t-ink-400",
  doing: "border-t-sf-500",
  done: "border-t-ink-300",
};

export function TodoBoard({ initial }: { initial: CrmTodo[] }) {
  const [todos, setTodos] = useState<CrmTodo[]>(initial);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TodoStatus | null>(null);

  const openCount = todos.filter((t) => t.status !== "done").length;
  const byStatus = (status: TodoStatus) => todos.filter((t) => t.status === status);

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

  /** Optimistic: the card lands in the new column before the round trip. */
  async function move(todo: CrmTodo, status: TodoStatus) {
    if (todo.status === status) return;
    const before = todos;
    setTodos((rows) => rows.map((r) => (r.id === todo.id ? { ...r, status } : r)));
    setError("");
    try {
      const saved = await apiPatch<CrmTodo>(`/api/crm/todos/${todo.id}`, { status });
      setTodos((rows) => rows.map((r) => (r.id === saved.id ? saved : r)));
    } catch (err) {
      setTodos(before);
      setError(err instanceof Error ? err.message : "Could not move that card.");
    }
  }

  async function remove(todo: CrmTodo) {
    const before = todos;
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
          const cards = byStatus(status);
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
              className={`rounded border border-t-4 border-ink-200 ${COLUMN_TONE[status]} bg-ink-100/60 p-2 transition ${
                overColumn === status ? "bg-sf-50 ring-2 ring-sf-200" : ""
              }`}
            >
              <h3 className="flex items-baseline justify-between px-1 pb-2 pt-1">
                <span className="text-sm font-bold text-ink-900">
                  {LABELS.todoStatus[status]}
                </span>
                <span className="sf-meta">{cards.length}</span>
              </h3>

              <ul className="space-y-2 empty:hidden">
                {cards.map((todo) => {
                  const index = TODO_STATUSES.indexOf(status);
                  const prev = TODO_STATUSES[index - 1];
                  const next = TODO_STATUSES[index + 1];
                  return (
                    <li
                      key={todo.id}
                      draggable
                      onDragStart={() => setDragId(todo.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverColumn(null);
                      }}
                      className={`group cursor-grab rounded border border-ink-200 bg-white p-2.5 active:cursor-grabbing ${
                        dragId === todo.id ? "opacity-40" : ""
                      }`}
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

                      <div className="mt-1.5 flex items-center gap-1">
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
                          onClick={() => void remove(todo)}
                          aria-label={`Delete "${todo.title}"`}
                          title="Delete"
                          className="ml-auto rounded px-1.5 py-0.5 text-xs text-ink-500 opacity-0 transition hover:bg-err-100 hover:text-err-700 focus:opacity-100 group-hover:opacity-100"
                        >
                          Delete
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
    </div>
  );
}
