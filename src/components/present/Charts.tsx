// Charts for the client presentation.
//
// Plain SVG, no chart library and no client JavaScript: this is projected in a
// meeting, so the fewest moving parts wins. Hover is a native <title>, which
// every browser and screen reader already understands.
//
// COLOUR IS NOT EYEBALLED. The slide surface is navy-900 (#0a1430) and the
// palette below was run through the validator against that surface:
//
//   ACCENT  #b08a2c  — passes lightness band, chroma floor, CVD and 3:1 contrast
//   NEUTRAL ramp     — passes as an ordinal ramp: monotone L, ΔL >= 0.06, single hue
//
// The brand's decorative gold (#c8a45c) is deliberately NOT used as a mark: it
// sits outside the lightness band on this surface and reads washed out when
// projected. It stays where it belongs, on rules and eyebrow text.
//
// Every chart here is the EMPHASIS form — one accent, the rest recessive — for
// the same reason a pitch has one point per slide. Colour carries "this is the
// number that matters"; the neutral ramp carries order, not identity.

const ACCENT = "#b08a2c";
const NEUTRAL = ["#8b97ad", "#6b7890", "#4d5a74"] as const;
const TEXT = "#fbfaf7";
const TEXT_MUTED = "rgba(251,250,247,0.62)";
const GRID = "rgba(251,250,247,0.14)";

/** A gap of surface between adjacent fills, so segments read as separate marks. */
const GAP = 2;
const RADIUS = 4;

function money(cents: number, opts: { cents?: boolean } = {}): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
}

/* -------------------------------------------------------------------------- */
/* Where the monthly rent goes                                                 */
/* -------------------------------------------------------------------------- */

export interface Segment {
  label: string;
  cents: number;
  /** The one segment that is the point of the slide. */
  accent?: boolean;
  note?: string;
}

/**
 * One month of rent, as a part-to-whole bar.
 *
 * Part-to-whole is the job, so a stacked bar is the form — and with four
 * segments, direct labels are mandatory rather than optional, which suits a
 * projected slide anyway. The owner's share is the only coloured segment; the
 * three that precede it are an ordinal ramp, because they are stages of a
 * deduction in a fixed order, not four competing identities.
 */
export function RevenueSplitBar({
  segments,
  totalCents,
  width = 980,
}: {
  segments: Segment[];
  totalCents: number;
  width?: number;
}) {
  const barY = 54;
  const barH = 64;
  const height = 208;
  const total = totalCents || segments.reduce((sum, s) => sum + s.cents, 0);

  let x = 0;
  const placed = segments.map((segment, i) => {
    const w = (segment.cents / total) * width;
    const rect = { x, w, segment, i };
    x += w;
    return rect;
  });

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`One month of rental income of ${money(total)}, divided into ${segments
          .map((s) => `${s.label} ${money(s.cents, { cents: true })}`)
          .join(", ")}`}
      >
        <defs>
          {/* Rounds only the two outer ends of the bar, not every segment. */}
          <clipPath id="split-clip">
            <rect x={0} y={barY} width={width} height={barH} rx={RADIUS} />
          </clipPath>
        </defs>

        <text x={0} y={22} fill={TEXT_MUTED} fontSize={17}>
          Gross rental income, one month
        </text>
        <text x={0} y={44} fill={TEXT} fontSize={26} fontWeight={600}>
          {money(total)}
        </text>

        <g clipPath="url(#split-clip)">
          {placed.map(({ x: sx, w, segment, i }) => (
            <rect
              key={segment.label}
              x={sx}
              y={barY}
              // The gap is taken off the right of every segment but the last, so
              // fills never touch and the eye reads four marks, not one blur.
              width={Math.max(0, w - (i === placed.length - 1 ? 0 : GAP))}
              height={barH}
              fill={segment.accent ? ACCENT : NEUTRAL[Math.min(i, NEUTRAL.length - 1)]}
            >
              <title>{`${segment.label}: ${money(segment.cents, { cents: true })}`}</title>
            </rect>
          ))}
        </g>

        {placed.map(({ x: sx, w, segment }) => {
          const cx = sx + w / 2;
          return (
            <g key={`label-${segment.label}`}>
              <text
                x={cx}
                y={barY + barH + 28}
                textAnchor="middle"
                fill={segment.accent ? TEXT : TEXT_MUTED}
                fontSize={16}
                fontWeight={segment.accent ? 600 : 400}
              >
                {segment.label}
              </text>
              <text
                x={cx}
                y={barY + barH + 52}
                textAnchor="middle"
                fill={TEXT}
                fontSize={19}
                fontWeight={segment.accent ? 700 : 500}
              >
                {money(segment.cents, { cents: true })}
              </text>
              {segment.note ? (
                <text x={cx} y={barY + barH + 74} textAnchor="middle" fill={TEXT_MUTED} fontSize={13}>
                  {segment.note}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Cash in against deduction out                                               */
/* -------------------------------------------------------------------------- */

/**
 * The leverage, on ONE axis.
 *
 * Two bars to the same dollar scale is the entire argument — the cash bar is
 * visibly a sliver of the deduction bar — and it is why this must never become
 * two axes or two charts. A reader who has to reconcile two scales cannot see
 * the ratio, which is the only thing this slide says.
 */
export function LeverageBars({
  cashCents,
  deductionCents,
  taxSavingCents,
  width = 980,
}: {
  cashCents: number;
  deductionCents: number;
  taxSavingCents?: number;
  width?: number;
}) {
  const rows = [
    { label: "Cash you put in", cents: cashCents, accent: false },
    ...(taxSavingCents
      ? [{ label: "Tax saved in year one", cents: taxSavingCents, accent: false }]
      : []),
    { label: "Deduction against your income", cents: deductionCents, accent: true },
  ];
  const max = Math.max(...rows.map((r) => r.cents), 1);
  const labelW = 300;
  const plotW = width - labelW - 190;
  const rowH = 78;
  const barH = 34;
  const height = rows.length * rowH + 24;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={rows.map((r) => `${r.label} ${money(r.cents)}`).join("; ")}
      >
        {rows.map((row, i) => {
          const y = i * rowH + 10;
          const w = Math.max(3, (row.cents / max) * plotW);
          return (
            <g key={row.label}>
              <text x={0} y={y + barH / 2 + 6} fill={row.accent ? TEXT : TEXT_MUTED} fontSize={18}>
                {row.label}
              </text>
              <rect
                x={labelW}
                y={y}
                width={w}
                height={barH}
                rx={RADIUS}
                fill={row.accent ? ACCENT : NEUTRAL[1]}
              >
                <title>{`${row.label}: ${money(row.cents)}`}</title>
              </rect>
              <text
                x={labelW + w + 16}
                y={y + barH / 2 + 7}
                fill={TEXT}
                fontSize={20}
                fontWeight={row.accent ? 700 : 500}
              >
                {money(row.cents)}
              </text>
            </g>
          );
        })}
        {/* Baseline, recessive: it orients the bars without competing with them. */}
        <line x1={labelW} y1={6} x2={labelW} y2={height - 12} stroke={GRID} strokeWidth={2} />
      </svg>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* The ownership structure                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The entity chain, as a diagram rather than a chart.
 *
 * This is the slide that decides whether the room understands the deal, so it
 * is drawn rather than bulleted: four boxes, one arrow each, and the trustee
 * relationship as the one dashed line — because it is the only relationship
 * that is not ownership, and drawing it the same as the others is how people
 * come away thinking the manager owns their home.
 */
export function StructureDiagram({ width = 980 }: { width?: number }) {
  const height = 430;
  const boxW = 300;
  const boxH = 74;
  // The chain sits left and the Management Series far right, so the connector
  // between them has ~200px of clear space. At the original spacing the
  // "serves as trustee" label ran underneath the Management Series box — a
  // collision the validator cannot see and only rendering the slide catches.
  const cx = 110;
  const mgtX = 610;
  const linkY = 153;

  // `sub` is an ARRAY OF LINES, not a sentence. SVG <text> does not wrap: a
  // string too wide for the box does not reflow, it just runs out the side, and
  // "One Series per home — owned 100% by the Trust" did exactly that. There is
  // no width at which this stops being a hazard, so the break is explicit and
  // measured — see the padding assertion in the deck's browser check.
  const nodes = [
    { y: 8, title: "The buyer", sub: ["A high-income taxpayer"] },
    { y: 116, title: "Irrevocable grantor trust", sub: ["Settled by the buyer, funded with cash"] },
    {
      y: 224,
      title: "Series LLC",
      sub: ["One Series per home —", "owned 100% by the Trust"],
    },
    { y: 332, title: "The Park Model", sub: ["Titled with a state VIN as a trailer / RV"] },
  ];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="The buyer settles an irrevocable grantor trust, which owns 100% of a Series LLC, which owns the Park Model. The Management Series is the trustee of the trust and the manager of the home."
      >
        <defs>
          <marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={NEUTRAL[0]} />
          </marker>
        </defs>

        {nodes.slice(0, -1).map((n, i) => (
          <line
            key={`edge-${i}`}
            x1={cx + boxW / 2}
            y1={n.y + boxH}
            x2={cx + boxW / 2}
            y2={nodes[i + 1].y - 4}
            stroke={NEUTRAL[0]}
            strokeWidth={2}
            markerEnd="url(#arw)"
          />
        ))}

        {nodes.map((n, i) => {
          const last = i === nodes.length - 1;
          return (
            <g key={n.title}>
              <rect
                x={cx}
                y={n.y}
                width={boxW}
                height={boxH}
                rx={8}
                fill={last ? ACCENT : "rgba(251,250,247,0.06)"}
                stroke={last ? ACCENT : "rgba(251,250,247,0.22)"}
                strokeWidth={2}
              />
              {/* One line of sub sits centred under the title as before; two
                  lines pull the title up so both fit inside the same box
                  height, rather than growing the box and eating the gap the
                  connector arrows need. */}
              <text
                x={cx + 20}
                y={n.y + (n.sub.length > 1 ? 26 : 30)}
                fill={last ? "#0a1430" : TEXT}
                fontSize={19}
                fontWeight={650}
              >
                {n.title}
              </text>
              {n.sub.map((line, li) => (
                <text
                  key={line}
                  x={cx + 20}
                  y={n.y + (n.sub.length > 1 ? 46 : 54) + li * 17}
                  fill={last ? "rgba(10,20,48,0.78)" : TEXT_MUTED}
                  fontSize={14}
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}

        {/* The Management Series. Dashed, because this is NOT ownership. */}
        <rect
          x={mgtX}
          y={116}
          width={boxW}
          height={boxH + 34}
          rx={8}
          fill="rgba(251,250,247,0.06)"
          stroke={NEUTRAL[0]}
          strokeWidth={2}
          strokeDasharray="7 5"
        />
        <text x={mgtX + 20} y={146} fill={TEXT} fontSize={19} fontWeight={650}>
          The Management Series
        </text>
        <text x={mgtX + 20} y={170} fill={TEXT_MUTED} fontSize={14}>
          Trustee of the Trust, and manager
        </text>
        <text x={mgtX + 20} y={192} fill={TEXT_MUTED} fontSize={14}>
          of the home. It owns nothing.
        </text>

        <line
          x1={mgtX}
          y1={linkY}
          x2={cx + boxW + 6}
          y2={linkY}
          stroke={NEUTRAL[0]}
          strokeWidth={2}
          strokeDasharray="7 5"
          markerEnd="url(#arw)"
        />
        {/* Centred in the gap and ABOVE the connector, so it cannot sit under
            either box however the two are spaced. */}
        <text
          x={(cx + boxW + mgtX) / 2}
          y={linkY - 12}
          textAnchor="middle"
          fill={TEXT_MUTED}
          fontSize={13}
        >
          serves as trustee
        </text>
      </svg>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Comparison of sizes                                                         */
/* -------------------------------------------------------------------------- */

export interface TierRow {
  label: string;
  priceCents: number;
  downCents: number;
  financedCents: number;
  monthlyCents: number;
  deductionCents: number;
}

/**
 * Three sizes, as a table with one bar per row.
 *
 * A handful of headline numbers is a table, not a grouped bar chart — five
 * measures across three tiers would need fifteen bars to say what a table says
 * in a glance. The single bar per row encodes deposit against price, which is
 * the one comparison that is genuinely visual.
 */
export function TierTable({ rows, depositLabel }: { rows: TierRow[]; depositLabel: string }) {
  const max = Math.max(...rows.map((r) => r.priceCents), 1);

  return (
    <div className="overflow-hidden rounded-lg border border-white/15">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-white/[0.06] text-[0.82rem] uppercase tracking-wider text-paper-50/60">
            <th className="px-5 py-3 font-medium">Size</th>
            <th className="px-5 py-3 font-medium">Purchase price</th>
            <th className="px-5 py-3 font-medium">Cash down ({depositLabel})</th>
            <th className="px-5 py-3 font-medium">Financed at 0%</th>
            <th className="px-5 py-3 font-medium">Monthly note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-white/10 align-middle">
              <td className="px-5 py-4">
                <div className="text-[1.05rem] font-semibold text-paper-50">{row.label}</div>
                <svg viewBox="0 0 200 10" className="mt-2 h-[10px] w-[9rem]" aria-hidden>
                  <rect x={0} y={0} width={200} height={10} rx={4} fill="rgba(251,250,247,0.10)" />
                  <rect
                    x={0}
                    y={0}
                    width={Math.max(6, (row.priceCents / max) * 200)}
                    height={10}
                    rx={4}
                    fill={ACCENT}
                  />
                </svg>
              </td>
              <td className="px-5 py-4 text-[1.05rem] text-paper-50">{money(row.priceCents)}</td>
              <td className="px-5 py-4 text-[1.05rem] text-paper-50">{money(row.downCents)}</td>
              <td className="px-5 py-4 text-[1.05rem] text-paper-50/80">
                {money(row.financedCents)}
              </td>
              <td className="px-5 py-4 text-[1.05rem] font-semibold text-paper-50">
                {money(row.monthlyCents, { cents: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
