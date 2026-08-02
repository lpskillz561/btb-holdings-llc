"use client";

// Land we are thinking about buying, and the argument about whether to.
//
// Paste a link and it becomes a row. Everyone signed in sees the same list and
// the same discussion — which is the point: deciding whether a parcel is worth
// a million dollars is not a decision one person should make in their own inbox.

import { useState } from "react";
import type { CrmParkComment, CrmPark } from "@/lib/crm/types";
import { fmtAgo, fmtDate, fmtMoney } from "@/lib/crm/format";
import { Badge, EmptyState, ErrorNote, TextArea, TextInput } from "./ui";
import { apiPost } from "./api";

export interface ProspectRow extends CrmPark {
  comment_count: number;
  last_comment_at: string | null;
}

export function LandProspects({ initial }: { initial: ProspectRow[] }) {
  const [rows, setRows] = useState(initial);
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState("");

  /** Pull acreage, assessed value, county and owner from the county records. */
  async function backfillAll() {
    setFilling(true);
    setFillNote("");
    try {
      const res = await apiPost<{ filled: number; skipped: number }>(
        "/api/crm/parks/backfill",
        {},
      );
      setFillNote(
        `Filled ${res.filled}, left ${res.skipped} alone. ` +
          "Anything left alone either had no confident parcel match or is in a state that has not been imported yet.",
      );
      const listed = await fetch("/api/crm/parks?status=prospect");
      if (listed.ok) {
        // Re-read rather than patch: the server decided what was safe to fill.
        const fresh = (await listed.json()) as ProspectRow[];
        setRows((rs) =>
          rs.map((r) => {
            const f = fresh.find((x) => x.id === r.id);
            return f ? { ...r, ...f } : r;
          }),
        );
      }
    } catch (err) {
      setFillNote(err instanceof Error ? err.message : "Backfill failed.");
    } finally {
      setFilling(false);
    }
  }

  async function save() {
    const link = url.trim();
    if (!link) return;
    // Checked here as well as on the server so a typo is caught before it
    // becomes a row nobody can open.
    if (!/^https?:\/\//i.test(link)) {
      setError("That does not look like a link. Paste the full URL, including https://");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await apiPost<ProspectRow>("/api/crm/parks", {
        listing_url: link,
        asking_price_cents: price || null,
        status: "prospect",
      });
      setRows((r) => [{ ...created, comment_count: 0, last_comment_at: null }, ...r]);
      setUrl("");
      setPrice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="sf-card p-4">
        <h3 className="mb-1 text-sm font-bold text-ink-900">Save a listing</h3>
        <p className="mb-3 text-xs text-ink-600">
          Paste a Zillow, LandWatch or agent link. Everyone signed in sees it, and can argue with
          it below.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[22rem] flex-1">
            <label className="sf-label" htmlFor="listing">Listing URL</label>
            <TextInput
              id="listing"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              placeholder="https://www.zillow.com/homedetails/..."
            />
          </div>
          <div>
            <label className="sf-label" htmlFor="asking">Asking price</label>
            <TextInput
              id="asking"
              value={price}
              onChange={(e) => setPrice(e.currentTarget.value)}
              placeholder="95,000"
              className="w-40"
            />
          </div>
          <button type="button" className="sf-btn-brand" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save listing"}
          </button>
        </div>
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="sf-card flex flex-wrap items-center gap-3 p-3">
          <button type="button" className="sf-btn-neutral" onClick={backfillAll} disabled={filling}>
            {filling ? "Filling…" : "Backfill from county records"}
          </button>
          <p className="text-xs text-ink-600">
            Fills acreage, assessed value, county and parcel key from the imported assessor data.
            Asking price is never touched — the county does not hold it.
          </p>
          {fillNote ? <p className="w-full text-xs text-ink-700">{fillNote}</p> : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState>
          Nothing saved yet. Paste a link above and it becomes a shared row everyone can comment on.
        </EmptyState>
      ) : (
        <div className="sf-card overflow-hidden">
          <table className="sf-table">
            <thead>
              <tr>
                <th>Listing</th>
                <th>Where</th>
                <th>Asking</th>
                <th>Acres</th>
                <th>Status</th>
                <th>Saved</th>
                <th>Discussion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ProspectRowView
                  key={row.id}
                  row={row}
                  open={openId === row.id}
                  onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                  onCommented={(n, at) =>
                    setRows((rs) =>
                      rs.map((r) =>
                        r.id === row.id ? { ...r, comment_count: n, last_comment_at: at } : r,
                      ),
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProspectRowView({
  row,
  open,
  onToggle,
  onCommented,
}: {
  row: ProspectRow;
  open: boolean;
  onToggle: () => void;
  onCommented: (count: number, at: string) => void;
}) {
  const [comments, setComments] = useState<CrmParkComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggle() {
    onToggle();
    if (!open && comments === null) {
      const res = await fetch(`/api/crm/parks/${row.id}/comments`);
      if (res.ok) setComments(await res.json());
    }
  }

  async function post() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      const created = await apiPost<CrmParkComment>(`/api/crm/parks/${row.id}/comments`, { body });
      const next = [...(comments ?? []), created];
      setComments(next);
      setDraft("");
      onCommented(next.length, created.created_at);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          {/* rel=noopener because these are third-party listing sites. */}
          <a
            href={row.listing_url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sf-600 hover:underline"
          >
            {row.name}
          </a>
        </td>
        <td>{[row.city, row.county, row.state].filter(Boolean).join(", ") || "—"}</td>
        <td>{fmtMoney(row.asking_price_cents)}</td>
        <td>{row.acres ?? "—"}</td>
        <td>
          <Badge tone={row.status === "owned" || row.status === "operating" ? "green" : "neutral"}>
            {row.status}
          </Badge>
        </td>
        <td className="whitespace-nowrap">{fmtDate(row.created_at)}</td>
        <td>
          <button type="button" onClick={toggle} className="sf-btn-neutral py-0.5 text-xs">
            {row.comment_count > 0 ? `${row.comment_count} comment${row.comment_count === 1 ? "" : "s"}` : "Discuss"}
            {row.last_comment_at ? (
              <span className="ml-1 text-ink-500">· {fmtAgo(row.last_comment_at)}</span>
            ) : null}
          </button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7} className="bg-ink-100">
            <div className="space-y-3 px-2 py-3">
              {comments === null ? (
                <p className="text-sm text-ink-600">Loading…</p>
              ) : comments.length === 0 ? (
                <p className="text-sm text-ink-600">
                  No comments yet. What is good or bad about this one?
                </p>
              ) : (
                <ul className="space-y-2">
                  {comments.map((c) => (
                    <li key={c.id} className="rounded border border-ink-200 bg-white p-2.5">
                      <p className="text-xs font-medium text-ink-700">
                        {c.author_email}
                        <span className="ml-2 font-normal text-ink-500">{fmtAgo(c.created_at)}</span>
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-start gap-2">
                <TextArea
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.currentTarget.value)}
                  placeholder="Pros, cons, zoning worries, anything worth remembering."
                />
                <button type="button" className="sf-btn-brand shrink-0" onClick={post} disabled={busy}>
                  {busy ? "Posting…" : "Comment"}
                </button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
