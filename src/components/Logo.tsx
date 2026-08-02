/**
 * The BTB Holdings mark.
 *
 * A heraldic shield carrying a classical portico. The reference is a private
 * bank's crest, because that is the register this business sells in — the
 * audience is a high-income taxpayer and their CPA, and the documents this mark
 * appears on are a purchase agreement, an installment note and a tax proposal.
 *
 * The pediment does double duty: read as architecture it is a bank portico,
 * read as a silhouette it is a roofline. That is the whole business in one
 * shape — lodging, financed.
 *
 * Drawn rather than imported so it inherits `currentColor` for the field and
 * takes the gold as a prop. A PNG could not be tinted for the dark navy header
 * and the light print stylesheet from a single source.
 */
export function ShieldMark({
  className = "",
  field = "#0a1430",
  accent = "#d4b876",
  rule = "#c8a45c",
  title,
  simplified = false,
}: {
  className?: string;
  /** Shield body. Navy on light surfaces; pass a light value to invert. */
  field?: string;
  /** Portico. */
  accent?: string;
  /** The inner keyline. */
  rule?: string;
  /** Set only when the mark stands alone; omit when adjacent text names it. */
  title?: string;
  /**
   * Drop the keyline and architrave, widen the columns.
   *
   * Below roughly 24px those details stop being detail and become noise: the
   * keyline merges with the shield edge and the architrave closes the gap above
   * the columns, so the whole thing reads as a smudge. Use anywhere the mark
   * renders small — breadcrumbs, avatars. Matches public/favicon.svg, which
   * exists for the same reason.
   */
  simplified?: boolean;
}) {
  const common = {
    viewBox: "0 0 64 64",
    className,
    role: title ? "img" : "presentation",
    "aria-label": title,
    "aria-hidden": title ? undefined : true,
    xmlns: "http://www.w3.org/2000/svg",
  } as const;

  const shield =
    "M10 8h44a2 2 0 0 1 2 2v21c0 14.5-11.2 24.8-24 29.5C19.2 55.8 8 45.5 8 31V10a2 2 0 0 1 2-2z";

  if (simplified) {
    return (
      <svg {...common}>
        <path d={shield} fill={field} />
        <g fill={accent}>
          <path d="M32 16 49 30.5H15z" />
          <rect x="18" y="34.5" width="6" height="12" />
          <rect x="29" y="34.5" width="6" height="12" />
          <rect x="40" y="34.5" width="6" height="12" />
          <rect x="15" y="48" width="34" height="4" />
        </g>
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path
        d="M10 8h44a2 2 0 0 1 2 2v21c0 14.5-11.2 24.8-24 29.5C19.2 55.8 8 45.5 8 31V10a2 2 0 0 1 2-2z"
        fill={field}
      />
      {/* Inset keyline. The detail that makes a crest read as engraved rather
          than printed, and the first thing to disappear at favicon size. */}
      <path
        d="M13 12.5h38a1 1 0 0 1 1 1V31c0 11.9-9.2 20.6-20 24.9C21.2 51.6 12 42.9 12 31V13.5a1 1 0 0 1 1-1z"
        fill="none"
        stroke={rule}
        strokeWidth="0.9"
        opacity="0.75"
      />
      <g fill={accent}>
        {/* Pediment: portico above, roofline below. */}
        <path d="M32 17.5 47.8 30H16.2z" />
        <rect x="16.2" y="31.8" width="31.6" height="3.1" />
        <rect x="20" y="36.7" width="4.5" height="10.2" />
        <rect x="29.75" y="36.7" width="4.5" height="10.2" />
        <rect x="39.5" y="36.7" width="4.5" height="10.2" />
        <rect x="15.6" y="48.1" width="32.8" height="3.1" />
      </g>
    </svg>
  );
}
