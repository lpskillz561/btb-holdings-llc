// Which tags are on one card.
//
// POST attaches, DELETE detaches. Detaching takes the tag off THIS card and
// leaves the tag itself alone — removing it from the vocabulary is
// DELETE /api/crm/tags/[id], which is a different and much larger action.
//
// POST accepts either an existing `tag_id` or a `label`, and creates the tag
// when given a label it has not seen. That is what lets the card dialog offer
// "type a tag and press enter" without a separate create step, which is the
// only way people actually tag things.

import { NextResponse } from "next/server";
import { attachTag, detachTag, listTodoTags, upsertTag } from "@/lib/crm/todos";
import { CrmError } from "@/lib/crm/db";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrmParams<{ id: string }>(async (_req, { params }) => {
  return NextResponse.json(await listTodoTags(params.id));
});

export const POST = withCrmParams<{ id: string }>(async (req, { params, actor }) => {
  const body = await readBody(req);

  let tagId = body.tag_id ? String(body.tag_id) : "";
  if (!tagId) {
    if (!body.label) throw new CrmError("Send a tag_id or a label.", 400);
    tagId = (await upsertTag(body.label, body.color, actor)).id;
  }

  await attachTag(params.id, tagId);
  // The card's whole tag set back, not just the one added — the dialog renders
  // the set, and returning one tag would make it reconstruct the rest.
  return NextResponse.json(await listTodoTags(params.id));
});

export const DELETE = withCrmParams<{ id: string }>(async (req, { params }) => {
  const tagId = req.nextUrl.searchParams.get("tag_id");
  if (!tagId) throw new CrmError("Which tag?", 400);
  await detachTag(params.id, tagId);
  return NextResponse.json(await listTodoTags(params.id));
});
