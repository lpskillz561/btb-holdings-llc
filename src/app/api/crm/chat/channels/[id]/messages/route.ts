import { NextResponse } from "next/server";
import { CrmError } from "@/lib/crm/db";
import { getChannel, lastReadAt, listMessages, markRead, postMessage } from "@/lib/crm/chat";
import { answerInChannel, mentionsAi } from "@/lib/crm/chat-ai";
import { publish } from "@/lib/crm/chat-bus";
import { getCachedPreviews, unfurl, urlsIn } from "@/lib/crm/unfurl";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

/**
 * A page of history, plus the link previews for it.
 *
 * The previews are returned WITH the page rather than fetched per message by
 * the browser: fifty messages would otherwise be fifty round trips on open, and
 * the cache lookup is one query keyed on the URLs actually present.
 */
export const GET = withCrmParams<{ id: string }>(async (req, { params, actor }) => {
  const channel = await getChannel(params.id);
  if (!channel) throw new CrmError("That channel no longer exists.", 404);

  const before = new URL(req.url).searchParams.get("before");
  const messages = await listMessages(channel.id, { before });

  const urls = [...new Set(messages.flatMap((m) => urlsIn(m.body)))];
  const [previews, readAt] = await Promise.all([
    getCachedPreviews(urls),
    lastReadAt(channel.id, actor),
  ]);

  // `last_read_at` is sent so the browser can place the "New messages" divider
  // exactly. Deriving it from the unread COUNT instead is off by however many
  // of your own messages are interleaved, because your own never count as
  // unread — and a divider in the wrong place is worse than none.
  return NextResponse.json({ channel, messages, previews, viewer: actor, last_read_at: readAt });
});

/**
 * Post a message.
 *
 * Three things happen after the row is written, and NONE of them is awaited
 * before answering. Sending has to feel instantaneous — it is the single most
 * repeated action in the product — and unfurling a link or waiting on a model
 * would put a network round trip, or ten seconds, between pressing Enter and
 * seeing your own words.
 *
 * Both follow-ups announce themselves on the bus when they finish, so every
 * open browser gets the preview card and the AI's reply as they land.
 */
export const POST = withCrmParams<{ id: string }>(async (req, { params, actor }) => {
  const channel = await getChannel(params.id);
  if (!channel) throw new CrmError("That channel no longer exists.", 404);

  const body = await readBody(req);
  const message = await postMessage({
    channelId: channel.id,
    authorEmail: actor,
    body: body.body,
  });

  publish({ type: "message", channelId: channel.id, message });
  // Your own message is read by definition — otherwise posting lights up your
  // own unread badge the instant the stream echoes it back to you.
  await markRead(channel.id, actor, message.created_at);

  // Fire-and-forget. `void` plus a catch on each: an unhandled rejection here
  // would take the whole Node process down, and a link that will not unfurl
  // must never cost someone their message.
  void (async () => {
    for (const url of urlsIn(message.body)) {
      try {
        const preview = await unfurl(url);
        publish({ type: "preview", channelId: channel.id, messageId: message.id, preview });
      } catch (err) {
        console.error("[chat] unfurl failed", url, err);
      }
    }
  })();

  if (mentionsAi(message.body)) {
    void (async () => {
      try {
        const reply = await answerInChannel({ channelId: channel.id, trigger: message });
        if (reply) publish({ type: "message", channelId: channel.id, message: reply });
      } catch (err) {
        console.error("[chat] ai reply failed", err);
        // The room is told, rather than left waiting on an answer that is never
        // coming. Posted as the assistant so it reads as the assistant failing.
        try {
          const { postMessage: post } = await import("@/lib/crm/chat");
          const { AI_AUTHOR } = await import("@/lib/crm/chat-ai");
          const note = await post({
            channelId: channel.id,
            authorEmail: AI_AUTHOR,
            kind: "ai",
            body: "I could not answer that one — something went wrong on my side. Try again in a moment.",
          });
          publish({ type: "message", channelId: channel.id, message: note });
        } catch {
          // Nothing further to do; the original error is already logged.
        }
      }
    })();
  }

  return NextResponse.json(message, { status: 201 });
});
