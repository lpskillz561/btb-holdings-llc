// Write the house summary for one call.
//
// Separate from PATCH because the summary is not a field a caller supplies: it
// is generated here, from the transcript, through the same scoped prompt every
// other AI surface uses, and stamped with which model wrote it. See
// summarizeMeeting in lib/crm/meetings.ts for why that matters more than taking
// the notetaker vendor's own summary.

import { NextResponse } from "next/server";
import { summarizeMeeting } from "@/lib/crm/meetings";
import { withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

// The model call runs to completion inside the request. Fine on a long-lived
// container, which is what this deploys as; it would need a queue on Lambda.
export const maxDuration = 300;

export const POST = withCrmParams<{ id: string }>(async (_req, { actor, params }) => {
  return NextResponse.json(await summarizeMeeting(params.id, actor));
});
