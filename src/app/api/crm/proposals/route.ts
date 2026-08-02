import { NextResponse } from "next/server";
import { listProposals } from "@/lib/crm/proposals";
import { withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

// There is no POST here: a proposal is always produced by POST
// /api/crm/proposals/generate, which computes and freezes the economics. An
// endpoint that let a caller insert arbitrary figures would defeat that.
export const GET = withCrm(async (req) => {
  return NextResponse.json(await listProposals(req.nextUrl.searchParams));
});
