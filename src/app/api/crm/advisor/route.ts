import { NextResponse } from "next/server";
import {
  getMessages,
  listConversations,
  sendAdvisorMessage,
  toPromptScope,
} from "@/lib/crm/advisor";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * A conversation is scoped to a client, a proposal, a contract, or to the
 * workspace as a whole (`global`).
 *
 * `client_id` is still accepted as shorthand for `scope_type=client`, because
 * the client card's Advisor tab sends it and there is no reason to break a
 * working caller to tidy a parameter name.
 */
function scopeFrom(source: { scope_type?: unknown; scope_id?: unknown; client_id?: unknown }) {
  if (source.client_id) return toPromptScope("client", source.client_id);
  return toPromptScope(source.scope_type, source.scope_id);
}

/** `?conversation_id=` for one thread's messages, otherwise the scope's threads. */
export const GET = withCrm(async (req) => {
  const sp = req.nextUrl.searchParams;
  const conversationId = sp.get("conversation_id");
  if (conversationId) {
    return NextResponse.json(await getMessages(conversationId));
  }
  return NextResponse.json(
    await listConversations(
      scopeFrom({
        scope_type: sp.get("scope_type"),
        scope_id: sp.get("scope_id"),
        client_id: sp.get("client_id"),
      }),
    ),
  );
});

export const POST = withCrm(async (req) => {
  const body = await readBody(req);
  const reply = await sendAdvisorMessage({
    scope: scopeFrom(body),
    conversationId: body.conversation_id ? String(body.conversation_id) : null,
    content: String(body.content ?? ""),
  });
  return NextResponse.json(reply);
});
