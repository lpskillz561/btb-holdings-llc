import { NextResponse } from "next/server";
import { CrmError } from "@/lib/crm/db";
import { withCrmParams } from "@/lib/crm/rest";
import { publish } from "@/lib/crm/chat-bus";
import { getDocument, listDocumentsByIds, relearnDocument } from "@/lib/crm/knowledge-docs";

export const runtime = "nodejs";

/**
 * Read a document again.
 *
 * Its own endpoint rather than a field on the PATCH beside it, because it is a
 * verb and not a state — the same reason attaching a meeting to a client has its
 * own route. It is what recovers a row from three situations:
 *
 * - `failed`, once whatever went wrong has been dealt with. A failed row has its
 *   stored text cleared first, so the extraction genuinely re-runs.
 * - stuck at `learning`, which is what a deploy mid-read leaves behind. Nothing
 *   sweeps those up; this button is the sweep.
 * - `ready`, but read by an older `OPENAI_MODEL`. The stamp on the row is what
 *   makes that visible in the first place.
 *
 * **FIRE-AND-FORGET, exactly like the upload, and the reason is the ALB.** The
 * obvious version awaits the model and answers with the finished row. That
 * version breaks in production and nowhere else: reading a long memorandum is
 * comfortably over a minute, the load balancer closes a connection idle for 60
 * seconds, and the caller would get a 502 for a read that in fact succeeded —
 * then press the button again and pay for a second one. Same trap the SSE
 * heartbeat exists for.
 *
 * So this answers 202 with the row set to `learning`, and the finished row
 * arrives on the chat bus as a `document` event. Every open card is already
 * listening for it, because that is how a fresh upload updates itself.
 */
export const POST = withCrmParams<{ id: string }>(async (_req, { params }) => {
  const row = await getDocument(params.id);
  if (!row) throw new CrmError("That document no longer exists.", 404);

  void relearnDocument(params.id)
    .then((fresh) => {
      const { text_body: _text, storage_key: _key, ...summary } = fresh;
      publish({ type: "document", document: summary });
    })
    .catch(async (err) => {
      console.error("[crm/documents] re-learn failed", params.id, err);
      // Re-read rather than guessed at: `learnDocument` has already written the
      // reason onto the row, and that sentence is the whole point of the card.
      try {
        const [fresh] = await listDocumentsByIds([params.id]);
        if (fresh) publish({ type: "document", document: fresh });
      } catch (announceErr) {
        console.error("[crm/documents] could not announce", params.id, announceErr);
      }
    });

  // The status the row is ABOUT to hold rather than the one it holds now, so the
  // card flips to "being read" on the click instead of a beat later. The write
  // itself is the first thing `learnDocument` does.
  return NextResponse.json({ ...stripped(row), status: "learning", error: null }, { status: 202 });
});

function stripped(row: Awaited<ReturnType<typeof getDocument>> & object) {
  const { text_body: _text, storage_key: _key, ...summary } = row;
  return summary;
}
