/**
 * Whether the left rail is collapsed — remembered in a COOKIE, not localStorage.
 *
 * The distinction is the whole reason this file exists. The rail's width is
 * decided during the server render, so the server has to know the preference
 * before it emits any HTML. `localStorage` is unreadable there, which leaves
 * only the read-it-on-mount pattern: render expanded, then snap to 64px in a
 * `useEffect`. That is a visible 176px jolt on every full page load for anyone
 * who has collapsed it, and the alternative — rendering nothing until mounted —
 * is worse. A cookie is sent with the document request, so the first paint is
 * already correct and the client's initial state matches what the server sent.
 *
 * Nothing here is a security boundary: it is a display preference, so it is
 * deliberately readable and writable by script (the toggle sets it with
 * `document.cookie`). Do not give it `HttpOnly` — that would make the toggle
 * need a round trip to change a CSS class.
 *
 * Pure and dependency-free, like routes.ts, so a client component may import it.
 */

export const RAIL_COOKIE = "btb_rail";

/** A year: this is a preference someone sets once, not a session. */
export const RAIL_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Expanded is the default, and an unrecognised value falls back to it rather
 * than throwing. The cost of being wrong is a nav that is wider than someone
 * wanted for one click; the cost of throwing is a 500 on every /crm page
 * because of a malformed cookie we do not control.
 */
export function isRailCollapsed(cookieValue: string | undefined): boolean {
  return cookieValue === "collapsed";
}

export function railCookieValue(collapsed: boolean): string {
  return collapsed ? "collapsed" : "expanded";
}
