/**
 * Link previews for chat messages.
 *
 * ============================ READ THIS FIRST ==============================
 * THIS MODULE MAKES THE SERVER FETCH A URL A USER TYPED. That is server-side
 * request forgery by construction, and on this deployment it is not theoretical:
 * the EC2 instance's metadata service at 169.254.169.254 hands out the instance
 * role's credentials to anything that can reach it, and the IMDS hop limit was
 * raised to 2 so the container could reach AWS for image uploads. A fetcher that
 * followed a user-supplied URL without checking where it actually goes would let
 * anyone who can type in chat exfiltrate the role that can read our database
 * secret and our SSM parameters.
 *
 * The defence is `assertPublicUrl` below, and its three non-obvious parts:
 *
 *   1. DNS IS RESOLVED HERE, AND THE RESOLVED IP IS WHAT IS CHECKED. Checking
 *      the hostname is useless — `evil.com` can have an A record of 127.0.0.1,
 *      and does, in public. This is the whole attack.
 *   2. REDIRECTS ARE FOLLOWED BY HAND, one hop at a time, re-checking every
 *      one. `fetch`'s own redirect following would happily land on a private
 *      address after a public first hop.
 *   3. THE CHECK AND THE CONNECTION STILL RACE (DNS rebinding: answer public,
 *      then answer private a moment later). We cannot pin the socket to the
 *      checked IP without a custom agent, so the residual risk is accepted and
 *      narrowed instead: no credentials are ever attached, the response is
 *      capped and parsed only for meta tags, and NOTHING from the response is
 *      returned to the caller except title/description/image. An attacker who
 *      wins the race gets a page title.
 *
 * Do not "simplify" any of that, and do not swap it for an unfurl library
 * without reading what that library does about private addresses.
 * ===========================================================================
 *
 * The other rule: **a preview never renders a remote image.** The og:image is
 * downloaded and stored in our own attachment bucket, so a chat message cannot
 * cause a reader's browser to hit a third-party server — which would leak who
 * is reading, and when, to whoever was linked. Same rule `Markdown.tsx` applies
 * to pasted images; this is the one path that could otherwise smuggle a remote
 * URL past it.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { nowIso, query, queryOne } from "./db";
import { createAttachment, areUploadsConfigured } from "./uploads";
import { isAllowedImageType } from "./attachments";

export interface LinkPreview {
  url: string;
  status: "pending" | "ok" | "empty" | "blocked";
  title: string | null;
  description: string | null;
  site_name: string | null;
  image_attachment_id: string | null;
  fetched_at: string | null;
}

/** A page is HTML and we want its head. Anything past this is not a meta tag. */
const MAX_HTML_BYTES = 512 * 1024;
/** A preview thumbnail. Bigger than this is not a thumbnail. */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;

/**
 * A browser's User-Agent, not a bot's.
 *
 * Not an attempt to evade anything — we obey the status code we are given. Many
 * sites (crexi.com among them; a plain fetch gets 403) serve their OpenGraph
 * tags only to something that looks like a browser, and the alternative is that
 * the previews people most want are the ones that never work. Sites that still
 * refuse get the fallback card, which is the honest outcome.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0 Safari/537.36 BTBHoldingsBot/1.0 (+https://btbholdingsllc.com)";

/* -------------------------------------------------------------------------- */
/* The address check                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every range that is not the public internet.
 *
 * Exported so it can be checked directly. Verified against a table of 21
 * addresses covering IMDS, ECS task metadata, loopback, our own VPC, CGNAT,
 * multicast, IPv6 link-local and unique-local, and IPv4-mapped IPv6 — plus two
 * that MUST be allowed (`172.32.0.1`, `100.128.0.1`), which are what catch a
 * filter written one bit too wide. Re-run that table if you touch this.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b] = p;
    return (
      a === 0 || // "this network"
      a === 10 || // private
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // CGNAT — the ISP's own space
      (a === 169 && b === 254) || // link-local: THIS IS IMDS
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 192 && b === 0) || // IETF protocol assignments
      (a === 198 && b >= 18 && b <= 19) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (ip6 === "::1" || ip6 === "::") return true;
    // IPv4-mapped (::ffff:127.0.0.1) is the classic bypass — unwrap and re-test.
    const mapped = ip6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      ip6.startsWith("fe80") || // link-local
      ip6.startsWith("fc") || // unique local
      ip6.startsWith("fd") || // unique local
      ip6.startsWith("ff") // multicast
    );
  }
  // Not an IP literal at all — refuse rather than guess.
  return true;
}

/**
 * Throws unless this URL is http(s) and resolves to a public address.
 *
 * Every DNS answer is checked, not just the first: a hostname with both a
 * public and a private A record must be refused outright, or which one you get
 * is a coin toss.
 */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("not a url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("unsupported scheme");
  }
  // Credentials in a URL are only ever an attempt to authenticate to something
  // internal on our behalf.
  if (url.username || url.password) throw new Error("credentials in url");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("private address");
    return url;
  }

  const answers = await lookup(host, { all: true });
  if (!answers.length) throw new Error("does not resolve");
  for (const a of answers) {
    if (isPrivateAddress(a.address)) throw new Error("resolves to a private address");
  }
  return url;
}

/**
 * Fetch, following redirects by hand and re-checking each hop.
 *
 * `redirect: "manual"` is the point. Left to itself `fetch` follows up to 20
 * redirects with no way to inspect them, so a public URL that 302s to
 * 169.254.169.254 would be fetched with the check already passed.
 */
async function safeFetch(raw: string, accept: string): Promise<Response> {
  let target = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(target);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      // No cookies, no credentials, ever. This request is made on behalf of a
      // user but it is OUR server's identity on the wire.
      credentials: "omit",
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return res;
      target = new URL(next, url).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

/** Read a capped number of bytes, then stop pulling. */
async function readCapped(res: Response, cap: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    total += value.byteLength;
    if (total >= cap) {
      // Stop the transfer rather than reading a 4 GB "HTML page" to the end.
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(chunks).subarray(0, cap);
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
}

/**
 * Meta tags, by regex.
 *
 * A real HTML parser would be more correct and is not worth a dependency here:
 * the input is capped at 512 KB, the output is three strings that are escaped
 * again on render, and the failure mode of a missed tag is a less pretty card.
 * Both attribute orders are matched because both are common in the wild.
 */
function metaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]?.trim()) return decodeEntities(m[1].trim());
    }
  }
  return null;
}

function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1].trim().replace(/\s+/g, " ")) : null;
}

const trim = (s: string | null, max: number) =>
  s ? (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s) : null;

/* -------------------------------------------------------------------------- */
/* Instagram                                                                   */
/* -------------------------------------------------------------------------- */

function isInstagram(url: URL): boolean {
  return /(^|\.)instagram\.com$/i.test(url.hostname);
}

/**
 * Instagram, WITHOUT a network call — and that is not laziness, it is the only
 * thing that works. Measured from this instance, August 2026:
 *
 *   - **Fetching instagram.com returns 429 for EVERY user agent.** Browser
 *     string, bot string, curl default — all 429. Instagram blocks datacenter
 *     IPs outright, so no amount of User-Agent choice makes HTML scraping work
 *     from EC2. Trying is a wasted round trip and a poisoned cache entry.
 *   - **Tokenless oEmbed returns NO metadata.** Meta dropped the token
 *     requirement in June 2026, but what comes back is `provider_name` and an
 *     embed blockquote — `author_name`, `title` and `thumbnail_url` are absent
 *     for profiles, posts AND reels alike. That was the previous implementation
 *     here, and it is why an Instagram link rendered as a card saying, in full,
 *     "Instagram".
 *
 * WhatsApp shows a rich card with the profile photo and the follower count
 * because Meta is previewing its own property from its own infrastructure. That
 * is not a gap we can close from here, and pretending otherwise by leaving a
 * request in that always fails only makes it slower.
 *
 * So the card is built from the URL itself, which actually carries the useful
 * part: the handle. `@boltfarmtreehouse · Instagram profile` beats a bare link,
 * renders instantly, and tells no third party who is reading the message.
 *
 * The one way to get the real photo is Instagram's own client-side embed script
 * running in the reader's browser (not a datacenter IP). That means loading
 * Meta's JavaScript into the CRM and letting every reader's browser talk to
 * Instagram — a deliberate privacy trade, not a default. See CLAUDE.md.
 */
function instagramPreview(url: URL): Omit<LinkPreview, "url" | "fetched_at"> {
  const parts = url.pathname.split("/").filter(Boolean);
  // /p/<code>, /reel/<code>, /tv/<code> — and the same nested under a handle,
  // which is the form a share sheet produces: /boltfarmtreehouse/p/<code>.
  const typeAt = parts.findIndex((p) => ["p", "reel", "reels", "tv"].includes(p.toLowerCase()));
  const kind =
    typeAt === -1
      ? "profile"
      : parts[typeAt].toLowerCase().startsWith("reel")
        ? "reel"
        : parts[typeAt].toLowerCase() === "tv"
          ? "video"
          : "post";

  // The handle is the first segment, unless the first segment IS the type.
  const handle = parts.length && typeAt !== 0 ? parts[0] : null;
  const reserved = ["explore", "accounts", "stories", "direct", "about"];
  const named = handle && !reserved.includes(handle.toLowerCase()) ? handle : null;

  return {
    status: "ok",
    title: named ? `@${named}` : "Instagram",
    description:
      kind === "profile"
        ? named
          ? "Instagram profile"
          : "Instagram"
        : `Instagram ${kind}${named ? ` by @${named}` : ""}`,
    site_name: "Instagram",
    image_attachment_id: null,
  };
}

/* -------------------------------------------------------------------------- */
/* The entry point                                                             */
/* -------------------------------------------------------------------------- */

export async function getCachedPreview(url: string): Promise<LinkPreview | null> {
  return queryOne<LinkPreview>(
    `SELECT url, status, title, description, site_name, image_attachment_id, fetched_at
       FROM crm_link_previews WHERE url = $1`,
    [url],
  );
}

export async function getCachedPreviews(urls: string[]): Promise<LinkPreview[]> {
  if (!urls.length) return [];
  return query<LinkPreview>(
    `SELECT url, status, title, description, site_name, image_attachment_id, fetched_at
       FROM crm_link_previews WHERE url = ANY($1)`,
    [urls],
  );
}

/**
 * Unfurl one URL and cache the result.
 *
 * Returns the cached row if there is one — including a failed one. A site that
 * refuses us is cached as `empty` rather than retried on every render, which is
 * the difference between one 403 and one per message view forever.
 */
export async function unfurl(rawUrl: string): Promise<LinkPreview> {
  const cached = await getCachedPreview(rawUrl);
  if (cached && cached.status !== "pending") return cached;

  let result: Omit<LinkPreview, "url" | "fetched_at"> = {
    status: "empty",
    title: null,
    description: null,
    site_name: null,
    image_attachment_id: null,
  };

  try {
    const url = await assertPublicUrl(rawUrl);
    let imageUrl: string | null = null;

    if (isInstagram(url)) {
      // No request at all — see instagramPreview for the measurements.
      result = instagramPreview(url);
    } else {
      const res = await safeFetch(url.toString(), "text/html,application/xhtml+xml");
      if (res.ok && (res.headers.get("content-type") ?? "").includes("html")) {
        const html = (await readCapped(res, MAX_HTML_BYTES)).toString("utf8");
        const title = trim(metaContent(html, ["og:title", "twitter:title"]) ?? titleTag(html), 140);
        const description = trim(
          metaContent(html, ["og:description", "twitter:description", "description"]),
          300,
        );
        // `www.` stripped: the card renders this in small caps, and
        // "WWW.CREXI.COM" reads like a 1998 business card next to "CREXI.COM".
        const siteName =
          trim(metaContent(html, ["og:site_name"]), 60) ?? url.hostname.replace(/^www\./i, "");
        imageUrl = metaContent(html, ["og:image", "og:image:url", "twitter:image"]);
        if (imageUrl) imageUrl = new URL(imageUrl, url).toString();

        result =
          title || description
            ? { status: "ok", title, description, site_name: siteName, image_attachment_id: null }
            : { ...result, site_name: siteName };
      } else {
        // A 403 from a bot shield, or a PDF, or anything else. The message still
        // renders a card; it just carries the domain rather than a photograph.
        // `www.` stripped HERE TOO — this is the branch crexi.com actually
        // takes, so stripping it only on the success path fixed the case that
        // was already fine and left the visible one reading "WWW.CREXI.COM".
        result = { ...result, site_name: url.hostname.replace(/^www\./i, "") };
      }
    }

    if (imageUrl && areUploadsConfigured()) {
      result.image_attachment_id = await storePreviewImage(imageUrl);
    }
  } catch (err) {
    // Includes every refusal from assertPublicUrl. Logged, because someone
    // pasting a link to 169.254.169.254 is worth seeing in the log, and stored
    // as `blocked` so it is never attempted again.
    console.warn("[unfurl] refused or failed", rawUrl, (err as Error)?.message);
    result = { ...result, status: "blocked" };
  }

  const stamp = nowIso();
  const rows = await query<LinkPreview>(
    `INSERT INTO crm_link_previews
       (url, status, title, description, site_name, image_attachment_id, fetched_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
     ON CONFLICT (url) DO UPDATE SET
       status = EXCLUDED.status, title = EXCLUDED.title, description = EXCLUDED.description,
       site_name = EXCLUDED.site_name, image_attachment_id = EXCLUDED.image_attachment_id,
       fetched_at = EXCLUDED.fetched_at, updated_at = EXCLUDED.updated_at
     RETURNING url, status, title, description, site_name, image_attachment_id, fetched_at`,
    [
      rawUrl,
      result.status,
      result.title,
      result.description,
      result.site_name,
      result.image_attachment_id,
      stamp,
    ],
  );
  return rows[0];
}

/** Copy a preview thumbnail into our own store. See the module note. */
async function storePreviewImage(imageUrl: string): Promise<string | null> {
  try {
    const res = await safeFetch(imageUrl, "image/*");
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!isAllowedImageType(type)) return null;
    const bytes = await readCapped(res, MAX_IMAGE_BYTES);
    if (!bytes.byteLength) return null;
    const row = await createAttachment({
      bytes,
      contentType: type,
      fileName: "link-preview",
      // Attributed to the system, not to whoever pasted the link: nobody
      // uploaded this, we went and got it.
      uploadedBy: "system:unfurl",
    });
    return row.id;
  } catch (err) {
    console.warn("[unfurl] preview image failed", (err as Error)?.message);
    return null;
  }
}

/**
 * Unfurl anything in view that has no cached row yet, in the background.
 *
 * SELF-HEALING, and it covers three cases — the third is why it exists. A
 * message posted while the unfurler was failing; older history reached by
 * paging back, which was never unfurled at post time; and a cache row deleted
 * deliberately because the RULES changed. Without this, improving how a site is
 * previewed only ever affects messages sent afterwards, and the link someone is
 * actually looking at keeps its old card forever.
 *
 * Takes the publisher as an argument rather than importing the chat bus, so
 * this module stays about fetching URLs and knows nothing about chat. Never
 * awaited: a preview is decoration, and no page render waits on the network.
 *
 * Each URL is attempted once ever — failures cache as `blocked`/`empty` — so a
 * room full of dead links does not re-attempt them on every open.
 */
export function backfillPreviews(
  urls: string[],
  cached: LinkPreview[],
  onDone: (preview: LinkPreview) => void,
): void {
  const known = new Set(cached.map((p) => p.url));
  const missing = urls.filter((u) => !known.has(u));
  if (!missing.length) return;

  void (async () => {
    for (const url of missing) {
      try {
        onDone(await unfurl(url));
      } catch (err) {
        console.error("[unfurl] backfill failed", url, err);
      }
    }
  })();
}

/**
 * URLs in a message, for unfurling.
 *
 * Our own attachment links are skipped — they are already images and fetching
 * our own auth-gated route from our own server would 401 anyway. Capped at
 * three so one message pasting forty links is not forty outbound requests.
 */
export function urlsIn(text: string, max = 3): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>()[\]"']+/g)) {
    const url = match[0].replace(/[.,;:!?]+$/, "");
    if (url.includes("/api/crm/attachments/")) continue;
    if (!found.includes(url)) found.push(url);
    if (found.length >= max) break;
  }
  return found;
}
