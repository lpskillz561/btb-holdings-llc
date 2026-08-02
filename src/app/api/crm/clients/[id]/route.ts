import { NextResponse } from "next/server";
import { deleteClient, getClientDetail, updateClient } from "@/lib/crm/clients";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

/** The full client card in one request: record, people, deals, holdings, money, feed. */
export const GET = withCrmParams<{ id: string }>(async (_req, { params }) => {
  return NextResponse.json(await getClientDetail(params.id));
});

export const PATCH = withCrmParams<{ id: string }>(async (req, { actor, params }) => {
  return NextResponse.json(await updateClient(params.id, await readBody(req), actor));
});

export const DELETE = withCrmParams<{ id: string }>(async (_req, { actor, params }) => {
  await deleteClient(params.id, actor);
  return new NextResponse(null, { status: 204 });
});
