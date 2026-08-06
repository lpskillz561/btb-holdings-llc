import { NextResponse } from "next/server";
import { withCrmParams } from "@/lib/crm/rest";
import { CrmError } from "@/lib/crm/db";
import { getAttachment, readAttachmentBytes } from "@/lib/crm/uploads";

export const runtime = "nodejs";

/**
 * Serve an image.
 *
 * This is the `src` of every `<img>` the app renders, which means it is fetched
 * by the browser rather than by our own code — and it is still behind `withCrm`.
 * That is the entire access-control story for attachments: the bucket is
 * private with no policy, nothing is presigned, and an image of a client's tax
 * return pasted into a card is exactly as reachable as the card is.
 *
 * A browser sends cookies on an `<img>` request to a same-origin URL, so this
 * needs nothing special on the markup side. A signed-out session gets a 401
 * here and a broken image, which is the correct outcome — `SessionWatch` is
 * what turns that into a sentence the reader can act on.
 *
 * `Content-Disposition: inline` with the original filename: inline so it
 * renders rather than downloads, and named so "save image as" produces
 * something recognisable rather than a bare id.
 */
export const GET = withCrmParams<{ id: string }>(async (_req, { params }) => {
  const row = await getAttachment(params.id);
  if (!row) throw new CrmError("That image no longer exists.", 404);

  const bytes = await readAttachmentBytes(row);

  // Quoted and stripped of anything that could break out of the header. The
  // name came from a file system and has been round-tripped through a database.
  const safeName = (row.file_name || `image-${row.id}`).replace(/["\\\r\n]/g, "");

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": row.content_type,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${safeName}"`,
      // An attachment id addresses one immutable object — the bytes behind it
      // never change — so this can be cached hard. PRIVATE, because the
      // response is only correct for a reader who passed the session check and
      // a shared cache holding it would be a hole in exactly the gate above.
      "Cache-Control": "private, max-age=31536000, immutable",
      // The bytes are attacker-influenced in the sense that a user chose them.
      // The type is allow-listed to raster images on the way in, but a sniffing
      // browser is the one thing that could undo that, so say it plainly.
      "X-Content-Type-Options": "nosniff",
    },
  });
});
