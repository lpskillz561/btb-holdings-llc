// Deleting one comment.
//
// A sibling of /api/crm/todos rather than nested under it, because a comment id
// identifies the row on its own — nesting it would put a card id in the URL that
// the handler has no reason to trust or check against.

import { NextResponse } from "next/server";
import { deleteTodoComment } from "@/lib/crm/todos";
import { withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

// Authorship is enforced in deleteTodoComment, not here: anyone may edit any
// card on this board, but nobody may delete a remark somebody else made.
export const DELETE = withCrmParams<{ id: string }>(async (_req, { params, actor }) => {
  await deleteTodoComment(params.id, actor);
  return new NextResponse(null, { status: 204 });
});
