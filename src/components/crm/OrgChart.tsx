"use client";

/**
 * BTB's leadership chart — who reports to whom, with a face on every card.
 *
 * Three things are worth knowing before changing anything here.
 *
 * **The layout is not in this file.** `lib/crm/org-layout.ts` decides where every
 * card goes and which lines connect them, and it is pure so the server can use
 * the same cycle test to refuse an illegal reporting line. This component draws
 * what that returns and owns the dragging, the dialog and the network calls.
 *
 * **Dragging is POINTER events, not HTML5 drag-and-drop.** The board's cards use
 * HTML5 drag and therefore need the little move arrows beside them, because
 * `dragstart` does not fire on touch at all. Pointer events do, so this chart
 * works on a tablet with no second control — and `touch-action: none` on a card
 * is what stops a drag from scrolling the page instead of moving the card.
 *
 * **A drag and a click are the same gesture until they are not.** Pressing a
 * card and releasing without moving opens the editor; moving more than a few
 * pixels first makes it a move and no dialog opens. Without the threshold every
 * attempt to nudge a card would end with a modal over the chart.
 *
 * Positions are written per card as they are dropped, because a coordinate on a
 * canvas means something on its own — unlike the saved-listings order, where a
 * position without the rows either side of it is meaningless and the whole list
 * is therefore written at once.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { apiDeleteJson, apiPatch, apiPost, apiUpload } from "./api";
import { avatarTone, initialsFor } from "./CommentThread";
import { Dropdown } from "./Dropdown";
import { Dialog, ErrorNote, Field, TextArea, TextInput } from "./ui";
import { ALLOWED_IMAGE_TYPES, MAX_ATTACHMENT_BYTES, fmtBytes, isAllowedImageType } from "@/lib/crm/attachments";
import {
  CANVAS_PAD,
  CARD_H,
  CARD_W,
  edgePath,
  layoutOrgChart,
  wouldCycle,
} from "@/lib/crm/org-layout";
import type { CrmOrgPerson } from "@/lib/crm/types";

/** Below this, the gesture was a click. Four pixels is a firm press, not a nudge. */
const DRAG_THRESHOLD = 4;

interface DragState {
  id: string;
  /** Where the pointer went down, in client coordinates. */
  fromClientX: number;
  fromClientY: number;
  /** The card's stored position when the drag began. */
  baseX: number;
  baseY: number;
  /** Live stored position, or null while the gesture is still under threshold. */
  x: number | null;
  y: number | null;
  moved: boolean;
}

/* -------------------------------------------------------------------------- */
/* The card                                                                    */
/* -------------------------------------------------------------------------- */

function PersonPhoto({ person, size }: { person: CrmOrgPerson; size: number }) {
  if (person.photo_attachment_id) {
    return (
      // A plain <img>, never next/image. The optimizer fetches the URL from the
      // server without the reader's cookie and our serve route answers 401 to
      // that, so every photograph would be a broken image. Same rule as every
      // other attachment in this app.
      // eslint-disable-next-line @next/next/no-img-element -- our own auth-gated route
      <img
        src={`/api/crm/attachments/${person.photo_attachment_id}`}
        alt=""
        // Or the browser's native image drag competes with the card's own, and
        // the gesture ends with a ghost of the photograph following the cursor.
        draggable={false}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover ring-1 ring-ink-900/10"
      />
    );
  }
  // Initials on the SHARED hashed colour, so one person is one colour here, in
  // every comment thread and on every board card. Hashed on the email when
  // there is one and on the id otherwise — the id is stable, which is the only
  // property this needs. `Avatar` itself is not reused because it is fixed at
  // two sizes and this needs its own.
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${avatarTone(
        person.email || person.id,
      )}`}
    >
      {initialsFor(person.name, person.email || person.id)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* The editor                                                                  */
/* -------------------------------------------------------------------------- */

function PersonDialog({
  open,
  person,
  people,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  /** The person being edited, or null when adding. */
  person: CrmOrgPerson | null;
  people: CrmOrgPerson[];
  onClose: () => void;
  onSaved: (row: CrmOrgPerson) => void;
  onDeleted: (id: string, promoted: number) => void;
}) {
  // Seeded once from the row. The caller gives this component a `key` that
  // changes on EVERY open, so it remounts and these initialisers run again.
  //
  // Keying on the person's id alone is not enough, and the failure is a quiet
  // one: adding two people in a row is the same `person` (null) twice, so the
  // component would not remount and the second form would open holding the
  // first person's name and title. Someone who did not notice would create a
  // duplicate. Found by driving the real form, not by reading it.
  const [name, setName] = useState(person?.name ?? "");
  const [title, setTitle] = useState(person?.title ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [managerId, setManagerId] = useState(person?.manager_id ?? "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const [photoId, setPhotoId] = useState<string | null>(person?.photo_attachment_id ?? null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Who this person may be made to report to.
   *
   * Themselves and everyone below them are left out, because choosing one would
   * close a loop. The server refuses those too — this is not the guard, it is
   * the reason nobody meets the guard. Both call the same `wouldCycle`.
   */
  const managerOptions = useMemo(() => {
    const legal = people.filter(
      (p) => !person || (p.id !== person.id && !wouldCycle(people, person.id, p.id)),
    );
    return [
      { value: "", label: "Nobody — top of the chart" },
      ...legal.map((p) => ({ value: p.id, label: p.title ? `${p.name} — ${p.title}` : p.name })),
    ];
  }, [people, person]);

  async function uploadPhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!isAllowedImageType(file.type)) {
      setError(
        `${file.name || "That file"} is ${file.type || "an unknown type"}. Photos must be ${ALLOWED_IMAGE_TYPES.map((t) => t.replace("image/", "")).join(", ")}.`,
      );
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`That photo is ${fmtBytes(file.size)}. The limit is ${fmtBytes(MAX_ATTACHMENT_BYTES)}.`);
      return;
    }
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const row = await apiUpload<{ id: string }>("/api/crm/attachments", form);
      // Held in state, not saved yet. Save is what commits it, so backing out of
      // the dialog leaves the card as it was.
      setPhotoId(row.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That photo could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      setError("A name is required.");
      return;
    }
    setBusy(true);
    setError("");
    const body = {
      name: name.trim(),
      title: title.trim() || null,
      email: email.trim() || null,
      manager_id: managerId || null,
      photo_attachment_id: photoId,
      notes: notes.trim() || null,
    };
    try {
      const row = person
        ? await apiPatch<CrmOrgPerson>(`/api/crm/org/${person.id}`, body)
        : await apiPost<CrmOrgPerson>("/api/crm/org", body);
      onSaved(row);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!person) return;
    const reports = people.filter((p) => p.manager_id === person.id);
    const warning = reports.length
      ? `\n\n${reports.length} ${reports.length === 1 ? "person reports" : "people report"} to ${person.name}. They stay on the chart and move to the top, reporting to nobody.`
      : "";
    if (!confirm(`Remove ${person.name} from the org chart?${warning}`)) return;

    setBusy(true);
    try {
      const res = await apiDeleteJson<{ promoted: number }>(`/api/crm/org/${person.id}`);
      onDeleted(person.id, res.promoted);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be removed.");
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={person ? `Edit ${person.name}` : "Add someone"}>
      <div className="space-y-4">
        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <div className="flex items-center gap-4">
          {photoId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/crm/attachments/${photoId}`}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-ink-900/10"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-ink-200/70 text-lg font-semibold text-ink-500">
              {(name.trim()[0] ?? "?").toUpperCase()}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={ALLOWED_IMAGE_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                void uploadPhoto(e.target.files);
                // Reset, or picking the same file twice fires no change event
                // the second time and the button looks dead.
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="sf-btn-ghost text-xs"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? "Uploading…" : photoId ? "Replace photo" : "Upload photo"}
            </button>
            {photoId ? (
              <button
                type="button"
                className="sf-btn-ghost text-xs"
                disabled={uploading}
                onClick={() => setPhotoId(null)}
              >
                Remove photo
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Sarah Chen" />
          </Field>
          <Field label="Title">
            <TextInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Head of Acquisitions"
            />
          </Field>
          <Field label="Email" hint="Optional. Only used to keep their colour the same everywhere.">
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sarah@btbholdingsllc.com"
            />
          </Field>
          <Field label="Reports to">
            <Dropdown
              value={managerId}
              onChange={setManagerId}
              options={managerOptions}
              aria-label="Reports to"
            />
          </Field>
          <Field label="Notes" span>
            <TextArea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What this person covers."
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink-200 pt-4">
          <div>
            {person ? (
              <button type="button" className="sf-btn-ghost text-xs text-err-700" onClick={() => void remove()} disabled={busy}>
                Remove from chart
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button type="button" className="sf-btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="sf-btn-brand" onClick={() => void save()} disabled={busy || uploading}>
              {busy ? "Saving…" : person ? "Save" : "Add to chart"}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* The chart                                                                   */
/* -------------------------------------------------------------------------- */

export function OrgChart({ initial }: { initial: CrmOrgPerson[] }) {
  const [people, setPeople] = useState<CrmOrgPerson[]>(initial);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [editing, setEditing] = useState<CrmOrgPerson | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open, and used as the dialog's `key`. See the note on
  // PersonDialog's state for the bug this exists to prevent.
  const [openSeq, setOpenSeq] = useState(0);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // The dragged card's live position is folded into the rows the layout reads,
  // so the connecting lines follow it without any separate bookkeeping.
  const effective = useMemo(() => {
    if (!drag || drag.x === null || drag.y === null) return people;
    return people.map((p) => (p.id === drag.id ? { ...p, pos_x: drag.x, pos_y: drag.y } : p));
  }, [people, drag]);

  const layout = useMemo(() => layoutOrgChart(effective), [effective]);
  const byId = useMemo(() => new Map(effective.map((p) => [p.id, p])), [effective]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const anyMoved = people.some((p) => p.pos_x !== null && p.pos_y !== null);

  /** Open the editor on a person, or on nobody to add one. */
  const openDialog = useCallback((person: CrmOrgPerson | null) => {
    setEditing(person);
    setOpenSeq((n) => n + 1);
    setDialogOpen(true);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, id: string) => {
      // Primary button only, and never a right-click.
      if (event.button !== 0) return;
      const node = nodeById.get(id);
      if (!node) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        id,
        fromClientX: event.clientX,
        fromClientY: event.clientY,
        baseX: node.x - CANVAS_PAD,
        baseY: node.y - CANVAS_PAD,
        x: null,
        y: null,
        moved: false,
      });
    },
    [nodeById],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDrag((d) => {
      if (!d) return d;
      const dx = event.clientX - d.fromClientX;
      const dy = event.clientY - d.fromClientY;
      if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return d;
      return {
        ...d,
        moved: true,
        // Clamped at zero: a card dragged off the top-left would be given a
        // negative stored position and then be unreachable on reload, since the
        // canvas has no negative space to scroll into.
        x: Math.max(0, Math.round(d.baseX + dx)),
        y: Math.max(0, Math.round(d.baseY + dy)),
      };
    });
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const d = drag;
      setDrag(null);
      if (!d) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);

      if (!d.moved || d.x === null || d.y === null) {
        // A press with no movement is a click, and a click opens the editor.
        const person = people.find((p) => p.id === d.id);
        if (person) openDialog(person);
        return;
      }

      // Optimistic, then confirmed. The card is already where it was dropped;
      // re-rendering it from the server's answer would make a slow round trip
      // look like the card springing back and then settling.
      const { x, y } = d;
      setPeople((rows) => rows.map((p) => (p.id === d.id ? { ...p, pos_x: x, pos_y: y } : p)));
      setError("");
      apiPatch<CrmOrgPerson>(`/api/crm/org/${d.id}`, { pos_x: x, pos_y: y }).catch((err) => {
        setError(
          err instanceof Error
            ? `${err.message} That card is where you left it on your screen only.`
            : "That position could not be saved.",
        );
      });
    },
    [drag, people, openDialog],
  );

  function upsert(row: CrmOrgPerson) {
    setPeople((rows) => {
      const next = rows.some((p) => p.id === row.id)
        ? rows.map((p) => (p.id === row.id ? row : p))
        : [...rows, row];
      return [...next].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    });
    setNote("");
  }

  function removed(id: string, promoted: number) {
    setPeople((rows) =>
      rows
        .filter((p) => p.id !== id)
        // The database did this with ON DELETE SET NULL; mirroring it here keeps
        // the chart correct without a refetch.
        .map((p) => (p.manager_id === id ? { ...p, manager_id: null } : p)),
    );
    setNote(
      promoted > 0
        ? `Removed. ${promoted} direct report${promoted === 1 ? "" : "s"} moved to the top of the chart — give ${promoted === 1 ? "them" : "each of them"} a manager.`
        : "Removed from the chart.",
    );
  }

  async function resetLayout() {
    if (!confirm("Put every card back where the automatic layout would place it?")) return;
    try {
      await apiPost<{ reset: number }>("/api/crm/org/reset-layout");
      setPeople((rows) => rows.map((p) => ({ ...p, pos_x: null, pos_y: null })));
      setNote("Layout reset.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The layout could not be reset.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-ink-600">
          {people.length === 0
            ? "Nobody on the chart yet."
            : `${people.length} ${people.length === 1 ? "person" : "people"}. Click a card to edit it, drag it to move it.`}
        </div>
        <div className="flex gap-2">
          {anyMoved ? (
            <button type="button" className="sf-btn-ghost text-xs" onClick={() => void resetLayout()}>
              Reset layout
            </button>
          ) : null}
          <button
            type="button"
            className="sf-btn-brand"
            onClick={() => openDialog(null)}
          >
            Add someone
          </button>
        </div>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {note ? <p className="text-xs text-ok-700">{note}</p> : null}

      {people.length === 0 ? (
        <div className="sf-card p-10 text-center">
          <p className="text-sm font-medium text-ink-900">The chart is empty.</p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-600">
            Add the person at the top first — leave their &ldquo;reports to&rdquo; as{" "}
            <em>nobody</em> — then add everyone else and say who they report to. The chart draws
            itself from that; you only drag a card if you want it somewhere else.
          </p>
          <button
            type="button"
            className="sf-btn-brand mt-5"
            onClick={() => openDialog(null)}
          >
            Add the first person
          </button>
        </div>
      ) : (
        <div className="sf-card overflow-auto p-0">
          <div
            className="relative select-none"
            style={{ width: layout.width, height: layout.height, minWidth: "100%" }}
          >
            {/* The reporting lines, behind the cards. One SVG rather than a
                positioned element per line: an elbow is a path, and 40 absolutely
                positioned divs pretending to be corners is how that goes wrong. */}
            <svg
              width={layout.width}
              height={layout.height}
              className="pointer-events-none absolute inset-0"
              aria-hidden
            >
              {layout.edges.map((edge) => {
                const manager = nodeById.get(edge.managerId);
                const report = nodeById.get(edge.reportId);
                if (!manager || !report) return null;
                return (
                  <path
                    key={`${edge.managerId}-${edge.reportId}`}
                    d={edgePath(manager, report)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-ink-900/20"
                  />
                );
              })}
            </svg>

            {layout.nodes.map((node) => {
              const person = byId.get(node.id);
              if (!person) return null;
              const isDragging = drag?.id === node.id && drag.moved;
              return (
                <div
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${person.name}${person.title ? `, ${person.title}` : ""}`}
                  onPointerDown={(e) => onPointerDown(e, node.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  // A drag interrupted by the system — an incoming call, a
                  // gesture the OS claimed — fires cancel and never up. Without
                  // this the card would stay stuck to the pointer.
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(e) => {
                    // Keyboard users get the editor; they cannot drag, which is
                    // fine — position is decoration and the reporting line is
                    // the record, and that is editable in the dialog.
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openDialog(person);
                    }
                  }}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: CARD_W,
                    height: CARD_H,
                    // Without this a touch drag scrolls the container instead of
                    // moving the card, and the card never moves at all.
                    touchAction: "none",
                  }}
                  className={`absolute flex cursor-grab items-center gap-3 rounded-card border border-ink-200 bg-card px-3 shadow-sm transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-sf-500 ${
                    isDragging ? "z-20 cursor-grabbing shadow-pop" : "hover:shadow-md"
                  }`}
                >
                  <PersonPhoto person={person} size={40} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink-900">
                      {person.name}
                    </span>
                    {person.title ? (
                      <span className="mt-0.5 block truncate text-xs leading-snug text-ink-600">
                        {person.title}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* The key is what reseeds the form — see the note on its state. It
          carries the open counter as well as the id, so opening "Add someone"
          twice in a row is two different keys and two blank forms. */}
      <PersonDialog
        key={`${editing?.id ?? "new"}:${openSeq}`}
        open={dialogOpen}
        person={editing}
        people={people}
        onClose={() => setDialogOpen(false)}
        onSaved={upsert}
        onDeleted={removed}
      />
    </div>
  );
}
