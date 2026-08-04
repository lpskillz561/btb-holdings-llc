"use client";

// Shared CRM primitives, in the Salesforce Lightning idiom.
//
// These are INTERNAL ONLY — no print page imports this module, which is what
// makes the split possible: staff screens get Lightning's density and blue,
// while proposals and contracts keep the navy/gold private-bank look that is
// worth something in front of a client's CPA.
//
// Compose these; don't restyle per page. The vocabulary is the .sf-* classes in
// globals.css.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Tone } from "@/lib/crm/tone";

/* -------------------------------------------------------------------------- */
/* Badges                                                                      */
/* -------------------------------------------------------------------------- */

// `statusTone` deliberately lives in lib/crm/tone.ts, not here: the server
// components that render the CRM sections need to call it, and a server
// component cannot call a function exported from a "use client" module.

const TONES: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700 ring-ink-200",
  gold: "bg-gold-500/15 text-gold-600 ring-gold-500/30",
  green: "bg-ok-100 text-ok-700 ring-ok-500/25",
  amber: "bg-warn-100 text-warn-700 ring-warn-500/30",
  red: "bg-err-100 text-err-700 ring-err-500/25",
  navy: "bg-sf-100 text-sf-700 ring-sf-300",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium ring-1 ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "navy" | "gold";
}

/** The body of one figure. Bare — StatTile and StatStrip supply the surface. */
export function Stat({ label, value, hint, tone = "navy" }: StatProps) {
  return (
    <div className="bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-600">{label}</p>
      <p
        className={`mt-1.5 text-2xl font-semibold leading-tight ${
          tone === "gold" ? "text-gold-600" : "text-ink-900"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-600">{hint}</p>}
    </div>
  );
}

export function StatTile(props: StatProps) {
  return (
    <div className="sf-card overflow-hidden">
      <Stat {...props} />
    </div>
  );
}

/**
 * Several figures as ONE surface, divided by hairlines.
 *
 * The overview used to show eight separate cards in two grids, and eight boxes
 * of equal visual weight is noise — nothing reads as more important than
 * anything else. A single band with internal rules is the Lightning pattern for
 * this, and the gap-px-over-grey trick gives clean hairlines that wrap
 * correctly at every column count, which per-cell borders do not.
 */
export function StatStrip({ children }: { children: ReactNode }) {
  return (
    <div className="sf-card grid gap-px overflow-hidden bg-ink-200 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h3 className="text-sm font-bold text-ink-900">
        {title}
        {count !== undefined && (
          <span className="ml-2 text-sm font-normal text-ink-600">({count})</span>
        )}
      </h3>
      {action}
    </div>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-300 bg-white p-8 text-center">
      <p className="text-sm text-ink-600">{children}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded border-l-4 border-err-500 bg-err-100 px-3 py-2 text-sm text-err-700"
    >
      {children}
    </p>
  );
}

/** A labelled definition row, used all over the client card. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-600">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-900">{children}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Form fields                                                                 */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  children,
  span,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  span?: boolean;
}) {
  return (
    <label className={`block ${span ? "sm:col-span-2" : ""}`}>
      <span className="sf-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-600">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`sf-input ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`sf-input ${props.className ?? ""}`} />;
}

export function Select({
  options,
  labels,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: readonly string[];
  labels?: Record<string, string>;
}) {
  return (
    <select {...props} className={`sf-input ${props.className ?? ""}`}>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

/**
 * A money input. The form works in whole dollars — the string a human types —
 * and the API converts to cents on the way in, so no component ever holds a
 * float number of dollars that could round badly.
 */
export function MoneyInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">
        $
      </span>
      <input
        inputMode="decimal"
        {...props}
        className={`sf-input pl-7 ${props.className ?? ""}`}
      />
    </div>
  );
}

export function PercentInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        {...props}
        className={`sf-input pr-8 ${props.className ?? ""}`}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">
        %
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialog                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A modal. Closes on Escape and on backdrop click, restores focus to whatever
 * opened it, and locks background scroll while open.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    // Move focus into the panel so keyboard users aren't left behind the backdrop.
    panel.current?.querySelector<HTMLElement>(
      "input, select, textarea, button",
    )?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      restoreTo.current?.focus();
    };
  }, [open, onClose]);

  // Mounted flag, because document.body does not exist during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!open || !mounted) return null;

  // PORTALLED TO document.body, not rendered where it is written.
  //
  // `position: fixed` is relative to the nearest ancestor that creates a
  // stacking context, and z-index only competes inside it. A dialog opened
  // from a button in RecordHeader was therefore painted UNDER the page body —
  // visible, half-covered, and unusable, with no error anywhere. Nothing about
  // the call site can guard against that, so the primitive escapes to the body
  // and the problem cannot recur.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sf-card w-full shadow-lift ${wide ? "max-w-3xl" : "max-w-xl"}`}
      >
        <div className="flex items-center justify-between border-b border-ink-200 px-6 py-4">
          <h2 className="text-base font-bold text-ink-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Open/close state for a Dialog, so pages don't each re-declare it. */
export function useDialog(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);
  return [open, () => setOpen(true), () => setOpen(false)];
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-200 bg-ink-100 text-left">
            {head.map((h, i) => (
              <th
                key={i}
                className="whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-600"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-200">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-middle text-ink-800 ${className}`}>{children}</td>;
}
