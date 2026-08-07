/**
 * Documents the assistant learns from — the PURE half.
 *
 * THIS MODULE READS NO ENVIRONMENT AND TOUCHES NO NODE API, because the browser
 * imports it: the chat composer and the knowledge library both validate a file
 * before spending a round trip on it. `./knowledge.ts` is the server-only half
 * that extracts text and calls the model, and `./uploads.ts` remains the only
 * file that knows S3 exists. Same split, and the same reason, as
 * `attachments.ts` against `uploads.ts`: `process.env` in a client bundle is
 * silently `undefined`, so a component that resolved its own limits would
 * quietly run on nothing.
 *
 * **A document is NOT an attachment, and the two tables stay apart.** An
 * attachment is an image, and `Markdown.tsx` renders `![](…)` for any id it
 * validates — pointing that at a PDF would render a broken picture. A document
 * is a LINK, `[name](/api/crm/documents/<id>)`, which is what it is: a thing you
 * open rather than a thing you look at. Keeping the tables separate is what
 * keeps the images-only invariant on `crm_attachments` true, which is what makes
 * the Markdown image rule safe.
 */

import type { DocumentStatus } from "./types";

/**
 * 20 MB. Larger than an image's 5 MB, and for a different reason: a document is
 * never re-sent to the model as base64 on every turn — its TEXT is extracted
 * once and the bytes are only ever downloaded by a person. A scanned
 * memorandum is routinely 12 MB and refusing it would be refusing the feature.
 *
 * A CONSTANT, not SSM configuration, for the reason `MAX_ATTACHMENT_BYTES`
 * gives: it is enforced on the server and pre-checked in the browser, and those
 * two may only disagree in one direction. An env-tuned limit raised without a
 * rebuild leaves the browser refusing files the server would take, which reads
 * as a broken button rather than as a stale constant.
 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/**
 * What can actually be read, which is a shorter list than what people will try.
 *
 * An allow-list of formats `./extract.ts` has a real extractor for. Anything
 * else is refused at the door with the reason, because the alternative — storing
 * it and failing later — produces a document that sits in the library forever
 * saying "could not be read" and teaches nobody anything.
 *
 * Deliberately absent:
 * - **`.doc`** (the pre-2007 binary Word format). It is an OLE compound file,
 *   not a zip, and nothing here can open it. "Save as .docx" is a ten-second
 *   fix and a clear message is worth more than a silent failure.
 * - **`image/svg+xml`**, on exactly the grounds `attachments.ts` excludes it: an
 *   SVG is a document that can carry `<script>`, and served from our own origin
 *   it runs with our cookies.
 * - **Scanned PDFs with no text layer** are not excluded — they cannot be, since
 *   nothing about the file says so — but they extract to almost nothing, and
 *   `./knowledge.ts` refuses them by character count rather than pretending.
 */
export const DOCUMENT_KINDS = [
  {
    type: "application/pdf",
    extensions: [".pdf"],
    label: "PDF",
  },
  {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: [".docx"],
    label: "Word (.docx)",
  },
  { type: "text/plain", extensions: [".txt", ".text"], label: "Plain text" },
  { type: "text/markdown", extensions: [".md", ".markdown"], label: "Markdown" },
  { type: "text/csv", extensions: [".csv"], label: "CSV" },
] as const;

export type DocumentType = (typeof DOCUMENT_KINDS)[number]["type"];

/** For the file picker's `accept`, which takes both forms and is happier with both. */
export const DOCUMENT_ACCEPT = DOCUMENT_KINDS.flatMap((k) => [k.type, ...k.extensions]).join(",");

/** "PDF, Word (.docx), plain text, Markdown or CSV" — for an error a person reads. */
export const DOCUMENT_KINDS_SENTENCE = DOCUMENT_KINDS.map((k) => k.label).join(", ");

/**
 * The type of a file, resolved from its NAME as well as its declared MIME type.
 *
 * The extension is checked first and it is the more reliable of the two. A
 * browser's `File.type` for a `.md` is routinely `""`, for a `.csv` it is
 * whatever the OS last associated with Excel (`application/vnd.ms-excel` on
 * Windows), and a drag from some file managers declares
 * `application/octet-stream` for everything. Trusting the MIME type alone means
 * refusing perfectly ordinary files with a message about a type the person
 * never chose.
 *
 * Returns null for anything not on the list, which is the caller's cue to
 * refuse rather than to guess.
 */
export function documentTypeFor(fileName: string | null | undefined, mime?: string | null): DocumentType | null {
  const name = (fileName || "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  if (ext) {
    const byExt = DOCUMENT_KINDS.find((k) => (k.extensions as readonly string[]).includes(ext));
    if (byExt) return byExt.type;
  }
  const declared = (mime || "").toLowerCase().split(";")[0].trim();
  const byMime = DOCUMENT_KINDS.find((k) => k.type === declared);
  return byMime ? byMime.type : null;
}

/** Is this file one we can read at all? The browser's pre-check. */
export function isDocumentFile(fileName: string | null | undefined, mime?: string | null): boolean {
  return documentTypeFor(fileName, mime) !== null;
}

const EXTENSIONS: Record<DocumentType, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
};

export function documentExtension(type: DocumentType): string {
  return EXTENSIONS[type];
}

/** Where the bytes are served from. Auth-gated and proxied — see the route. */
export const DOCUMENT_URL_PREFIX = "/api/crm/documents/";

export function documentUrl(id: string): string {
  return `${DOCUMENT_URL_PREFIX}${id}`;
}

/**
 * The id in one of our own document URLs, or null.
 *
 * Strict for the same reason `attachmentIdFrom` is: this decides whether a link
 * in a message body refers to something of ours, and an id is the shape
 * `newId()` produces. Anything with a scheme, a host, a `..` or a query string
 * is not ours.
 */
export function documentIdFrom(url: string | undefined | null): string | null {
  if (!url || !url.startsWith(DOCUMENT_URL_PREFIX)) return null;
  const id = url.slice(DOCUMENT_URL_PREFIX.length);
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

/**
 * The Markdown an upload inserts into a message.
 *
 * A LINK, not an image — see the module comment. The leading 📄 is content
 * rather than chrome (the distinction `EmojiPicker.tsx` draws), so the reader's
 * own system font rendering it is right.
 */
export function documentMarkdown(name: string, id: string): string {
  const label = name.replace(/[[\]]/g, "").trim() || "document";
  return `📄 [${label}](${documentUrl(id)})`;
}

/**
 * Every document id referenced by a block of text, in order, deduplicated.
 *
 * Matches the URL rather than the `[…](…)` syntax, so a bare paste of the link
 * still counts. The question being answered is "which of our documents does
 * this message point at", not "is this well-formed Markdown".
 */
export function documentIdsIn(text: string): string[] {
  const found = new Set<string>();
  const pattern = new RegExp(`${DOCUMENT_URL_PREFIX}([A-Za-z0-9_-]{8,64})`, "g");
  for (const match of text.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

/**
 * The same text with the document link taken out.
 *
 * For a surface that renders a CARD for the document instead — the chat room,
 * which shows the title, the size and how far the assistant has got with it.
 * Leaving the link in as well would print the file name twice, once as prose and
 * once as a heading three pixels below it.
 *
 * The leading `📄 ` is optional in the pattern even though `documentMarkdown`
 * always writes one: a person who types their own link to a document, or who
 * edits the emoji off, should still get a card rather than a card AND a
 * stranded link. Built per call because a `g` regex carries mutable `lastIndex`.
 */
export function withoutDocumentMarkdown(text: string): string {
  const pattern = new RegExp(
    `(?:📄\\s*)?\\[[^\\]]*\\]\\(${DOCUMENT_URL_PREFIX}[A-Za-z0-9_-]{8,64}\\)`,
    "g",
  );
  return text
    .replace(pattern, "")
    // Removing a block leaves the blank lines that surrounded it behind.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** What the browser and the API agree a document row looks like. */
export interface CrmDocumentSummary {
  id: string;
  title: string;
  file_name: string | null;
  content_type: string;
  byte_size: number;
  status: DocumentStatus;
  /** Set means the note is IN the assistant's prompt. Null means it is not. */
  active_at: string | null;
  activated_by: string | null;
  /** The note the model wrote. Null until it has read the document. */
  skill_md: string | null;
  /** Which model wrote it, so an old note can be judged. Same rule as a meeting summary. */
  skill_model: string | null;
  learned_at: string | null;
  /** Why it could not be read, when `status` is `failed`. */
  error: string | null;
  extracted_chars: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

/** "1.4 MB". Same formatter as an image's, kept here so the browser needs one import. */
export function fmtDocumentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
