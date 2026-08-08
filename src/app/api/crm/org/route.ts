import { NextResponse } from "next/server";
import { createOrgPerson, listOrgPeople } from "@/lib/crm/org";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

/**
 * The leadership chart.
 *
 * Not wired through `collectionHandlers` because this resource is not in
 * `resource.ts` — `manager_id` needs a cycle check the generic engine has no
 * way to express. See lib/crm/org.ts.
 */
export const GET = withCrm(async () => {
  return NextResponse.json(await listOrgPeople());
});

export const POST = withCrm(async (req, { actor }) => {
  const row = await createOrgPerson(await readBody(req), actor);
  return NextResponse.json(row, { status: 201 });
});
