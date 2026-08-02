// Where should BTB buy land?
//
// Scoring is ARITHMETIC, here, in code — the same rule that governs proposal
// economics and contract terms. A model may write prose around these numbers; it
// may not produce them. "Best place to buy" is a figure someone will spend a
// million dollars against.
//
// What this is honest about: the parcel database carries the ASSESSED value and
// the last recorded sale. It does not carry an asking price. So this ranks
// candidates by what the county thinks the land is worth per pad we could build
// on it — a screen for where to look, not a valuation and not an offer.

import { query } from "./db";

/** Square feet in an acre. */
const SQFT_PER_ACRE = 43_560;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * Ground consumed per pad once access roads, setbacks and amenity space are
 * taken out — not the pad slab itself.
 *
 * 2,500 sq ft against a ~1,200 sq ft pad is roughly a 2:1 overhead, which is
 * ordinary for an RV park. Configure it rather than arguing about it.
 */
export const PAD_FOOTPRINT_SQFT = () => envInt("CRM_PAD_FOOTPRINT_SQFT", 2_500);

/**
 * Share of raw acreage that can actually carry pads, in basis points.
 *
 * 40% is deliberately conservative. Wetland, slope, setback and the bits you
 * cannot build on are invisible at this level of data, and a screen that
 * flatters every parcel is worse than useless — it sends someone to look at
 * land that cannot hold what the model promised.
 */
export const USABLE_SHARE_BPS = () => envInt("CRM_USABLE_SHARE_BPS", 4_000);

/** Below this a site is not worth developing as a park. */
export const MIN_VIABLE_PADS = () => envInt("CRM_MIN_VIABLE_PADS", 8);

export interface SiteFit {
  usableSqft: number;
  padsThatFit: number;
  viable: boolean;
  /** Assessed value spread over the pads it could carry. Null without a value. */
  landCostPerPadCents: number | null;
}

/** What a parcel of `acres` could hold, and what the land costs per pad. */
export function siteFit(acres: number | null | undefined, valueCents: number | null): SiteFit {
  const a = typeof acres === "number" && Number.isFinite(acres) && acres > 0 ? acres : 0;
  const usableSqft = Math.floor((a * SQFT_PER_ACRE * USABLE_SHARE_BPS()) / 10_000);
  const padsThatFit = Math.floor(usableSqft / PAD_FOOTPRINT_SQFT());
  return {
    usableSqft,
    padsThatFit,
    viable: padsThatFit >= MIN_VIABLE_PADS(),
    landCostPerPadCents:
      valueCents && valueCents > 0 && padsThatFit > 0
        ? Math.round(valueCents / padsThatFit)
        : null,
  };
}

export interface CountyCandidate {
  state: string;
  county: string;
  /** Parcels that clear the acreage floor and are recorded as land. */
  candidates: number;
  median_acres: number;
  /** Median assessed value across those candidates, in cents. */
  median_value_cents: number;
  /** Median assessed value per pad the median parcel could carry, in cents. */
  median_cost_per_pad_cents: number | null;
  median_pads: number;
  score: number;
}

/**
 * Counties ranked as places to buy.
 *
 * Aggregated at county level rather than per parcel because "where should we
 * buy" is a question about markets, not listings — one cheap parcel in an
 * expensive county is an outlier, and a county with fifty viable candidates is
 * somewhere you can actually build a pipeline.
 *
 * Medians, not averages: assessment rolls carry a long tail of enormous
 * ranch parcels that drag a mean somewhere useless.
 */
export async function rankCounties(opts: {
  state?: string | null;
  minAcres?: number;
  limit?: number;
}): Promise<CountyCandidate[]> {
  const minAcres = opts.minAcres ?? 2;
  const limit = Math.min(50, Math.max(1, opts.limit ?? 15));
  const params: unknown[] = [minAcres];
  let stateFilter = "";
  if (opts.state) {
    params.push(opts.state.toUpperCase());
    stateFilter = `AND p.state = $${params.length}`;
  }

  // jv is the assessor's just/market value in dollars; money is cents in this
  // app, hence the ×100. `is_land` keeps improved property out — we are buying
  // ground to build on, not somebody's house.
  const rows = await query<Omit<CountyCandidate, "score">>(
    `SELECT
       p.state,
       p.county,
       count(*)::int                                                    AS candidates,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY p.acres)::double precision
                                                                        AS median_acres,
       (percentile_cont(0.5) WITHIN GROUP (ORDER BY p.jv) * 100)::bigint
                                                                        AS median_value_cents,
       0::bigint                                                        AS median_cost_per_pad_cents,
       0::int                                                           AS median_pads
     FROM parcels p
     WHERE p.acres >= $1
       AND p.is_land IS TRUE
       AND p.jv IS NOT NULL AND p.jv > 0
       ${stateFilter}
     GROUP BY p.state, p.county
     HAVING count(*) >= 5
     ORDER BY count(*) DESC
     LIMIT ${limit}`,
    params,
  );

  // The per-pad arithmetic is done here rather than in SQL so it uses exactly
  // the same siteFit() the parcel rows and the park planner use. One definition,
  // three call sites.
  return rows
    .map((r) => {
      const fit = siteFit(r.median_acres, r.median_value_cents);
      return {
        ...r,
        median_pads: fit.padsThatFit,
        median_cost_per_pad_cents: fit.landCostPerPadCents,
      };
    })
    .map((r) => ({ ...r, score: scoreCounty(r) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 0-100. Cheap land per pad, enough of it, and enough candidates to choose from.
 *
 * Weighted toward cost per pad because that is the figure that survives into the
 * proposal: it becomes BTB's land basis, which is not depreciable and therefore
 * cannot be written off (see economics.ts). Supply matters second — a market you
 * can only buy in once is not a pipeline.
 */
function scoreCounty(c: Omit<CountyCandidate, "score">): number {
  // $12,000 of land per pad is treated as par. Below that scores above 50.
  const PAR_COST_PER_PAD_CENTS = 1_200_000;
  const cost = c.median_cost_per_pad_cents;
  const costScore =
    cost === null || cost <= 0
      ? 30 // unknown is not the same as good
      : Math.max(0, Math.min(100, 100 - (cost / PAR_COST_PER_PAD_CENTS) * 50));

  // 40 viable candidates is plenty; more adds little.
  const supplyScore = Math.min(100, (c.candidates / 40) * 100);

  // A median parcel that cannot hold a viable park is a bad market for us even
  // if the land is cheap.
  const viability = c.median_pads >= MIN_VIABLE_PADS() ? 100 : (c.median_pads / MIN_VIABLE_PADS()) * 100;

  return Math.round(costScore * 0.5 + supplyScore * 0.25 + viability * 0.25);
}

/** True when the parcel table has been loaded at all. */
export async function parcelsAvailable(): Promise<{ ready: boolean; rows: number }> {
  try {
    const [row] = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM parcels`,
    );
    return { ready: true, rows: row?.n ?? 0 };
  } catch {
    // The table is created by the ETL, not by this app — its absence is a
    // normal state before the first import, not an error.
    return { ready: false, rows: 0 };
  }
}
