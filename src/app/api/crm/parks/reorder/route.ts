import { NextResponse } from "next/server";
import { reorderLandProspects } from "@/lib/crm/portfolio";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

/**
 * Save the hand-arranged order of the saved listings.
 *
 * Its own route rather than a PATCH field, because the operation is the whole
 * list at once: a position on one row says nothing without the rows either side
 * of it. Same reasoning as the meetings attach endpoint — one deliberate door
 * rather than a hole in the generic resource rules.
 */
export const POST = withCrm(async (req) => {
  const body = await readBody(req);
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map((id) => String(id)) : [];
  await reorderLandProspects(ids);
  return NextResponse.json({ ordered: ids.length });
});
