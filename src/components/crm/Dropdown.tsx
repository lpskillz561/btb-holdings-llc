"use client";

/**
 * A dropdown we draw ourselves.
 *
 * The reason this exists at all: a native `<select>`'s POPUP is rendered by the
 * operating system, not the page. No amount of CSS reaches it — it will always
 * be a grey macOS menu in the middle of an indigo app, in the light appearance
 * even when everything around it is dark. It is the one control that cannot be
 * themed, and on a form of ten fields it is the one people notice.
 *
 * THE NATIVE <select> IS STILL IN THE DOM, and that is the whole design.
 * It is visually hidden and pointer-inert, but it is a real, named form control,
 * which means everything that already worked keeps working with no call-site
 * changes:
 *
 *   - `new FormData(form)` picks it up, so ClientForm and RecordForm submit
 *     exactly as before.
 *   - `form.elements.namedItem(name)` finds it, so the AI assist panel's "Use"
 *     button can write into it.
 *   - `setFieldValue` in AiAssist.tsx dispatches a bubbling `input`/`change`,
 *     which the `onChange` below hears — so an AI suggestion updates the visible
 *     label rather than silently changing a value nobody can see.
 *
 * A hidden `<input>` plus a button would have broken all three. Reimplementing
 * `<select>` from scratch would have broken all three *and* the accessibility
 * tree.
 *
 * Keyboard: Enter/Space/Arrow to open, arrows to move, Home/End, type-ahead,
 * Enter to choose, Escape to close without choosing. That is the ARIA listbox
 * pattern, and it is the reason this is worth ~200 lines rather than being a
 * div with an onClick.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFieldId } from "./fieldContext";

export interface DropdownOption {
  value: string;
  label: string;
  /** Rendered under the label in the popup. Not shown on the closed control. */
  hint?: string;
  disabled?: boolean;
}

export function Dropdown({
  options,
  value,
  defaultValue,
  onChange,
  name,
  id,
  placeholder = "Select…",
  disabled,
  required,
  className = "",
  triggerClassName,
  "aria-label": ariaLabel,
}: {
  options: DropdownOption[];
  /** Controlled. Omit for an uncontrolled control seeded by `defaultValue`. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /**
   * Replaces `.sf-input` on the closed control, for the one case where this is
   * not a form field: the status lozenge on a card, which is a coloured pill
   * that has to carry the status tone. The popup is untouched — every dropdown
   * in the app opens the same menu, whatever opened it. When this is set the
   * label and the caret inherit `currentColor` instead of the field ink, so the
   * pill's own text colour applies.
   */
  triggerClassName?: string;
  "aria-label"?: string;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = controlled ? value : inner;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const native = useRef<HTMLSelectElement>(null);
  const listId = useId();
  // Falls back to the id `Field` minted for its <label htmlFor>, so a dropdown
  // inside a Field is properly labelled without every call site passing one.
  const buttonId = useFieldId(id);

  const selected = useMemo(
    () => options.find((o) => o.value === current),
    [options, current],
  );

  const commit = useCallback(
    (next: string) => {
      if (!controlled) setInner(next);
      // Keep the native element in step even when this is controlled: it is what
      // FormData reads, and a controlled parent that only tracks React state
      // would otherwise submit a stale value.
      if (native.current) native.current.value = next;
      onChange?.(next);
    },
    [controlled, onChange],
  );

  /* ---- open/close ---- */

  const openList = useCallback(() => {
    if (disabled) return;
    const r = button.current?.getBoundingClientRect();
    if (r) setRect(r);
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
  }, [disabled, options, current]);

  const closeList = useCallback((focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  }, []);

  // The popup is PORTALLED and positioned from the trigger's rect, the same
  // approach as InfoTip and for the same reason: an absolutely-positioned menu
  // is clipped to nothing inside the `overflow-auto` containers this control
  // sits in (the card dialog, the equipment tables, any scrolling form).
  //
  // The cost of `position: fixed` is that it cannot follow the trigger, so
  // scrolling has to close it. `capture` on the listener because scrolling
  // inside one of those containers does not bubble to window.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => closeList(false);
    const onResize = () => closeList(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, closeList]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrap.current?.contains(target) || list.current?.contains(target)) return;
      closeList(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, closeList]);

  // Keep the active row in view when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelectorAll("li")[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  /* ---- type-ahead ---- */

  const typed = useRef({ text: "", at: 0 });
  const typeAhead = useCallback(
    (char: string) => {
      const now = Date.now();
      // A pause resets the buffer, so "st" finds "Status" but a later "a" on its
      // own finds "Amber" rather than searching for "sta".
      typed.current.text = now - typed.current.at > 700 ? char : typed.current.text + char;
      typed.current.at = now;
      const needle = typed.current.text.toLowerCase();
      const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(needle));
      if (i >= 0) {
        if (open) setActive(i);
        else commit(options[i].value);
      }
    },
    [options, open, commit],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openList();
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        typeAhead(e.key);
      }
      return;
    }

    const step = (from: number, dir: 1 | -1) => {
      let i = from;
      for (let n = 0; n < options.length; n++) {
        i = (i + dir + options.length) % options.length;
        if (!options[i].disabled) return i;
      }
      return from;
    };

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeList();
        break;
      case "Tab":
        // Tab commits nothing and gets out of the way — matching a native select.
        closeList(false);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (options[active] && !options[active].disabled) commit(options[active].value);
        closeList();
        break;
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => step(i, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => step(i, -1));
        break;
      case "Home":
        e.preventDefault();
        setActive(options.findIndex((o) => !o.disabled));
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1 - [...options].reverse().findIndex((o) => !o.disabled));
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          typeAhead(e.key);
        }
    }
  }

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div ref={wrap} className={`relative ${className}`}>
      {/* The real control. Visually hidden but NOT `display:none` and NOT
          `hidden` — a hidden select is excluded from form submission by the
          HTML spec, which would silently drop the field. `aria-hidden` plus
          `tabIndex={-1}` keeps it out of the accessibility tree and the tab
          order, since the button below is what represents it. */}
      <select
        ref={native}
        name={name}
        value={controlled ? value : undefined}
        defaultValue={controlled ? undefined : defaultValue}
        required={required}
        disabled={disabled}
        aria-hidden
        tabIndex={-1}
        // Fires when something OUTSIDE this component writes to the element —
        // in practice the AI assist panel's "Use" button. Without this the value
        // would change and the visible label would not.
        onChange={(e) => {
          if (!controlled) setInner(e.target.value);
          onChange?.(e.target.value);
        }}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      >
        {/* A placeholder option so an unset value is representable. */}
        {!options.some((o) => o.value === "") && <option value="" />}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <button
        ref={button}
        type="button"
        id={buttonId}
        disabled={disabled}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={`${triggerClassName ?? "sf-input"} flex items-center justify-between gap-2 text-left ${
          open && !triggerClassName ? "border-sf-400 ring-4 ring-sf-500/15" : ""
        } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      >
        <span
          className={`truncate ${
            triggerClassName ? "" : selected ? "text-ink-900" : "text-ink-400"
          }`}
        >
          {selected?.label ?? placeholder}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`h-4 w-4 shrink-0 transition-transform duration-150 ${
            triggerClassName ? "opacity-70" : "text-ink-500"
          } ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9.5l6 6 6-6" />
        </svg>
      </button>

      {open && mounted && rect
        ? createPortal(
            <ul
              ref={list}
              id={listId}
              role="listbox"
              tabIndex={-1}
              className="sf-glass animate-pop-in fixed z-[60] max-h-72 overflow-y-auto rounded-card border p-1 shadow-pop"
              style={{
                left: rect.left,
                width: rect.width,
                // Flip above the trigger when there is not room below, so a
                // control near the bottom of a dialog does not open off-screen.
                ...(rect.bottom + 300 > window.innerHeight && rect.top > 300
                  ? { bottom: window.innerHeight - rect.top + 6 }
                  : { top: rect.bottom + 6 }),
              }}
            >
              {options.map((o, i) => {
                const isSelected = o.value === current;
                return (
                  <li
                    key={o.value}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={o.disabled || undefined}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    // mousedown, not click: the outside-click handler runs on
                    // mousedown, and a click handler would fire after the list
                    // had already closed.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (o.disabled) return;
                      commit(o.value);
                      closeList();
                    }}
                    className={`flex cursor-pointer items-center gap-2 rounded-pill px-2.5 py-2 text-sm transition-colors ${
                      o.disabled
                        ? "cursor-not-allowed opacity-40"
                        : i === active
                          ? "bg-sf-500 text-white"
                          : "text-ink-800"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.hint ? (
                        <span
                          className={`block truncate text-xs ${
                            i === active ? "text-white/75" : "text-ink-500"
                          }`}
                        >
                          {o.hint}
                        </span>
                      ) : null}
                    </span>
                    {isSelected ? (
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden
                        className="h-4 w-4 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    ) : null}
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
