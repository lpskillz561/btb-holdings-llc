// Rename, recolour or delete a tag — everywhere it is used.
//
// That reach is the point of a tag registry: fixing a typo in one place fixes
// it on every card, which a free-text array on the card could not do. It is
// also why DELETE is worth thinking about before pressing — it removes the tag
// from every card that carries it, via ON DELETE CASCADE on crm_todo_tags.

import { NextResponse } from "next/server";
import { deleteTag, updateTag } from "@/lib/crm/todos";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const PATCH = withCrmParams<{ id: string }>(async (req, { params }) => {
  const body = await readBody(req);
  return NextResponse.json(await updateTag(params.id, { label: body.label, color: body.color }));
});

export const DELETE = withCrmParams<{ id: string }>(async (_req, { params }) => {
  await deleteTag(params.id);
  return new NextResponse(null, { status: 204 });
});
