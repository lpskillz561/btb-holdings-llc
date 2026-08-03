// Outbound Zillow links for parcel rows.
//
// The reverse of `nameFromListingUrl` in lib/crm/portfolio.ts: that reads an
// address out of a pasted Zillow slug, this builds a slug out of the address we
// hold. Zillow's `/homes/<slug>_rb/` endpoint is its address search — for a
// full situs address it resolves straight to the property page, and for a
// partial one it lands on results for that street, which is still the useful
// page. This is a SEARCH link, not an assertion that Zillow has a listing.
//
// No database import and no "use client": both server tables and client
// components link from here.

/**
 * `"2505 PINE ST, CLERMONT, FL 34714"` →
 * `https://www.zillow.com/homes/2505-PINE-ST-CLERMONT-FL-34714_rb/`.
 *
 * Null when the string carries no house number — a bare parcel key or a county
 * name would produce a search for nothing in particular, and a link that lands
 * somewhere useless is worse than no link.
 */
export function zillowUrlForAddress(oneLine: string | null | undefined): string | null {
  if (!oneLine) return null;
  const s = oneLine.trim();
  if (!/\d/.test(s)) return null;
  const slug = s
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;
  return `https://www.zillow.com/homes/${slug}_rb/`;
}
