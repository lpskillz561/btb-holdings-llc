import Link from "next/link";
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
}: {
  /** href of the active section, or undefined on a detail page. */
  current?: string;
  title: string;
  eyebrow: string;
  intro?: string;
  breadcrumb?: { href: string; label: string }[];
  actions?: ReactNode;
}) {
  return (
    <section className="bg-navy-950">
      <div className="container-x py-10 lg:py-14">
        {/* Sign out lives here because this app has no dashboard to host it —
            without it there is no way to end a session from the UI. */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <nav className="text-sm text-paper-50/50">
            <Link href="/crm" className="hover:text-gold-400">
              {site.shortName}
            </Link>
            {(breadcrumb ?? []).map((crumb) => (
              <span key={crumb.href}>
                <span className="px-2">/</span>
                <Link href={crumb.href} className="hover:text-gold-400">
                  {crumb.label}
                </Link>
              </span>
            ))}
            <span className="px-2">/</span>
            <span className="text-paper-50/80">{title}</span>
          </nav>

          <a
            href="/api/auth/logout"
            className="shrink-0 text-sm font-semibold text-paper-50/60 transition hover:text-gold-400"
          >
            Sign out
          </a>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow-light">{eyebrow}</p>
            <h1 className="mt-3 font-serif text-3xl font-medium text-paper-50 lg:text-4xl">
              {title}
            </h1>
            {intro && <p className="mt-3 max-w-2xl text-paper-50/65">{intro}</p>}
          </div>
          {actions}
        </div>

        <div className="mt-8 flex flex-wrap gap-1 border-t border-white/10 pt-4">
          {SECTIONS.map((section) => {
            const active = section.href === current;
            return (
              <Link
                key={section.href}
                href={section.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-white/10 text-gold-400"
                    : "text-paper-50/60 hover:bg-white/5 hover:text-paper-50"
                }`}
              >
                {section.label}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
