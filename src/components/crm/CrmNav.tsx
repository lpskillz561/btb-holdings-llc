import Link from "next/link";
import { ShieldMark } from "@/components/Logo";
import { site } from "@/lib/site";
import type { ReactNode } from "react";

/**
 * The navy band every CRM page opens with, plus the section nav.
 *
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

export function CrmNav({
  current,
  title,
  eyebrow,
  intro,
  breadcrumb,
  actions,
  isSuperUser = false,
}: {
  /** href of the active section, or undefined on a detail page. */
  current?: string;
  title: string;
  eyebrow: string;
  intro?: string;
  breadcrumb?: { href: string; label: string }[];
  actions?: ReactNode;
  /**
   * Show the Users link. Defaults to false so the link is hidden unless a page
   * has actually checked — a nav that guesses would either show a 404 to
   * ordinary staff or hint that the page exists.
   */
  isSuperUser?: boolean;
}) {
  return (
    <>
      {/* Global header — Lightning's dark utility bar. Kept navy rather than
          Salesforce's own indigo so the product still looks like BTB at a
          glance, which is the one place the brand should survive indoors. */}
      <div className="bg-navy-950">
        <div className="container-x flex h-12 items-center justify-between gap-4">
          <Link href="/crm" className="inline-flex items-center gap-2 text-sm font-semibold text-paper-50">
            <ShieldMark
              simplified
              className="h-[1.15rem] w-auto shrink-0"
              field="#f6f3ec"
              accent="#c8a45c"
            />
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

      {/* Object nav — the blue bar of tabs Lightning puts under the header. */}
      <div className="border-b border-ink-200 bg-white">
        <div className="container-x flex flex-wrap items-stretch gap-0">
          {SECTIONS.map((section) => {
            const active = section.href === current;
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`border-b-2 px-4 py-2.5 text-sm transition ${
                  active
                    ? "border-sf-500 font-semibold text-sf-600"
                    : "border-transparent text-ink-700 hover:bg-ink-100 hover:text-sf-600"
                }`}
              >
                {section.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Record header — Lightning's "highlights panel": breadcrumb, object
          type, record name, and the actions, all on white above the grey. */}
      <div className="border-b border-ink-200 bg-white">
        <div className="container-x min-h-[9.25rem] py-4">
          <nav className="flex flex-wrap items-center text-xs text-ink-600">
            <Link href="/crm" className="hover:text-sf-600 hover:underline">
              {site.shortName}
            </Link>
            {(breadcrumb ?? []).map((crumb) => (
              <span key={crumb.href}>
                <span className="px-1.5">/</span>
                <Link href={crumb.href} className="hover:text-sf-600 hover:underline">
                  {crumb.label}
                </Link>
              </span>
            ))}
          </nav>

          <div className="crm-enter mt-2 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              {/* The coloured object tile Lightning puts beside a record name. */}
              <span
                aria-hidden
                className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded bg-sf-500 sm:inline-flex"
              >
                <ShieldMark simplified className="h-5 w-auto" field="#ffffff" accent="#0176d3" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-600">{eyebrow}</p>
                <h1 className="mt-0.5 truncate text-xl font-bold text-ink-900">{title}</h1>
                {intro && <p className="mt-1 line-clamp-2 max-w-3xl text-sm text-ink-700">{intro}</p>}
              </div>
            </div>
            {actions}
          </div>
        </div>
      </div>
    </>
  );
}
