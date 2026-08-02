import Link from "next/link";
import { site } from "@/lib/site";

/**
 * Typeset wordmark rather than an image file.
 *
 * The Ziora Capital site used a PNG lockup; this app has no brand assets yet, so
 * it renders type in the same serif the rest of the UI uses. Swap in an <Image>
 * here when there is a real mark, and nothing else needs to change.
 */
export function Wordmark({
  tone = "dark",
  href = "/crm",
  className = "",
}: {
  tone?: "dark" | "light";
  href?: string;
  className?: string;
}) {
  const light = tone === "light";
  return (
    <Link
      href={href}
      className={`inline-flex items-baseline gap-2 ${className}`}
      aria-label={`${site.name} home`}
    >
      <span
        className={`font-serif text-xl font-medium tracking-tight ${
          light ? "text-paper-50" : "text-navy-900"
        }`}
      >
        {site.shortName}
      </span>
      <span
        aria-hidden
        className={`text-xs font-semibold uppercase tracking-[0.22em] ${
          light ? "text-gold-400" : "text-gold-600"
        }`}
      >
        CRM
      </span>
    </Link>
  );
}
