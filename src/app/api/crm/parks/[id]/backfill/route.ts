import { NextResponse } from "next/server";
import { backfillProspect } from "@/lib/crm/portfolio";
import { withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const POST = withCrmParams<{ id: string }>(async (_req, { params }) =>
  NextResponse.json(await backfillProspect(params.id)),
);
