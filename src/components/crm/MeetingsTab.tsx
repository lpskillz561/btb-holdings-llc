"use client";

// Calls on one account, and what the model made of them.
//
// Two things sit side by side here and must not be confused for each other: the
// AI summary, which is stamped with the model that wrote it and cannot be
// edited, and the staff member's own notes, which can. The summary is a record
// of what a model said about a call; letting someone edit it in place would turn
// it into an unattributed claim wearing a machine's authority.
//
// The transcript is collapsed by default, and often absent entirely — retention
// is off unless CRM_STORE_TRANSCRIPTS is set. See lib/crm/meetings.ts.

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { fmtDateTime } from "@/lib/crm/format";
import { statusTone } from "@/lib/crm/tone";
import { LABELS, type CrmMeeting } from "@/lib/crm/types";
import { apiPost } from "./api";
import { MEETING_SPEC, RecordDialog } from "./RecordForm";
import { SendNotetaker } from "./SendNotetaker";
import { Badge, EmptyState, ErrorNote, SectionHeading, useDialog } from "./ui";

type Row = Record<string, unknown>;

export function MeetingsTab({
  clientId,
  clientName,
  meetings,
  aiEnabled,
  timeZone,
  notetaker,
  onChanged,
}: {
  clientId: string;
  clientName: string;
  meetings: CrmMeeting[];
  aiEnabled: boolean;
  /** The office zone, resolved server-side. See lib/crm/tz.ts. */
  timeZone: string;
  /** Null when RECALL_API_KEY is unset; otherwise the bot's display name. */
  notetaker: string | null;
  onChanged: (rows: CrmMeeting[]) => void;
}) {
  const [open, openDialog, closeDialog] = useDialog();
  const [editing, setEditing] = useState<CrmMeeting | undefined>();
  const [error, setError] = useState("");

  function upsert(row: CrmMeeting) {
    onChanged(
      meetings.some((m) => m.id === row.id)
        ? meetings.map((m) => (m.id === row.id ? row : m))
        : [row, ...meetings].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading
          title="Calls"
          count={meetings.length}
          action={
            <button
              type="button"
              className="sf-btn-neutral"
              onClick={() => {
                setEditing(undefined);
                openDialog();
              }}
            >
              Log a call
            </button>
          }
        />
        <p className="-mt-2 text-sm text-ink-600">
          Summaries are written from the transcript by the in-house model, against the
          same knowledge base the proposals use — which is why they can flag a figure or
          a test that was described wrongly on the call.
        </p>
      </div>

      <ErrorNote>{error}</ErrorNote>

      {notetaker && (
        <SendNotetaker
          clientId={clientId}
          clientName={clientName}
          botName={notetaker}
          onSent={upsert}
        />
      )}

      {meetings.length === 0 ? (
        <EmptyState
          action={
            <button
              type="button"
              className="sf-btn-brand"
              onClick={() => {
                setEditing(undefined);
                openDialog();
              }}
            >
              Log a call
            </button>
          }
        >
          No calls recorded. Log one by hand, or paste in a transcript and have it summarised.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {meetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              aiEnabled={aiEnabled}
              timeZone={timeZone}
              onEdit={() => {
                setEditing(meeting);
                openDialog();
              }}
              onUpdated={upsert}
              onError={setError}
            />
          ))}
        </div>
      )}

      <RecordDialog
        spec={MEETING_SPEC}
        open={open}
        onClose={closeDialog}
        row={editing as unknown as Row | undefined}
        fixed={{ client_id: clientId, source: "manual" }}
        onSaved={(row) => upsert(row as unknown as CrmMeeting)}
        onDeleted={() => {
          if (editing) onChanged(meetings.filter((m) => m.id !== editing.id));
        }}
      />
    </div>
  );
}

function MeetingCard({
  meeting,
  aiEnabled,
  timeZone,
  onEdit,
  onUpdated,
  onError,
}: {
  meeting: CrmMeeting;
  aiEnabled: boolean;
  timeZone: string;
  onEdit: () => void;
  onUpdated: (row: CrmMeeting) => void;
  onError: (message: string) => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [summarising, setSummarising] = useState(false);

  const hasTranscript = Boolean(meeting.transcript?.trim());

  async function summarise() {
    setSummarising(true);
    onError("");
    try {
      onUpdated(await apiPost<CrmMeeting>(`/api/crm/meetings/${meeting.id}/summarize`, {}));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not summarise this call.");
    } finally {
      setSummarising(false);
    }
  }

  return (
    <article className="sf-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink-900">{meeting.title}</h3>
          <p className="mt-1 text-sm text-ink-600">
            {fmtDateTime(meeting.occurred_at, timeZone)}
            {meeting.duration_minutes != null && ` · ${meeting.duration_minutes} min`}
            {` · ${LABELS.meetingPlatform[meeting.platform]}`}
            {meeting.source !== "manual" && ` · ${LABELS.meetingSource[meeting.source]}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={statusTone(meeting.status)}>{LABELS.meetingStatus[meeting.status]}</Badge>
          <button type="button" className="sf-btn-neutral" onClick={onEdit}>
            Edit
          </button>
        </div>
      </header>

      {meeting.summary_md ? (
        <div className="mt-4 border-t border-ink-200 pt-4">
          <Markdown>{meeting.summary_md}</Markdown>
          {/* Which model, and when. OPENAI_MODEL is an SSM value that changes
              without a rebuild, so a summary that doesn't say what wrote it
              can't be judged later. */}
          <p className="mt-3 text-xs text-ink-500">
            Written by {meeting.summary_model ?? "the model"}
            {meeting.summarized_at ? ` on ${fmtDateTime(meeting.summarized_at, timeZone)}` : ""}. Not a record
            anyone has signed — check anything that matters against the call itself.
          </p>
        </div>
      ) : (
        <div className="mt-4 border-t border-ink-200 pt-4">
          <p className="text-sm text-ink-600">
            {hasTranscript
              ? "Not summarised yet."
              : meeting.transcript_url
                ? "No transcript stored here — transcript retention is off on this environment, so there is nothing to summarise from. Open the source recording instead."
                : "No transcript yet. Paste one in on Edit and it can be summarised."}
          </p>
          {hasTranscript && aiEnabled && (
            <button
              type="button"
              className="sf-btn-brand mt-3"
              onClick={summarise}
              disabled={summarising}
            >
              {summarising ? "Summarising…" : "Summarise this call"}
            </button>
          )}
        </div>
      )}

      {meeting.notes && (
        <div className="mt-4 rounded-md bg-sf-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Your notes</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{meeting.notes}</p>
        </div>
      )}

      {(meeting.recording_url || meeting.meeting_url || meeting.transcript_url) && (
        <p className="mt-4 flex flex-wrap gap-4 text-sm">
          {meeting.recording_url && (
            <a className="text-sf-600 hover:underline" href={meeting.recording_url} target="_blank" rel="noopener">
              Recording
            </a>
          )}
          {meeting.transcript_url && (
            <a className="text-sf-600 hover:underline" href={meeting.transcript_url} target="_blank" rel="noopener">
              Transcript
            </a>
          )}
          {meeting.meeting_url && (
            <a className="text-sf-600 hover:underline" href={meeting.meeting_url} target="_blank" rel="noopener">
              Meeting link
            </a>
          )}
        </p>
      )}

      {hasTranscript && (
        <div className="mt-4">
          <button
            type="button"
            className="text-sm font-medium text-ink-600 hover:text-ink-900"
            onClick={() => setShowTranscript((v) => !v)}
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
          {showTranscript && (
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-ink-50 p-4 text-xs leading-relaxed text-ink-800">
              {meeting.transcript}
            </pre>
          )}
        </div>
      )}
    </article>
  );
}
