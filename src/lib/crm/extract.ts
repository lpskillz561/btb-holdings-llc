/**
 * Pulling readable text out of an uploaded document. Server-only.
 *
 * One job, one file: bytes in, plain text out. Nothing here knows what the text
 * is for, which is what keeps `./knowledge.ts` free of format handling and makes
 * adding a format a change in exactly one place.
 *
 * **Both parsers are pure JavaScript and neither has a native dependency**, and
 * that constraint is load-bearing rather than tidy. The app is built on the EC2
 * instance from a tarball, on ARM, with a swapfile doing the heavy lifting — a
 * package needing node-gyp, poppler or libreoffice would fail at `npm ci` on the
 * box and nowhere else, which is the worst place to discover it.
 *
 * - `unpdf` for PDF: a bundled pdf.js with zero dependencies, built for exactly
 *   this (serverless, no filesystem, no worker thread).
 * - `fflate` for DOCX: a docx is a zip, and the text is one XML entry inside it.
 *   `mammoth` is the better-known choice and was rejected — it converts to HTML
 *   (which is thrown away here) and pulls ten transitive dependencies including
 *   bluebird, to do a job that is an unzip and a tag strip.
 *
 * **A PDF with no text layer is the interesting failure**, and it is not an
 * error at this level. A scan extracts to a handful of characters, or to none;
 * this returns whatever it found and the caller decides that is too little. OCR
 * is not attempted and should not be added quietly — it changes the cost and the
 * failure modes of every upload.
 */

import { strFromU8, unzipSync } from "fflate";
import { CrmError } from "./db";
import { documentTypeFor, type DocumentType } from "./documents";

export interface Extracted {
  text: string;
  /** Pages for a PDF, null for everything else. Shown in the library. */
  pages: number | null;
}

/**
 * Below this, whatever came out is not a document anyone can learn from.
 *
 * The number is deliberately low. It is not a quality bar — it is the line
 * between "this is a scan" and "this is text", and a one-page pro forma is 265
 * characters, which the real `docs/` folder proves is a genuine document.
 */
export const MIN_USEFUL_CHARS = 200;

export async function extractDocumentText(
  bytes: Buffer,
  fileName: string | null,
  contentType: string,
): Promise<Extracted> {
  const type = documentTypeFor(fileName, contentType);
  if (!type) throw new CrmError("That file type cannot be read.", 400);
  return extractByType(bytes, type);
}

async function extractByType(bytes: Buffer, type: DocumentType): Promise<Extracted> {
  switch (type) {
    case "application/pdf":
      return extractPdf(bytes);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return { text: tidy(extractDocx(bytes)), pages: null };
    case "text/plain":
    case "text/markdown":
    case "text/csv":
      return { text: tidy(decodeText(bytes)), pages: null };
  }
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                         */
/* -------------------------------------------------------------------------- */

async function extractPdf(bytes: Buffer): Promise<Extracted> {
  // Imported lazily. `unpdf` bundles the whole of pdf.js, and the AI routes that
  // never see a PDF should not pay to parse it into the module graph — this is
  // the same reason the AWS SDK sits behind ./uploads.ts.
  const { extractText, getDocumentProxy } = await import("unpdf");

  let pdf;
  try {
    // A COPY of the bytes, not a view onto the Buffer. pdf.js takes ownership of
    // the array it is handed and transfers it away, and a Buffer is a view onto
    // a pooled ArrayBuffer that Node reuses for other allocations — handing that
    // over detaches memory belonging to something else entirely.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    // An encrypted or corrupt PDF lands here. It is the person's problem, not
    // ours, so it is a 400 naming the likely cause rather than a 500.
    throw new CrmError(
      "That PDF could not be opened. If it is password-protected, remove the password and upload it again.",
      400,
    );
  }

  // `mergePages` is what makes `text` a single string rather than one entry per
  // page. Per-page text is not wanted here: a clause that straddles a page break
  // should reach the model as one sentence, and page numbers are not something
  // anyone asks a chat assistant about.
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { text: tidy(text), pages: totalPages };
}

/* -------------------------------------------------------------------------- */
/* DOCX                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The text of a .docx.
 *
 * A docx is a zip; `word/document.xml` is the body. The tag strip is crude on
 * purpose — this is feeding a language model, not rebuilding the document — but
 * the three replacements before it are not optional, and each was verified
 * against the real agreements in `docs/`:
 *
 * - `</w:p>` is a PARAGRAPH end. Without a newline there, the entire Management
 *   Agreement extracts as one unbroken line and its numbered clauses run into
 *   each other, which is precisely the structure that makes it readable.
 * - `<w:tab/>` is the indent on every numbered clause. Dropped, "1." and its
 *   text collide.
 * - `<w:br/>` is a soft line break, which is what a signature block is made of.
 *
 * Entities are decoded LAST, after the tags are gone, and `&amp;` last of all —
 * decoding it first would turn `&amp;lt;` into `<` and reintroduce markup that
 * the strip has already run past.
 */
function extractDocx(bytes: Buffer): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new CrmError(
      "That .docx could not be opened — it may be damaged, or it may be an older .doc saved with the wrong extension.",
      400,
    );
  }

  const body = entries["word/document.xml"];
  if (!body) {
    throw new CrmError(
      "That file is a zip but not a Word document. Save it as .docx and try again.",
      400,
    );
  }

  // Footnotes and endnotes carry the citations in a legal memorandum, which is
  // often the most quotable part of it. Absent from most documents; appended
  // when present so they do not interleave with the body text.
  const parts = [body, entries["word/footnotes.xml"], entries["word/endnotes.xml"]]
    .filter(Boolean)
    .map((part) => strFromU8(part as Uint8Array));

  return parts
    .map((xml) =>
      xml
        .replace(/<w:tab\b[^>]*\/?>/g, "\t")
        .replace(/<w:br\b[^>]*\/?>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&amp;/g, "&"),
    )
    .join("\n\n");
}

/* -------------------------------------------------------------------------- */
/* Plain text                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Bytes to a string, honouring a UTF-8 BOM.
 *
 * Excel writes CSV with a BOM, and it is the single most common way a document
 * arrives here from a finance person. Left in place it becomes a U+FEFF at the
 * head of the text, which is invisible everywhere except in the first column
 * heading of a table the model then quotes back wrong.
 */
function decodeText(bytes: Buffer): string {
  const text = bytes.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/* -------------------------------------------------------------------------- */

/**
 * Normalise whitespace without destroying structure.
 *
 * Blank lines are meaningful — they are what separates a clause from the next —
 * so runs are collapsed to two rather than to one. Non-breaking spaces and the
 * soft hyphen come out of every PDF and are invisible to a reader and
 * significant to a tokeniser.
 */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // Non-breaking, narrow no-break and zero-width spaces, then the soft hyphen.
    // Written as escapes rather than as literal glyphs, because a "space" in
    // this file that is really a U+00A0 is a bug nobody can see in an editor.
    .replace(/[\u00a0\u202f\u200b]/g, " ")
    .replace(/\u00ad/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
