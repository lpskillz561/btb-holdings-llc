"use client";

/**
 * Coloured tag chips, and the picker that puts them on a card.
 *
 * A note on how the colours are built, because it is the one place in the app
 * that does NOT go through the CSS-variable token layer.
 *
 * Everything else uses `sf` / `ink` / `ok` / `warn` / `err`, which invert
 * automatically in dark mode. Tags need eight distinct hues, and adding eight
 * more variable ramps to globals.css — sixteen ramps counting the dark values —
 * would be a lot of token surface for something decorative. So these use
 * Tailwind's own palette with an explicit `dark:` variant per tone.
 *
 * That works because Tailwind's default `darkMode` is `media`, which is the
 * same `prefers-color-scheme` the token layer keys off — so the two switch
 * together and cannot disagree. Do NOT change `darkMode` in the config to
 * `class` without revisiting this file; the chips would then stay light while
 * everything around them went dark.
 *
 * The fills are deliberately soft (100 in light, a 20%-alpha 500 in dark) with
 * the hue carried by the TEXT. A saturated chip fill is what makes a Jira board
 * with thirty labels unreadable — the tags start competing with the cards.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { TAG_COLORS, type TagColor } from "@/lib/crm/types";
import type { CrmTag } from "@/lib/crm/todos";

export const TAG_TONE: Record<TagColor, string> = {
  grey: "bg-ink-200/70 text-ink-700 ring-ink-300/60",
  purple:
    "bg-purple-100 text-purple-700 ring-purple-300/60 dark:bg-purple-400/20 dark:text-purple-200 dark:ring-purple-400/40",
  blue: "bg-blue-100 text-blue-700 ring-blue-300/60 dark:bg-blue-400/20 dark:text-blue-200 dark:ring-blue-400/40",
  teal: "bg-teal-100 text-teal-700 ring-teal-300/60 dark:bg-teal-400/20 dark:text-teal-200 dark:ring-teal-400/40",
  green:
    "bg-green-100 text-green-700 ring-green-300/60 dark:bg-green-400/20 dark:text-green-200 dark:ring-green-400/40",
  yellow:
    "bg-yellow-100 text-yellow-800 ring-yellow-300/60 dark:bg-yellow-400/20 dark:text-yellow-200 dark:ring-yellow-400/40",
  orange:
    "bg-orange-100 text-orange-700 ring-orange-300/60 dark:bg-orange-400/20 dark:text-orange-200 dark:ring-orange-400/40",
  red: "bg-red-100 text-red-700 ring-red-300/60 dark:bg-red-400/20 dark:text-red-200 dark:ring-red-400/40",
};

/** Solid swatches, for the colour picker where the hue IS the content. */
const TAG_SWATCH: Record<TagColor, string> = {
  grey: "bg-ink-400",
  purple: "bg-purple-500",
  blue: "bg-blue-500",
  teal: "bg-teal-500",
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

/**
 * The colour a brand-new tag gets, derived from its label.
 *
 * Deterministic rather than random, so the same word always lands on the same
 * hue — "urgent" is red-ish for everyone, and re-creating a deleted tag brings
 * its colour back. `grey` is excluded from the pool because it is the explicit
 * "no colour" choice; being handed it by the hash would look like the picker
 * had failed.
 */
export function suggestTagColor(label: string): TagColor {
  const pool = TAG_COLORS.filter((c) => c !== "grey");
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.toLowerCase().charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}

export function TagChip({
  tag,
  onRemove,
  onClick,
  active,
  size = "sm",
}: {
  tag: Pick<CrmTag, "label" | "color">;
  onRemove?: () => void;
  onClick?: () => void;
  /** Filter chips: shows the chip as currently selected. */
  active?: boolean;
  size?: "xs" | "sm";
}) {
  const base = `inline-flex max-w-full items-center gap-1 rounded-full font-medium ring-1 transition ${
    size === "xs" ? "px-2 py-0.5 text-[0.65rem]" : "px-2.5 py-1 text-xs"
  } ${TAG_TONE[tag.color] ?? TAG_TONE.grey} ${active ? "ring-2 ring-offset-1 ring-offset-ink-100" : ""}`;

  const body = <span className="truncate">{tag.label}</span>;

  // A chip that removes AND filters would be two controls in one target, so a
  // removable chip is a span with its own button rather than a nested button.
  if (onRemove) {
    return (
      <span className={base}>
        {body}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${tag.label}`}
          className="-mr-0.5 shrink-0 rounded-full p-0.5 opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} hover:brightness-95`}>
        {body}
      </button>
    );
  }

  return <span className={base}>{body}</span>;
}

/**
 * Add-a-tag control for the card dialog.
 *
 * Type-to-filter over the existing vocabulary with "create" as the last option,
 * which is the only shape that works: forcing a separate "manage tags" screen
 * before a tag can be used is how boards end up with no tags on them, and pure
 * free-text with no list is how they end up with `urgent`, `Urgent` and
 * `urgnet`. The server upserts case-insensitively, so picking and typing the
 * same word reach the same row.
 */
export function TagPicker({
  all,
  selected,
  onAdd,
  onCreate,
  disabled,
}: {
  /** The whole vocabulary. */
  all: CrmTag[];
  /** Already on this card — filtered out of the list. */
  selected: CrmTag[];
  onAdd: (tag: CrmTag) => void;
  onCreate: (label: string, color: TagColor) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const chosen = new Set(selected.map((t) => t.id));
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((t) => !chosen.has(t.id))
      .filter((t) => !needle || t.label.toLowerCase().includes(needle))
      .slice(0, 8);
    // `chosen` is derived from `selected` each render; listing it would churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, selected]);

  const trimmed = q.trim();
  const exact = all.some((t) => t.label.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length > 0 && !exact;

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function create() {
    if (!canCreate) return;
    onCreate(trimmed, suggestTagColor(trimmed));
    setQ("");
    setOpen(false);
  }

  return (
    <div ref={wrap} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-ink-300 px-2.5 py-1 text-xs text-ink-600 transition hover:border-sf-400 hover:text-sf-600 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
        Tag
      </button>

      {open ? (
        <div className="sf-glass animate-pop-in absolute left-0 top-full z-40 mt-1.5 w-60 rounded-card border p-2 shadow-pop">
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (matches.length && !canCreate) {
                  onAdd(matches[0]);
                  setQ("");
                  setOpen(false);
                } else {
                  create();
                }
              }
            }}
            placeholder="Find or create a tag…"
            maxLength={40}
            className="sf-input mb-2 text-xs"
          />

          <div className="max-h-52 space-y-1 overflow-y-auto">
            {matches.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => {
                  onAdd(tag);
                  setQ("");
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-pill px-1.5 py-1 text-left transition hover:bg-sf-50"
              >
                <TagChip tag={tag} size="xs" />
                {tag.usage_count ? (
                  <span className="shrink-0 text-[0.65rem] text-ink-500">{tag.usage_count}</span>
                ) : null}
              </button>
            ))}

            {canCreate ? (
              <button
                type="button"
                onClick={create}
                className="flex w-full items-center gap-2 rounded-pill px-1.5 py-1.5 text-left text-xs text-ink-700 transition hover:bg-sf-50"
              >
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${TAG_SWATCH[suggestTagColor(trimmed)]}`}
                />
                Create <span className="font-semibold">{trimmed}</span>
              </button>
            ) : null}

            {!matches.length && !canCreate ? (
              <p className="px-1.5 py-2 text-xs text-ink-500">
                {all.length ? "Every tag is already on this card." : "No tags yet — type one."}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The eight swatches, for recolouring an existing tag. */
export function TagColorPicker({
  value,
  onChange,
}: {
  value: TagColor;
  onChange: (color: TagColor) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={c}
          title={c}
          className={`h-5 w-5 rounded-full ${TAG_SWATCH[c]} transition ${
            value === c ? "ring-2 ring-sf-500 ring-offset-2 ring-offset-card" : "hover:scale-110"
          }`}
        />
      ))}
    </div>
  );
}
