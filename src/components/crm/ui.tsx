"use client";

// Shared CRM primitives. Compose these; don't restyle per page — the portal's
// look is defined by the .card / .field / .btn-* classes in globals.css, and
// these components are the CRM's only additions to that vocabulary.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Tone } from "@/lib/crm/tone";

/* -------------------------------------------------------------------------- */
/* Badges                                                                      */
/* -------------------------------------------------------------------------- */

// `statusTone` deliberately lives in lib/crm/tone.ts, not here: the server
// components that render the CRM sections need to call it, and a server
// component cannot call a function exported from a "use client" module.

const TONES: Record<Tone, string> = {
  neutral: "bg-paper-100 text-navy-900/65 ring-paper-200",
  gold: "bg-gold-500/15 text-gold-600 ring-gold-500/25",
  green: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-700 ring-amber-500/20",
  red: "bg-red-500/10 text-red-700 ring-red-500/20",
  navy: "bg-navy-900/8 text-navy-800 ring-navy-900/12",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  hint,
  tone = "navy",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "navy" | "gold";
}) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-800/55">{label}</p>
      <p
        className={`mt-2 font-serif text-2xl font-medium ${
          tone === "gold" ? "text-gold-600" : "text-navy-900"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-navy-900/50">{hint}</p>}
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
      <h3 className="text-base font-semibold text-navy-900">
        {title}
        {count !== undefined && (
          <span className="ml-2 text-sm font-normal text-navy-900/45">{count}</span>
        )}
      </h3>
      {action}
    </div>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-paper-300 p-8 text-center">
      <p className="text-sm text-navy-900/55">{children}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-700"
    >
      {children}
    </p>
  );
}

/** A labelled definition row, used all over the client card. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-800/50">{label}</dt>
      <dd className="mt-0.5 text-sm text-navy-900">{children}</dd>
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
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-navy-900/45">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`field ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`field ${props.className ?? ""}`} />;
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
    <select {...props} className={`field ${props.className ?? ""}`}>
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
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-navy-900/40">
        $
      </span>
      <input
        inputMode="decimal"
        {...props}
        className={`field pl-7 ${props.className ?? ""}`}
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
        className={`field pr-8 ${props.className ?? ""}`}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-navy-900/40">
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/50 p-4 py-10 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card w-full ${wide ? "max-w-3xl" : "max-w-xl"}`}
      >
        <div className="flex items-center justify-between border-b border-paper-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-navy-900/40 transition hover:bg-paper-100 hover:text-navy-900"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
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
          <tr className="border-b border-paper-200 text-left">
            {head.map((h, i) => (
              <th
                key={i}
                className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-navy-800/50"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-paper-200">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-top text-navy-900/85 ${className}`}>{children}</td>;
}
