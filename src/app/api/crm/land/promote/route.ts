import { NextResponse } from "next/server";
import { convertSavedParcelToHolding } from "@/lib/crm/land";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

/** Turn a shortlisted parcel into a tracked land holding once it's being acquired. */
export const POST = withCrm(async (req, { actor }) => {
  const body = await readBody(req);
  const result = await convertSavedParcelToHolding(String(body.saved_parcel_id ?? ""), actor);
  return NextResponse.json(result, { status: 201 });
});
