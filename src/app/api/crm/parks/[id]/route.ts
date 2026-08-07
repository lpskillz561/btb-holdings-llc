import { NextResponse } from "next/server";
import { CrmError, queryOne } from "@/lib/crm/db";
import { PARKS, deleteRow } from "@/lib/crm/resource";
import { itemHandlers, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

const handlers = itemHandlers(PARKS);
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;

/**
 * Delete a park — in practice, throw away a saved listing nobody is pursuing.
 *
 * Not archived, unlike a proposal or a contract: those record where a document
 * stands and folding "archived" into a status would erase that a withdrawn one
 * had been accepted. A listing somebody pasted and the room dismissed carries no
 * such history, and `deleteRow` writes the deletion to the activity feed, so the
 * fact that it existed and was dropped survives.
 *
 * The guard is the part worth keeping: `crm_pads` cascades from this row and
 * `crm_units.pad_id` is ON DELETE SET NULL, so deleting a built-out park would
 * take its pads with it and quietly leave the homes standing on them attached to
 * nothing. That is not a thing to discover later, so it is refused here rather
 * than trusted to nobody pressing the button on the wrong row. Its comments DO
 * go with it, which is what the browser says before asking.
 */
export const DELETE = withCrmParams<{ id: string }>(async (_req, { actor, params }) => {
  const pads = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM crm_pads WHERE park_id = $1`,
    [params.id],
  );
  const count = pads?.n ?? 0;
  if (count > 0) {
    throw new CrmError(
      `That park has ${count} pad${count === 1 ? "" : "s"} on it. Remove them from the park page first — deleting it here would detach any home standing on them.`,
      409,
    );
  }
  await deleteRow(PARKS, params.id, actor);
  return new NextResponse(null, { status: 204 });
});
