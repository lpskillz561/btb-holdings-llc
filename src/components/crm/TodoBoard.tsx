"use client";

/**
 * The shared to-do list on the dashboard.
 *
 * One list for the whole office: everyone sees the same items and everyone can
 * add, tick, reword and delete them. There is no per-item owner and no second
 * permission model — reaching the CRM at all is the permission.
 *
 * Ticking is optimistic. A checkbox that waits for a round trip before it moves
 * feels broken, and this is the one interaction people will do dozens of times
 * a day; if the request fails the item snaps back and the error says why.
 */

import { useState } from "react";
import { apiDelete, apiPatch, apiPost } from "./api";
import { ErrorNote, SectionHeading } from "./ui";
import { fmtAgo } from "@/lib/crm/format";
import type { CrmTodo } from "@/lib/crm/todos";

export function TodoBoard({ initial }: { initial: CrmTodo[] }) {
  const [todos, setTodos] = useState<CrmTodo[]>(initial);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const openCount = todos.filter((t) => !t.done_at).length;

  /** Keep the server's ordering rule — open first, newest first — locally. */
  function sorted(rows: CrmTodo[]): CrmTodo[] {
    return [...rows].sort((a, b) => {
      const open = Number(!b.done_at) - Number(!a.done_at);
      return open !== 0 ? open : b.created_at.localeCompare(a.created_at);
    });
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const row = await apiPost<CrmTodo>("/api/crm/todos", { title: text });
      setTodos((rows) => sorted([row, ...rows]));
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(todo: CrmTodo) {
    const done = !todo.done_at;
    const before = todos;
    // Optimistic: move it immediately, reconcile with the server's row after.
    setTodos((rows) =>
      sorted(
        rows.map((r) =>
          r.id === todo.id ? { ...r, done_at: done ? new Date().toISOString() : null } : r,
        ),
      ),
    );
    setError("");
    try {
      const saved = await apiPatch<CrmTodo>(`/api/crm/todos/${todo.id}`, { done });
      setTodos((rows) => sorted(rows.map((r) => (r.id === saved.id ? saved : r))));
    } catch (err) {
      setTodos(before);
      setError(err instanceof Error ? err.message : "Could not save that.");
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

  return (
    <div>
      <SectionHeading
        title="Shared to-do"
        count={openCount}
        action={<span className="sf-meta">Everyone can see and edit this list</span>}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="sf-card">
        <form onSubmit={add} className="flex gap-2 border-b border-ink-200 p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add something the team needs to do…"
            maxLength={300}
            aria-label="New to-do"
            className="sf-input flex-1"
          />
          <button type="submit" className="sf-btn-brand shrink-0" disabled={busy || !title.trim()}>
            Add
          </button>
        </form>

        {todos.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-600">
            Nothing on the list. Add the first thing above.
          </p>
        ) : (
          <ul>
            {todos.map((todo) => {
              const done = Boolean(todo.done_at);
              return (
                <li
                  key={todo.id}
                  className="group flex items-start gap-3 border-b border-ink-200 px-3 py-2.5 last:border-b-0 hover:bg-ink-100"
                >
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={() => void toggle(todo)}
                    aria-label={done ? `Reopen: ${todo.title}` : `Mark done: ${todo.title}`}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-sf-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm ${
                        done ? "text-ink-500 line-through" : "text-ink-900"
                      }`}
                    >
                      {todo.title}
                    </p>
                    <p className="sf-meta mt-0.5">
                      {done
                        ? `Done by ${todo.done_by ?? "someone"} ${fmtAgo(todo.done_at)}`
                        : `Added by ${todo.created_by ?? "someone"} ${fmtAgo(todo.created_at)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(todo)}
                    aria-label={`Delete: ${todo.title}`}
                    title="Delete"
                    className="shrink-0 rounded px-2 py-1 text-xs text-ink-500 opacity-0 transition hover:bg-err-100 hover:text-err-700 focus:opacity-100 group-hover:opacity-100"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
