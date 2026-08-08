import { NextResponse } from "next/server";
import { resetOrgLayout } from "@/lib/crm/org";
import { withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

/**
 * Throw away every hand-placed card position.
 *
 * Its own route rather than a PATCH field, for the same reason the parks
 * reorder endpoint is one: the operation is the whole list at once, and there is
 * no per-row body that could express it. Same shape, opposite direction — that
 * one writes an arrangement, this one erases it.
 */
export const POST = withCrm(async (_req, { actor }) => {
  return NextResponse.json(await resetOrgLayout(actor));
});
