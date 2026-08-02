import { NextResponse } from "next/server";
import { placeClientOnPad } from "@/lib/crm/portfolio";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

/** Place this client's home on a pad BTB owns. */
export const POST = withCrmParams<{ id: string }>(async (req, { params, actor }) => {
  const body = await readBody(req);
  const unit = await placeClientOnPad(
    params.id,
    String(body.pad_id ?? ""),
    String(body.label ?? ""),
    actor,
  );
  return NextResponse.json(unit, { status: 201 });
});
