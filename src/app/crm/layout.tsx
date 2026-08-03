import type { ReactNode } from "react";
import { AskAi } from "@/components/crm/AskAi";
import { CrmChrome } from "@/components/crm/CrmChrome";
import { NavProgress } from "@/components/crm/NavProgress";
import { getCrmPageUser, isSuperUser } from "@/lib/crm/access";
import { isAiConfigured } from "@/lib/crm/ai";

/**
 * The internal application shell.
 *
 * Everything under /crm that a member of staff works in renders on Lightning's
 * grey with sans type. The grey is load-bearing rather than decorative: it is
 * what makes the white cards read as raised, which is why `.sf-card` carries no
 * shadow.
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

  return (
    <div className="sf-page">
      {user ? (
        <>
          <NavProgress />
          <CrmChrome isSuperUser={isSuperUser(user)} />
        </>
      ) : null}
      {children}
      {user ? <AskAi aiEnabled={isAiConfigured()} /> : null}
    </div>
  );
}
