// The shared to-do list on the dashboard.
//
// One list, visible and editable by everyone who can reach the CRM. There is no
// owner and no per-item permission: this is the office whiteboard, and a
// whiteboard nobody else can rub out is not a whiteboard.
//
// Written by hand rather than through ./resource because two of the columns
// must NOT come from the request body. `created_by` and `done_by` are stamped
// from the session, so "who ticked this off" is a fact rather than a claim the
// client made about itself.

import { CrmError, newId, nowIso, query, queryOne } from "./db";

export interface CrmTodo {
  id: string;
  title: string;
  done_at: string | null;
  created_by: string | null;
  done_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Longer than this is a note, not a to-do — and it has to fit a table cell. */
const MAX_TITLE = 300;

function cleanTitle(value: unknown): string {
  const title = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!title) throw new CrmError("Enter what needs doing.", 400);
  if (title.length > MAX_TITLE) {
    throw new CrmError(`Keep it under ${MAX_TITLE} characters.`, 400);
  }
  return title;
}

/**
 * Open items first, newest first within each group.
 *
 * Completed items stay on the list rather than vanishing — on a shared list the
 * value of a crossed-off line is that everyone can see it was done, and by whom.
 */
export async function listTodos(): Promise<CrmTodo[]> {
  return query<CrmTodo>(
    `SELECT id, title, done_at, created_by, done_by, created_at, updated_at
       FROM crm_todos
      ORDER BY (done_at IS NULL) DESC, created_at DESC
      LIMIT 500`,
  );
}

export async function createTodo(title: unknown, actor: string): Promise<CrmTodo> {
  const now = nowIso();
  const rows = await query<CrmTodo>(
    `INSERT INTO crm_todos (id, title, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)
     RETURNING id, title, done_at, created_by, done_by, created_at, updated_at`,
    [newId(), cleanTitle(title), actor, now],
  );
  return rows[0];
}

/**
 * Tick, un-tick, or reword an item.
 *
 * `done` absent leaves the state alone, matching the PATCH semantics used
 * everywhere else in this API: absent means "leave it", not "clear it".
 */
export async function updateTodo(
  id: string,
  patch: { title?: unknown; done?: unknown },
  actor: string,
): Promise<CrmTodo> {
  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, nowIso()];

  if (patch.title !== undefined) {
    params.push(cleanTitle(patch.title));
    sets.push(`title = $${params.length}`);
  }

  if (patch.done !== undefined) {
    if (patch.done) {
      // Stamp the ticker. Re-ticking an already-done item must not rewrite who
      // finished it, so only set these when it is currently open.
      params.push(actor);
      sets.push(`done_at = COALESCE(done_at, $2)`, `done_by = COALESCE(done_by, $${params.length})`);
    } else {
      sets.push("done_at = NULL", "done_by = NULL");
    }
  }

  const row = await queryOne<CrmTodo>(
    `UPDATE crm_todos SET ${sets.join(", ")} WHERE id = $1
     RETURNING id, title, done_at, created_by, done_by, created_at, updated_at`,
    params,
  );
  if (!row) throw new CrmError("That to-do no longer exists.", 404);
  return row;
}

export async function deleteTodo(id: string): Promise<void> {
  const rows = await query<{ id: string }>("DELETE FROM crm_todos WHERE id = $1 RETURNING id", [id]);
  if (rows.length === 0) throw new CrmError("That to-do no longer exists.", 404);
}
