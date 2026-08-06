/**
 * Image attachments — the PURE half.
 *
 * THIS MODULE READS NO ENVIRONMENT AND TOUCHES NO NODE API, because the browser
 * imports it: the paste-to-upload control validates a file before spending a
 * round trip on it, and the Markdown renderer uses `attachmentIdFrom` to decide
 * whether an `<img>` is ours. `./uploads.ts` is the server-only half that knows
 * S3 exists. Same split, and the same reason, as `equipment.ts` against
 * `equipmentConfig()`: `process.env` in a client bundle is silently `undefined`,
 * so a component that resolved its own limits would quietly run on nothing.
 *
 * THE SIZE LIMIT IS A CONSTANT, NOT CONFIGURATION, and that is deliberate. It
 * is enforced on the server and pre-checked in the browser, and those two are
 * only allowed to disagree in one direction — the server may reject what the
 * browser accepted, never the reverse. An SSM-tuned limit would drift the
 * moment someone raised it without a rebuild: the browser would go on refusing
 * a file the server would have taken, and the failure would look like a broken
 * upload button rather than a stale constant.
 *
 * An attachment is addressed by its id and nothing else. The URL below is a
 * STABLE app route, not a presigned S3 link — a presigned URL embedded in the
 * body of a comment would stop working the day its signature expired, which is
 * to say every image in the history would rot on a timer.
 */

/** 5 MB. Big enough for a full-resolution screenshot, small enough to send to
 *  the model as base64 without the request becoming the problem. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * Images only, and an explicit allow-list rather than a `image/*` prefix test.
 *
 * `image/svg+xml` is EXCLUDED ON PURPOSE and must stay excluded. An SVG is a
 * document, not a picture: it can carry `<script>`, and served from our own
 * origin it would execute with our cookies. Everything here is a raster format
 * a decoder cannot be talked into running.
 */
export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type AttachmentType = (typeof ALLOWED_IMAGE_TYPES)[number];

export function isAllowedImageType(type: string): type is AttachmentType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

const EXTENSIONS: Record<AttachmentType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function extensionFor(type: AttachmentType): string {
  return EXTENSIONS[type];
}

/** Where the bytes are served from. Auth-gated — see the route. */
export const ATTACHMENT_URL_PREFIX = "/api/crm/attachments/";

export function attachmentUrl(id: string): string {
  return `${ATTACHMENT_URL_PREFIX}${id}`;
}

/**
 * The id in one of our own attachment URLs, or null for anything else.
 *
 * This is the gate the Markdown renderer uses, so it has to be strict rather
 * than merely helpful: an id is the same shape `newId()` produces, and anything
 * with a scheme, a host, a `..` or a query string is not ours. Returning null
 * for a remote URL is what stops a comment from embedding a tracking pixel that
 * reports who read the card and when, and from pointing the browser at an
 * arbitrary host on our users' behalf.
 */
export function attachmentIdFrom(url: string | undefined | null): string | null {
  if (!url || !url.startsWith(ATTACHMENT_URL_PREFIX)) return null;
  const id = url.slice(ATTACHMENT_URL_PREFIX.length);
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

/** The Markdown an upload inserts into a comment or a description. */
export function attachmentMarkdown(name: string, id: string): string {
  // Brackets in the alt text would close it early and leave the link dangling
  // as literal text. Names come from the file system, so this is not academic —
  // "Screenshot [1].png" is what a browser hands over after a second save.
  const alt = name.replace(/[[\]]/g, "").trim() || "image";
  return `![${alt}](${attachmentUrl(id)})`;
}

/**
 * Every attachment id referenced by a block of Markdown, in order, deduplicated.
 *
 * Used to decide which images ride along to the model. It matches the URL
 * rather than the `![...]()` syntax, so an image someone wrote as a bare link
 * still counts — the question being answered is "which of our images does this
 * message point at", not "is this well-formed Markdown".
 */
export function attachmentIdsIn(text: string): string[] {
  const found = new Set<string>();
  const pattern = new RegExp(`${ATTACHMENT_URL_PREFIX}([A-Za-z0-9_-]{8,64})`, "g");
  for (const match of text.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

/** `![alt](/api/crm/attachments/<id>)`, with the alt captured. Built per call
 *  because a `g` regex carries mutable `lastIndex` and a shared one is a
 *  cross-call bug waiting for the second caller. */
function imageMarkdownPattern(): RegExp {
  return new RegExp(`!\\[([^\\]]*)\\]\\(${ATTACHMENT_URL_PREFIX}[A-Za-z0-9_-]{8,64}\\)`, "g");
}

/**
 * Replace image Markdown with a short note naming it.
 *
 * For the model. The image itself is sent alongside as a real vision part, so
 * leaving `![Screenshot](/api/crm/attachments/xyz)` in the text would hand it a
 * URL it cannot fetch and might repeat back to the reader as if it were a
 * source. The alt text survives, because "the error in the sidebar.png" is
 * often the only thing saying which of three screenshots is meant.
 */
export function describeAttachments(text: string): string {
  return text.replace(imageMarkdownPattern(), (_whole, alt: string) =>
    alt.trim() ? `[attached image: ${alt.trim()}]` : "[attached image]",
  );
}

/**
 * The same text with the image Markdown taken out entirely.
 *
 * For a surface that renders the images ITSELF and only needs the prose — the
 * AI panel's own message bubbles, which show a user's text verbatim rather than
 * as Markdown. Without this a pasted screenshot appears there as a line of
 * literal `![](…)` next to the picture it refers to.
 */
export function withoutAttachmentMarkdown(text: string): string {
  return text
    .replace(imageMarkdownPattern(), "")
    // Removing a block leaves the blank lines that surrounded it behind.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "1.4 MB" — for the upload error, which has to name a number to be useful. */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
