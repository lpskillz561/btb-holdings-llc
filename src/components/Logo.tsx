/**
 * The BTB Holdings mark: a disc carrying a pediment over two rules.
 *
 * Read as architecture the triangle is a portico; read as a silhouette it is a
 * roofline over ground. That is the business in one shape — homes, on land.
 *
 * Drawn rather than imported from `logo/*.png`. Every place this appears it is
 * between 18px and 27px, where a downscaled 2048px raster goes soft, and the
 * navy header needs the reversed treatment from the same source. The geometry
 * below was measured off `logo/btb-logo-mark.png` and normalised onto a 64
 * viewBox with the disc centred, so it is the supplied artwork rather than an
 * approximation of it.
 *
 * The three colours are the artwork's own, and they are already in
 * tailwind.config.ts: #032d60 is sf-800, #1b96ff is sf-400, #0176d3 is sf-500.
 * The mark is native to the Lightning palette the CRM is built in.
 */

const NAVY = "#032d60"; // sf-800
const BAR_LIGHT = "#1b96ff"; // sf-400
const BAR_MID = "#0176d3"; // sf-500

export function BtbMark({
  className = "",
  variant = "default",
  simplified = false,
  title,
}: {
  className?: string;
  /**
   * `default` is the navy disc for light surfaces. `reversed` is the white disc
   * for dark ones — the navy disc on the navy header would be a hole. Both are
   * supplied artwork (`btb-logo-mark.png` / `btb-logo-reversed-navy.png`); the
   * bars stay blue in both, which is what keeps the two readable as one mark.
   */
  variant?: "default" | "reversed";
  /**
   * Thicken the two rules.
   *
   * True to the vector they are 2.33 units of 64, which is a hair under a pixel
   * once the mark is drawn at 18px in the header — it renders as a grey smear or
   * drops out to nothing depending on the display. Everywhere the mark is small
   * this is the honest reading of it. Matches public/favicon.svg, which exists
   * for the same reason.
   */
  simplified?: boolean;
  /** Set only when the mark stands alone; omit when adjacent text names it. */
  title?: string;
}) {
  const disc = variant === "reversed" ? "#ffffff" : NAVY;
  const pediment = variant === "reversed" ? NAVY : "#ffffff";
  const barH = simplified ? 3.4 : 2.33;

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="32" fill={disc} />
      <path d="M32 17.77 47.6 34.65H16.4z" fill={pediment} />
      <rect x="13.69" y="39.35" width="36.67" height={barH} fill={BAR_LIGHT} />
      <rect x="19.69" y="44.02" width="24.67" height={barH} fill={BAR_MID} />
    </svg>
  );
}
