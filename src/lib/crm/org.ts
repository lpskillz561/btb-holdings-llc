/**
 * BTB's leadership chart — the rows behind `/crm/org`.
 *
 * Its own module rather than an entry in `resource.ts`, for the reason clients
 * are: the generic engine coerces and writes, and this table has a rule the
 * engine cannot express. `manager_id` is a self-reference, and a chart in which
 * A reports to B reports to A is not a chart — it is a renderer walking a loop
 * for ever. The guard is `wouldCycle` in `./org-layout`, which is the SAME
 * function the browser uses to draw the thing, so what saves and what draws
 * cannot disagree about what a loop is.
 *
 * Everything else here is deliberately ordinary: create, patch, delete, and one
 * whole-list operation to throw the hand-arrangement away.
 */

import {
  CrmError,
  buildInsert,
  buildUpdate,
  logActivity,
  newId,
  nowIso,
  num,
  query,
  queryOne,
  str,
} from "./db";
import { wouldCycle } from "./org-layout";
import type { CrmOrgPerson } from "./types";

/**
 * The columns a caller may write.
 *
 * `created_at` and `updated_at` are absent for the obvious reason. So is any
 * notion of a computed position: `pos_x`/`pos_y` are here because a dragged card
 * IS a single-row fact — unlike `crm_parks.sort_order`, where a position is
 * meaningless without the rows either side of it and the whole list is therefore
 * written at once. A coordinate on a canvas stands on its own.
 */
const WRITABLE = [
  "name",
  "title",
  "email",
  "manager_id",
  "photo_attachment_id",
  "pos_x",
  "pos_y",
  "sort_order",
  "notes",
] as const;

export interface OrgPersonInput {
  name?: unknown;
  title?: unknown;
  email?: unknown;
  manager_id?: unknown;
  photo_attachment_id?: unknown;
  pos_x?: unknown;
  pos_y?: unknown;
  sort_order?: unknown;
  notes?: unknown;
}

/** Whole pixels. A fractional coordinate would round differently in two browsers. */
const coord = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.max(0, Math.round(n));
};

function coerce(input: OrgPersonInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("name" in input) out.name = str(input.name);
  if ("title" in input) out.title = str(input.title);
  if ("email" in input) out.email = str(input.email)?.toLowerCase() ?? null;
  if ("manager_id" in input) out.manager_id = str(input.manager_id);
  if ("photo_attachment_id" in input) out.photo_attachment_id = str(input.photo_attachment_id);
  if ("pos_x" in input) out.pos_x = coord(input.pos_x);
  if ("pos_y" in input) out.pos_y = coord(input.pos_y);
  if ("sort_order" in input) {
    const n = num(input.sort_order);
    out.sort_order = n === null ? null : Math.round(n);
  }
  if ("notes" in input) out.notes = str(input.notes);
  return out;
}

/**
 * Everyone, in a stable order.
 *
 * Ordered by name rather than by the reporting structure: the chart derives its
 * own order from `manager_id` and `sort_order`, and this ordering is what the
 * "Reports to" picker and the sidebar list read. Sorting those by creation date
 * would make finding a colleague a scan rather than a look.
 */
export async function listOrgPeople(): Promise<CrmOrgPerson[]> {
  return query<CrmOrgPerson>(`SELECT * FROM crm_org_people ORDER BY name ASC, id ASC`);
}

async function getOrgPerson(id: string): Promise<CrmOrgPerson> {
  const row = await queryOne<CrmOrgPerson>(`SELECT * FROM crm_org_people WHERE id = $1`, [id]);
  if (!row) throw new CrmError("That person is not on the chart.", 404);
  return row;
}

/**
 * Reject a reporting line that does not exist or that closes a loop.
 *
 * Read-then-check rather than a database constraint, because Postgres has no
 * way to express "this foreign key must not be cyclic" short of a trigger, and
 * a trigger would be a second copy of a rule that already has to exist in
 * JavaScript for the renderer. The read is one small table.
 *
 * `personId` is null when creating: a new row cannot be its own ancestor, so
 * only the existence of the manager is checked.
 */
async function assertManagerOk(personId: string | null, managerId: string | null): Promise<void> {
  if (!managerId) return;

  const people = await listOrgPeople();
  if (!people.some((p) => p.id === managerId)) {
    throw new CrmError("That manager is no longer on the chart.", 400);
  }
  if (!personId) return;

  // Said separately, because the general message ("X already reports to this
  // person…") reads as nonsense when X *is* this person.
  if (managerId === personId) {
    throw new CrmError("Somebody cannot report to themselves.", 400);
  }
  if (wouldCycle(people, personId, managerId)) {
    const manager = people.find((p) => p.id === managerId);
    throw new CrmError(
      `${manager?.name ?? "That person"} already reports to this person, directly or through someone else. Two people cannot report to each other.`,
      400,
    );
  }
}

export async function createOrgPerson(
  input: OrgPersonInput,
  actor?: string | null,
): Promise<CrmOrgPerson> {
  const values = coerce(input);
  if (!values.name) throw new CrmError("A name is required.", 400);

  await assertManagerOk(null, (values.manager_id as string | null) ?? null);

  values.id = newId();
  values.created_at = nowIso();
  values.updated_at = values.created_at;

  const { sql, params } = buildInsert("crm_org_people", values);
  const [row] = await query<CrmOrgPerson>(sql, params);

  await logActivity({
    entity_type: "crm_org_people",
    entity_id: row.id,
    verb: "created",
    summary: `Added ${row.name}${row.title ? ` (${row.title})` : ""} to the org chart`,
    actor_email: actor,
  });
  return row;
}

export async function updateOrgPerson(
  id: string,
  input: OrgPersonInput,
  actor?: string | null,
): Promise<CrmOrgPerson> {
  const existing = await getOrgPerson(id);
  const patch = coerce(input);

  if ("manager_id" in patch) {
    await assertManagerOk(id, (patch.manager_id as string | null) ?? null);
  }

  const update = buildUpdate("crm_org_people", id, patch, WRITABLE);
  if (!update) return existing;
  const [row] = await query<CrmOrgPerson>(update.sql, update.params);

  // A drag is not worth a line in the activity feed. It happens dozens of times
  // while someone tidies the chart, it changes nothing about the company, and a
  // feed full of "Updated Sarah Chen" is a feed nobody reads for the entry that
  // says she now reports to someone else.
  const positionOnly = Object.keys(patch).every((k) => k === "pos_x" || k === "pos_y");
  if (!positionOnly) {
    await logActivity({
      entity_type: "crm_org_people",
      entity_id: id,
      verb: "updated",
      summary: `Updated ${row.name} on the org chart`,
      actor_email: actor,
    });
  }
  return row;
}

/**
 * Remove someone.
 *
 * Their reports are promoted to the top of the chart by the `ON DELETE SET NULL`
 * on the column — never deleted with them. The count comes back so the caller
 * can say what just happened rather than leaving someone to notice three cards
 * have moved.
 */
export async function deleteOrgPerson(
  id: string,
  actor?: string | null,
): Promise<{ promoted: number }> {
  const existing = await getOrgPerson(id);
  const reports = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM crm_org_people WHERE manager_id = $1`,
    [id],
  );
  await query(`DELETE FROM crm_org_people WHERE id = $1`, [id]);

  const promoted = reports[0]?.n ?? 0;
  await logActivity({
    entity_type: "crm_org_people",
    entity_id: id,
    verb: "deleted",
    summary:
      `Removed ${existing.name} from the org chart` +
      (promoted > 0
        ? `; ${promoted} direct report${promoted === 1 ? "" : "s"} now report to nobody`
        : ""),
    actor_email: actor,
  });
  return { promoted };
}

/**
 * Throw away every hand-placed position and go back to the automatic layout.
 *
 * The whole table at once, because that is what the button means. A per-card
 * "put this one back" would leave a chart that is half arranged and half
 * computed, which is the state that makes people think the drag did not save.
 */
export async function resetOrgLayout(actor?: string | null): Promise<{ reset: number }> {
  const rows = await query<{ id: string }>(
    `UPDATE crm_org_people
        SET pos_x = NULL, pos_y = NULL, updated_at = $1
      WHERE pos_x IS NOT NULL OR pos_y IS NOT NULL
      RETURNING id`,
    [nowIso()],
  );
  if (rows.length > 0) {
    await logActivity({
      entity_type: "crm_org_people",
      verb: "updated",
      summary: `Reset the org chart layout (${rows.length} card${rows.length === 1 ? "" : "s"})`,
      actor_email: actor,
    });
  }
  return { reset: rows.length };
}
