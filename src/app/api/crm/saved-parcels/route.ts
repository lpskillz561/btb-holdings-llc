import { NextResponse } from "next/server";
import { SAVED_PARCELS, listRows } from "@/lib/crm/resource";
import { withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrm(async (req) => {
  return NextResponse.json(await listRows(SAVED_PARCELS, req.nextUrl.searchParams));
});
