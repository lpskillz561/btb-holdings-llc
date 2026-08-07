/**
 * Team chat.
 *
 * The room the office actually talks in, inside the app rather than on someone
 * else's platform. It exists because the alternative was a WhatsApp group, and
 * a WhatsApp group means this business's client material — grounded in the same
 * `SKILL.md` that carries the memorandum and the executed agreements — sitting
 * decrypted on Meta's servers and permanently in every member's phone backup.
 * Here it is behind the same session gate as everything else.
 *
 * **Staff only.** There is no per-channel membership and no private messaging,
 * deliberately. Reaching `/crm` at all is the permission, exactly as it is for
 * the board — and a permission model nobody asked for is a permission model
 * that will be wrong when somebody does.
 *
 * Messages are Markdown, like card comments, so `@mentions`, links and pasted
 * images all work through machinery that already exists. The AI answers when it
 * is `@ai`-ed and stays quiet otherwise; see ./chat-ai.ts.
 */

import { CrmError, newId, nowIso, query, queryOne } from "./db";

/** Long enough for a considered paragraph, short of an essay nobody reads. */
export const MAX_CHAT_MESSAGE = 8000;

/** One page of history. Chat is read from the bottom, so this is "recent". */
export const PAGE_SIZE = 50;

export interface CrmChatChannel {
  id: string;
  slug: string;
  name: string;
  topic: string | null;
  client_id: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmChatReaction {
  emoji: string;
  /** Everyone who reacted with it, so the UI can name them on hover. */
  actors: string[];
}

export interface CrmChatMessage {
  id: string;
  channel_id: string;
  author_email: string;
  kind: "user" | "ai";
  body: string;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  reactions: CrmChatReaction[];
}

export interface ChannelSummary extends CrmChatChannel {
  /** Messages since this reader's last read. Drives the badge in the rail. */
  unread: number;
  last_message_at: string | null;
}

/* -------------------------------------------------------------------------- */
/* Channels                                                                    */
/* -------------------------------------------------------------------------- */

export async function listChannels(viewer: string): Promise<ChannelSummary[]> {
  // The unread count is computed in SQL rather than by fetching messages and
  // counting them in Node: the rail renders on every page and a channel with
  // 4,000 messages must not send 4,000 rows to learn that three are new.
  return query<ChannelSummary>(
    `SELECT c.*,
            COALESCE(m.last_at, NULL) AS last_message_at,
            COALESCE(u.n, 0)::int     AS unread
       FROM crm_chat_channels c
       LEFT JOIN LATERAL (
            SELECT max(created_at) AS last_at
              FROM crm_chat_messages WHERE channel_id = c.id
       ) m ON true
       LEFT JOIN LATERAL (
            SELECT count(*) AS n
              FROM crm_chat_messages msg
             WHERE msg.channel_id = c.id
               AND msg.created_at > COALESCE(
                     (SELECT last_read_at FROM crm_chat_reads
                       WHERE channel_id = c.id AND lower(user_email) = lower($1)), '')
               -- Your own messages are never unread. Posting and then seeing a
               -- badge against your own name reads as the app being broken.
               AND lower(msg.author_email) <> lower($1)
       ) u ON true
      WHERE c.archived_at IS NULL
      ORDER BY c.created_at ASC`,
    [viewer],
  );
}

export async function getChannel(idOrSlug: string): Promise<CrmChatChannel | null> {
  return queryOne<CrmChatChannel>(
    `SELECT * FROM crm_chat_channels WHERE id = $1 OR lower(slug) = lower($1)`,
    [idOrSlug],
  );
}

export async function createChannel(args: {
  name: string;
  topic?: unknown;
  createdBy: string;
}): Promise<CrmChatChannel> {
  const name = String(args.name ?? "").trim();
  if (!name) throw new CrmError("A channel needs a name.", 400);
  if (name.length > 60) throw new CrmError("That name is too long.", 400);

  const slug = slugify(name);
  if (!slug) throw new CrmError("That name has no letters or numbers in it.", 400);

  const stamp = nowIso();
  const rows = await query<CrmChatChannel>(
    `INSERT INTO crm_chat_channels (id, slug, name, topic, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
    [newId(), slug, name, String(args.topic ?? "").trim() || null, args.createdBy, stamp],
  );
  return rows[0];
}

/** "Cedar Ridge — Phase 2" -> "cedar-ridge-phase-2". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A page of history, oldest-first for rendering.
 *
 * `before` pages backwards for infinite scroll. The query orders DESC to use
 * the index and take the newest N, then the result is reversed — ordering ASC
 * with a LIMIT would take the OLDEST fifty messages in the channel, which on a
 * year-old room is the wrong end of the conversation entirely.
 */
export async function listMessages(
  channelId: string,
  opts: { before?: string | null; limit?: number } = {},
): Promise<CrmChatMessage[]> {
  const limit = Math.min(Math.max(opts.limit ?? PAGE_SIZE, 1), 200);
  const rows = await query<CrmChatMessage>(
    `SELECT m.*, COALESCE(r.reactions, '[]'::json) AS reactions
       FROM crm_chat_messages m
       LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object('emoji', x.emoji, 'actors', x.actors)
                            ORDER BY x.first_at) AS reactions
              FROM (
                SELECT emoji,
                       json_agg(actor_email ORDER BY created_at) AS actors,
                       min(created_at) AS first_at
                  FROM crm_chat_reactions
                 WHERE message_id = m.id
                 GROUP BY emoji
              ) x
       ) r ON true
      WHERE m.channel_id = $1
        AND ($2::text IS NULL OR m.created_at < $2)
      ORDER BY m.created_at DESC
      LIMIT $3`,
    [channelId, opts.before ?? null, limit],
  );
  return rows.reverse();
}

export async function getMessage(id: string): Promise<CrmChatMessage | null> {
  const rows = await listMessagesByIds([id]);
  return rows[0] ?? null;
}

/** Re-read specific messages with their reactions — what the SSE stream emits. */
export async function listMessagesByIds(ids: string[]): Promise<CrmChatMessage[]> {
  if (!ids.length) return [];
  return query<CrmChatMessage>(
    `SELECT m.*, COALESCE(r.reactions, '[]'::json) AS reactions
       FROM crm_chat_messages m
       LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object('emoji', x.emoji, 'actors', x.actors)
                            ORDER BY x.first_at) AS reactions
              FROM (
                SELECT emoji,
                       json_agg(actor_email ORDER BY created_at) AS actors,
                       min(created_at) AS first_at
                  FROM crm_chat_reactions
                 WHERE message_id = m.id
                 GROUP BY emoji
              ) x
       ) r ON true
      WHERE m.id = ANY($1)
      ORDER BY m.created_at ASC`,
    [ids],
  );
}

export async function postMessage(args: {
  channelId: string;
  authorEmail: string;
  body: unknown;
  kind?: "user" | "ai";
}): Promise<CrmChatMessage> {
  const body = String(args.body ?? "").trim();
  if (!body) throw new CrmError("Type something first.", 400);
  if (body.length > MAX_CHAT_MESSAGE) {
    throw new CrmError(`Messages are limited to ${MAX_CHAT_MESSAGE} characters.`, 400);
  }

  // Checked so a message into a deleted channel is a clean 404 rather than a
  // foreign-key violation surfacing as an unexplained 400.
  const channel = await queryOne<{ id: string }>(
    "SELECT id FROM crm_chat_channels WHERE id = $1",
    [args.channelId],
  );
  if (!channel) throw new CrmError("That channel no longer exists.", 404);

  const stamp = nowIso();
  const rows = await query<CrmChatMessage>(
    `INSERT INTO crm_chat_messages (id, channel_id, author_email, kind, body, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING *, '[]'::json AS reactions`,
    [newId(), args.channelId, args.authorEmail, args.kind ?? "user", body, stamp],
  );
  return rows[0];
}

/**
 * Delete your own message.
 *
 * Hard delete, and only your own — the same rule as a card comment. There is no
 * soft-delete tombstone ("message deleted") because in a five-person staff room
 * it adds a permanent scar to the transcript for something that is almost always
 * a typo being retracted.
 */
export async function deleteMessage(id: string, actor: string): Promise<string> {
  const row = await queryOne<{ author_email: string; channel_id: string }>(
    "SELECT author_email, channel_id FROM crm_chat_messages WHERE id = $1",
    [id],
  );
  if (!row) throw new CrmError("That message is already gone.", 404);
  if (row.author_email.toLowerCase() !== actor.toLowerCase()) {
    throw new CrmError("You can only delete your own messages.", 403);
  }
  await query("DELETE FROM crm_chat_messages WHERE id = $1", [id]);
  return row.channel_id;
}

/* -------------------------------------------------------------------------- */
/* Reactions                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Toggle one reaction. Returns the message, freshly aggregated.
 *
 * Toggle rather than add/remove as separate verbs: tapping the same emoji twice
 * is how every chat app on earth behaves, and the UI should not have to know
 * whether it is currently on.
 */
export async function toggleReaction(args: {
  messageId: string;
  emoji: unknown;
  actor: string;
}): Promise<CrmChatMessage> {
  const emoji = String(args.emoji ?? "").trim();
  // A length cap, not a whitelist. Emoji are multi-codepoint — a flag is two,
  // and a family with skin tones is seven or more joined by ZWJ — so counting
  // characters is the only cheap sanity check that does not reject valid ones.
  // The cap is what stops the column being used to store a paragraph.
  if (!emoji || [...emoji].length > 8) throw new CrmError("That is not an emoji.", 400);

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM crm_chat_reactions
      WHERE message_id = $1 AND emoji = $2 AND lower(actor_email) = lower($3)`,
    [args.messageId, emoji, args.actor],
  );

  if (existing) {
    await query("DELETE FROM crm_chat_reactions WHERE id = $1", [existing.id]);
  } else {
    await query(
      `INSERT INTO crm_chat_reactions (id, message_id, emoji, actor_email, created_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [newId(), args.messageId, emoji, args.actor, nowIso()],
    );
  }

  const message = await getMessage(args.messageId);
  if (!message) throw new CrmError("That message is already gone.", 404);
  return message;
}

/* -------------------------------------------------------------------------- */
/* Read state                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Mark a channel read up to an instant.
 *
 * `GREATEST` so this can only ever move FORWARD. Two tabs open on the same
 * channel will both report, and the one that was scrolled up would otherwise
 * wind the marker back and resurrect an unread badge the reader had cleared.
 */
export async function markRead(channelId: string, viewer: string, at?: string): Promise<void> {
  const stamp = at ?? nowIso();
  await query(
    `INSERT INTO crm_chat_reads (channel_id, user_email, last_read_at, updated_at)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (channel_id, lower(user_email))
     DO UPDATE SET last_read_at = GREATEST(crm_chat_reads.last_read_at, EXCLUDED.last_read_at),
                   updated_at   = EXCLUDED.updated_at`,
    [channelId, viewer, stamp],
  );
}

/** Where this reader had got to — drives the "new messages" divider. */
export async function lastReadAt(channelId: string, viewer: string): Promise<string | null> {
  const row = await queryOne<{ last_read_at: string }>(
    `SELECT last_read_at FROM crm_chat_reads
      WHERE channel_id = $1 AND lower(user_email) = lower($2)`,
    [channelId, viewer],
  );
  return row?.last_read_at || null;
}
