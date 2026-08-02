import { NextResponse } from "next/server";
import { getCrmSummary } from "@/lib/crm/clients";
import { withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrm(async () => {
  return NextResponse.json(await getCrmSummary());
});
