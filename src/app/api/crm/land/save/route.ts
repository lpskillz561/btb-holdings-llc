import { NextResponse } from "next/server";
import { saveParcelForClient } from "@/lib/crm/land";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

/** Shortlist a parcel for a client. Re-saving refreshes the snapshot, never duplicates. */
export const POST = withCrm(async (req, { actor }) => {
  const body = await readBody(req);
  const row = await saveParcelForClient(
    String(body.client_id ?? ""),
    String(body.parcel_key ?? ""),
    actor,
  );
  return NextResponse.json(row, { status: 201 });
});
