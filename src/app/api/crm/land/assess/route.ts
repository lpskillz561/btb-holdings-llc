import { NextResponse } from "next/server";
import { assessParkSite } from "@/lib/crm/land";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * AI read on whether a parcel would make a park for BTB.
 *
 * Sibling of ../fit, which asks whether a parcel suits one CLIENT. This one is
 * global and takes only a parcel key — under the current model the client never
 * buys ground, so "should we buy this" has no client in it.
 */
export const POST = withCrm(async (req) => {
  const body = await readBody(req);
  return NextResponse.json(await assessParkSite(String(body.parcel_key ?? "")));
});
