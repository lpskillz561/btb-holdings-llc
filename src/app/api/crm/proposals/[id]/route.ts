import { NextResponse } from "next/server";
import { deleteProposal, getProposal, updateProposal } from "@/lib/crm/proposals";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrmParams<{ id: string }>(async (_req, { params }) => {
  return NextResponse.json(await getProposal(params.id));
});

/** Title, prose, validity and status only — the economics columns are frozen. */
export const PATCH = withCrmParams<{ id: string }>(async (req, { actor, params }) => {
  return NextResponse.json(await updateProposal(params.id, await readBody(req), actor));
});

export const DELETE = withCrmParams<{ id: string }>(async (_req, { actor, params }) => {
  await deleteProposal(params.id, actor);
  return new NextResponse(null, { status: 204 });
});
