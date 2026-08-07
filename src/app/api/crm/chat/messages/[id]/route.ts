import { NextResponse } from "next/server";
import { deleteMessage, toggleReaction } from "@/lib/crm/chat";
import { publish } from "@/lib/crm/chat-bus";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

/** Toggle a reaction. POST rather than PUT because it is not idempotent. */
export const POST = withCrmParams<{ id: string }>(async (req, { params, actor }) => {
  const body = await readBody(req);
  const message = await toggleReaction({
    messageId: params.id,
    emoji: body.emoji,
    actor,
  });
  // An `update`, not a `message` — the browser replaces a row it already has
  // rather than appending a duplicate and scrolling the room.
  publish({ type: "update", channelId: message.channel_id, message });
  return NextResponse.json(message);
});

export const DELETE = withCrmParams<{ id: string }>(async (_req, { params, actor }) => {
  const channelId = await deleteMessage(params.id, actor);
  publish({ type: "delete", channelId, messageId: params.id });
  return new NextResponse(null, { status: 204 });
});
