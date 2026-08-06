"use client";

/**
 * The ⓘ beside a field, explaining what it means and the rule behind it.
 *
 * Three decisions here are not cosmetic:
 *
 * 1. **The panel is `position: fixed`, placed from the trigger's rect.** The
 *    obvious implementation — an absolutely-positioned div inside the label —
 *    is clipped to nothing on this page, because the tables it would live in
 *    are `overflow-x-auto` and the schedule is `max-h ... overflow-auto`. A
 *    fixed panel escapes every ancestor's overflow. The cost is that it does
 *    not follow the trigger when something scrolls, so scrolling CLOSES it.
 * 2. **Hover is not the only way in.** Hover-only tooltips are unreachable by
 *    keyboard and unusable on a touch screen. This opens on hover, on focus and
 *    on click; a click PINS it so the panel can be read without the pointer
 *    having to stay inside a 16px target.
 * 3. **The trigger is a real `<button>` inside the `<label>`'s text, not the
 *    label itself.** Wrapping a label around it is what puts the ⓘ in the tab
 *    order with an accessible name; making the label the trigger would mean
 *    clicking the field name opened a popover instead of focusing the input.
 *
 * Content lives in `lib/crm/equipment-glossary.ts`, never inline here.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  EQUIPMENT_GLOSSARY,
  type GlossaryEntry,
  type GlossaryKey,
} from "@/lib/crm/equipment-glossary";

const PANEL_WIDTH = 360;
const MARGIN = 12;
/** Enough room below the trigger to bother opening downwards. */
const MIN_BELOW = 300;

interface Placement {
  top: number;
  left: number;
  above: boolean;
}

export function InfoTip({ term }: { term: GlossaryKey }) {
  // Widened to the interface deliberately: the `as const satisfies` on the
  // glossary keeps each entry's literal type, and `cites` is absent from some
  // of them, so indexing straight into it yields a union where `.cites` is not
  // a common property.
  const entry: GlossaryEntry = EQUIPMENT_GLOSSARY[term];
  const [place, setPlace] = useState<Placement | null>(null);
  const [pinned, setPinned] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Set for one tick while Escape returns focus to the trigger.
   *
   * Without it, Escape is a no-op that looks like a bug: `close()` clears the
   * panel, `.focus()` then fires `onFocus`, and `onFocus` opens it straight
   * back up. Dropping the `.focus()` instead would "fix" it by stranding
   * keyboard focus on a dismissed popover.
   */
  const suppressFocusOpen = useRef(false);
  const panelId = useId();

  const open = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Clamp horizontally so a tooltip on the last column of a wide table does
    // not render half off-screen.
    const left = Math.max(
      MARGIN,
      Math.min(
        r.left + r.width / 2 - PANEL_WIDTH / 2,
        window.innerWidth - PANEL_WIDTH - MARGIN,
      ),
    );
    const above = window.innerHeight - r.bottom < MIN_BELOW && r.top > MIN_BELOW;
    setPlace({ top: above ? r.top - 8 : r.bottom + 8, left, above });
  }, []);

  const close = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setPlace(null);
    setPinned(false);
  }, []);

  // Scroll and resize invalidate a fixed panel's position, so dismiss rather
  // than let it drift away from the field it describes. `capture` catches
  // scrolling inside the tables, which does not bubble to window.
  useEffect(() => {
    if (!place) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        suppressFocusOpen.current = true;
        close();
        btnRef.current?.focus();
        // `.focus()` dispatches synchronously, so the flag has been consumed by
        // now unless the trigger already held focus. Clear it either way, or
        // the NEXT deliberate focus would be swallowed instead.
        setTimeout(() => {
          suppressFocusOpen.current = false;
        }, 0);
      }
    };
    // The panel has live pointer events so its text can be selected and read,
    // which means it must be excluded here too — otherwise clicking into a
    // pinned explanation to highlight a citation dismisses it.
    const onAway = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!btnRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("mousedown", onAway);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", onAway);
    };
  }, [place, close]);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        // Not "more info": a screen reader hearing thirty of those in a table
        // learns nothing about which field it is on.
        aria-label={`What "${entry.term}" means`}
        aria-expanded={place !== null}
        aria-describedby={place ? panelId : undefined}
        onMouseEnter={() => {
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          hoverTimer.current = setTimeout(open, 120);
        }}
        onMouseLeave={() => {
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          if (!pinned) setPlace(null);
        }}
        onFocus={() => {
          if (suppressFocusOpen.current) return;
          open();
        }}
        onBlur={() => {
          if (!pinned) setPlace(null);
        }}
        onClick={(e) => {
          e.preventDefault();
          if (pinned) {
            close();
          } else {
            setPinned(true);
            open();
          }
        }}
        className="ml-1 inline-flex h-4 w-4 shrink-0 translate-y-[1px] items-center justify-center rounded-full border border-ink-200 bg-card text-[10px] font-semibold leading-none text-ink-600 transition hover:border-sf-600 hover:text-sf-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sf-600"
      >
        i
      </button>

      {place ? (
        <span
          ref={panelRef}
          id={panelId}
          role="tooltip"
          // Pointer events are ON so the panel can be read and its text
          // selected while pinned; the outside-mousedown handler is what
          // closes it, so it does not need to be inert.
          className="fixed z-50 block w-[360px] rounded-lg border border-ink-200 bg-card p-4 text-left shadow-xl"
          style={{
            top: place.top,
            left: place.left,
            transform: place.above ? "translateY(-100%)" : undefined,
          }}
        >
          <span className="block text-sm font-semibold text-ink-900">{entry.term}</span>

          <span className="mt-2 block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-sf-600">
              Usage
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-ink-800">{entry.usage}</span>
          </span>

          <span className="mt-3 block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-accent-600">
              Legality
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-ink-800">{entry.legal}</span>
          </span>

          {entry.cites?.length ? (
            <span className="mt-3 block border-t border-ink-200 pt-2 text-[10px] leading-relaxed text-ink-600">
              {entry.cites.join(" · ")}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
