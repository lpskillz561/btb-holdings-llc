// The tag vocabulary, shared by the whole board.
//
// POST is an UPSERT rather than a create: "add the tag `urgent`" from a card
// that has never seen it and from one that has are the same intent, and making
// the second a 409 would push the find-or-create decision into every caller.

import { NextResponse } from "next/server";
import { listTags, upsertTag } from "@/lib/crm/todos";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrm(async () => {
  return NextResponse.json(await listTags());
});

export const POST = withCrm(async (req, { actor }) => {
  const body = await readBody(req);
  const row = await upsertTag(body.label, body.color, actor);
  return NextResponse.json(row, { status: 201 });
});
