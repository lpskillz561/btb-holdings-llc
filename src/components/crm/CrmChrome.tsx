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
 * below it.
 *
 * The rail is a deep indigo→plum gradient (`.sf-rail`) and it stays dark in
 * BOTH appearances, which is a deliberate constraint rather than an oversight:
 * `BtbMark`'s disc is a solid navy, so a rail that inverted with the OS would
 * need both mark variants rendered and toggled. Holding it dark keeps one mark
 * and one reversed treatment. It is also the only large field of colour in the
 * layout — without it the app reads as a grey admin panel.
 *
 * The rail COLLAPSES to icons on lg+, and the preference is a cookie the server
 * reads — see lib/crm/rail.ts for why it is not localStorage. Collapsing is an
 * lg+ idea only: below lg the nav is already a drawer that is closed by default,
 * so a second way to make it smaller would just be a second thing to be stuck
 * in. The drawer therefore always renders the full-width column.
 */

import { useEffect, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { BtbMark } from "@/components/Logo";
import { RAIL_COOKIE, RAIL_COOKIE_MAX_AGE, railCookieValue } from "@/lib/crm/rail";
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
  // Clients ranks above the documents because it is the record everything else
  // hangs off, and it has its own section rather than living only on the
  // Overview: reaching an account through the dashboard meant scrolling past
  // the whole summary every time.
  { href: "/crm/clients", label: "Clients", icon: "users" },
  // Second, right under Overview: the board is what the team works FROM each
  // day, so it sits with the dashboard rather than filed after the views of the
  // book. The dashboard's own list links here too.
  { href: "/crm/todos", label: "Board", icon: "board" },
  // Beside the board, because they are the same kind of thing: the room the
  // team talks in and the list the team works from. It replaced a WhatsApp
  // group — see lib/crm/chat.ts for why that mattered.
  { href: "/crm/chat", label: "Chat", icon: "chat" },
  // With the board rather than filed with the documents: what is on today and
  // what was said yesterday is work-in-hand, not a view of the book.
  { href: "/crm/meetings", label: "Meetings", icon: "calendar" },
  // Directly under Chat, because that is where most people will meet it: you
  // drop a PDF into the room, the assistant reads it, and the card under the
  // message offers to teach it. This is the same set of documents with room to
  // read the note first. See lib/crm/knowledge-docs.ts.
  { href: "/crm/knowledge", label: "Knowledge", icon: "book" },
  // The deck library. Note the href — /crm/presentATIONS is ours; /crm/present
  // is the client-facing deck and carries no chrome at all. See lib/crm/routes.
  { href: "/crm/presentations", label: "Presentations", icon: "slides" },
  // The amusement-equipment scenario tool. It sits beside Presentations rather
  // than with Holdings because it is a SELLING surface — you open it on a call
  // to answer "what would twelve units look like", not to look up something we
  // own. Nothing is stored behind it.
  { href: "/crm/equipment", label: "Equipment", icon: "arcade" },
  { href: "/crm/proposals", label: "Proposals", icon: "doc" },
  { href: "/crm/contracts", label: "Contracts", icon: "pen" },
  // BTB's own land, distinct from Holdings, which is the client-owned homes.
  { href: "/crm/land", label: "Our land", icon: "map" },
  { href: "/crm/holdings", label: "Holdings", icon: "unit" },
  { href: "/crm/financials", label: "Financials", icon: "chart" },
] as const;

type IconName = (typeof SECTIONS)[number]["icon"] | "shield" | "exit" | "collapse" | "expand";

/** Minimal 1.5-stroke line icons; currentColor so state styling is free. */
const ICON_PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5.5 8.5V20h13V8.5",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h5M10 16.5h5",
  pen: "M4 20l4-1L20.5 6.5a1.9 1.9 0 0 0-3-3L5 16zM13 6l3 3",
  map: "M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14",
  unit: "M3 20h18M5 20V9.5L12 4l7 5.5V20M9.5 20v-6h5v6",
  chart: "M4 4v16h16M8 16v-5M12 16V8M16 16v-8",
  board: "M4 5h16v14H4zM9.33 5v14M14.67 5v14",
  calendar: "M4 6h16v14H4zM4 10h16M8.5 4v3M15.5 4v3",
  users: "M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-3.5 2.9-5 5.5-5s5 1.5 5.5 5M15.5 10.5a3 3 0 1 0-1.4-5.8M15.8 15.3c2.3.3 4.2 1.7 4.7 4.7",
  slides: "M3 4.5h18v11.5H3zM12 16v3.5M8.5 20.5h7",
  // A speech bubble with a tail. Deliberately unlike `board` (a column grid) —
  // they sit two apart in the rail and both are places the team writes things.
  chat: "M20.5 12.5a7.5 7.5 0 0 1-7.5 7.5H8l-4.5 3v-5A7.5 7.5 0 0 1 8 5h5a7.5 7.5 0 0 1 7.5 7.5z",
  // An open book. Distinct from `doc` (a single sheet with a folded corner),
  // which sits four below it and means Proposals: one document is a thing you
  // send, and a book is a thing the assistant has read.
  book: "M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2zM12 6.5v13",
  // An upright cabinet with a screen — distinct from `slides` (a projector
  // screen on a stand) at rail size, which matters because the two sit next to
  // each other and a deck and a machine are not the same thing.
  arcade: "M6 3h12v18H6zM8.5 6h7v5h-7zM9.5 14h2M14 14h.01M9 21v-2h6v2",
  // Account administration, distinct from the Clients list above — the same
  // "users" glyph on both would put the allow-list and the book of business
  // under one symbol, which is the one confusion worth avoiding on this rail.
  shield: "M12 3.2l7 2.8v5.4c0 4.1-2.9 7.4-7 8.6-4.1-1.2-7-4.5-7-8.6V6zM9.3 12l1.9 1.9 3.5-3.6",
  exit: "M14 4h6v16h-6M10 8l-4 4 4 4M6 12h11",
  collapse: "M13 7l-5 5 5 5M18.5 7l-5 5 5 5",
  expand: "M11 7l5 5-5 5M5.5 7l5 5-5 5",
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
function ItemBody({
  label,
  icon,
  active,
  collapsed = false,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  collapsed?: boolean;
}) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={`sf-rail-item ${collapsed ? "justify-center px-0" : "gap-2.5 px-3"} ${
        active ? "sf-rail-item-active" : pending ? "animate-pulse bg-white/10 text-white" : ""
      }`}
    >
      {/* The gold tick that used to mark "you are here" is gone: the active row
          is now the gradient pill itself, and a marker bar beside a filled pill
          is two ways of saying one thing. */}
      <NavIcon name={icon} />
      {/* Collapsed, the label is dropped from the flow but never from the
          accessible name — the <Link> above carries aria-label and title, so
          the row still announces itself and still has a hover tooltip. */}
      {collapsed ? null : label}
    </span>
  );
}

/**
 * The nav column itself; shared by the rail and the mobile drawer.
 *
 * `onToggle` is what distinguishes the two. The rail passes one and gets the
 * collapse control in its footer; the drawer passes none and gets no control,
 * because there is nothing there to collapse.
 */
function NavColumn({
  pathname,
  isSuperUser,
  collapsed = false,
  onToggle,
}: {
  pathname: string;
  isSuperUser: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  // Collapsed, the row IS the icon, so the tooltip is the only label there is.
  const tip = (label: string) => (collapsed ? { title: label, "aria-label": label } : {});
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            aria-current={isCurrent(pathname, s.href) ? "page" : undefined}
            className="block"
            {...tip(s.label)}
          >
            <ItemBody label={s.label} icon={s.icon} active={isCurrent(pathname, s.href)} collapsed={collapsed} />
          </Link>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-white/10 px-3 py-3">
        {isSuperUser ? (
          <Link href="/crm/admin" className="block" {...tip("Users")}>
            <ItemBody label="Users" icon="shield" active={isCurrent(pathname, "/crm/admin")} collapsed={collapsed} />
          </Link>
        ) : null}
        {/* A plain <a>: logout is an API route, not a client navigation. */}
        <a
          href="/api/auth/logout"
          className={`sf-rail-item ${collapsed ? "justify-center px-0" : "gap-2.5 px-3"}`}
          {...tip("Sign out")}
        >
          <NavIcon name="exit" />
          {collapsed ? null : "Sign out"}
        </a>
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            className={`sf-rail-item w-full ${collapsed ? "justify-center px-0" : "gap-2.5 px-3"}`}
          >
            <NavIcon name={collapsed ? "expand" : "collapse"} />
            {collapsed ? null : "Collapse"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      href="/crm"
      className={`flex h-14 shrink-0 items-center text-sm font-semibold tracking-wide text-white ${
        collapsed ? "justify-center px-0" : "gap-2.5 px-5"
      }`}
      {...(collapsed ? { title: site.shortName, "aria-label": site.shortName } : {})}
    >
      {/* Reversed: the navy disc on the navy rail would be a hole. */}
      <BtbMark simplified variant="reversed" className="h-[1.35rem] w-auto shrink-0" />
      {collapsed ? null : site.shortName}
    </Link>
  );
}

export function CrmChrome({
  isSuperUser = false,
  defaultCollapsed = false,
}: {
  isSuperUser?: boolean;
  /**
   * Read from the cookie by the layout on the server. Seeding state from it —
   * rather than reading storage on mount — is what makes the first paint the
   * right width. See lib/crm/rail.ts.
   */
  defaultCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Write-through: the state is the truth for this tab, the cookie is what the
  // NEXT server render reads. The write is in the handler rather than an effect
  // on `collapsed`, because an effect would also fire on mount and rewrite the
  // cookie with the value the server had just supplied — and it is not inside
  // the state updater either, which React is free to call twice.
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${RAIL_COOKIE}=${railCookieValue(next)}; path=/; max-age=${RAIL_COOKIE_MAX_AGE}; samesite=lax`;
  };

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
      <aside
        className={`sf-rail hidden shrink-0 transition-[width] duration-200 ease-spring lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <Brand collapsed={collapsed} />
        <NavColumn
          pathname={pathname}
          isSuperUser={isSuperUser}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
        />
      </aside>

      {/* ---- below lg: a compact bar plus a drawer. ---- */}
      <div className="sf-rail sticky top-0 z-30 flex h-12 items-center justify-between pr-2 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="rounded-pill p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
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
            className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
          />
          <div className="sf-rail absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-slide-in-right flex-col shadow-2xl">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-pill p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
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
