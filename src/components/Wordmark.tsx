import Link from "next/link";
import { site } from "@/lib/site";
import { BtbMark } from "@/components/Logo";

/**
 * The full lockup: mark, name, and the descriptor under it.
 *
 * Follows `logo/btb-logo-primary-horizontal.png` — bold sans rather than the
 * serif this used to set the name in, and the descriptor rather than the gold
 * "CRM" chip that used to sit alongside. The login screen already says what it
 * is twice over ("Client Sign In", "Secure access"), so the chip was spending
 * the one line of brand real estate on the least interesting fact.
 *
 * The mark is drawn inline rather than loaded as an <Image> so the navy login
 * screen gets the reversed treatment from the same source — see `tone`.
 * `aria-label` on the link already names the business, so the mark stays
 * decorative and a screen reader hears the name once rather than twice.
 *
 * Sized in `em`, so the caller sets the scale with a font size or just takes
 * the default.
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
      className={`inline-flex items-center gap-[0.6em] ${className}`}
      aria-label={`${site.name} home`}
    >
      <BtbMark
        className="h-[2.5em] w-auto shrink-0"
        variant={light ? "reversed" : "default"}
      />
      <span className="flex flex-col justify-center leading-none">
        <span
          className={`text-[1.3em] font-bold tracking-tight ${
            light ? "text-white" : "text-sf-800"
          }`}
        >
          {site.shortName}
        </span>
        <span
          aria-hidden
          className={`mt-[0.45em] text-[0.52em] font-semibold uppercase tracking-[0.24em] ${
            light ? "text-sf-400" : "text-sf-500"
          }`}
        >
          Land acquisition &amp; leasing
        </span>
      </span>
    </Link>
  );
}
