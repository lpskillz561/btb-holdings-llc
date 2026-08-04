"use client";

// "Send the notetaker" — paste the meeting link, the bot joins.
//
// Deliberately a button rather than a calendar sync. Auto-dispatching to every
// event with a Meet link would put a bot into internal calls and into calls with
// counsel; pressing this means somebody decided. It also means the client is
// known at dispatch, so the call files itself.

import { useState } from "react";
import { apiPost } from "./api";
import type { CrmMeeting } from "@/lib/crm/types";
import { ErrorNote } from "./ui";

export function SendNotetaker({
  clientId,
  clientName,
  botName,
  onSent,
}: {
  clientId: string;
  clientName: string;
  /** What the bot calls itself in the participant list. The client sees it. */
  botName: string;
  onSent: (meeting: CrmMeeting) => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!url.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const meeting = await apiPost<CrmMeeting>("/api/crm/meetings/dispatch", {
        client_id: clientId,
        meeting_url: url.trim(),
        title: title.trim() || `Call with ${clientName}`,
      });
      onSent(meeting);
      setUrl("");
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the notetaker.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="sf-card p-5">
      <h3 className="text-sm font-bold text-ink-900">Send the notetaker</h3>
      <p className="mt-1 text-sm text-ink-600">
        Paste the meeting link and <strong>{botName}</strong> joins as a participant, visible
        to everyone on the call. It records, transcribes, and writes the summary here when
        the call ends.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input
          className="field"
          placeholder="https://meet.google.com/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={sending}
          aria-label="Meeting link"
        />
        <input
          className="field"
          placeholder={`Call with ${clientName}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={sending}
          aria-label="Title"
        />
      </div>

      <div className="mt-3">
        <ErrorNote>{error}</ErrorNote>
      </div>

      <button
        type="button"
        className="sf-btn-brand mt-3"
        onClick={send}
        disabled={!url.trim() || sending}
      >
        {sending ? "Sending…" : "Send notetaker"}
      </button>

      {/* Recording consent varies by state, and a bot in a call about someone's
          tax position is not the moment to be surprising anyone. The bot is
          named and visible; saying so here is cheap. */}
      <p className="mt-3 text-xs text-ink-500">
        Everyone on the call sees {botName} in the participant list. Tell them it is
        recording — consent rules differ by state.
      </p>
    </div>
  );
}
