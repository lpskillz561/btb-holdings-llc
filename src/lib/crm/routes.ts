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
  return pathname.endsWith("/print") || pathname === "/crm/present";
}
