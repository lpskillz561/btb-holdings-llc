"use client";

// File one unassigned call under a client.
//
// The whole reason `crm_meetings.client_id` is allowed to be NULL. A notetaker
// webhook knows attendee email addresses, not our id for the account, and a
// first call is often with somebody who is not a row yet — so an unrecognised
// call lands unfiled and a person puts it where it belongs. Guessing from the
// attendee list would file a stranger's call under a real client, and nobody
// would ever know to look.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPost } from "./api";

export function AttachMeeting({
  meetingId,
  clients,
}: {
  meetingId: string;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function attach() {
    if (!clientId || saving) return;
    setSaving(true);
    setError("");
    try {
      await apiPost(`/api/crm/meetings/${meetingId}/attach`, { client_id: clientId });
      // Server component page; refresh is what moves the row out of this list.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not file this call.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Client"
        className="field max-w-56"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        disabled={saving}
      >
        <option value="">— choose a client —</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="sf-btn-neutral"
        onClick={attach}
        disabled={!clientId || saving}
      >
        {saving ? "Filing…" : "File"}
      </button>
      {error && <span className="text-sm text-err-700">{error}</span>}
    </div>
  );
}
