// The AI advisor, in whatever the person is looking at.
//
// Same model and key as the rest of the site; what differs is that the system
// prompt is rebuilt from the record on EVERY turn rather than being baked into
// the conversation when it started. Records change mid-conversation — a unit
// gets placed in service, a proposal is accepted — and an advisor answering
// from a stale snapshot of the account is worse than no advisor.
//
// A conversation is scoped: to one client, one proposal, one contract, or to
// the workspace as a whole. The scope is stored on the row rather than passed
// per turn, so reopening a thread from the sidebar reloads the same context it
// was answering with. The workspace assistant that rides on every /crm page
// picks its scope from the URL — see components/crm/AskAi.tsx.

import type OpenAI from "openai";
import { CrmError, newId, nowIso, query, queryOne } from "./db";
import { MODEL, buildScopedPrompt, getOpenAI, isAiConfigured, type PromptScope } from "./ai";
import { attachmentIdsIn, describeAttachments } from "./attachments";
import { attachmentDataUrl, getAttachment } from "./uploads";
import { AI_SCOPES, type AiScope, type CrmConversation, type CrmMessage } from "./types";

/** Turns of history replayed to the model. Older turns stay in the DB and in the UI. */
const HISTORY_LIMIT = 24;

/**
 * How many attached images ride along with a turn.
 *
 * Images are sent as base64 DATA URLS, not as links, and that is forced: our
 * own `/api/crm/attachments/[id]` is behind the session check, so OpenAI
 * fetching it would get a 401. Which means every image in scope is re-uploaded
 * on every turn of the conversation, inline in the request body.
 *
 * So this is a real budget, not a formality. At the 5 MB ceiling four images is
 * a ~27 MB request after base64's third, on every message thereafter. Newest
 * first, so a long thread keeps carrying what is being discussed now and drops
 * the screenshot from twenty turns ago — which is the same thing HISTORY_LIMIT
 * does for text, and for the same reason.
 */
const MAX_VISION_IMAGES = 4;

/**
 * History → what the model is sent, with images attached as vision parts.
 *
 * A message's images are resolved ONCE even when two turns reference the same
 * one, which is the common case: "look at this" followed by "and the total in
 * the same screenshot" is one image and two messages.
 *
 * An image that cannot be read is DROPPED, loudly in the log and silently in
 * the request. The alternative is failing the whole turn because one object is
 * missing from a bucket — the person asked a question, and answering it without
 * one image beats refusing to answer at all. The `[attached image: …]` note
 * stays in the text either way, so the model is never told an image is there
 * when it is not.
 */
async function toModelMessages(
  history: CrmMessage[],
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const recent = history.slice(-HISTORY_LIMIT);

  // Which images make the cut: newest turn backwards until the budget is spent.
  const wanted: string[] = [];
  for (let i = recent.length - 1; i >= 0 && wanted.length < MAX_VISION_IMAGES; i--) {
    if (recent[i].role !== "user") continue;
    for (const id of attachmentIdsIn(recent[i].content)) {
      if (wanted.length >= MAX_VISION_IMAGES) break;
      if (!wanted.includes(id)) wanted.push(id);
    }
  }

  const dataUrls = new Map<string, string>();
  await Promise.all(
    wanted.map(async (id) => {
      try {
        const row = await getAttachment(id);
        if (row) dataUrls.set(id, await attachmentDataUrl(row));
      } catch (err) {
        console.error("[advisor] attachment could not be read, sending without it", id, err);
      }
    }),
  );

  return recent.map((message) => {
    const text = describeAttachments(message.content);
    const ids =
      message.role === "user"
        ? attachmentIdsIn(message.content).filter((id) => dataUrls.has(id))
        : [];

    if (!ids.length) {
      return {
        role: message.role as "user" | "assistant" | "system",
        content: text,
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
    }

    return {
      role: "user",
      content: [
        { type: "text", text },
        ...ids.map((id) => ({
          type: "image_url" as const,
          image_url: { url: dataUrls.get(id) as string },
        })),
      ],
    };
  });
}

export function isAiScope(value: unknown): value is AiScope {
  return typeof value === "string" && (AI_SCOPES as readonly string[]).includes(value);
}

/**
 * A scope as it arrives from a request, normalised.
 *
 * Anything record-scoped without an id collapses to `global` rather than
 * erroring: the assistant is open on every page, and a thread the model can
 * still answer generally is better than a panel that refuses to talk.
 */
export function toPromptScope(scopeType: unknown, scopeId: unknown): PromptScope {
  const id = typeof scopeId === "string" && scopeId.trim() ? scopeId.trim() : null;
  if (!isAiScope(scopeType) || scopeType === "global" || !id) return { type: "global" };
  return { type: scopeType, id };
}

export async function listConversations(scope: PromptScope): Promise<CrmConversation[]> {
  return scope.type === "global"
    ? query<CrmConversation>(
        `SELECT * FROM crm_conversations WHERE scope_type = 'global'
         ORDER BY updated_at DESC LIMIT 50`,
      )
    : query<CrmConversation>(
        `SELECT * FROM crm_conversations WHERE scope_type = $1 AND scope_id = $2
         ORDER BY updated_at DESC LIMIT 50`,
        [scope.type, scope.id],
      );
}

export async function getMessages(conversationId: string): Promise<CrmMessage[]> {
  return query<CrmMessage>(
    `SELECT * FROM crm_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId],
  );
}

async function createConversation(
  scope: PromptScope,
  firstMessage: string,
): Promise<CrmConversation> {
  const id = newId();
  const ts = nowIso();
  // Title from the opening question — enough to tell threads apart in a list.
  const title = firstMessage.trim().slice(0, 70) || "New conversation";
  const row = await queryOne<CrmConversation>(
    `INSERT INTO crm_conversations (id, scope_type, scope_id, title, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
    [id, scope.type, scope.type === "global" ? null : scope.id, title, ts],
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
  scope: PromptScope;
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
    conversation = await createConversation(args.scope, content);
  }

  await addMessage(conversation.id, "user", content);

  const history = await getMessages(conversation.id);
  // The thread's OWN scope, not the caller's. Reopening a client thread from a
  // list page must still answer about that client.
  const system = await buildScopedPrompt(
    toPromptScope(conversation.scope_type, conversation.scope_id),
  );

  // No `temperature` — see structuredChat in ./ai: newer models 400 on any
  // non-default value, taking the whole request with them.
  const res = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `${system}

---

Format in Markdown: short headings, tight bullets, tables where a comparison genuinely helps. Do not calculate dollar figures; work from the ones in the record above and describe anything else in words. If something you need isn't in the record, ask one pointed question rather than guessing at length.

Screenshots may be attached to a message. Read them and work from what they actually show. If an image contradicts the record above, say so plainly and name both — a figure someone can see on their screen and a figure on the row are exactly the kind of disagreement worth surfacing. Do not infer a dollar figure from a picture and then treat it as ours; quote it as what the image shows.`,
      },
      ...(await toModelMessages(history)),
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
