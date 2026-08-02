import { NextResponse } from "next/server";
import { generateContractSet, type GenerateContractsInput } from "@/lib/crm/contracts-gen";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

// Unlike proposal generation there is no model call here and nothing to wait
// on — the documents are templates and the figures are arithmetic — so this
// needs no extended duration.
export const POST = withCrm(async (req, { actor }) => {
  const body = (await readBody(req)) as unknown as GenerateContractsInput;
  const set = await generateContractSet(body, actor);
  return NextResponse.json(set, { status: 201 });
});
