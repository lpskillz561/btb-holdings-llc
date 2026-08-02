import { NextResponse } from "next/server";
import { assessParcelFit } from "@/lib/crm/land";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";
export const maxDuration = 90;

/** AI read on whether one parcel suits one client. Cached on the shortlist row. */
export const POST = withCrm(async (req) => {
  const body = await readBody(req);
  const fit = await assessParcelFit(
    String(body.client_id ?? ""),
    String(body.parcel_key ?? ""),
    { force: body.force === true },
  );
  return NextResponse.json(fit);
});
