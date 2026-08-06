"use client";

/**
 * Subtasks on a card.
 *
 * Each is a real row with its OWN ticket key from the shared sequence — BTB-58
 * under BTB-42, the way Jira does it, rather than BTB-42.1. That is what makes
 * a subtask something you can hand to someone and then refer to: "where are we
 * on 58" has to resolve to one thing.
 *
 * Ticking writes immediately. A subtask is one bit of state and the whole point
 * of the list is that it is quick — making it part of the card's dirty-field
 * save would mean the ticks are lost by pressing Close, which is the opposite of
 * what a checklist is for. The parent card's title and notes still batch, for
 * the reason set out in CardDialog.
 */

import { useState } from "react";
import { fmtAgo } from "@/lib/crm/format";
import { formatTicket } from "@/lib/crm/ticket";
import type { CrmSubtask } from "@/lib/crm/todos";
import { apiDelete, apiPatch, apiPost } from "./api";
import { Dropdown } from "./Dropdown";
import { ErrorNote } from "./ui";
import type { BoardUser } from "./TodoBoard";

export function SubtaskList({
  todoId,
  subtasks,
  users,
  viewer,
  onChange,
}: {
  todoId: string;
  subtasks: CrmSubtask[];
  users: BoardUser[];
  /** Signed-in email, used to stamp the optimistic "done by" before the
      server's own answer arrives. */
  viewer: string;
  /** The whole list back, so the parent can update its "2 of 5" badge. */
  onChange: (rows: CrmSubtask[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const person = (email: string | null) => (email ? byEmail.get(email.toLowerCase()) : undefined);
  const nameOf = (email: string | null) =>
    email ? (person(email)?.name?.trim() || email) : "Unassigned";

  const done = subtasks.filter((s) => s.done_at).length;

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const row = await apiPost<CrmSubtask>(`/api/crm/todos/${todoId}/subtasks`, { title: text });
      onChange([...subtasks, row]);
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(row: CrmSubtask, changes: Record<string, unknown>) {
    // Optimistic, rolled back with the reason if the server disagrees — the same
    // treatment the board gives a card move, and for the same reason: a tick
    // that waits for a round trip feels broken.
    //
    // `done` has to be TRANSLATED rather than spread. It is a boolean on the
    // wire and a nullable timestamp in the row, and the checkbox renders from
    // `done_at` — so spreading the request body onto the row set a `done`
    // property nothing reads and left the tick visibly unchanged until the
    // server answered. Which is exactly the latency this function exists to
    // hide. Found by driving the real board, not by tsc: both shapes typecheck.
    const optimistic: Partial<CrmSubtask> = { ...changes } as Partial<CrmSubtask>;
    if ("done" in changes) {
      delete (optimistic as Record<string, unknown>).done;
      optimistic.done_at = changes.done ? new Date().toISOString() : null;
      optimistic.done_by = changes.done ? viewer : null;
    }

    const before = subtasks;
    onChange(subtasks.map((s) => (s.id === row.id ? { ...s, ...optimistic } : s)));
    setError("");
    try {
      const saved = await apiPatch<CrmSubtask>(`/api/crm/subtasks/${row.id}`, changes);
      // Reconciled against the server's row, so the locally-guessed timestamp
      // is replaced by the real one rather than lingering.
      onChange(before.map((s) => (s.id === saved.id ? saved : s)));
    } catch (err) {
      onChange(before);
      setError(err instanceof Error ? err.message : "Could not save that.");
    }
  }

  async function remove(row: CrmSubtask) {
    const before = subtasks;
    onChange(subtasks.filter((s) => s.id !== row.id));
    setError("");
    try {
      await apiDelete(`/api/crm/subtasks/${row.id}`);
    } catch (err) {
      onChange(before);
      setError(err instanceof Error ? err.message : "Could not delete that.");
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-ink-900">
          Subtasks
          {subtasks.length > 0 && (
            <span className="ml-2 text-xs font-normal text-ink-600">
              {done} of {subtasks.length} done
            </span>
          )}
        </h4>
        {subtasks.length > 0 && (
          <div
            className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-200"
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={subtasks.length}
            aria-label="Subtask progress"
          >
            <div
              className="h-full rounded-full bg-ok-500 transition-[width] duration-300 ease-spring"
              style={{ width: `${(done / subtasks.length) * 100}%` }}
            />
          </div>
        )}
      </div>

      <ErrorNote>{error}</ErrorNote>

      <ul className="space-y-1">
        {subtasks.map((row) => {
          const isDone = Boolean(row.done_at);
          return (
            <li
              key={row.id}
              className="group flex items-center gap-2 rounded-pill px-2 py-1.5 transition hover:bg-card-2"
            >
              <input
                type="checkbox"
                checked={isDone}
                onChange={() => void patch(row, { done: !isDone })}
                aria-label={`Mark "${row.title}" ${isDone ? "not done" : "done"}`}
                className="h-4 w-4 shrink-0 accent-[rgb(var(--ok-500))]"
              />

              <span className="sf-num shrink-0 text-[0.7rem] font-semibold text-ink-500">
                {formatTicket(row.ticket_number)}
              </span>

              <span
                className={`min-w-0 flex-1 truncate text-sm ${
                  isDone ? "text-ink-500 line-through" : "text-ink-900"
                }`}
                title={row.title}
              >
                {row.title}
              </span>

              {isDone && row.done_by ? (
                <span className="shrink-0 text-[0.65rem] text-ink-500" title={`Done by ${row.done_by}`}>
                  {fmtAgo(row.done_at)}
                </span>
              ) : null}

              {/* Assigning is the reason subtasks are rows rather than a
                  markdown checklist, so the control is always visible rather
                  than hidden behind a hover. */}
              <Dropdown
                value={row.assignee ?? ""}
                onChange={(v) => void patch(row, { assignee: v || null })}
                aria-label={`Assign ${row.title}`}
                className="w-36 shrink-0"
                options={[
                  { value: "", label: "Unassigned" },
                  ...users.map((u) => ({
                    value: u.email,
                    label: u.name?.trim() || u.email,
                    hint: u.name?.trim() ? u.email : undefined,
                  })),
                ]}
              />

              <button
                type="button"
                onClick={() => void remove(row)}
                aria-label={`Delete ${formatTicket(row.ticket_number) ?? row.title}`}
                title="Delete subtask"
                className="shrink-0 rounded-full p-1 text-ink-400 opacity-0 transition hover:bg-err-50 hover:text-err-700 focus:opacity-100 group-hover:opacity-100"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      <form onSubmit={add} className="mt-2 flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a subtask…"
          maxLength={300}
          aria-label="New subtask"
          className="sf-input flex-1 text-sm"
        />
        <button type="submit" className="sf-btn-neutral shrink-0 text-xs" disabled={busy || !title.trim()}>
          Add
        </button>
      </form>

      {subtasks.length === 0 ? (
        <p className="mt-2 text-xs text-ink-500">
          Break the card down into steps someone can be given. Each gets its own ticket number.
        </p>
      ) : null}
    </section>
  );
}
