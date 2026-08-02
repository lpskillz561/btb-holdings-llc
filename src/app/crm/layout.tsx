import type { ReactNode } from "react";

/**
 * The internal application shell.
 *
 * Everything under /crm that a member of staff works in renders on Lightning's
 * grey with sans type. The grey is load-bearing rather than decorative: it is
 * what makes the white cards read as raised, which is why `.sf-card` carries no
 * shadow.
 *
 * The print routes (/crm/*\/print) are nested here too and are deliberately
 * unaffected — they set their own type and the @media print rules drop the
 * background, so a client document still comes out in the navy/gold brand.
 */
export default function CrmLayout({ children }: { children: ReactNode }) {
  return <div className="sf-page">{children}</div>;
}
