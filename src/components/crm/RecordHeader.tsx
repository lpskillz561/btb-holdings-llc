import Link from "next/link";
import { BtbMark } from "@/components/Logo";
import { site } from "@/lib/site";
import type { ReactNode } from "react";

/**
 * Lightning's "highlights panel": breadcrumb, object type, record name, actions.
 *
 * This is the only part of the CRM chrome that a page owns. The navy bar and the
 * section tabs above it are `CrmChrome`, rendered once from `app/crm/layout.tsx`
 * so they survive a navigation — which is why this component no longer takes a
 * `current` section or an `isSuperUser` flag. Anything a page passes here is by
 * definition per-record and is meant to be replaced.
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
            {/* Lightning puts a coloured tile beside a record name. The disc is
                already that shape and already that blue, so it stands in for the
                tile rather than sitting inside one. */}
            <BtbMark simplified className="mt-0.5 hidden h-10 w-10 shrink-0 sm:block" />
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
  );
}
