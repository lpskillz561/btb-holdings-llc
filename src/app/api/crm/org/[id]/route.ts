import { NextResponse } from "next/server";
import { deleteOrgPerson, updateOrgPerson } from "@/lib/crm/org";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

/**
 * One person on the chart.
 *
 * PATCH carries both kinds of edit: the details someone typed in the dialog, and
 * the `pos_x`/`pos_y` a drag produced. They go through one route because they
 * are one row, and `updateOrgPerson` is what decides that a pure move is not
 * worth an activity-feed entry.
 */
export const PATCH = withCrmParams<{ id: string }>(async (req, { actor, params }) => {
  const row = await updateOrgPerson(params.id, await readBody(req), actor);
  return NextResponse.json(row);
});

/**
 * Answers with a body rather than a 204, unlike most deletes here: the caller
 * needs to know how many people were left reporting to nobody so it can say so.
 */
export const DELETE = withCrmParams<{ id: string }>(async (_req, { actor, params }) => {
  return NextResponse.json(await deleteOrgPerson(params.id, actor));
});
