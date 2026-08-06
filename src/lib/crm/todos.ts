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
import { TAG_COLORS, TODO_STATUSES, type TagColor, type TodoStatus } from "./types";

export interface CrmTodo {
  id: string;
  /**
   * The ticket key's number — rendered `BTB-<n>` by lib/crm/ticket.ts.
   *
   * Nullable because the column is: a card inserted by hand, or one caught
   * between a deploy and the first request that runs the backfill, has none.
   * Every card written through `createTodo` has one.
   */
  ticket_number: number | null;
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
  /** Same treatment: rolled up in `listTodos` so a card can show "2 of 5". */
  subtask_count?: number;
  subtask_done_count?: number;
  /**
   * The card's tags, whole. Aggregated in `listTodos` rather than fetched per
   * card, because the board filters and colours on them and would otherwise
   * issue one query per card on every render.
   */
  tags?: CrmTag[];
}

export interface CrmTodoComment {
  id: string;
  todo_id: string;
  author_email: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface CrmTag {
  id: string;
  label: string;
  color: TagColor;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Present on `listTags` only: how many cards carry it. */
  usage_count?: number;
}

export interface CrmSubtask {
  id: string;
  ticket_number: number | null;
  todo_id: string;
  title: string;
  done_at: string | null;
  done_by: string | null;
  assignee: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, ticket_number, title, status, assignee, notes, done_at, created_by, done_by, created_at, updated_at";

const SUBTASK_COLUMNS =
  "id, ticket_number, todo_id, title, done_at, done_by, assignee, position, created_by, created_at, updated_at";

const TAG_COLUMNS = "id, label, color, created_by, created_at, updated_at";

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
  // Every rollup is a correlated subquery rather than a GROUP BY join, for the
  // same reason the comment count always was: it keeps crm_todos_board_idx
  // driving the ORDER BY, and a card with no comments/subtasks/tags still needs
  // its row, which an inner join would drop and three LEFT JOINs would multiply
  // out into a row per (comment x subtask x tag) that then has to be collapsed.
  //
  // The tags come back as JSON rather than as an array of ids, so the board can
  // colour a chip without a second lookup. `COALESCE(..., '[]')` matters: a
  // card with no tags would otherwise arrive as SQL NULL and every `.map` on
  // the client would need a guard.
  return query<CrmTodo>(
    `SELECT ${T_COLUMNS},
            (SELECT count(*)::int FROM crm_todo_comments c WHERE c.todo_id = t.id) AS comment_count,
            (SELECT count(*)::int FROM crm_todo_subtasks s WHERE s.todo_id = t.id) AS subtask_count,
            (SELECT count(*)::int FROM crm_todo_subtasks s
              WHERE s.todo_id = t.id AND s.done_at IS NOT NULL) AS subtask_done_count,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id', g.id, 'label', g.label, 'color', g.color,
                       'created_by', g.created_by,
                       'created_at', g.created_at, 'updated_at', g.updated_at)
                     ORDER BY lower(g.label))
                FROM crm_todo_tags tt
                JOIN crm_tags g ON g.id = tt.tag_id
               WHERE tt.todo_id = t.id
            ), '[]'::json) AS tags
     FROM crm_todos t
     ORDER BY t.status, t.created_at DESC
     LIMIT 500`,
  );
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

/** Longer than this is a sentence, not a label. */
const MAX_TAG_LABEL = 40;

function cleanTagLabel(value: unknown): string {
  // Inner whitespace collapsed, because "needs cpa" and "needs  cpa" reading as
  // two different tags is the classic way a tag list turns to noise.
  const label = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!label) throw new CrmError("Give the tag a name.", 400);
  if (label.length > MAX_TAG_LABEL) {
    throw new CrmError(`Tag names are limited to ${MAX_TAG_LABEL} characters.`, 400);
  }
  return label;
}

function cleanTagColor(value: unknown): TagColor {
  const color = String(value ?? "grey");
  return (TAG_COLORS as readonly string[]).includes(color) ? (color as TagColor) : "grey";
}

/**
 * Every tag, with how many cards carry it.
 *
 * The count is what makes the filter bar usable: it puts the tags actually in
 * use at the top and makes a typo-tag with one card obvious enough to be
 * cleaned up.
 */
export async function listTags(): Promise<CrmTag[]> {
  return query<CrmTag>(
    `SELECT ${TAG_COLUMNS.split(", ").map((c) => `g.${c}`).join(", ")},
            (SELECT count(*)::int FROM crm_todo_tags tt WHERE tt.tag_id = g.id) AS usage_count
     FROM crm_tags g
     ORDER BY lower(g.label)`,
  );
}

/**
 * Find a tag by label or create it.
 *
 * Case-insensitive, matching the unique index on `lower(label)`. The
 * find-then-insert is not a race in practice (one instance, one board) but the
 * `ON CONFLICT` makes it safe anyway and, more usefully, makes "add a tag that
 * already exists" a no-op that returns the existing row rather than a 409 the
 * UI would have to interpret.
 */
export async function upsertTag(
  label: unknown,
  color: unknown,
  actor: string,
): Promise<CrmTag> {
  const clean = cleanTagLabel(label);
  const existing = await queryOne<CrmTag>(
    `SELECT ${TAG_COLUMNS} FROM crm_tags WHERE lower(label) = lower($1)`,
    [clean],
  );
  if (existing) return existing;

  const now = nowIso();
  const rows = await query<CrmTag>(
    `INSERT INTO crm_tags (id, label, color, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (lower(label)) DO UPDATE SET updated_at = EXCLUDED.updated_at
     RETURNING ${TAG_COLUMNS}`,
    [newId(), clean, cleanTagColor(color), actor, now],
  );
  return rows[0];
}

/** Rename or recolour a tag. Renaming applies everywhere it is used, by design. */
export async function updateTag(
  id: string,
  patch: { label?: unknown; color?: unknown },
): Promise<CrmTag> {
  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, nowIso()];

  if (patch.label !== undefined) {
    params.push(cleanTagLabel(patch.label));
    sets.push(`label = $${params.length}`);
  }
  if (patch.color !== undefined) {
    params.push(cleanTagColor(patch.color));
    sets.push(`color = $${params.length}`);
  }

  const row = await queryOne<CrmTag>(
    `UPDATE crm_tags SET ${sets.join(", ")} WHERE id = $1 RETURNING ${TAG_COLUMNS}`,
    params,
  );
  if (!row) throw new CrmError("That tag no longer exists.", 404);
  return row;
}

/** Delete a tag everywhere. The join rows go with it via ON DELETE CASCADE. */
export async function deleteTag(id: string): Promise<void> {
  const rows = await query<{ id: string }>("DELETE FROM crm_tags WHERE id = $1 RETURNING id", [id]);
  if (rows.length === 0) throw new CrmError("That tag no longer exists.", 404);
}

/**
 * Put a tag on a card. Idempotent — tagging twice is not an error, it is what
 * happens when two people do it at once, or when someone double-clicks.
 */
export async function attachTag(todoId: string, tagId: string): Promise<void> {
  const card = await queryOne<{ id: string }>("SELECT id FROM crm_todos WHERE id = $1", [todoId]);
  if (!card) throw new CrmError("That card no longer exists.", 404);
  const tag = await queryOne<{ id: string }>("SELECT id FROM crm_tags WHERE id = $1", [tagId]);
  if (!tag) throw new CrmError("That tag no longer exists.", 404);

  const now = nowIso();
  await query(
    `INSERT INTO crm_todo_tags (todo_id, tag_id, created_at, updated_at)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (todo_id, tag_id) DO NOTHING`,
    [todoId, tagId, now],
  );
}

/** Take a tag off one card. The tag itself survives — see deleteTag. */
export async function detachTag(todoId: string, tagId: string): Promise<void> {
  await query("DELETE FROM crm_todo_tags WHERE todo_id = $1 AND tag_id = $2", [todoId, tagId]);
}

/** One card's tags, for the card dialog. */
export async function listTodoTags(todoId: string): Promise<CrmTag[]> {
  return query<CrmTag>(
    `SELECT ${TAG_COLUMNS.split(", ").map((c) => `g.${c}`).join(", ")}
       FROM crm_todo_tags tt JOIN crm_tags g ON g.id = tt.tag_id
      WHERE tt.todo_id = $1
      ORDER BY lower(g.label)`,
    [todoId],
  );
}

/* -------------------------------------------------------------------------- */
/* Subtasks                                                                    */
/* -------------------------------------------------------------------------- */

/** One card's subtasks, in hand-set order. */
export async function listSubtasks(todoId: string): Promise<CrmSubtask[]> {
  return query<CrmSubtask>(
    `SELECT ${SUBTASK_COLUMNS} FROM crm_todo_subtasks
      WHERE todo_id = $1 ORDER BY position, created_at`,
    [todoId],
  );
}

/**
 * Add a subtask.
 *
 * `position` defaults to the end of the list rather than 0, so adding three in a
 * row keeps the order they were typed in. Computed with a subquery in the same
 * statement rather than read-then-write, which would race two people adding at
 * once into the same position.
 *
 * The ticket number comes from the column DEFAULT (`nextval('crm_ticket_seq')`),
 * shared with the parent table — so a subtask is BTB-58, not BTB-42.1.
 */
export async function createSubtask(
  todoId: string,
  title: unknown,
  assignee: unknown,
  actor: string,
): Promise<CrmSubtask> {
  const card = await queryOne<{ id: string }>("SELECT id FROM crm_todos WHERE id = $1", [todoId]);
  if (!card) throw new CrmError("That card no longer exists.", 404);

  const now = nowIso();
  const rows = await query<CrmSubtask>(
    `INSERT INTO crm_todo_subtasks
       (id, todo_id, title, assignee, position, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4,
             COALESCE((SELECT max(position) + 1 FROM crm_todo_subtasks WHERE todo_id = $2), 0),
             $5, $6, $6)
     RETURNING ${SUBTASK_COLUMNS}`,
    [newId(), todoId, cleanTitle(title), cleanAssignee(assignee), actor, now],
  );
  return rows[0];
}

/**
 * Tick, untick, reword, reassign or reorder a subtask.
 *
 * `done` is a boolean on the way in and a timestamp in the table, the same
 * shape as the card's own status: unticking clears `done_at` AND `done_by`,
 * because a subtask that says it was finished by someone while sitting unticked
 * is a record that contradicts itself.
 */
export async function updateSubtask(
  id: string,
  patch: { title?: unknown; done?: unknown; assignee?: unknown; position?: unknown },
  actor: string,
): Promise<CrmSubtask> {
  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, nowIso()];

  if (patch.title !== undefined) {
    params.push(cleanTitle(patch.title));
    sets.push(`title = $${params.length}`);
  }
  if (patch.assignee !== undefined) {
    params.push(cleanAssignee(patch.assignee));
    sets.push(`assignee = $${params.length}`);
  }
  if (patch.position !== undefined) {
    const n = Number(patch.position);
    if (!Number.isFinite(n)) throw new CrmError("That is not a position.", 400);
    params.push(Math.trunc(n));
    sets.push(`position = $${params.length}`);
  }
  if (patch.done !== undefined) {
    if (patch.done) {
      // COALESCE so re-ticking an already-done subtask does not rewrite who
      // actually finished it.
      params.push(actor);
      sets.push("done_at = COALESCE(done_at, $2)", `done_by = COALESCE(done_by, $${params.length})`);
    } else {
      sets.push("done_at = NULL", "done_by = NULL");
    }
  }

  const row = await queryOne<CrmSubtask>(
    `UPDATE crm_todo_subtasks SET ${sets.join(", ")} WHERE id = $1 RETURNING ${SUBTASK_COLUMNS}`,
    params,
  );
  if (!row) throw new CrmError("That subtask no longer exists.", 404);
  return row;
}

export async function deleteSubtask(id: string): Promise<void> {
  const rows = await query<{ id: string }>(
    "DELETE FROM crm_todo_subtasks WHERE id = $1 RETURNING id",
    [id],
  );
  if (rows.length === 0) throw new CrmError("That subtask no longer exists.", 404);
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
  /**
   * Detail, optional. Added because the AI card suggester posts one — it
   * proposes a title AND the reasoning behind it — and without this parameter
   * the body was accepted, ignored and silently dropped, so every suggested
   * card arrived on the board stripped of the context that justified it.
   */
  notes?: unknown,
): Promise<CrmTodo> {
  const now = nowIso();
  const rows = await query<CrmTodo>(
    // `nextval` is written here rather than as a column DEFAULT, unlike the
    // subtask table. crm_todos already existed when ticket numbers arrived, so
    // its column had to be added nullable and backfilled — attaching a volatile
    // DEFAULT afterwards would have meant a second ALTER whose only job was to
    // change behaviour the code already controls. One place, visible.
    `INSERT INTO crm_todos (id, ticket_number, title, status, notes, created_by, created_at, updated_at)
     VALUES ($1, nextval('crm_ticket_seq'), $2, $3, $4, $5, $6, $6)
     RETURNING ${COLUMNS}`,
    [
      newId(),
      cleanTitle(title),
      status === undefined ? "todo" : cleanStatus(status),
      notes === undefined ? null : cleanNotes(notes),
      actor,
      now,
    ],
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
