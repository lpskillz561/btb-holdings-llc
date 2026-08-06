import { NextResponse } from "next/server";
import { withCrm } from "@/lib/crm/rest";
import { CrmError } from "@/lib/crm/db";
import { createAttachment } from "@/lib/crm/uploads";
import { MAX_ATTACHMENT_BYTES, attachmentUrl, fmtBytes } from "@/lib/crm/attachments";

export const runtime = "nodejs";

/**
 * Upload one image.
 *
 * `multipart/form-data`, not a base64 JSON field: base64 inflates the body by a
 * third for no gain, and the browser already has `FormData` and a progress
 * story for it.
 *
 * The uploader is the SESSION, never the body — the same rule that governs a
 * comment's author. Everything a caller sends about itself is a claim.
 */
export const POST = withCrm(async (req, { actor }) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new CrmError("Expected a file upload.", 400);

  const file = form.get("file");
  if (!(file instanceof File)) throw new CrmError("No file was attached.", 400);

  // Checked BEFORE the bytes are read into memory. `file.size` comes from the
  // multipart part's own length, so a 200 MB paste is refused without first
  // buffering 200 MB to find out it was too big.
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new CrmError(
      `That image is ${fmtBytes(file.size)}. The limit is ${fmtBytes(MAX_ATTACHMENT_BYTES)}.`,
      400,
    );
  }

  const row = await createAttachment({
    bytes: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
    // A pasted screenshot arrives as "image.png" or with no name at all; that
    // is fine, it is only the alt text and the download filename.
    fileName: file.name || null,
    uploadedBy: actor,
  });

  return NextResponse.json(
    {
      id: row.id,
      url: attachmentUrl(row.id),
      file_name: row.file_name,
      content_type: row.content_type,
      byte_size: row.byte_size,
    },
    { status: 201 },
  );
});
