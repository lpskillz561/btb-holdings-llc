/**
 * Documents the assistant learns from — the SERVER half.
 *
 * Someone uploads a PDF, a Word file or a spreadsheet export; the text is pulled
 * out of it; the model reads that text and WRITES A NOTE in the register of
 * `./knowledge/SKILL.md`; a person reads the note and decides whether it joins
 * the knowledge base. Only then does it reach a prompt.
 *
 * ## Why there is a human in the middle
 *
 * `SKILL.md` is the file that keeps every AI surface from describing a deal BTB
 * does not sell — the 7-day test, a non-recourse note, land the client owns. It
 * is in git, it is reviewed, and `loadSkill()` THROWS rather than let the model
 * answer without it. A feature that lets anyone drop a PDF into a chat window
 * and have its contents silently join that file would undo the whole
 * arrangement: the next generated proposal would be grounded in whatever a
 * counterparty last emailed us, and nobody would know.
 *
 * So the note is written automatically and adopted deliberately. `active_at` is
 * the whole gate, it is one click, and until it is set the note is a draft
 * sitting in the library. That click is the same act as editing `SKILL.md`,
 * which is what it is.
 *
 * ## Where this sits against SKILL.md
 *
 * `SKILL.md` is DOCTRINE and this is REFERENCE. The house file says what the
 * deal IS; a learned note says what some particular document SAYS. The prompt
 * states that precedence explicitly and every note is attributed to its
 * document, because the failure to avoid is the model quoting a prospect's
 * marketing PDF back to a taxpayer as if it were our own legal opinion.
 *
 * The model is told, in as many words, NOT to restate the house doctrine — that
 * is the "two copies that can disagree" bug that put the 7-day test in a prompt
 * — and to NAME any place its document contradicts the house view rather than
 * quietly reconciling the two. Those contradictions are the most valuable thing
 * this feature produces. They are the same instinct as "Points to check" on a
 * meeting summary.
 *
 * ## What is NOT here
 *
 * The functions that turn adopted notes into prompt text — `learnedKnowledge`
 * and `documentReadingContext` — live in `./ai.ts` beside every other
 * context builder, and not because that is tidier. This module imports `ai.ts`
 * in order to call the model, so `ai.ts` importing back would be a cycle: it
 * happens to work under ES module semantics, and it is the kind of thing that
 * works until a bundler orders the two differently. Prompt assembly belongs in
 * the prompt-assembly file; this one owns rows and bytes.
 *
 * NOT importable from the browser or from Edge middleware — it reaches S3, runs
 * a PDF parser and calls OpenAI. `./documents.ts` is the pure half.
 */

import { MODEL, buildSystemPrompt, isAiConfigured, structuredChat } from "./ai";
import { CrmError, newId, nowIso, query, queryOne } from "./db";
import {
  MAX_DOCUMENT_BYTES,
  documentExtension,
  documentTypeFor,
  fmtDocumentBytes,
  type CrmDocumentSummary,
} from "./documents";
import { MIN_USEFUL_CHARS, extractDocumentText } from "./extract";
import { deleteDocumentObject, putDocumentObject, readDocumentBytes } from "./uploads";

/** The row, including the columns no API hands out whole. */
export interface CrmDocument extends CrmDocumentSummary {
  storage_key: string;
  text_body: string | null;
}

/** Everything except the extracted text, which is the only large column. */
const SUMMARY_COLUMNS = `id, title, file_name, content_type, byte_size, status, active_at,
  activated_by, skill_md, skill_model, learned_at, error, extracted_chars, uploaded_by,
  created_at, updated_at`;

/* -------------------------------------------------------------------------- */
/* Budgets                                                                     */
/*                                                                             */
/* Three separate caps, because they protect three different things.           */
/* -------------------------------------------------------------------------- */

/**
 * How much of one document the model reads when writing its note.
 *
 * Roughly 30,000 tokens. The real `docs/` folder sets the scale: the
 * Memorandum of Law is 32,000 characters and *Shirley* is 20,000, so this fits
 * the documents this feature exists for several times over. Beyond it the text
 * is elided in the middle rather than truncated — see `forReading`.
 */
const MAX_READ_CHARS = 120_000;

/** How much of one note reaches a prompt. A note longer than this is a summary
 *  that failed to summarise, and it is trimmed with the fact said out loud. */
const MAX_NOTE_CHARS = 8_000;

/**
 * How much learned knowledge reaches a prompt IN TOTAL, across every active
 * document.
 *
 * This is the cap that matters. `SKILL.md` plus record context is already a
 * substantial system prompt, and the failure this prevents is not cost — it is
 * that an unbounded appendix pushes the house doctrine far enough down the
 * prompt to stop governing the answer. Documents over the line are dropped
 * OLDEST-ACTIVATED FIRST and the fact is logged, because a silent cap reads as
 * "the assistant has read everything" when it has not.
 */
const MAX_KNOWLEDGE_CHARS = 40_000;

/* -------------------------------------------------------------------------- */
/* Storing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Store an uploaded document and record it.
 *
 * Validation is here rather than only in the route, because this is the choke
 * point every caller passes through and the browser's pre-check is a courtesy.
 * The type is resolved from the FILE NAME as well as the declared MIME type —
 * see `documentTypeFor` for why a `.md` arriving as `""` is normal.
 *
 * The row lands as `pending`. Reading it is a separate step so that the upload
 * answers immediately: extracting a 400-page PDF and calling a model is fifteen
 * seconds, and a file picker that hangs for fifteen seconds is a broken button.
 */
export async function createDocument(args: {
  bytes: Buffer;
  fileName: string | null;
  contentType: string;
  title?: string | null;
  uploadedBy: string;
}): Promise<CrmDocument> {
  const type = documentTypeFor(args.fileName, args.contentType);
  if (!type) {
    throw new CrmError(
      `That file type can't be read. Upload a PDF, a Word .docx, or plain text, Markdown or CSV.`,
      400,
    );
  }
  if (args.bytes.byteLength === 0) throw new CrmError("That file is empty.", 400);
  if (args.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new CrmError(
      `That document is ${fmtDocumentBytes(args.bytes.byteLength)}. The limit is ${fmtDocumentBytes(MAX_DOCUMENT_BYTES)}.`,
      400,
    );
  }

  const id = newId();
  // S3 FIRST, then the row — the same order, and the same reasoning, as
  // createAttachment. The other way round can leave a row promising bytes that
  // were never written; this way round can leave an orphaned object, which
  // costs a fraction of a cent and is invisible.
  const key = await putDocumentObject({
    id,
    bytes: args.bytes,
    contentType: type,
    extension: documentExtension(type),
  });

  const stamp = nowIso();
  const rows = await query<CrmDocument>(
    `INSERT INTO crm_documents
       (id, storage_key, content_type, byte_size, file_name, title, status,
        uploaded_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $8)
     RETURNING ${SUMMARY_COLUMNS}, storage_key, NULL::text AS text_body`,
    [
      id,
      key,
      type,
      args.bytes.byteLength,
      args.fileName,
      titleFor(args.title, args.fileName),
      args.uploadedBy,
      stamp,
    ],
  );
  return rows[0];
}

/**
 * A readable title from a file name.
 *
 * "Frank Aragona Trust v Commr 142 TC No 9 Docket No 1539211.pdf" is not a
 * title, but it is much better than "Untitled", so the extension and the worst
 * of the punctuation come off and the rest is left alone. The model proposes a
 * better one when it reads the document; this is what the row carries in the
 * seconds before that, and what it keeps if reading fails.
 */
function titleFor(given: string | null | undefined, fileName: string | null): string {
  const explicit = String(given ?? "").trim();
  if (explicit) return explicit.slice(0, 200);
  const base = (fileName || "").replace(/\.[a-z0-9]{1,8}$/i, "").replace(/[_]+/g, " ").trim();
  return (base || "Untitled document").slice(0, 200);
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** The JSON the model returns. Every field is required — see the schema below. */
interface LearnedNote {
  title: string;
  one_line: string;
  skill_md: string;
  conflicts: string[];
}

const LEARN_SCHEMA = {
  name: "learned_document",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "one_line", "skill_md", "conflicts"],
    properties: {
      title: {
        type: "string",
        description:
          "A short title for this document as a person would file it. No file extension, no version suffix.",
      },
      one_line: {
        type: "string",
        description: "One sentence: what this document is and who wrote it.",
      },
      skill_md: {
        type: "string",
        description:
          "The knowledge-base note, in Markdown. This is what the assistant will be taught.",
      },
      conflicts: {
        type: "array",
        items: { type: "string" },
        description:
          "Every place this document disagrees with the house knowledge base, or with itself. Empty if there are none.",
      },
    },
  },
} as const;

/**
 * What the model is asked to produce.
 *
 * Written as instructions to a person who is being asked to brief a colleague,
 * because that is the job. The four prohibitions at the end are the ones this
 * codebase has already paid for:
 *
 * 1. **Do not restate the house doctrine.** A note that re-explains the 30-day
 *    test is a second copy of it that can drift, which is the exact bug that put
 *    the 7-day §469 test into a prompt and had every generated proposal
 *    describing a deal BTB does not sell.
 * 2. **Do not compute money.** The rule the whole app is built on: figures are
 *    computed in `economics.ts`, frozen, and handed over as given facts.
 * 3. **Name contradictions, do not resolve them.** `SKILL.md` already records
 *    where the source documents contradict themselves — the pro forma's 70% and
 *    20 nights, the deck's FULL PURCHASE column. Laundering a discrepancy is
 *    worse than surfacing it, because the discrepancy is what a CPA will find.
 * 4. **Say what it does not say.** A document being silent on a term is a fact
 *    about the document, and inventing the term is the failure mode that makes
 *    this whole feature dangerous rather than useful.
 */
const LEARN_INSTRUCTIONS = `A member of staff has uploaded a document and wants you to learn it, so that you can answer questions about it later with the same authority you answer questions about the house knowledge base.

Write a note for the knowledge base. Someone will read it before it is adopted, so write it for them.

The note ("skill_md") should:

- Open with one line saying what the document is, who wrote it, and what it governs or argues.
- State the facts, terms, figures, authorities, dates, parties and obligations that someone would need in order to answer a question about this document without opening it. Be specific. A number, a section reference or a party name is worth more than a paragraph of characterisation.
- Quote sparingly and exactly. A defined term, an operative clause or a holding is worth quoting; prose is not.
- Note what the document does NOT address, where that is likely to be asked.
- Use Markdown headings and bullets. Aim for the length the document deserves — a one-page pro forma is a short note; a legal memorandum is a long one.

The note must NOT:

- Restate the house knowledge base, or any note under "LEARNED DOCUMENTS" that is already in your prompt. That material is already there, and a second copy of it is a copy that can drift out of date. Write only what THIS document adds.
- Calculate anything. Report figures the document itself states; never derive, total, reconcile or annualise one. If a figure the reader will want is absent, say it is absent.
- Smooth over a disagreement. If the document contradicts the house knowledge base, or contradicts itself, put it in "conflicts" AND say so plainly in the note. That is the most useful thing you can produce here.
- Assert anything the document does not say. If it is silent on a term, say it is silent.

"conflicts" is a list of one-sentence statements, each naming a specific disagreement between this document and the house knowledge base, or an internal inconsistency in the document. Return an empty list if there genuinely are none — do not invent one.`;

/**
 * Read a document and write its note.
 *
 * Idempotent in the way that matters: it can be re-run on any row at any time
 * and simply overwrites the note. It deliberately does NOT clear `active_at` —
 * a re-learn of a document the team has adopted keeps it adopted, because the
 * alternative is that fixing a typo in a title silently removes a document from
 * the assistant's knowledge.
 *
 * The status transitions are written to the row before and after the model call
 * so the library can show "being read" rather than appearing to do nothing for
 * fifteen seconds. That means a process that dies mid-call leaves a row stuck at
 * `learning`; `relearnDocument` is reachable from the UI for exactly that.
 */
export async function learnDocument(id: string): Promise<CrmDocument> {
  const row = await getDocument(id);
  if (!row) throw new CrmError("That document no longer exists.", 404);
  if (!isAiConfigured()) {
    throw new CrmError(
      "The assistant is not configured, so documents cannot be read. Set OPENAI_API_KEY and redeploy.",
      503,
    );
  }

  await query(`UPDATE crm_documents SET status = 'learning', error = NULL, updated_at = $2 WHERE id = $1`, [
    id,
    nowIso(),
  ]);

  try {
    // Re-extract only when the text is not already on the row. A re-learn after
    // a model change should not re-download the object and re-run pdf.js to
    // arrive at a string the row already holds.
    let text = row.text_body?.trim() || "";
    let extractedChars = row.extracted_chars;
    if (!text) {
      const bytes = await readDocumentBytes(row.storage_key);
      const extracted = await extractDocumentText(bytes, row.file_name, row.content_type);
      text = extracted.text;
      extractedChars = text.length;
      if (text.length < MIN_USEFUL_CHARS) {
        // Almost always a scan. Said plainly, with the thing to do about it —
        // "could not be read" on its own sends someone to re-upload the same
        // file and get the same answer.
        throw new CrmError(
          `Only ${text.length} characters of text came out of that file. It is probably a scan or a photo rather than a text document, and there is no OCR here — run it through a "make searchable"/OCR step and upload it again.`,
          422,
        );
      }
      await query(
        `UPDATE crm_documents SET text_body = $2, extracted_chars = $3, updated_at = $4 WHERE id = $1`,
        [id, text, extractedChars, nowIso()],
      );
    }

    // BASE_PROMPT + SKILL.md, with no record context: the model needs the house
    // view in order to spot where the document disagrees with it, and it needs
    // nothing at all about any particular client. Never call the model directly
    // from here — a note written without SKILL.md would describe the generic
    // tiny-home strategy, which is the whole failure this app is built against.
    const system = await buildSystemPrompt(null);

    const note = await structuredChat<LearnedNote>(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: `${LEARN_INSTRUCTIONS}

---

Document file name: ${row.file_name || "(none)"}
Working title: ${row.title}

--- BEGIN DOCUMENT TEXT ---

${forReading(text)}

--- END DOCUMENT TEXT ---`,
        },
      ],
      LEARN_SCHEMA,
    );

    const skill = composeNote(note);
    const stamp = nowIso();
    const rows = await query<CrmDocument>(
      `UPDATE crm_documents
          SET status = 'ready', error = NULL, skill_md = $2, skill_model = $3,
              learned_at = $4, title = $5, extracted_chars = $6, updated_at = $4
        WHERE id = $1
      RETURNING ${SUMMARY_COLUMNS}, storage_key, NULL::text AS text_body`,
      [id, skill, MODEL, stamp, titleFor(note.title, row.file_name), extractedChars],
    );
    return rows[0];
  } catch (err) {
    // The reason is stored on the row, not just logged. Someone looking at the
    // library needs to know whether to re-upload, to OCR, or to wait — and a
    // CrmError raised here already carries a sentence written for them.
    const message =
      err instanceof CrmError ? err.message : "Something went wrong while reading that document.";
    console.error("[crm/knowledge] learn failed", id, err);
    await query(
      `UPDATE crm_documents SET status = 'failed', error = $2, updated_at = $3 WHERE id = $1`,
      [id, message.slice(0, 1000), nowIso()],
    );
    throw err instanceof CrmError ? err : new CrmError(message, 500);
  }
}

/**
 * A document long enough to need trimming, trimmed HONESTLY.
 *
 * The middle is dropped rather than the tail. A memorandum's conclusion, an
 * agreement's signature block and a schedule's totals all live at the end, and
 * truncating at a character count throws away exactly the part a reader would
 * have turned to first. The elision says how much went, so the model can say so
 * too rather than describing a partial document as if it were whole.
 */
function forReading(text: string): string {
  if (text.length <= MAX_READ_CHARS) return text;
  const head = Math.floor(MAX_READ_CHARS * 0.7);
  const tail = MAX_READ_CHARS - head;
  const dropped = text.length - MAX_READ_CHARS;
  return `${text.slice(0, head)}

[… ${dropped.toLocaleString("en-GB")} characters from the middle of this document were omitted to fit. You are reading the beginning and the end. Say so if the answer depends on what was left out. …]

${text.slice(-tail)}`;
}

/** The note as it is stored: what the model wrote, plus its conflicts, verbatim. */
function composeNote(note: LearnedNote): string {
  const parts = [note.one_line.trim(), note.skill_md.trim()].filter(Boolean);
  if (note.conflicts.length) {
    // Its own heading, and phrased as a warning rather than as trivia. This is
    // the section that earns the feature, the same way "Points to check" earns
    // the meeting summary.
    parts.push(
      `## Where this document disagrees\n${note.conflicts
        .map((c) => `- ${c.trim()}`)
        .filter((c) => c.length > 2)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

export async function getDocument(id: string): Promise<CrmDocument | null> {
  return queryOne<CrmDocument>(
    `SELECT ${SUMMARY_COLUMNS}, storage_key, text_body FROM crm_documents WHERE id = $1`,
    [id],
  );
}

/** Without the text body, which is the only column big enough to matter. */
export async function listDocuments(): Promise<CrmDocumentSummary[]> {
  return query<CrmDocumentSummary>(
    `SELECT ${SUMMARY_COLUMNS} FROM crm_documents ORDER BY created_at DESC`,
  );
}

/** The ones referenced by a chat message, for the card under it. */
export async function listDocumentsByIds(ids: string[]): Promise<CrmDocumentSummary[]> {
  if (!ids.length) return [];
  return query<CrmDocumentSummary>(
    `SELECT ${SUMMARY_COLUMNS} FROM crm_documents WHERE id = ANY($1) ORDER BY created_at`,
    [ids],
  );
}

/**
 * Adopt a document into the knowledge base, or withdraw it.
 *
 * WHO adopted it is recorded, because this is the one action here with
 * consequences beyond the library: from this moment the note is in the system
 * prompt of proposal drafting, the client advisor, the meeting summariser, every
 * Ask AI panel and the chat room. That is a decision someone made, and the row
 * should say who.
 *
 * A document that has not been read successfully cannot be adopted — there is no
 * note to adopt, and allowing it would put an empty section in every prompt.
 */
export async function setDocumentActive(
  id: string,
  active: boolean,
  actor: string,
): Promise<CrmDocumentSummary> {
  const row = await queryOne<{ status: string; skill_md: string | null }>(
    `SELECT status, skill_md FROM crm_documents WHERE id = $1`,
    [id],
  );
  if (!row) throw new CrmError("That document no longer exists.", 404);
  if (active && (row.status !== "ready" || !row.skill_md?.trim())) {
    throw new CrmError(
      "The assistant has not read that document yet, so there is nothing to teach it.",
      409,
    );
  }

  const stamp = nowIso();
  const rows = await query<CrmDocumentSummary>(
    `UPDATE crm_documents
        SET active_at = $2, activated_by = $3, updated_at = $4
      WHERE id = $1
    RETURNING ${SUMMARY_COLUMNS}`,
    [id, active ? stamp : null, active ? actor : null, stamp],
  );
  return rows[0];
}

/** Rename. The only field on this table a person may type into. */
export async function renameDocument(id: string, title: unknown): Promise<CrmDocumentSummary> {
  const next = String(title ?? "").trim();
  if (!next) throw new CrmError("A document needs a title.", 400);
  const rows = await query<CrmDocumentSummary>(
    `UPDATE crm_documents SET title = $2, updated_at = $3 WHERE id = $1
     RETURNING ${SUMMARY_COLUMNS}`,
    [id, next.slice(0, 200), nowIso()],
  );
  if (!rows.length) throw new CrmError("That document no longer exists.", 404);
  return rows[0];
}

/** Re-read a document that failed, or that was read by an older model. */
export async function relearnDocument(id: string): Promise<CrmDocument> {
  // The stored text is cleared first, so a re-learn after a FAILED extraction
  // actually re-extracts. Without this, a row that failed on a truncated
  // download would re-read the same bad text forever and report the same error.
  await query(`UPDATE crm_documents SET text_body = NULL WHERE id = $1 AND status = 'failed'`, [id]);
  return learnDocument(id);
}

/**
 * Delete a document, its note and its bytes.
 *
 * A real delete, not an archive, and it is the exception to this app's
 * archive-never-delete rule rather than a violation of it. That rule protects
 * the record of what was quoted to a client — a withdrawn proposal is a fact
 * about the deal. A document someone uploaded to teach the assistant is not part
 * of any client's history; it is a reference book on a shelf, and taking one off
 * the shelf should take it off the shelf.
 */
export async function deleteDocument(id: string): Promise<void> {
  const row = await getDocument(id);
  if (!row) return;
  // The object first. If S3 refuses, the row survives and the delete can be
  // retried; the other order leaves bytes in the bucket that nothing points at.
  try {
    await deleteDocumentObject(row.storage_key);
  } catch (err) {
    console.error("[crm/knowledge] could not delete object, removing row anyway", row.storage_key, err);
  }
  await query(`DELETE FROM crm_documents WHERE id = $1`, [id]);
}
