// Calls with clients: the queries the calendar and the client card read, and
// the one write that turns a transcript into a summary.
//
// Phase 1 of the notetaker work. Deliberately source-agnostic: nothing here
// knows about a particular bot vendor, because the table is the contract and
// the ingest webhook is a later, separable piece. A meeting typed in by hand and
// one delivered by a notetaker are the same row and render identically.

import { CrmError, logActivity, nowIso, query, queryOne } from "./db";
import { MODEL, buildSystemPrompt, isAiConfigured, structuredChat } from "./ai";
import type { CrmMeeting } from "./types";

/* -------------------------------------------------------------------------- */
/* Transcript retention                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Whether to keep the verbatim transcript, as opposed to the summary and a link
 * to the vendor's copy.
 *
 * OFF by default, and that default is the considered one. A transcript of one of
 * these calls is a recording of a named taxpayer discussing their income and
 * their exposure — the most sensitive material this database would hold, in a
 * database with no automated backup and therefore no tested restore. It is also
 * the text that would be pasted into the model's context on every AI surface
 * scoped to that client, which widens where it travels.
 *
 * The summary carries almost all of the working value at a fraction of that
 * risk. Turn this on deliberately, per environment, once you want the verbatim
 * record — it is an SSM write under /btb-crm/ plus a redeploy, not a rebuild.
 */
export function storeTranscripts(): boolean {
  return ["1", "true", "yes", "on"].includes(
    (process.env.CRM_STORE_TRANSCRIPTS ?? "").trim().toLowerCase(),
  );
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** One meeting with the client's name, for the calendar and the meetings list. */
export interface MeetingRow extends CrmMeeting {
  client_name: string | null;
}

const SELECT_WITH_CLIENT = `
  SELECT m.*, c.name AS client_name
  FROM crm_meetings m
  LEFT JOIN crm_clients c ON c.id = m.client_id`;

/**
 * Every meeting whose start falls in [from, to).
 *
 * Half-open on purpose: the calendar asks for a month as
 * [first-of-month, first-of-next-month), and a closed upper bound would either
 * double-count the boundary day or drop it, depending on the time of day. The
 * bounds are ISO strings compared as TEXT, which is exactly why TS_DEFAULT
 * insists on the "Z" form — see the note on it in ./schema.
 */
export async function meetingsInRange(from: string, to: string): Promise<MeetingRow[]> {
  return query<MeetingRow>(
    `${SELECT_WITH_CLIENT}
     WHERE m.occurred_at >= $1 AND m.occurred_at < $2
     ORDER BY m.occurred_at ASC`,
    [from, to],
  );
}

/** The next calls due, for the panel beside the calendar. */
export async function upcomingMeetings(limit = 8): Promise<MeetingRow[]> {
  return query<MeetingRow>(
    `${SELECT_WITH_CLIENT}
     WHERE m.occurred_at >= $1 AND m.status = 'scheduled'
     ORDER BY m.occurred_at ASC
     LIMIT ${Math.max(1, Math.min(50, Math.round(limit)))}`,
    [nowIso()],
  );
}

/**
 * Calls that arrived without a client.
 *
 * This is the queue that makes a nullable `client_id` safe rather than lossy: a
 * notetaker webhook knows attendee email addresses, not our id for the account,
 * so an unrecognised call lands here to be attached by hand. Without somewhere
 * visible to land, an unmatched meeting is just a row nobody ever sees again.
 */
export async function unassignedMeetings(limit = 50): Promise<MeetingRow[]> {
  return query<MeetingRow>(
    `${SELECT_WITH_CLIENT}
     WHERE m.client_id IS NULL
     ORDER BY m.occurred_at DESC
     LIMIT ${Math.max(1, Math.min(200, Math.round(limit)))}`,
  );
}

/** One client's calls, newest first — what the client card's Meetings tab reads. */
export async function clientMeetings(clientId: string, limit = 100): Promise<CrmMeeting[]> {
  return query<CrmMeeting>(
    `SELECT * FROM crm_meetings WHERE client_id = $1
     ORDER BY occurred_at DESC
     LIMIT ${Math.max(1, Math.min(500, Math.round(limit)))}`,
    [clientId],
  );
}

export async function getMeeting(id: string): Promise<MeetingRow> {
  const row = await queryOne<MeetingRow>(
    `${SELECT_WITH_CLIENT} WHERE m.id = $1`,
    [id],
  );
  if (!row) throw new CrmError("Meeting not found.", 404);
  return row;
}

/** Parsed attendee list, tolerant of a row written before the shape settled. */
export function meetingAttendees(row: Pick<CrmMeeting, "attendees_json">): {
  name: string | null;
  email: string | null;
}[] {
  if (!row.attendees_json) return [];
  try {
    const parsed: unknown = JSON.parse(row.attendees_json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((a) => {
      const o = (a ?? {}) as Record<string, unknown>;
      return {
        name: typeof o.name === "string" ? o.name : null,
        email: typeof o.email === "string" ? o.email : null,
      };
    });
  } catch {
    // A malformed blob is a display problem, not a reason to 500 the card.
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Attaching an unassigned call                                                */
/* -------------------------------------------------------------------------- */

/**
 * File a meeting under a client.
 *
 * Kept out of the generic PATCH path, which strips `client_id` on every resource
 * because moving a record between clients silently rewrites one account's
 * holdings into another's. That rule is right for a proposal and wrong for a
 * meeting, where assignment is the *point* — so this is the one deliberate,
 * logged door, and it only ever moves a call, never a document.
 */
export async function attachMeeting(
  id: string,
  clientId: string,
  actor?: string | null,
): Promise<MeetingRow> {
  const meeting = await getMeeting(id);
  const client = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM crm_clients WHERE id = $1`,
    [clientId],
  );
  if (!client) throw new CrmError("That client does not exist.", 400);

  await query(`UPDATE crm_meetings SET client_id = $1, updated_at = $2 WHERE id = $3`, [
    clientId,
    nowIso(),
    id,
  ]);
  await logActivity({
    entity_type: "crm_meetings",
    entity_id: id,
    client_id: clientId,
    verb: "attached",
    summary: `Filed call "${meeting.title}" under ${client.name}`,
    actor_email: actor,
  });
  return getMeeting(id);
}

/* -------------------------------------------------------------------------- */
/* Summarising                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What the summariser is asked to produce.
 *
 * The headings are fixed rather than left to the model so that two summaries are
 * comparable, and so "Points to check" always exists — an empty section is a
 * statement that nothing was flagged, whereas a section the model chose not to
 * write is indistinguishable from one it forgot.
 */
const SUMMARY_SCHEMA = {
  name: "meeting_summary",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary_md"],
    properties: {
      summary_md: {
        type: "string",
        description:
          "Markdown with exactly these level-2 headings, in order: " +
          "## What was discussed, ## Commitments made, ## Points to check.",
      },
    },
  },
} as const;

const SUMMARY_INSTRUCTIONS = `You are summarising a recorded call for the internal client record.

Write markdown with exactly three level-2 headings, in this order:

## What was discussed
Short bullets. What the call actually covered, in the staff member's terms.

## Commitments made
What either side undertook to do, and by when if it was said. Only what was
actually committed to on the call — an inference is not a commitment. Write
"Nothing explicit." if none were made.

## Points to check
This is the section that earns its keep. Flag anything said on the call that
disagrees with the house knowledge base or with this client's own record: a
figure that does not match their frozen proposal economics, the seven-day
short-term-rental test described where the thirty-day transient-lodging test is
what this deal relies on, a non-recourse characterisation of the note, any
suggestion the client owns or will own land, a first-year benefit quoted without
the section 461(l) cap, or a deposit that does not match what is on file. Quote
the phrase you are flagging. Write "Nothing flagged." if there is nothing.

Rules:
- Report, never calculate. Every figure you cite must appear in the transcript
  or in the record context above. Do not derive a new one.
- Do not repair what was said. If something on the call was wrong, it belongs
  under "Points to check" as what it was, not silently corrected in the summary.
- If the transcript is partial or the audio was poor, say so at the top rather
  than filling the gap.`;

/**
 * Generate and store the summary for a meeting.
 *
 * The prompt is the ordinary scoped one — BASE_PROMPT + SKILL.md + this client's
 * record — which is the entire reason to do this in-house rather than take the
 * notetaker vendor's summary. A generic summariser has no idea that the seven-day
 * test is the wrong one for this deal, or what this client's proposal already
 * froze. This one does, and "Points to check" is where that shows up.
 *
 * The model and the time are stamped alongside, because `OPENAI_MODEL` is an SSM
 * value that changes without a rebuild: a summary written months ago should say
 * what wrote it.
 */
export async function summarizeMeeting(id: string, actor?: string | null): Promise<MeetingRow> {
  if (!isAiConfigured()) {
    throw new CrmError("AI is not configured on this environment.", 503);
  }

  const meeting = await getMeeting(id);
  const body = meeting.transcript?.trim();
  if (!body) {
    throw new CrmError(
      meeting.transcript_url
        ? "No transcript is stored for this call. Transcript retention is off, so there is nothing here to summarise — open the source recording instead."
        : "This call has no transcript to summarise yet.",
      400,
    );
  }

  const attendees = meetingAttendees(meeting)
    .map((a) => [a.name, a.email].filter(Boolean).join(" <") + (a.email ? ">" : ""))
    .filter(Boolean);

  const system = await buildSystemPrompt(meeting.client_id);
  const header = [
    `Call: ${meeting.title}`,
    `When: ${meeting.occurred_at}`,
    meeting.duration_minutes != null && `Duration: ${meeting.duration_minutes} minutes`,
    attendees.length > 0 && `Attendees: ${attendees.join(", ")}`,
    !meeting.client_id &&
      `This call is not yet filed under a client, so there is no record context for it. Do not guess which client it concerns.`,
  ]
    .filter(Boolean)
    .join("\n");

  const { summary_md } = await structuredChat<{ summary_md: string }>(
    [
      { role: "system", content: system },
      { role: "system", content: SUMMARY_INSTRUCTIONS },
      { role: "user", content: `${header}\n\n---\n\nTranscript:\n\n${body}` },
    ],
    SUMMARY_SCHEMA as unknown as {
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    },
  );

  const now = nowIso();
  await query(
    `UPDATE crm_meetings
     SET summary_md = $1, summary_model = $2, summarized_at = $3, updated_at = $3
     WHERE id = $4`,
    [summary_md, MODEL, now, id],
  );

  await logActivity({
    entity_type: "crm_meetings",
    entity_id: id,
    client_id: meeting.client_id,
    verb: "summarised",
    summary: `Summarised call "${meeting.title}"`,
    actor_email: actor,
  });

  return getMeeting(id);
}
