"use client";

/**
 * The two inline AI controls that ride on the CRM's forms.
 *
 * `AiAssist`  — "help me fill this in" over a whole form.
 * `AiText`    — tidy / shorten / expand / extract actions / check, on one field.
 *
 * Both are PROPOSE-THEN-CONFIRM and neither writes anything. They call
 * /api/crm/assist, which is itself read-only (see the route's header), render
 * what came back beside what is already typed, and apply a value only when
 * somebody presses Use. Saving is still the form's own submit, down the ordinary
 * POST/PATCH path with its ordinary allow-list.
 *
 * Nothing here fires on mount. A suggestion costs a model call and several
 * seconds, and a form that quietly bills one every time it opens is a form
 * nobody can afford to open. Every call in this file is behind a press.
 *
 * The violet gradient (`sf-btn-ai`) is used for these and nowhere else. The
 * primary action in this app is indigo; "the machine suggested this" must never
 * be one glance away from "this is the button that saves".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "./api";
import { ErrorNote } from "./ui";

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

export function SparkleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12 2.5l1.7 5.1 5.1 1.7-5.1 1.7L12 16.1l-1.7-5.1-5.1-1.7 5.1-1.7L12 2.5Z" />
      <path d="M18.5 14.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" opacity="0.65" />
      <path d="M5 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7L5 15Z" opacity="0.45" />
    </svg>
  );
}

export interface AssistScope {
  /** `global`, `client`, `proposal` or `contract`. Drives the record context. */
  scopeType?: string;
  scopeId?: string | null;
}

/**
 * Write a value into an uncontrolled form field, the way a person typing would.
 *
 * The direct `el.value = x` that this replaces is not enough on its own. React
 * installs its own value setter on the input prototype and tracks the last value
 * it saw; assigning through the instance leaves that tracker stale, so a
 * CONTROLLED input silently reverts on the next render and — more subtly — a
 * later real keystroke can be swallowed as "no change". Going through the
 * prototype setter and then dispatching a bubbling `input` event is what makes
 * the write indistinguishable from typing.
 *
 * ClientForm and RecordForm are both uncontrolled today, so this is belt and
 * braces; it is here so that making one of them controlled later does not
 * quietly break Use.
 */
function setFieldValue(el: HTMLElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The named control inside a form, or null. Radio groups are not used here. */
function fieldEl(form: HTMLFormElement | null, name: string): HTMLElement | null {
  const el = form?.elements.namedItem(name);
  return el instanceof HTMLElement ? el : null;
}

/* -------------------------------------------------------------------------- */
/* AiAssist — whole-form suggestions                                           */
/* -------------------------------------------------------------------------- */

export interface AssistFieldSpec {
  name: string;
  label: string;
  type: string;
  options?: readonly string[];
  hint?: string;
}

interface FieldSuggestion {
  field: string;
  value: string;
  display: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

interface FieldsResult {
  suggestions: FieldSuggestion[];
  questions: string[];
  warnings: string[];
}

const CONFIDENCE_TONE: Record<FieldSuggestion["confidence"], string> = {
  high: "bg-ok-100 text-ok-700 ring-ok-500/25",
  medium: "bg-sf-100 text-sf-700 ring-sf-300",
  low: "bg-warn-100 text-warn-700 ring-warn-500/30",
};

export function AiAssist({
  formRef,
  fields,
  formTitle,
  scopeType = "global",
  scopeId = null,
  /** Rendered in the trigger. Defaults to something that names the action. */
  label = "Help me fill this in",
  className = "",
}: AssistScope & {
  formRef: React.RefObject<HTMLFormElement | null>;
  fields: AssistFieldSpec[];
  formTitle?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<FieldsResult | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [hint, setHint] = useState("");
  const [showHint, setShowHint] = useState(false);

  const labelFor = (name: string) => fields.find((f) => f.name === name)?.label ?? name;

  const run = useCallback(async () => {
    setLoading(true);
    setError("");
    setApplied(new Set());
    try {
      // Read what is typed at the moment of the press, not at mount: half a
      // form is usually already filled in, and a suggestion that ignores it
      // proposes replacing what the person just wrote.
      const current: Record<string, string> = {};
      for (const f of fields) {
        const el = fieldEl(formRef.current, f.name);
        const value = (el as HTMLInputElement | null)?.value?.trim();
        if (value) current[f.name] = value;
      }
      const res = await apiPost<FieldsResult>("/api/crm/assist", {
        kind: "fields",
        scope_type: scopeType,
        scope_id: scopeId,
        form_title: formTitle,
        fields,
        current,
        hint: hint.trim() || undefined,
      });
      setResult(res);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer.");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, [fields, formRef, formTitle, hint, scopeId, scopeType]);

  const apply = useCallback(
    (s: FieldSuggestion) => {
      const el = fieldEl(formRef.current, s.field);
      if (!el) return;
      setFieldValue(el, s.value);
      // A brief highlight on the field itself. Without it, pressing Use on a
      // field that has scrolled out of view looks like nothing happened.
      el.classList.remove("ai-applied");
      // Force a reflow so the animation restarts when the same field is applied
      // twice; a class that is already present does not replay.
      void el.offsetWidth;
      el.classList.add("ai-applied");
      setApplied((prev) => new Set(prev).add(s.field));
    },
    [formRef],
  );

  const suggestions = result?.suggestions ?? [];
  const unapplied = suggestions.filter((s) => !applied.has(s.field));

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void run()} disabled={loading} className="sf-btn-ai">
          <SparkleIcon />
          {loading ? "Reading the record…" : label}
        </button>
        <button
          type="button"
          onClick={() => setShowHint((v) => !v)}
          className="sf-btn-ghost text-xs"
          aria-expanded={showHint}
        >
          {showHint ? "Hide notes" : "Paste notes first"}
        </button>
        {result && !open ? (
          <button type="button" onClick={() => setOpen(true)} className="sf-btn-ghost text-xs">
            Show {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>

      {showHint ? (
        <textarea
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          rows={3}
          placeholder="Paste an email, call notes or anything else you're working from. This is treated as the strongest source."
          className="sf-input mt-2 resize-y"
        />
      ) : null}

      {open ? (
        <div className="animate-pop-in mt-3 rounded-card border border-sf-200 bg-sf-50 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-sf-700">
              Suggestions — nothing is saved until you press Use
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Dismiss suggestions"
              className="rounded-full p-1 text-ink-500 transition hover:bg-ink-200/60 hover:text-ink-900"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <ErrorNote>{error}</ErrorNote>

          {/* Contradictions first. This is the half of the feature that earns
              its keep — a generic assistant cannot flag a 7-day test or a
              figure quoted without §461(l), because it has never read docs/. */}
          {result?.warnings?.length ? (
            <ul className="mb-3 space-y-1.5 rounded-pill border border-warn-500/30 bg-warn-50 p-3">
              {result.warnings.map((w) => (
                <li key={w} className="text-xs leading-relaxed text-warn-700">
                  {w}
                </li>
              ))}
            </ul>
          ) : null}

          {!error && suggestions.length === 0 ? (
            <p className="text-sm text-ink-600">
              Nothing on the record supports filling any of these in yet. That is a real answer,
              not a failure — paste some notes above and try again.
            </p>
          ) : null}

          {suggestions.length ? (
            <ul className="space-y-2">
              {suggestions.map((s) => {
                const used = applied.has(s.field);
                return (
                  <li
                    key={s.field}
                    className={`rounded-pill border border-ink-200 bg-card p-3 transition ${
                      used ? "opacity-55" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-ink-600">
                            {labelFor(s.field)}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide ring-1 ${
                              CONFIDENCE_TONE[s.confidence]
                            }`}
                          >
                            {s.confidence}
                          </span>
                        </div>
                        <p className="mt-1 break-words text-sm font-medium text-ink-900">
                          {s.display || s.value}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-ink-600">{s.reason}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => apply(s)}
                        disabled={used}
                        className="sf-btn-neutral shrink-0 text-xs"
                      >
                        {used ? "Used" : "Use"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {result?.questions?.length ? (
            <div className="mt-3 border-t border-ink-200 pt-3">
              <p className="text-xs font-medium text-ink-600">
                What would let it do better
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {result.questions.map((q) => (
                  <li key={q} className="text-xs text-ink-600">
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {unapplied.length > 1 ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => unapplied.forEach(apply)}
                className="sf-btn-neutral text-xs"
              >
                Use all {unapplied.length}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="sf-btn-ghost text-xs">
                Dismiss
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AiText — one field                                                          */
/* -------------------------------------------------------------------------- */

const TEXT_ACTIONS = [
  { id: "tidy", label: "Tidy up", blurb: "Clean prose, same facts" },
  { id: "brief", label: "Shorten", blurb: "Just the decisions and figures" },
  { id: "expand", label: "Flesh out", blurb: "Notes a colleague could pick up" },
  { id: "actions", label: "Pull out actions", blurb: "Owners and dates" },
  { id: "check", label: "Check against the rules", blurb: "Find what contradicts docs/" },
] as const;

/**
 * The control that sits beside a notes field.
 *
 * `check` is the one that matters most and is deliberately last in the list
 * rather than first: it does not rewrite anything, it reads what is written
 * against the house knowledge base and reports what is wrong with it — the
 * 7-day test where the 30-day one applies, a non-recourse note, a first-year
 * figure quoted without §461(l). The rewrite actions are convenience; this one
 * catches a mistake before it reaches a taxpayer's CPA.
 */
export function AiText({
  formRef,
  name,
  label,
  scopeType = "global",
  scopeId = null,
}: AssistScope & {
  formRef: React.RefObject<HTMLFormElement | null>;
  /** The field's `name` inside the form. */
  name: string;
  label?: string;
}) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  /** The value before the last rewrite, so a bad one is one press from undone. */
  const [previous, setPrevious] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function onDown(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  async function run(action: string) {
    const el = fieldEl(formRef.current, name) as HTMLTextAreaElement | null;
    if (!el) return;
    const text = el.value.trim();
    setMenu(false);
    setError("");
    setNote("");
    if (!text) {
      setError("Write something in the field first — there is nothing to work on.");
      return;
    }
    setBusy(action);
    try {
      const res = await apiPost<{ text: string; note: string }>("/api/crm/assist", {
        kind: "text",
        scope_type: scopeType,
        scope_id: scopeId,
        action,
        text,
        label,
      });
      // `check` returns the text unchanged by contract, so this is a no-op for
      // it and the finding lands in `note` — which is the whole point.
      if (res.text && res.text !== text) {
        setPrevious(text);
        setFieldValue(el, res.text);
        el.classList.remove("ai-applied");
        void el.offsetWidth;
        el.classList.add("ai-applied");
      }
      setNote(res.note || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer.");
    } finally {
      setBusy(null);
    }
  }

  function undo() {
    const el = fieldEl(formRef.current, name) as HTMLTextAreaElement | null;
    if (!el || previous === null) return;
    setFieldValue(el, previous);
    setPrevious(null);
    setNote("");
  }

  return (
    <div ref={wrap} className="relative mt-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          disabled={Boolean(busy)}
          aria-expanded={menu}
          className="sf-btn-ai-quiet text-xs"
        >
          <SparkleIcon className="h-3.5 w-3.5" />
          {busy ? "Working…" : "AI"}
        </button>
        {previous !== null ? (
          <button type="button" onClick={undo} className="sf-btn-ghost text-xs">
            Undo
          </button>
        ) : null}
      </div>

      {menu ? (
        <div className="animate-pop-in absolute z-30 mt-1.5 w-64 overflow-hidden rounded-card border border-ink-200 bg-card shadow-pop">
          {TEXT_ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => void run(a.id)}
              className="block w-full px-3 py-2 text-left transition hover:bg-sf-50"
            >
              <span className="block text-sm font-medium text-ink-900">{a.label}</span>
              <span className="block text-xs text-ink-600">{a.blurb}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-err-700" role="alert">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="mt-2 whitespace-pre-wrap rounded-pill border border-sf-200 bg-sf-50 p-2.5 text-xs leading-relaxed text-ink-700">
          {note}
        </p>
      ) : null}
    </div>
  );
}
