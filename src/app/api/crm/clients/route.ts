import { NextResponse } from "next/server";
import { createClient, listClients } from "@/lib/crm/clients";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrm(async (req) => {
  return NextResponse.json(await listClients(req.nextUrl.searchParams));
});

export const POST = withCrm(async (req, { actor }) => {
  const row = await createClient(await readBody(req), actor);
  return NextResponse.json(row, { status: 201 });
});
