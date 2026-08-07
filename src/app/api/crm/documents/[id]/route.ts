import { NextResponse } from "next/server";
import { readBody, withCrmParams } from "@/lib/crm/rest";
import { CrmError } from "@/lib/crm/db";
import { publish } from "@/lib/crm/chat-bus";
import {
  deleteDocument,
  getDocument,
  renameDocument,
  setDocumentActive,
} from "@/lib/crm/knowledge-docs";
import { readDocumentBytes } from "@/lib/crm/uploads";

export const runtime = "nodejs";

/**
 * Download a document.
 *
 * PROXIED, never presigned, and behind `withCrm` like everything else — the
 * same argument the image route makes and one that applies harder here. These
 * are a client's legal and tax documents; a presigned URL handed to a browser
 * is a bearer token for that object which outlives the session that earned it,
 * and one pasted into a message would rot on a timer besides.
 *
 * `Content-Disposition: attachment`, unlike an image's `inline`. A PDF rendered
 * in Chrome's built-in viewer is fine and a .docx is not — the browser downloads
 * it either way, and a consistent "this is a file you are getting" is better
 * than a rule that depends on what the reader's browser can display. The name is
 * the original one so the download is recognisable rather than a bare id.
 */
export const GET = withCrmParams<{ id: string }>(async (_req, { params }) => {
  const row = await getDocument(params.id);
  if (!row) throw new CrmError("That document no longer exists.", 404);

  const bytes = await readDocumentBytes(row.storage_key);

  // Quoted and stripped of anything that could break out of the header. The
  // name came from a file system and has been round-tripped through a database.
  const safeName = (row.file_name || `${row.title || "document"}`).replace(/["\\\r\n]/g, "");

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": row.content_type,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      // One id addresses one immutable object. PRIVATE, because the response is
      // only correct for a reader who passed the session check above and a
      // shared cache holding it would be a hole in exactly that gate.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/**
 * Adopt, withdraw or rename.
 *
 * NOT routed through the generic `resource.ts` PATCH path, deliberately. That
 * path takes an allow-list of columns and writes them, which is right for a
 * record someone is editing and wrong here for two reasons: adopting a document
 * is not a field edit but an act with consequences across every AI surface in
 * the app, and `skill_md` / `skill_model` / `learned_at` must never be writable
 * at all — the same rule as `crm_meetings.summary_md` and
 * `crm_parks.area_analysis`. A hand-edited AI artifact stops being a record of
 * what the model said, and the model stamp beside it becomes a lie.
 *
 * So there are exactly two operations and each has its own function, each of
 * which records who did it.
 */
export const PATCH = withCrmParams<{ id: string }>(async (req, { params, actor }) => {
  const body = await readBody(req);

  let document;
  if (typeof body.title === "string") {
    document = await renameDocument(params.id, body.title);
  } else if (typeof body.active === "boolean") {
    document = await setDocumentActive(params.id, body.active, actor);
  } else {
    throw new CrmError("Send either a new title or whether the document is active.", 400);
  }

  // Announced on the chat bus, so a card in a room two people are looking at
  // stops saying "teach the assistant" the moment somebody else does. Best
  // effort: the write has already happened and the caller has its answer, so a
  // bus that is unhappy must not turn a successful adoption into a 500.
  try {
    publish({ type: "document", document });
  } catch (err) {
    console.error("[crm/documents] could not announce", params.id, err);
  }

  return NextResponse.json(document);
});

/** Delete the row, the note and the bytes. See deleteDocument for why this one
 *  really deletes where proposals and contracts are archived. */
export const DELETE = withCrmParams<{ id: string }>(async (_req, { params }) => {
  await deleteDocument(params.id);
  return new NextResponse(null, { status: 204 });
});
