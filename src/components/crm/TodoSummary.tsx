// The board, as a glance, on the dashboard.
//
// Read-only on purpose. The dashboard is reporting — figures the CRM computed
// about the book — and the full board was the one editable thing on it, which is
// why it had to be fenced off with rules top and bottom to stop it reading as
// more reporting. Moving the editing to /crm/todos lets this be what a dashboard
// entry should be: what is outstanding, and a way through to it.
//
// A server component. Nothing here changes without a navigation, so there is no
// reason to ship the board's state machine to the browser twice.

import Link from "next/link";
import { fmtAgo } from "@/lib/crm/format";
import { LABELS, type TodoStatus } from "@/lib/crm/types";
import type { CrmTodo } from "@/lib/crm/todos";

/** How many rows before the list stops being a glance. */
const SHOWN = 6;

const DOT: Record<TodoStatus, string> = {
  todo: "bg-sf-500",
  doing: "bg-warn-500",
  done: "bg-ok-500",
};

export function TodoSummary({ todos }: { todos: CrmTodo[] }) {
  // Done cards are the board's memory, not the dashboard's business: what is
  // still open is the only question this block answers.
  const open = todos.filter((t) => t.status !== "done");
  // In progress before queued — what is being worked on now is the more urgent
  // half of "what is outstanding". Ties keep the board's newest-first order.
  const ordered = [
    ...open.filter((t) => t.status === "doing"),
    ...open.filter((t) => t.status === "todo"),
  ];
  const shown = ordered.slice(0, SHOWN);

  return (
    <div className="sf-card">
      <div className="flex items-center justify-between gap-4 border-b border-ink-200 px-5 py-3">
        <h2 className="text-base font-semibold text-ink-900">
          To do
          {open.length > 0 && (
            <span className="ml-2 text-sm font-normal text-ink-600">{open.length} open</span>
          )}
        </h2>
        <Link href="/crm/todos" className="text-sm font-medium text-sf-600 hover:underline">
          Open board →
        </Link>
      </div>

      {shown.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-ink-600">
          Nothing outstanding.{" "}
          <Link href="/crm/todos" className="text-sf-600 hover:underline">
            Add a card
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-ink-200">
          {shown.map((todo) => (
            <li key={todo.id}>
              {/* Straight to the card, not just to the board: a list you click
                  that then makes you find the row again is a worse list. */}
              <Link
                href={`/crm/todos?card=${todo.id}`}
                className="flex items-start gap-3 px-5 py-2.5 transition hover:bg-sf-50"
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[todo.status]}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink-900">{todo.title}</span>
                  <span className="sf-meta mt-0.5 block">
                    {LABELS.todoStatus[todo.status]}
                    {todo.assignee ? ` · ${todo.assignee}` : " · unassigned"}
                    {` · ${fmtAgo(todo.created_at)}`}
                    {/* Words, not 💬. This is one line of 11px grey metadata
                        and a colour emoji is the loudest thing on the card —
                        rendered by the OS, so it also looks different on every
                        machine in the office. Same rule as the board's own
                        footer glyphs, which are drawn. */}
                    {(todo.comment_count ?? 0) > 0
                      ? ` · ${todo.comment_count} comment${todo.comment_count === 1 ? "" : "s"}`
                      : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {ordered.length > SHOWN && (
        <div className="border-t border-ink-200 px-5 py-2.5">
          <Link href="/crm/todos" className="text-sm text-sf-600 hover:underline">
            {ordered.length - SHOWN} more on the board →
          </Link>
        </div>
      )}
    </div>
  );
}
