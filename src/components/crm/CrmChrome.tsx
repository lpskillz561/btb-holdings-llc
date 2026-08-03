"use client";

/**
 * The chrome that does NOT change when you change section.
 *
 * This used to live inside CrmNav and therefore inside every page, which meant
 * the navy bar and the tab strip were torn down and rebuilt on every click —
 * `app/crm/loading.tsx` had to redraw both as skeletons, so switching from
 * Overview to Contracts blanked the whole window for as long as the server
 * render took. Rendered from the layout instead, it simply never unmounts:
 * the tabs stay put, stay clickable, and only the record header and the body
 * below them are replaced.
 *
 * Being a client component is what buys the other half of the fix. `usePathname`
 * means no page has to tell the nav which tab it is on, and `useLinkStatus`
 * gives the clicked tab a pending underline the instant it is pressed —
 * feedback that arrives before the server has done anything at all.
 */

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { BtbMark } from "@/components/Logo";
import { isClientFacingRoute } from "@/lib/crm/routes";
import { site } from "@/lib/site";

/**
 * The global sections exist alongside the per-client tabs on purpose. A client
 * card answers "where does this account stand" — the question you have with
 * someone on the phone. The sections answer what no single record can: what the
 * whole pipeline is worth, which contracts are unsigned, what the portfolio
 * earns. Anything client-scoped needs its global list too, or it is unreachable
 * from an empty install.
 */
const SECTIONS = [
  { href: "/crm", label: "Overview" },
  { href: "/crm/proposals", label: "Proposals" },
  { href: "/crm/contracts", label: "Contracts" },
  // BTB's own land, distinct from Holdings, which is the client-owned homes.
  { href: "/crm/land", label: "Our land" },
  { href: "/crm/holdings", label: "Holdings" },
  { href: "/crm/financials", label: "Financials" },
];

/**
 * A section owns its detail pages: /crm/land/search keeps "Our land" lit. The
 * root is matched exactly or it would own everything.
 */
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/crm") return pathname === "/crm";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The inside of a tab, which has to be a separate component because
 * `useLinkStatus` only reports on the <Link> above it.
 *
 * The label is rendered twice: once bold and invisible to hold the width, once
 * visibly. Without that, a tab going from regular to semibold on arrival would
 * nudge every tab to its right — a shift nobody noticed while the whole bar was
 * being replaced anyway, and which is glaring now that it stays.
 */
function Tab({ label, active }: { label: string; active: boolean }) {
  const { pending } = useLinkStatus();

  return (
    <span className="grid justify-items-center">
      <span aria-hidden className="invisible col-start-1 row-start-1 font-semibold">
        {label}
      </span>
      <span
        className={`col-start-1 row-start-1 transition-colors ${
          active ? "font-semibold text-sf-600" : pending ? "text-sf-600" : ""
        }`}
      >
        {label}
      </span>
      <span
        aria-hidden
        className={`absolute inset-x-0 bottom-0 h-0.5 ${
          pending ? "crm-tab-pending" : active ? "bg-sf-500" : ""
        }`}
      />
    </span>
  );
}

export function CrmChrome({ isSuperUser = false }: { isSuperUser?: boolean }) {
  const pathname = usePathname();

  // The print routes and the presentation are nested under /crm but are the
  // client's, not a screen of ours. They have never carried this chrome and must
  // not start. See lib/crm/routes.ts.
  if (isClientFacingRoute(pathname)) return null;

  return (
    <>
      {/* Global header — Lightning's dark utility bar. Kept navy rather than
          Salesforce's own indigo so the product still looks like BTB at a
          glance, which is the one place the brand should survive indoors. */}
      <div className="bg-navy-950">
        <div className="container-x flex h-12 items-center justify-between gap-4">
          <Link href="/crm" className="inline-flex items-center gap-2 text-sm font-semibold text-paper-50">
            {/* Reversed: the navy disc on the navy bar would be a hole. */}
            <BtbMark simplified variant="reversed" className="h-[1.25rem] w-auto shrink-0" />
            {site.shortName}
          </Link>
          <div className="flex shrink-0 items-center gap-4">
            {isSuperUser ? (
              <Link href="/crm/admin" className="text-sm text-paper-50/70 transition hover:text-gold-400">
                Users
              </Link>
            ) : null}
            <a href="/api/auth/logout" className="text-sm text-paper-50/70 transition hover:text-gold-400">
              Sign out
            </a>
          </div>
        </div>
      </div>

      {/* Object nav — the bar of tabs Lightning puts under the header. */}
      <div className="border-b border-ink-200 bg-white">
        <div className="container-x flex flex-wrap items-stretch gap-0">
          {SECTIONS.map((section) => {
            const active = isCurrent(pathname, section.href);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className="relative px-4 py-2.5 text-sm text-ink-700 transition-colors hover:bg-ink-100 hover:text-sf-600"
              >
                <Tab label={section.label} active={active} />
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
