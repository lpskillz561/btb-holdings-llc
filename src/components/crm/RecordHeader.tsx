import Link from "next/link";
import { site } from "@/lib/site";
import type { ReactNode } from "react";

/**
 * Lightning's "highlights panel": breadcrumb, object type, record name, actions.
 *
 * This is the only part of the CRM chrome that a page owns. The nav rail beside
 * it is `CrmChrome`, rendered once from `app/crm/layout.tsx` so it survives a
 * navigation — which is why this component no longer takes a `current` section
 * or an `isSuperUser` flag. Anything a page passes here is by definition
 * per-record and is meant to be replaced.
 */
export function RecordHeader({
  title,
  eyebrow,
  intro,
  breadcrumb,
  actions,
}: {
  title: string;
  eyebrow: string;
  intro?: string;
  breadcrumb?: { href: string; label: string }[];
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-ink-200 bg-white">
      {/* The min-height is layout stability, not decoration: every section's
          header is the same height, so switching sections never shifts the body
          below it. The mark that used to sit beside the title now lives on the
          nav rail, where it is visible from every screen once instead of
          repeated on each. */}
      <div className="container-x min-h-[8.25rem] py-5">
        <nav className="flex flex-wrap items-center text-xs text-ink-600">
          <Link href="/crm" className="hover:text-sf-600 hover:underline">
            {site.shortName}
          </Link>
          {(breadcrumb ?? []).map((crumb) => (
            <span key={crumb.href}>
              <span className="px-1.5 text-ink-400">/</span>
              <Link href={crumb.href} className="hover:text-sf-600 hover:underline">
                {crumb.label}
              </Link>
            </span>
          ))}
        </nav>

        <div className="crm-enter mt-2.5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-sf-600">
              {eyebrow}
            </p>
            <h1 className="mt-1 truncate text-[1.45rem] font-semibold leading-tight tracking-tight text-ink-900">
              {title}
            </h1>
            {intro && <p className="mt-1.5 line-clamp-2 max-w-3xl text-sm text-ink-600">{intro}</p>}
          </div>
          {actions}
        </div>
      </div>
    </div>
  );
}
