"use client";

/**
 * The chrome that does NOT change when you change section — now a left rail.
 *
 * This used to live inside CrmNav and therefore inside every page, which meant
 * the bar was torn down and rebuilt on every click. Rendered from the layout
 * instead, it simply never unmounts: the rail stays put, stays clickable, and
 * only the record header and the body beside it are replaced. Do not move it
 * back into a page.
 *
 * Being a client component is what buys the other half of the fix. `usePathname`
 * means no page has to tell the nav which item it is on, and `useLinkStatus`
 * gives the clicked item a pending pulse the instant it is pressed — feedback
 * that arrives before the server has done anything at all.
 *
 * Layout contract with app/crm/layout.tsx: on lg+ this renders a sticky
 * full-height column inside the layout's flex row, and the pages render beside
 * it. Below lg it renders a compact top bar plus a drawer, and the pages render
 * below it. The navy is deliberate — the one place the brand survives indoors —
 * and the body of every screen stays Lightning grey/white/blue.
 */

import { useEffect, useState } from "react";
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
  { href: "/crm", label: "Overview", icon: "home" },
  { href: "/crm/proposals", label: "Proposals", icon: "doc" },
  { href: "/crm/contracts", label: "Contracts", icon: "pen" },
  // BTB's own land, distinct from Holdings, which is the client-owned homes.
  { href: "/crm/land", label: "Our land", icon: "map" },
  { href: "/crm/holdings", label: "Holdings", icon: "unit" },
  { href: "/crm/financials", label: "Financials", icon: "chart" },
  // The shared kanban board. Last because it is the team talking to itself
  // rather than a view of the book, and it is reached from the dashboard too.
  { href: "/crm/todos", label: "Board", icon: "board" },
] as const;

type IconName = (typeof SECTIONS)[number]["icon"] | "users" | "exit";

/** Minimal 1.5-stroke line icons; currentColor so state styling is free. */
const ICON_PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5.5 8.5V20h13V8.5",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h5M10 16.5h5",
  pen: "M4 20l4-1L20.5 6.5a1.9 1.9 0 0 0-3-3L5 16zM13 6l3 3",
  map: "M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14",
  unit: "M3 20h18M5 20V9.5L12 4l7 5.5V20M9.5 20v-6h5v6",
  chart: "M4 4v16h16M8 16v-5M12 16V8M16 16v-8",
  board: "M4 5h16v14H4zM9.33 5v14M14.67 5v14",
  users: "M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-3.5 2.9-5 5.5-5s5 1.5 5.5 5M15.5 10.5a3 3 0 1 0-1.4-5.8M15.8 15.3c2.3.3 4.2 1.7 4.7 4.7",
  exit: "M14 4h6v16h-6M10 8l-4 4 4 4M6 12h11",
};

function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/**
 * A section owns its detail pages: /crm/land/search keeps "Our land" lit. The
 * root is matched exactly or it would own everything.
 */
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/crm") return pathname === "/crm";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The inside of a nav item — separate because `useLinkStatus` only reports on
 * the <Link> above it. Pending pulses the row the moment the link is pressed:
 * on a slow dynamic render this is the only immediate acknowledgement, since
 * the CRM deliberately has no loading.tsx (see app/crm/layout.tsx).
 */
function ItemBody({ label, icon, active }: { label: string; icon: IconName; active: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={`relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-white/10 font-medium text-white"
          : pending
            ? "animate-pulse bg-white/5 text-white"
            : "text-paper-50/60 hover:bg-white/5 hover:text-paper-50"
      }`}
    >
      {/* Gold tick for "you are here" — the one brand accent on the rail. */}
      <span
        aria-hidden
        className={`absolute -left-2 h-5 w-0.5 rounded-full ${active ? "bg-gold-500" : ""}`}
      />
      <NavIcon name={icon} />
      {label}
    </span>
  );
}

/** The nav column itself; shared verbatim by the rail and the mobile drawer. */
function NavColumn({ pathname, isSuperUser }: { pathname: string; isSuperUser: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} aria-current={isCurrent(pathname, s.href) ? "page" : undefined} className="block">
            <ItemBody label={s.label} icon={s.icon} active={isCurrent(pathname, s.href)} />
          </Link>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-white/10 px-3 py-3">
        {isSuperUser ? (
          <Link href="/crm/admin" className="block">
            <ItemBody label="Users" icon="users" active={isCurrent(pathname, "/crm/admin")} />
          </Link>
        ) : null}
        {/* A plain <a>: logout is an API route, not a client navigation. */}
        <a
          href="/api/auth/logout"
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-paper-50/60 transition-colors hover:bg-white/5 hover:text-paper-50"
        >
          <NavIcon name="exit" />
          Sign out
        </a>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/crm" className="flex h-14 shrink-0 items-center gap-2.5 px-5 text-sm font-semibold tracking-wide text-paper-50">
      {/* Reversed: the navy disc on the navy rail would be a hole. */}
      <BtbMark simplified variant="reversed" className="h-[1.35rem] w-auto shrink-0" />
      {site.shortName}
    </Link>
  );
}

export function CrmChrome({ isSuperUser = false }: { isSuperUser?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer when a navigation lands. Keyed on pathname, not on click:
  // closing at click time would blank the nav while the old page is still on
  // screen, which reads as the app losing its place.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // The print routes and the presentation are nested under /crm but are the
  // client's, not a screen of ours. They have never carried this chrome and must
  // not start. See lib/crm/routes.ts.
  if (isClientFacingRoute(pathname)) return null;

  return (
    <>
      {/* ---- lg+: the rail. Sticky, so it never scrolls away; the pages scroll
           beside it inside the layout's flex row. ---- */}
      <aside className="hidden w-60 shrink-0 bg-navy-950 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <Brand />
        <NavColumn pathname={pathname} isSuperUser={isSuperUser} />
      </aside>

      {/* ---- below lg: a compact bar plus a drawer. ---- */}
      <div className="sticky top-0 z-30 flex h-12 items-center justify-between bg-navy-950 pr-2 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="rounded-md p-2 text-paper-50/80 transition hover:bg-white/10 hover:text-paper-50"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 6.5h16M4 12h16M4 17.5h16" />
          </svg>
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-navy-950/50 backdrop-blur-[2px]"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-navy-950 shadow-2xl">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-2 text-paper-50/70 transition hover:bg-white/10 hover:text-paper-50"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <NavColumn pathname={pathname} isSuperUser={isSuperUser} />
          </div>
        </div>
      ) : null}
    </>
  );
}
