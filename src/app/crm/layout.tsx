import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AskAi } from "@/components/crm/AskAi";
import { CrmChrome } from "@/components/crm/CrmChrome";
import { NavProgress } from "@/components/crm/NavProgress";
import { SessionWatch } from "@/components/crm/SessionWatch";
import { getCrmPageUser, isSuperUser } from "@/lib/crm/access";
import { isAiConfigured } from "@/lib/crm/ai";
import { RAIL_COOKIE, isRailCollapsed } from "@/lib/crm/rail";

/**
 * The internal application shell.
 *
 * Everything under /crm that a member of staff works in renders on the internal
 * look: a tinted page, rounded cards lifted by a layered shadow, and a theme
 * that follows the reader's OS appearance. In dark mode a card is raised by
 * being BRIGHTER than the page rather than by shadow — see globals.css.
 *
 * Two things here are what make a section change feel like one screen rather
 * than a page load, and both are structural:
 *
 * 1. The header and the section tabs live HERE, not in each page. A layout is
 *    not re-rendered when a child segment changes, so the chrome stays mounted
 *    and clickable for the whole navigation. Move `CrmChrome` back into a page
 *    and it is torn down and rebuilt on every click.
 * 2. There is deliberately NO loading.tsx under /crm. A loading file is a
 *    Suspense fallback, and it throws away the page you are reading the instant
 *    you click. With no boundary the router keeps the current page on screen
 *    until the next one is ready, and `NavProgress` is what says so meanwhile.
 *    See that file before adding one back.
 *
 * `AskAi` is here for the same reason as the chrome, and it is the stronger
 * case: a conversation is not something to discard because someone opened
 * another tab. Mounted from the layout it survives every navigation, and it
 * re-scopes itself from the URL so the assistant is always looking at whatever
 * the person is looking at.
 *
 * The print routes (/crm/*\/print) are nested here too and are deliberately
 * unaffected — `CrmChrome` renders nothing for them, they set their own type,
 * and the @media print rules drop the background, so a client document still
 * comes out in the navy/gold brand.
 */
export default async function CrmLayout({ children }: { children: ReactNode }) {
  // Chrome only for someone who may actually use the CRM. Pages 404 for
  // everyone else, and that 404 should look like a 404 rather than like the
  // application with an error inside it. This is a cookie check, not a query.
  const user = await getCrmPageUser();

  // The rail's width has to be decided HERE, before any HTML is emitted, or a
  // collapsed rail renders at 240px and snaps to 64px once the client mounts.
  // That is why the preference is a cookie — see lib/crm/rail.ts. This layout
  // already reads cookies for the session, so it costs nothing extra.
  const railCollapsed = isRailCollapsed((await cookies()).get(RAIL_COOKIE)?.value);

  return (
    <div className="sf-page">
      {user ? <NavProgress /> : null}
      {/* One flex row: the rail is a sticky column on lg+, and the pages render
          beside it. Below lg the chrome renders a top bar instead, and this
          wrapper stacks. On the client-facing routes (print, present) CrmChrome
          renders nothing, so the content simply takes the full width. */}
      <div className="lg:flex">
        {user ? <CrmChrome isSuperUser={isSuperUser(user)} defaultCollapsed={railCollapsed} /> : null}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {user ? <AskAi aiEnabled={isAiConfigured()} /> : null}
      {/* Says "you have been signed out" once, when a fetch discovers it. Here
          rather than in a page for the same reason as the chrome: it must
          survive navigation, and the thing it reports is not page-specific. */}
      {user ? <SessionWatch /> : null}
    </div>
  );
}
