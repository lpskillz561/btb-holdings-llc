import { NextResponse } from "next/server";
import { addParkComment, listParkComments } from "@/lib/crm/portfolio";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrmParams<{ id: string }>(async (_req, { params }) =>
  NextResponse.json(await listParkComments(params.id)),
);

// The author is taken from the session, never from the body: a comment arguing
// against a purchase needs to be attributable to whoever actually made it.
export const POST = withCrmParams<{ id: string }>(async (req, { params, actor }) => {
  const body = await readBody(req);
  const row = await addParkComment(params.id, actor ?? "unknown", String(body.body ?? ""));
  return NextResponse.json(row, { status: 201 });
});
