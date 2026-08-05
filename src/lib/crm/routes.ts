/**
 * Which /crm routes are the CLIENT's, not ours.
 *
 * Everything under /crm carries the Lightning chrome — except the routes whose
 * output a client actually sees. The print pages are the document itself, and
 * the presentation is shown on a shared screen in a meeting. Neither may carry
 * a nav bar, a section tab strip or a floating assistant button.
 *
 * This lives on its own rather than being duplicated as `endsWith("/print")` in
 * each component, because the two copies had already diverged once: adding the
 * presentation meant remembering every place that test appears, and the cost of
 * missing one is our internal tooling appearing in a client's screen share.
 *
 * Pure and dependency-free so client components can import it.
 */
export function isClientFacingRoute(pathname: string): boolean {
  return pathname.endsWith("/print") || isPresentRoute(pathname);
}

/**
 * The deck, and anything nested under it — but NOT `/crm/presentations`, which
 * is the internal library that lists the decks and must keep its nav.
 *
 * The trailing slash is the whole guard. `startsWith("/crm/present")` reads as
 * the obvious simplification and is wrong: it also matches
 * `/crm/presentations`, which would strip the chrome off an internal page and
 * leave whoever opened it with no way back. Do not "tidy" this.
 */
function isPresentRoute(pathname: string): boolean {
  return pathname === "/crm/present" || pathname.startsWith("/crm/present/");
}
