import { NextResponse } from "next/server";
import { createChannel, listChannels } from "@/lib/crm/chat";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

// Scoped to the reader, because the unread counts are.
export const GET = withCrm(async (_req, { actor }) =>
  NextResponse.json(await listChannels(actor)),
);

export const POST = withCrm(async (req, { actor }) => {
  const body = await readBody(req);
  const row = await createChannel({
    name: String(body.name ?? ""),
    topic: body.topic,
    createdBy: actor,
  });
  return NextResponse.json(row, { status: 201 });
});
