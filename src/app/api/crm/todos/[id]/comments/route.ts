import { NextResponse } from "next/server";
import { addTodoComment, listTodoComments } from "@/lib/crm/todos";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrmParams<{ id: string }>(async (_req, { params }) =>
  NextResponse.json(await listTodoComments(params.id)),
);

// The author comes from the session, never the body. A comment is worth having
// over another line of `notes` precisely because it says who wrote it and when,
// and a name taken from the request would be a claim rather than a fact.
export const POST = withCrmParams<{ id: string }>(async (req, { params, actor }) => {
  const body = await readBody(req);
  const row = await addTodoComment(params.id, actor ?? "unknown", body.body);
  return NextResponse.json(row, { status: 201 });
});
