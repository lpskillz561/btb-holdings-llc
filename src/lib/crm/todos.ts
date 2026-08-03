// The shared kanban board, at /crm/todos.
//
// One board, visible and editable by everyone who can reach the CRM. There is
// no owner and no per-card permission: this is the office whiteboard, and a
// whiteboard nobody else can rub out is not a whiteboard.
//
// Comments are the one exception to that (see deleteTodoComment): anyone may
// add to a thread and nobody may delete someone else's remark.
//
// Written by hand rather than through ./resource because two of the columns
// must NOT come from the request body. `created_by` and `done_by` are stamped
// from the session, so "who finished this" is a fact rather than a claim the
// client made about itself.

import { envUserEmails } from "@/lib/credentials";
import { CrmError, newId, nowIso, query, queryOne } from "./db";
import { TODO_STATUSES, type TodoStatus } from "./types";

export interface CrmTodo {
  id: string;
  title: string;
  status: TodoStatus;
  assignee: string | null;
  notes: string | null;
  done_at: string | null;
  created_by: string | null;
  done_by: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Comments on the card. Carried on the row by `listTodos` so the board can
   * badge a card without a query per card; absent on the row a write returns,
   * where the client already knows the count it is holding.
   */
  comment_count?: number;
}

export interface CrmTodoComment {
  id: string;
  todo_id: string;
  author_email: string;
  body: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, title, status, assignee, notes, done_at, created_by, done_by, created_at, updated_at";

/** Same as COLUMNS, qualified, for the join in listTodos. */
const T_COLUMNS = COLUMNS.split(", ").map((c) => `t.${c}`).join(", ");

/** A comment is a remark, not a document. Bounded so one cannot bloat a thread. */
const MAX_COMMENT = 5000;

/** Longer than this is a note, not a card — and it has to fit in a column. */
const MAX_TITLE = 300;

/** Detail, not an essay. Generous, but bounded so one card cannot bloat a page. */
const MAX_NOTES = 5000;

function cleanTitle(value: unknown): string {
  const title = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!title) throw new CrmError("Enter what needs doing.", 400);
  if (title.length > MAX_TITLE) {
    throw new CrmError(`Keep it under ${MAX_TITLE} characters.`, 400);
  }
  return title;
}

/** Explicit null clears the field; anything else is trimmed text. */
function cleanNotes(value: unknown): string | null {
  if (value === null) return null;
  const notes = String(value ?? "").trim();
  if (!notes) return null;
  if (notes.length > MAX_NOTES) {
    throw new CrmError(`Notes are limited to ${MAX_NOTES} characters.`, 400);
  }
  return notes;
}

function cleanAssignee(value: unknown): string | null {
  if (value === null) return null;
  const email = String(value ?? "").trim().toLowerCase();
  return email || null;
}

/**
 * Everyone who could be assigned a card.
 *
 * BOTH kinds of account, because there are two and the env kind is not a row:
 * `info@ziora.io` lives only in AUTH_USERS, so a list built from `portal_users`
 * alone would omit the person most likely to be assigned anything. Blocked
 * accounts are left out — they cannot sign in, so giving them work is a way to
 * lose it.
 */
export async function listAssignableUsers(): Promise<{ email: string; name: string | null }[]> {
  const rows = await query<{ email: string; name: string | null }>(
    "SELECT email, name FROM portal_users WHERE blocked_at IS NULL",
  );
  const byEmail = new Map<string, string | null>();
  for (const email of envUserEmails()) byEmail.set(email.toLowerCase(), null);
  for (const row of rows) byEmail.set(row.email.toLowerCase(), row.name);
  return [...byEmail.entries()]
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

function cleanStatus(value: unknown): TodoStatus {
  const status = String(value ?? "");
  if (!(TODO_STATUSES as readonly string[]).includes(status)) {
    throw new CrmError(`"${status}" is not a column on this board.`, 400);
  }
  return status as TodoStatus;
}

/**
 * The whole board in one query; the client groups it into columns.
 *
 * Ordered by column then newest-first, matching crm_todos_board_idx. Cards are
 * not hand-orderable within a column — see the note in TodoBoard.
 */
export async function listTodos(): Promise<CrmTodo[]> {
  // The comment count is a correlated subquery rather than a GROUP BY join: it
  // keeps crm_todos_board_idx driving the ORDER BY, and a card with no comments
  // still needs its row, which an inner join would drop.
  return query<CrmTodo>(
    `SELECT ${T_COLUMNS},
            (SELECT count(*)::int FROM crm_todo_comments c WHERE c.todo_id = t.id) AS comment_count
     FROM crm_todos t
     ORDER BY t.status, t.created_at DESC
     LIMIT 500`,
  );
}

/* -------------------------------------------------------------------------- */
/* Comments                                                                    */
/* -------------------------------------------------------------------------- */

/** One card's thread, oldest first — a conversation reads down. */
export async function listTodoComments(todoId: string): Promise<CrmTodoComment[]> {
  return query<CrmTodoComment>(
    `SELECT id, todo_id, author_email, body, created_at, updated_at
     FROM crm_todo_comments WHERE todo_id = $1 ORDER BY created_at ASC`,
    [todoId],
  );
}

/**
 * Add a comment.
 *
 * The author is the session, never the body: "who said this" is the entire
 * value of a comment over another line in `notes`, and a client-supplied name
 * would be a claim rather than a fact.
 */
export async function addTodoComment(
  todoId: string,
  authorEmail: string,
  body: unknown,
): Promise<CrmTodoComment> {
  const text = String(body ?? "").trim();
  if (!text) throw new CrmError("A comment cannot be empty.", 400);
  if (text.length > MAX_COMMENT) {
    throw new CrmError(`Comments are limited to ${MAX_COMMENT} characters.`, 400);
  }

  // Checked here so a comment on a deleted card is a clean 404 rather than a
  // foreign-key violation surfacing as a 400 with no useful message.
  const card = await queryOne<{ id: string }>("SELECT id FROM crm_todos WHERE id = $1", [todoId]);
  if (!card) throw new CrmError("That card no longer exists.", 404);

  const stamp = nowIso();
  const rows = await query<CrmTodoComment>(
    `INSERT INTO crm_todo_comments (id, todo_id, author_email, body, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     RETURNING id, todo_id, author_email, body, created_at, updated_at`,
    [newId(), todoId, authorEmail, text, stamp],
  );
  return rows[0];
}

/**
 * Delete a comment — only the person who wrote it may.
 *
 * Deliberately narrower than the board's own rule that anyone may edit any
 * card. A card is shared work; a comment is a thing someone said, and letting
 * one person quietly delete another's remark would make the thread untrustworthy
 * as a record of what was decided.
 */
export async function deleteTodoComment(commentId: string, actor: string): Promise<void> {
  const row = await queryOne<{ author_email: string }>(
    "SELECT author_email FROM crm_todo_comments WHERE id = $1",
    [commentId],
  );
  if (!row) throw new CrmError("That comment no longer exists.", 404);
  if (row.author_email.toLowerCase() !== actor.toLowerCase()) {
    throw new CrmError("Only the person who wrote a comment can delete it.", 403);
  }
  await query("DELETE FROM crm_todo_comments WHERE id = $1", [commentId]);
}

export async function createTodo(
  title: unknown,
  status: unknown,
  actor: string,
): Promise<CrmTodo> {
  const now = nowIso();
  const rows = await query<CrmTodo>(
    `INSERT INTO crm_todos (id, title, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     RETURNING ${COLUMNS}`,
    [newId(), cleanTitle(title), status === undefined ? "todo" : cleanStatus(status), actor, now],
  );
  return rows[0];
}

/**
 * Move a card between columns, or reword it.
 *
 * An absent key leaves that field alone, matching the PATCH semantics used
 * everywhere else in this API: absent means "leave it", not "clear it".
 */
export async function updateTodo(
  id: string,
  patch: { title?: unknown; status?: unknown; assignee?: unknown; notes?: unknown },
  actor: string,
): Promise<CrmTodo> {
  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, nowIso()];

  if (patch.title !== undefined) {
    params.push(cleanTitle(patch.title));
    sets.push(`title = $${params.length}`);
  }

  // Absent leaves it alone; explicit null unassigns / clears. Same PATCH
  // semantics as the rest of this API.
  if (patch.assignee !== undefined) {
    params.push(cleanAssignee(patch.assignee));
    sets.push(`assignee = $${params.length}`);
  }

  if (patch.notes !== undefined) {
    params.push(cleanNotes(patch.notes));
    sets.push(`notes = $${params.length}`);
  }

  if (patch.status !== undefined) {
    const status = cleanStatus(patch.status);
    params.push(status);
    sets.push(`status = $${params.length}`);
    if (status === "done") {
      // Stamp the finisher. COALESCE so that nudging an already-done card does
      // not rewrite who actually completed it.
      params.push(actor);
      sets.push("done_at = COALESCE(done_at, $2)", `done_by = COALESCE(done_by, $${params.length})`);
    } else {
      // Dragged back out of Done: the completion is no longer true, so the
      // record of it must go too, or the card claims it was finished by someone
      // while sitting in "In progress".
      sets.push("done_at = NULL", "done_by = NULL");
    }
  }

  const row = await queryOne<CrmTodo>(
    `UPDATE crm_todos SET ${sets.join(", ")} WHERE id = $1 RETURNING ${COLUMNS}`,
    params,
  );
  if (!row) throw new CrmError("That card no longer exists.", 404);
  return row;
}

export async function deleteTodo(id: string): Promise<void> {
  const rows = await query<{ id: string }>("DELETE FROM crm_todos WHERE id = $1 RETURNING id", [id]);
  if (rows.length === 0) throw new CrmError("That card no longer exists.", 404);
}
