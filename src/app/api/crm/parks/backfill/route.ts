import { NextResponse } from "next/server";
import { backfillAllProspects } from "@/lib/crm/portfolio";
import { withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

/** Fill every saved listing still missing acreage or assessed value. */
export const POST = withCrm(async () => NextResponse.json(await backfillAllProspects()));
