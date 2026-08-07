// The team's room.
//
// It exists because the alternative was a WhatsApp group, and a WhatsApp group
// means this business's client material sitting decrypted on Meta's servers and
// permanently in every member's phone backup. Here it is behind the same gate
// as the rest of the CRM, and the assistant in it has read `docs/`.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatRoom } from "@/components/crm/ChatRoom";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { getCrmPageUser } from "@/lib/crm/access";
import { getChannel, lastReadAt, listChannels, listMessages } from "@/lib/crm/chat";
import { backfillPreviews, getCachedPreviews, urlsIn } from "@/lib/crm/unfurl";
import { publish } from "@/lib/crm/chat-bus";
import { officeTimeZone } from "@/lib/crm/tz";
import { listAssignableUsers } from "@/lib/crm/todos";

export const metadata: Metadata = {
  title: "Chat",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  // The seeded channel, or the first one there is. `ensureAppSchema` plants
  // `team` on first boot, so the empty case is a fresh database mid-migration
  // rather than a state anyone will meet.
  const channels = await listChannels(user.sub).catch(() => []);
  const channel = (await getChannel("team")) ?? (channels[0] ? await getChannel(channels[0].id) : null);
  if (!channel) notFound();

  const summary = channels.find((c) => c.id === channel.id) ?? {
    ...channel,
    unread: 0,
    last_message_at: null,
  };

  const [messages, users, readAt] = await Promise.all([
    listMessages(channel.id).catch(() => []),
    listAssignableUsers().catch(() => []),
    lastReadAt(channel.id, user.sub).catch(() => null),
  ]);

  // Rendered with the page rather than fetched per message on mount: fifty
  // messages would otherwise be fifty round trips before anything looked right.
  const urls = [...new Set(messages.flatMap((m) => urlsIn(m.body)))];
  const previews = await getCachedPreviews(urls).catch(() => []);

  // The same self-heal the API route does, because THIS is the path a first
  // page load takes — without it, a preview whose cache row was cleared would
  // only ever come back for someone who paged through history.
  backfillPreviews(urls, previews, (preview) => {
    const owner = messages.find((m) => m.body.includes(preview.url));
    publish({ type: "preview", channelId: channel.id, messageId: owner?.id ?? "", preview });
  });

  return (
    <>
      <RecordHeader
        eyebrow="Team"
        title="Chat"
        intro="The whole office, in one room. Paste screenshots, drop links, and type @ai to ask the assistant — it has read the memorandum and knows our deal."
      />
      <section className="section">
        <div className="container-x">
          <ChatRoom
            initial={{
              channel: summary,
              messages,
              previews,
              viewer: user.sub,
              last_read_at: readAt,
            }}
            users={users}
            viewer={user.sub}
            // Resolved on the server and passed down: `process.env` is
            // unreadable in a client component, and formatting times in the
            // reader's own zone would make the server's HTML and the browser's
            // hydration disagree. Same rule as the meetings calendar.
            timeZone={officeTimeZone()}
          />
        </div>
      </section>
    </>
  );
}
