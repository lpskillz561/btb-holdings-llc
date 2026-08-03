// The shared kanban board on the dashboard.
//
// One board, visible and editable by everyone who can reach the CRM. There is
// no owner and no per-card permission: this is the office whiteboard, and a
// whiteboard nobody else can rub out is not a whiteboard.
//
// Written by hand rather than through ./resource because two of the columns
// must NOT come from the request body. `created_by` and `done_by` are stamped
// from the session, so "who finished this" is a fact rather than a claim the
// client made about itself.

import { CrmError, newId, nowIso, query, queryOne } from "./db";
import { TODO_STATUSES, type TodoStatus } from "./types";

export interface CrmTodo {
  id: string;
  title: string;
  status: TodoStatus;
  done_at: string | null;
  created_by: string | null;
  done_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, title, status, done_at, created_by, done_by, created_at, updated_at";

/** Longer than this is a note, not a card — and it has to fit in a column. */
const MAX_TITLE = 300;

function cleanTitle(value: unknown): string {
  const title = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!title) throw new CrmError("Enter what needs doing.", 400);
  if (title.length > MAX_TITLE) {
    throw new CrmError(`Keep it under ${MAX_TITLE} characters.`, 400);
  }
  return title;
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
  return query<CrmTodo>(
    `SELECT ${COLUMNS} FROM crm_todos ORDER BY status, created_at DESC LIMIT 500`,
  );
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
  patch: { title?: unknown; status?: unknown },
  actor: string,
): Promise<CrmTodo> {
  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, nowIso()];

  if (patch.title !== undefined) {
    params.push(cleanTitle(patch.title));
    sets.push(`title = $${params.length}`);
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
