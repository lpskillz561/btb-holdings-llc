// The client-scoped AI advisor.
//
// Same model and key as the rest of the site; what differs is that the system
// prompt is rebuilt from the client's record on EVERY turn rather than being
// baked into the conversation when it started. Records change mid-conversation
// — a unit gets placed in service, a proposal is accepted — and an advisor
// answering from a stale snapshot of the account is worse than no advisor.

import { CrmError, newId, nowIso, query, queryOne } from "./db";
import { MODEL, buildSystemPrompt, getOpenAI, isAiConfigured } from "./ai";
import type { CrmConversation, CrmMessage } from "./types";

/** Turns of history replayed to the model. Older turns stay in the DB and in the UI. */
const HISTORY_LIMIT = 24;

export async function listConversations(clientId: string | null): Promise<CrmConversation[]> {
  return clientId
    ? query<CrmConversation>(
        `SELECT * FROM crm_conversations WHERE scope_type = 'client' AND scope_id = $1
         ORDER BY updated_at DESC LIMIT 50`,
        [clientId],
      )
    : query<CrmConversation>(
        `SELECT * FROM crm_conversations WHERE scope_type = 'global'
         ORDER BY updated_at DESC LIMIT 50`,
      );
}

export async function getMessages(conversationId: string): Promise<CrmMessage[]> {
  return query<CrmMessage>(
    `SELECT * FROM crm_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId],
  );
}

async function createConversation(
  clientId: string | null,
  firstMessage: string,
): Promise<CrmConversation> {
  const id = newId();
  const ts = nowIso();
  // Title from the opening question — enough to tell threads apart in a list.
  const title = firstMessage.trim().slice(0, 70) || "New conversation";
  const row = await queryOne<CrmConversation>(
    `INSERT INTO crm_conversations (id, scope_type, scope_id, title, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
    [id, clientId ? "client" : "global", clientId, title, ts],
  );
  if (!row) throw new CrmError("Could not start the conversation.", 500);
  return row;
}

async function addMessage(
  conversationId: string,
  role: CrmMessage["role"],
  content: string,
): Promise<CrmMessage> {
  const row = await queryOne<CrmMessage>(
    `INSERT INTO crm_messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [newId(), conversationId, role, content, nowIso()],
  );
  if (!row) throw new CrmError("Could not save the message.", 500);
  return row;
}

export interface AdvisorReply {
  conversation: CrmConversation;
  messages: CrmMessage[];
}

/**
 * Send one turn and get the whole thread back.
 *
 * The user's message is persisted BEFORE the model call, so a failed or slow
 * completion never loses what they typed — retrying replays the same thread
 * rather than starting from nothing.
 */
export async function sendAdvisorMessage(args: {
  clientId: string | null;
  conversationId: string | null;
  content: string;
}): Promise<AdvisorReply> {
  if (!isAiConfigured()) {
    throw new CrmError(
      "The AI advisor is unavailable: OPENAI_API_KEY is not set on the web service.",
      503,
    );
  }
  const content = args.content?.trim();
  if (!content) throw new CrmError("Type a question first.", 400);

  let conversation: CrmConversation | null = null;
  if (args.conversationId) {
    conversation = await queryOne<CrmConversation>(
      `SELECT * FROM crm_conversations WHERE id = $1`,
      [args.conversationId],
    );
    if (!conversation) throw new CrmError("Conversation not found.", 404);
  } else {
    conversation = await createConversation(args.clientId, content);
  }

  await addMessage(conversation.id, "user", content);

  const history = await getMessages(conversation.id);
  const system = await buildSystemPrompt(
    conversation.scope_type === "client" ? conversation.scope_id : null,
  );

  // No `temperature` — see structuredChat in ./ai: newer models 400 on any
  // non-default value, taking the whole request with them.
  const res = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `${system}

You are answering the Ziora team member who owns this relationship — an internal audience, not the client. Be candid about weaknesses in the deal.

Format in Markdown: short headings, tight bullets, tables where a comparison genuinely helps. Do not calculate dollar figures; work from the ones in the record above and describe anything else in words. If something you need isn't in the record, ask one pointed question rather than guessing at length.`,
      },
      ...history.slice(-HISTORY_LIMIT).map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ],
  });

  const reply = res.choices[0]?.message?.content?.trim();
  if (!reply) throw new CrmError("The AI returned an empty response.", 502);

  await addMessage(conversation.id, "assistant", reply);
  await query(`UPDATE crm_conversations SET updated_at = $2 WHERE id = $1`, [
    conversation.id,
    nowIso(),
  ]);

  return { conversation, messages: await getMessages(conversation.id) };
}

export async function deleteConversation(id: string): Promise<void> {
  await query(`DELETE FROM crm_conversations WHERE id = $1`, [id]);
}
