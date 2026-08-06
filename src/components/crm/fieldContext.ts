"use client";

/**
 * The id a `Field` minted for its label, handed down to whatever control sits
 * inside it.
 *
 * This exists because `Field` used to WRAP its control in a `<label>`, which
 * stopped being valid the moment a control became a `<button>` — which is what
 * `Dropdown` is, because a native `<select>`'s popup is drawn by the OS and
 * cannot be themed. Interactive content inside a label is invalid HTML, and the
 * practical symptom is worse than the spec violation: clicking the field's NAME
 * would toggle the dropdown open, so the label became a second, surprising
 * trigger.
 *
 * It is the same lesson `Num` learned when `InfoTip` was added to the equipment
 * workbench — see CLAUDE.md. Fixed the same way: `htmlFor` + a `useId`, and no
 * wrapping.
 *
 * Context rather than `cloneElement`, because a Field's children are not always
 * one control. The client form's Notes field holds a `TextArea` AND an `AiText`
 * button, and cloning an `id` onto both would produce a duplicate id and point
 * the label at the wrong thing.
 *
 * A control that is given an explicit `id` keeps it; this is only the fallback.
 */

import { createContext, useContext } from "react";

export const FieldIdContext = createContext<string | undefined>(undefined);

/** The id to put on a control, preferring one the caller set explicitly. */
export function useFieldId(explicit?: string): string | undefined {
  const inherited = useContext(FieldIdContext);
  return explicit ?? inherited;
}
