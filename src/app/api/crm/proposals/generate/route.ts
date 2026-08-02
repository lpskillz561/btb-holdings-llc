import { NextResponse } from "next/server";
import { generateProposal, type GenerateInput } from "@/lib/crm/proposals";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";
// A full proposal is several thousand tokens; the default serverless ceiling is
// tight for that.
export const maxDuration = 120;

export const POST = withCrm(async (req, { actor }) => {
  const body = (await readBody(req)) as unknown as GenerateInput;
  const row = await generateProposal(body, actor);
  return NextResponse.json(row, { status: 201 });
});
