// File an unassigned call under a client.
//
// The generic PATCH path strips `client_id` from every resource, because moving
// a proposal or a contract between accounts silently rewrites one client's
// holdings into another's. A meeting is the exception that proves it: a call
// arriving from a notetaker knows attendee email addresses, not our id for the
// account, so assignment is the whole operation. It gets its own door, which
// logs, rather than a hole in the rule that would apply to everything.

import { NextResponse } from "next/server";
import { CrmError, str } from "@/lib/crm/db";
import { attachMeeting } from "@/lib/crm/meetings";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const POST = withCrmParams<{ id: string }>(async (req, { actor, params }) => {
  const clientId = str((await readBody(req)).client_id);
  if (!clientId) throw new CrmError("Choose a client to file this call under.", 400);
  return NextResponse.json(await attachMeeting(params.id, clientId, actor));
});
