import { NextResponse } from "next/server";
import { withCrm } from "@/lib/crm/rest";
import { CrmError } from "@/lib/crm/db";
import { publish } from "@/lib/crm/chat-bus";
import {
  createDocument,
  learnDocument,
  listDocuments,
  listDocumentsByIds,
} from "@/lib/crm/knowledge-docs";
import {
  MAX_DOCUMENT_BYTES,
  fmtDocumentBytes,
  isDocumentFile,
  documentUrl,
  type CrmDocumentSummary,
} from "@/lib/crm/documents";

export const runtime = "nodejs";

/** The library, newest first. The text bodies are not selected — see listDocuments. */
export const GET = withCrm(async () => {
  return NextResponse.json({ documents: await listDocuments() });
});

/**
 * Upload a document for the assistant to read.
 *
 * `multipart/form-data` for the reason the image route gives: base64 inflates
 * the body by a third for no gain, and the browser already has `FormData`.
 *
 * **The response is sent before the document has been read, and that is the
 * design.** Extracting a 400-page PDF and asking a model to write a note on it
 * is ten to twenty seconds; a file picker that hangs for twenty seconds is a
 * broken button, and the row already exists and is visible as "waiting to be
 * read" the moment this returns. The reading is kicked off `void`, exactly like
 * the chat route's unfurl and AI reply, and it records its own outcome on the
 * row — including its failure, which is why nothing here needs to hear back.
 *
 * The uploader is the SESSION, never the body. Everything a caller says about
 * itself is a claim.
 */
export const POST = withCrm(async (req, { actor }) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new CrmError("Expected a file upload.", 400);

  const file = form.get("file");
  if (!(file instanceof File)) throw new CrmError("No file was attached.", 400);

  // Both checks BEFORE the bytes are read into memory. `file.size` comes from
  // the multipart part's own length, so a 200 MB upload is refused without
  // first buffering 200 MB to find out it was too big — and the type check
  // saves buffering a 19 MB video only to reject it a line later.
  if (!isDocumentFile(file.name, file.type)) {
    throw new CrmError(
      `${file.name || "That file"} can't be read. Upload a PDF, a Word .docx, or plain text, Markdown or CSV. (An old .doc must be saved as .docx first.)`,
      400,
    );
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new CrmError(
      `That document is ${fmtDocumentBytes(file.size)}. The limit is ${fmtDocumentBytes(MAX_DOCUMENT_BYTES)}.`,
      400,
    );
  }

  const row = await createDocument({
    bytes: Buffer.from(await file.arrayBuffer()),
    fileName: file.name || null,
    contentType: file.type,
    title: typeof form.get("title") === "string" ? String(form.get("title")) : null,
    uploadedBy: actor,
  });

  // Fire-and-forget, with its own catch. An unhandled rejection here would take
  // the Node process down, and a document that cannot be read must never cost
  // someone the upload — the row carries the reason and the library offers a
  // "read it again" button.
  //
  // The outcome is announced on the chat bus either way, which is what turns the
  // card under a pasted PDF from "being read" into "read — teach the assistant?"
  // without anyone reloading. On failure the row is re-read rather than guessed
  // at, because `learnDocument` has already written the reason onto it and that
  // sentence is the whole point of showing the card at all.
  void learnDocument(row.id)
    .then((fresh) => announce(fresh.id, fresh))
    .catch(async (err) => {
      console.error("[crm/documents] background learn failed", row.id, err);
      await announce(row.id);
    });

  return NextResponse.json(
    {
      id: row.id,
      url: documentUrl(row.id),
      title: row.title,
      file_name: row.file_name,
      content_type: row.content_type,
      byte_size: row.byte_size,
      status: row.status,
      active_at: row.active_at,
    },
    { status: 201 },
  );
});

/** Push a document's current state to every open browser. Never throws — a bus
 *  that is unhappy must not turn a successful read into a failed one. */
async function announce(id: string, known?: CrmDocumentSummary): Promise<void> {
  try {
    const document = known ?? (await listDocumentsByIds([id]))[0];
    if (document) publish({ type: "document", document });
  } catch (err) {
    console.error("[crm/documents] could not announce", id, err);
  }
}
