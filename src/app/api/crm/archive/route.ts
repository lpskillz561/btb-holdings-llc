// Archive and restore, for proposals and contracts.
//
// A dedicated route rather than a PATCH through ./resource: `archived_at` is a
// record of what happened and when, so it is set by this operation and is not a
// field anyone can write to an arbitrary value.

import { NextResponse } from "next/server";
import { isArchivableKind, listArchived, setArchived } from "@/lib/crm/archive";
import { CrmError } from "@/lib/crm/db";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrm(async () => {
  return NextResponse.json(await listArchived());
});

export const POST = withCrm(async (req, { actor }) => {
  const body = await readBody(req);
  const kind = body.kind;
  if (!isArchivableKind(kind)) {
    throw new CrmError("Only proposals and contracts can be archived.", 400);
  }
  await setArchived(kind, String(body.id ?? ""), body.archived !== false, actor);
  return NextResponse.json({ ok: true });
});
