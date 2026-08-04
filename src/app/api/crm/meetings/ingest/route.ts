// The notetaker webhook.
//
// THIS IS THE ONE ROUTE IN THE CRM WITH NO SESSION BEHIND IT. /api is outside
// the middleware matcher, and `withCrm` is what stands between an anonymous
// request and the data everywhere else — but a webhook has no user, so it cannot
// be used here. `verifyWebhook` in lib/crm/recall.ts is the entire gate, and it
// fails closed: with no RECALL_WEBHOOK_SECRET configured, nothing is accepted.
//
// Do not add a code path here that skips verification for convenience. The
// payloads carry transcript content, and the endpoint is reachable from the
// public internet by construction.
//
// Everything is idempotent. Recall retries a failed delivery for 24 hours and
// ordering is not guaranteed, so a duplicate or out-of-order event must be a
// no-op rather than a second row or a status walked backwards.

import { NextResponse } from "next/server";
import {
  getMeeting,
  meetingByExternalId,
  setMeetingStatus,
  storeTranscript,
  summarizeFromText,
} from "@/lib/crm/meetings";
import {
  downloadTranscriptPayload,
  flattenTranscript,
  getTranscript,
  requestTranscript,
  transcriptAttendees,
  verifyWebhook,
} from "@/lib/crm/recall";
import type { MeetingStatus } from "@/lib/crm/types";

export const runtime = "nodejs";
// Transcription and the summary both run inside this request. That is only
// affordable because this deploys as a long-lived container rather than a
// Lambda; see the note on the summarize route.
export const maxDuration = 800;

/** Recall's bot lifecycle → our status. Anything unlisted leaves the row alone. */
const STATUS_MAP: Record<string, MeetingStatus> = {
  "bot.joining_call": "in_progress",
  "bot.in_waiting_room": "in_progress",
  "bot.in_call_not_recording": "in_progress",
  "bot.in_call_recording": "in_progress",
  "bot.call_ended": "in_progress",
  "bot.done": "completed",
  // Both are calls that happened but produced nothing usable, which is a
  // different thing from one that was called off — and the only one worth
  // chasing. See MEETING_STATUSES.
  "bot.fatal": "failed",
  "bot.recording_permission_denied": "failed",
  "transcript.failed": "failed",
};

export async function POST(req: Request): Promise<NextResponse> {
  // Read the body as TEXT first: the signature is computed over the exact bytes,
  // so parsing and re-serialising would change them and every delivery would
  // fail to verify.
  const raw = await req.text();

  try {
    await verifyWebhook(raw, req.headers);
  } catch (err) {
    console.error("crm: rejected notetaker webhook", err);
    // 401, not 400. A rejected delivery is not a malformed one, and Recall's
    // retry behaviour is the same either way.
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: { event?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const event = payload.event ?? "";
  const data = payload.data ?? {};

  try {
    await handle(event, data);
  } catch (err) {
    // A 5xx makes Recall retry, which is right for a transient failure and wrong
    // for a permanent one — but a permanent failure here means a call with no
    // summary, which someone should notice. Retrying is the safer default; the
    // log is where the real reason lives.
    console.error(`crm: notetaker webhook "${event}" failed`, err);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** Narrow a nested id out of the webhook envelope without trusting its shape. */
function idAt(data: Record<string, unknown>, key: string): string | null {
  const node = data[key];
  if (node && typeof node === "object" && typeof (node as { id?: unknown }).id === "string") {
    return (node as { id: string }).id;
  }
  return null;
}

async function handle(event: string, data: Record<string, unknown>): Promise<void> {
  // Bot lifecycle. The bot id is what our rows are keyed on.
  const botId = idAt(data, "bot") ?? (typeof data.id === "string" ? data.id : null);

  if (event.startsWith("bot.")) {
    if (!botId) return;
    const meeting = await meetingByExternalId("notetaker", botId);
    // A bot we did not dispatch — someone started one from Recall's dashboard.
    // Ignored rather than adopted: without a meeting URL and a client we would
    // be inventing a record, and the unassigned queue is for calls we can at
    // least describe.
    if (!meeting) return;

    const mapped = STATUS_MAP[event];
    if (mapped) await setMeetingStatus(meeting.id, mapped);
    return;
  }

  // A finished recording. Ask for the transcript; the result comes back as a
  // separate transcript.done delivery rather than inline.
  if (event === "recording.done") {
    const recordingId = idAt(data, "recording");
    if (recordingId) await requestTranscript(recordingId);
    return;
  }

  if (event === "transcript.done") {
    const transcriptId = idAt(data, "transcript");
    if (!transcriptId || !botId) return;

    const meeting = await meetingByExternalId("notetaker", botId);
    if (!meeting) return;

    // Already summarised — a retried delivery must not re-bill the model or
    // overwrite a summary someone has already read and acted on.
    if (meeting.summary_md) return;

    const artifact = await getTranscript(transcriptId);
    const url = artifact.data?.download_url;
    if (!url) return;

    // Fetched ONCE. The download URL is presigned and short-lived, and both the
    // text and the attendee list come out of the same payload — pulling it twice
    // is a second chance for it to have expired between the two.
    const payload = await downloadTranscriptPayload(url);
    const text = flattenTranscript(payload).trim();
    const attendees = transcriptAttendees(payload);

    // Storage first, then the summary FROM THE TEXT IN HAND. With
    // CRM_STORE_TRANSCRIPTS off the column is left NULL, so reading it back to
    // summarise would summarise nothing — on the default configuration. See
    // summarizeFromText.
    await storeTranscript(meeting.id, text, attendees, null);
    if (text) await summarizeFromText(await getMeeting(meeting.id), text, "notetaker");
    return;
  }
}
