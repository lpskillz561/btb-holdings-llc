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

/**
 * The URL as a human should read it.
 *
 * Share sheets staple a tracking parameter onto everything — Instagram's
 * `igsh`, Facebook's `fbclid`, every campaign's `utm_*` — and the result is a
 * card whose second line is forty characters of base64 nobody can parse. They
 * are stripped for DISPLAY only; the href stays exactly as pasted, because
 * some sites do route on parameters and a link that goes somewhere else than
 * the one you copied is worse than an ugly one.
 */
const JUNK_PARAMS = /^(igsh|igshid|fbclid|gclid|mc_[a-z]+|ref|ref_src|si|utm_[a-z]+)$/i;

function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (JUNK_PARAMS.test(key)) u.searchParams.delete(key);
    }
    const shown = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
    return shown.length > 70 ? `${shown.slice(0, 69)}…` : shown;
  } catch {
    return url;
  }
}

/**
 * Sites we can draw a mark for.
 *
 * Instagram earns one because it is the case that most needs it: Meta serves us
 * no metadata at all (429 on HTML from any datacenter IP, and tokenless oEmbed
 * returns nothing), so an Instagram card has no photograph to carry and would
 * otherwise be the plainest card on the page. A branded tile makes it read as
 * deliberate rather than as a preview that failed.
 *
 * Literal brand colours, not theme tokens — this is somebody's logo, and it
 * does not invert in dark mode.
 */
const BRANDS: Record<string, { label: string; style: React.CSSProperties }> = {
  "instagram.com": {
    label: "Instagram",
    style: {
      backgroundImage:
        "radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)",
    },
  },
};

function brandFor(host: string) {
  const key = Object.keys(BRANDS).find((d) => host === d || host.endsWith(`.${d}`));
  return key ? BRANDS[key] : null;
}

function InstagramGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LinkCard({ preview }: { preview: PreviewData }) {
  const { host, path } = readable(preview.url);
  const rich = preview.status === "ok" && (preview.title || preview.description);
  const brand = brandFor(host);

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-2 flex max-w-md overflow-hidden rounded-card border border-ink-200 bg-card-2 transition hover:border-sf-300 hover:bg-card hover:shadow-soft"
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
      ) : brand ? (
        <span
          aria-hidden
          title={brand.label}
          style={brand.style}
          className="grid h-24 w-20 shrink-0 place-items-center text-white"
        >
          <InstagramGlyph />
        </span>
      ) : (
        <span
          aria-hidden
          className="grid h-24 w-14 shrink-0 place-items-center bg-sf-100 text-lg font-bold text-sf-700"
        >
          {host.slice(0, 1).toUpperCase()}
        </span>
      )}

      <span className="min-w-0 flex-1 px-3.5 py-2.5">
        <span className="block truncate text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-ink-500">
          {preview.site_name || host}
        </span>
        <span className="mt-0.5 block truncate text-sm font-semibold text-ink-900">
          {rich ? preview.title || host : path || host}
        </span>
        {rich && preview.description ? (
          <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-ink-600">
            {preview.description}
          </span>
        ) : null}
        {/* Always the last line, and always the tidied URL — it is what tells
            you where the card actually goes, which matters most on the cards
            that have nothing else to show. */}
        <span className="mt-1 block truncate text-[0.7rem] text-ink-500">
          {preview.status === "pending" ? "Loading preview…" : displayUrl(preview.url)}
        </span>
      </span>
    </a>
  );
}
