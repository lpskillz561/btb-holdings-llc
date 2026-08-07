/**
 * The assistant, in the room.
 *
 * **It speaks only when spoken to.** `@ai` anywhere in a message summons it;
 * anything else it never sees. A model reading every line of a team chat is a
 * bill on idle conversation and a participant nobody invited — and the point of
 * this is a colleague you can ask, not a bot that interjects.
 *
 * What it answers with is the SAME knowledge as every other AI surface:
 * `BASE_PROMPT` + `SKILL.md` + record context, assembled by `buildScopedPrompt`.
 * That is the whole reason this is worth having over a general assistant in
 * some other app — it has read `docs/`, so it knows the note is recourse, that
 * the test is 30 days and not 7, and that the client never owns the land.
 *
 * It posts as an ordinary message with `kind = 'ai'`, not as an overlay, so
 * scrolling back next month shows the answer where it was actually given.
 */

import { MODEL, buildScopedPrompt, getOpenAI, isAiConfigured } from "./ai";
import { attachmentIdsIn, describeAttachments } from "./attachments";
import { attachmentDataUrl, getAttachment } from "./uploads";
import { listMessages, postMessage, type CrmChatMessage } from "./chat";
import { site } from "@/lib/site";
import type OpenAI from "openai";

/** The address the assistant posts under. Not a real account — nothing can sign
 *  in as this, and `AUTH_USERS`/`portal_users` have never heard of it. */
export const AI_AUTHOR = "ai@btbholdingsllc.com";

/** How much of the room the model is shown. Enough for a thread of back-and-forth. */
const CONTEXT_MESSAGES = 24;

/** Same budget, and the same reason, as the advisor panel: images are re-sent
 *  inline as base64 on every call, because our own image route is auth-gated. */
const MAX_VISION_IMAGES = 3;

/** Does this message summon the assistant? */
export function mentionsAi(body: string): boolean {
  // Word-boundaried so "retail" and an email address ending "@ai" in the middle
  // of a domain do not trigger it. The mention may sit anywhere in the line.
  return /(^|[\s(>*_`])@ai\b/i.test(body);
}

/** Strip the summons before the model reads it, so it is not answering "@ai". */
function withoutMention(body: string): string {
  return body.replace(/(^|[\s(>*_`])@ai\b/gi, "$1").trim();
}

/**
 * Answer an `@ai` in a channel, and post the reply.
 *
 * Returns the posted message, or null when the AI is not configured — a chat
 * that keeps working without an API key is the right failure, and the caller
 * surfaces nothing.
 */
export async function answerInChannel(args: {
  channelId: string;
  trigger: CrmChatMessage;
}): Promise<CrmChatMessage | null> {
  if (!isAiConfigured()) return null;

  const history = await listMessages(args.channelId, { limit: CONTEXT_MESSAGES });

  // The room is scoped `global`: a team channel is about the business, not
  // about one record. When per-client channels exist, this is the one line that
  // changes — pass the channel's client_id through and the assistant arrives
  // already knowing whose room it is in.
  const system = await buildScopedPrompt({ type: "global" });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${system}

---

You are in ${site.shortName}'s internal team chat, summoned by someone typing "@ai". You are talking to staff, not to a client.

Write like a colleague in a chat window: short, direct, no headings unless you genuinely need them, no sign-off. One or two paragraphs is usually right. A list only when the answer is genuinely a list.

The messages above yours are the room's recent conversation, each prefixed with who said it. Use them for context, but answer the person who summoned you.

Do not calculate dollar figures. Work from figures in the record and describe anything else in words. If you need something you have not been given, ask one pointed question rather than guessing at length. Screenshots may be attached; read them and work from what they show.`,
    },
  ];

  // Which images ride along: newest first, capped. Same shape as advisor.ts.
  const wanted: string[] = [];
  for (let i = history.length - 1; i >= 0 && wanted.length < MAX_VISION_IMAGES; i--) {
    for (const id of attachmentIdsIn(history[i].body)) {
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
        console.error("[chat-ai] attachment unreadable, sending without it", id, err);
      }
    }),
  );

  for (const m of history) {
    const isAi = m.kind === "ai";
    // WHO SAID IT is prefixed into the text rather than carried on the role.
    // A group chat is many-to-one and the roles are two, so without this the
    // model reads five people's messages as one person changing their mind.
    const speaker = isAi ? "" : `${m.author_email.split("@")[0]}: `;
    const text = `${speaker}${describeAttachments(
      m.id === args.trigger.id ? withoutMention(m.body) : m.body,
    )}`;
    const ids = isAi ? [] : attachmentIdsIn(m.body).filter((id) => dataUrls.has(id));

    if (!ids.length) {
      messages.push({ role: isAi ? "assistant" : "user", content: text });
    } else {
      messages.push({
        role: "user",
        content: [
          { type: "text", text },
          ...ids.map((id) => ({
            type: "image_url" as const,
            image_url: { url: dataUrls.get(id) as string },
          })),
        ],
      });
    }
  }

  // No `temperature` — newer models 400 on any non-default value and take the
  // whole request with them. See structuredChat in ./ai.
  const res = await getOpenAI().chat.completions.create({ model: MODEL, messages });
  const reply = res.choices[0]?.message?.content?.trim();
  if (!reply) return null;

  return postMessage({
    channelId: args.channelId,
    authorEmail: AI_AUTHOR,
    body: reply,
    kind: "ai",
  });
}
