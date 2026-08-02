import Link from "next/link";
import { site } from "@/lib/site";
import { ShieldMark } from "@/components/Logo";

/**
 * The shield lockup: mark plus typeset name.
 *
 * The mark is drawn inline rather than loaded as an <Image> so it can be
 * inverted for the navy login screen and the light print stylesheet from one
 * source — see the `tone` prop. `aria-label` on the link already names the
 * business, so the mark itself stays decorative and screen readers hear the
 * name once rather than twice.
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
      className={`inline-flex items-center gap-2.5 ${className}`}
      aria-label={`${site.name} home`}
    >
      <ShieldMark
        className="h-[1.35em] w-auto shrink-0"
        field={light ? "#f6f3ec" : "#0a1430"}
        accent={light ? "#a9853f" : "#d4b876"}
        rule={light ? "#0a1430" : "#c8a45c"}
      />
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
