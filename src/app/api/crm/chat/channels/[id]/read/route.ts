import { NextResponse } from "next/server";
import { markRead } from "@/lib/crm/chat";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

/** "I have seen everything up to here." Moves forward only — see markRead. */
export const POST = withCrmParams<{ id: string }>(async (req, { params, actor }) => {
  const body = await readBody(req);
  await markRead(params.id, actor, typeof body.at === "string" ? body.at : undefined);
  return new NextResponse(null, { status: 204 });
});
