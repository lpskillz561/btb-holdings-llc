// Send the notetaker into a call.
//
// Button-driven rather than calendar-driven, deliberately. Polling Google
// Calendar and auto-dispatching to anything with a Meet link is a bigger build
// and a worse default: it would put a bot into internal calls, into calls with
// counsel, and into anything else with a link on it. Pressing a button on a
// client's card means the client is known at dispatch — which is why the
// unassigned queue exists for exceptions rather than as the normal path.

import { NextResponse } from "next/server";
import { CrmError, str } from "@/lib/crm/db";
import { createNotetakerMeeting } from "@/lib/crm/meetings";
import { isRecallConfigured, sendNotetaker } from "@/lib/crm/recall";
import { readBody, withCrm } from "@/lib/crm/rest";
import type { MeetingPlatform } from "@/lib/crm/types";

export const runtime = "nodejs";

/** Which platform a link belongs to. Display only — Recall parses it itself. */
function platformFor(url: string): MeetingPlatform {
  const u = url.toLowerCase();
  if (u.includes("meet.google.")) return "google_meet";
  if (u.includes("zoom.")) return "zoom";
  if (u.includes("teams.microsoft.") || u.includes("teams.live.")) return "teams";
  return "other";
}

export const POST = withCrm(async (req, { actor }) => {
  if (!isRecallConfigured()) {
    throw new CrmError(
      "The notetaker is not configured on this environment. RECALL_API_KEY is unset.",
      503,
    );
  }

  const body = await readBody(req);
  const meetingUrl = str(body.meeting_url);
  const clientId = str(body.client_id);
  const title = str(body.title) ?? "Call";

  if (!meetingUrl) throw new CrmError("Paste the meeting link to send the notetaker.", 400);
  // Checked here rather than left to Recall: a typo'd link otherwise costs a
  // round trip and comes back as a validation error in someone else's wording.
  if (!/^https?:\/\//i.test(meetingUrl)) {
    throw new CrmError("That does not look like a meeting link.", 400);
  }

  // Recall first, then the row. The other order would leave a meeting on the
  // calendar claiming a notetaker was sent when the dispatch had failed.
  const bot = await sendNotetaker(meetingUrl).catch((err: unknown) => {
    // Recall's own validation message is the useful part ("not a supported
    // platform"), but it is not a 500 on our side.
    throw new CrmError(err instanceof Error ? err.message : "Could not send the notetaker.", 502);
  });

  const meeting = await createNotetakerMeeting({
    clientId,
    botId: bot.id,
    meetingUrl,
    title,
    platform: platformFor(meetingUrl),
    actor,
  });

  return NextResponse.json(meeting, { status: 201 });
});
