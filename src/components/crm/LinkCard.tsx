"use client";

/**
 * The card under a message that contains a link.
 *
 * Three states, and the third is the one that matters: plenty of sites refuse a
 * server-side fetch outright (crexi.com answers 403), so "we could not read
 * this page" has to look deliberate rather than broken. It renders the domain
 * and the tidied path — which is genuinely useful, because a Crexi URL says
 * which listing it is — instead of a grey box apologising.
 *
 * The thumbnail is OUR attachment id, never the remote og:image. The unfurler
 * copies the image into our own store precisely so that reading a chat message
 * cannot tell a third party who is reading it and when.
 */

import { attachmentUrl } from "@/lib/crm/attachments";

export interface PreviewData {
  url: string;
  status: "pending" | "ok" | "empty" | "blocked";
  title: string | null;
  description: string | null;
  site_name: string | null;
  image_attachment_id: string | null;
}

/** "www.crexi.com/properties/12345/foo-bar" -> "crexi.com" + "foo bar". */
function readable(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const path = decodeURIComponent(last)
      .replace(/[-_]+/g, " ")
      .replace(/\.\w{2,4}$/, "")
      .trim();
    return { host, path };
  } catch {
    return { host: url, path: "" };
  }
}

export function LinkCard({ preview }: { preview: PreviewData }) {
  const { host, path } = readable(preview.url);
  const rich = preview.status === "ok" && (preview.title || preview.description);

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-2 flex max-w-md overflow-hidden rounded-card border border-ink-200 bg-card-2 transition hover:border-sf-300 hover:bg-card"
    >
      {preview.image_attachment_id ? (
        // eslint-disable-next-line @next/next/no-img-element -- our own route,
        // and next/image would fetch it server-side without the session.
        <img
          src={attachmentUrl(preview.image_attachment_id)}
          alt=""
          loading="lazy"
          className="h-24 w-24 shrink-0 object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="grid h-24 w-14 shrink-0 place-items-center bg-sf-100 text-lg font-bold text-sf-700"
        >
          {host.slice(0, 1).toUpperCase()}
        </span>
      )}

      <span className="min-w-0 flex-1 px-3 py-2">
        <span className="block truncate text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-ink-500">
          {preview.site_name || host}
        </span>
        <span className="mt-0.5 block truncate text-sm font-medium text-ink-900">
          {rich ? preview.title || host : path || host}
        </span>
        {rich && preview.description ? (
          <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-ink-600">
            {preview.description}
          </span>
        ) : (
          <span className="mt-0.5 block truncate text-xs text-ink-500">
            {preview.status === "pending" ? "Loading preview…" : preview.url}
          </span>
        )}
      </span>
    </a>
  );
}
