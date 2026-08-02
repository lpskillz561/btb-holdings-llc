import { NextResponse } from "next/server";
import { getMessages, listConversations, sendAdvisorMessage } from "@/lib/crm/advisor";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";
export const maxDuration = 120;

/** `?conversation_id=` for one thread's messages, `?client_id=` for a client's threads. */
export const GET = withCrm(async (req) => {
  const sp = req.nextUrl.searchParams;
  const conversationId = sp.get("conversation_id");
  if (conversationId) {
    return NextResponse.json(await getMessages(conversationId));
  }
  return NextResponse.json(await listConversations(sp.get("client_id")));
});

export const POST = withCrm(async (req) => {
  const body = await readBody(req);
  const reply = await sendAdvisorMessage({
    clientId: body.client_id ? String(body.client_id) : null,
    conversationId: body.conversation_id ? String(body.conversation_id) : null,
    content: String(body.content ?? ""),
  });
  return NextResponse.json(reply);
});
