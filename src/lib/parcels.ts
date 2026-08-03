// Parcel data layer, backed by Postgres (FDOR NAL / NC OneMap, loaded by
// /etl). Replaces the former ATTOM + RentCast integrations. Exposes the same
// AreaSearchResult / PropertyReport shapes the UI already consumes, so the
// research/land/foreclosure pages keep working.
//
// Distress: the nightly auction sync (etl/auctions.mjs) loads upcoming tax
// deed & foreclosure sales into `auctions`; parcels join to it by normalized
// parcel number (parcels_pid_norm_idx), which powers the Tax Deed and
// Foreclosure/REO filters and the auction flags on rows.

import { getPool } from "@/lib/db";
import { USE_KINDS, isUseKind, type UseKind } from "@/lib/parcelUse";

/** Thrown for bad input or DB failure; carries an HTTP status. */
export class ParcelError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "ParcelError";
    this.status = status;
  }
}

export interface PropertySummary {
  attomId?: string; // parcel key "co_no:parcel_id"
  oneLine?: string;
  apn?: string;
  county?: string;
  owner?: string;
  ownerType?: string;
  ownerMailing?: string;
  absenteeOwner?: boolean;
  propType?: string;
  lotSizeAcres?: number;
}

export interface TaxInfo {
  taxYear?: number;
  taxAmount?: number; // not in the assessment roll — always undefined for now
  assessedTotal?: number;
  marketTotal?: number;
  landValue?: number; // assessor's land-only value (FL LND_VAL / NC landval)
}

export interface DeedEvent {
  date?: string;
  amount?: number;
  docType?: string;
  distressed?: boolean;
  taxDeed?: boolean;
  reo?: boolean;
}

/** An upcoming (or in-progress) county auction matched to a parcel. */
export interface AuctionEvent {
  auctionType?: string; // TAXDEED | FORECLOSURE | TAX_FORECLOSURE
  status?: string; // pre-sale | upcoming | upset-period
  saleDate?: string;
  saleTime?: string;
  closeDate?: string; // NC upset-bid deadline
  openingBid?: number;
  currentBid?: number;
  judgmentAmount?: number;
  caseNo?: string;
  certNo?: string;
  county?: string;
  detailUrl?: string;
}

export interface PropertyReport {
  found: boolean;
  summary: PropertySummary;
  tax: TaxInfo;
  deeds: DeedEvent[];
  auctions: AuctionEvent[];
  notes: string[];
}

/**
 * Whether `parcel_zoning` exists, cached for the process.
 *
 * The table is created by the ETL's zoning job, not by this app's
 * `ensureAppSchema` — it belongs to the importer and this app only reads it. A
 * `to_regclass` probe is one cheap query and it is cached because the answer
 * only changes when a deploy or an ETL run happens, either of which restarts or
 * outlives the process.
 */
let zoningTablePresent: boolean | null = null;
async function zoningTableExists(): Promise<boolean> {
  if (zoningTablePresent !== null) return zoningTablePresent;
  try {
    const { rows } = await getPool().query<{ present: boolean }>(
      "SELECT to_regclass('public.parcel_zoning') IS NOT NULL AS present",
    );
    zoningTablePresent = rows[0]?.present === true;
  } catch {
    // Never let a probe take land search down; without zoning it still works.
    zoningTablePresent = false;
  }
  return zoningTablePresent;
}

export interface AreaRow {
  parcelId?: string; // "co_no:parcel_id" — key for detail/assess lookups
  oneLine?: string;
  /**
   * The zoning district, exactly as the county publishes it — prefix and all
   * (`ORG-A-1`, `WG-C-2`). The prefix is the jurisdiction whose rulebook
   * applies, which is why it is not stripped.
   *
   * **Absent for most parcels**, and absent is not "unzoned": it means no
   * adapter covers that county, or the job has not reached that parcel. Never
   * render a blank as though it were a finding.
   */
  zoning?: string;
  zoningJurisdiction?: string;
  /** When that code was read from the county. Zoning changes; this is a snapshot. */
  zoningAt?: string;
  owner?: string;
  propType?: string;
  lastDeedDate?: string;
  lastDeedAmount?: number;
  lastDeedType?: string;
  distressed?: boolean;
  taxDeed?: boolean;
  reo?: boolean;
  auctionDate?: string;
  auctionStatus?: string;
  openingBid?: number;
  assessedTotal?: number;
  landValue?: number; // assessor's land-only value
  acres?: number; // lot size in acres
  lotSqft?: number; // lot size in square feet
  taxAmount?: number;
  taxYear?: number;
  taxYearStale?: boolean;
  land?: boolean;
}

/** Friendly names for the state codes stored in `parcels.state`. */
export const STATE_NAMES: Record<string, string> = {
  FL: "Florida",
  NC: "North Carolina",
  CO: "Colorado",
  MT: "Montana",
};

export interface StateOption {
  code: string;
  name: string;
  count: number;
}

// Current-use presets. Defined in lib/parcelUse.ts, which has no database
// import, so client components can read the labels without pulling `pg` in.
export { USE_KINDS, isUseKind, type UseKind } from "@/lib/parcelUse";

export interface AreaSearchResult {
  area: string;
  query: string;
  by: "postalcode" | "radius" | "state";
  total: number;
  page: number;
  pageSize: number;
  distressedOnly: boolean;
  taxDeedOnly: boolean;
  reoOnly: boolean;
  landOnly: boolean;
  useKind?: UseKind;
  minPrice?: number;
  maxPrice?: number;
  minAcres?: number;
  maxAcres?: number;
  sort: SortKey;
  scanned?: number;
  hasNext: boolean;
  rows: AreaRow[];
  notes: string[];
}

const PAGE_SIZE = 50;

/**
 * Whitelisted sort orders. The key comes from the client; the value is the
 * literal ORDER BY expression, so untrusted input never reaches the SQL string.
 * All fall back to `p.id` for a stable tiebreaker (deterministic pagination).
 */
export const SORT_OPTIONS = {
  assessed_desc: "p.jv DESC NULLS LAST, p.id",
  assessed_asc: "p.jv ASC NULLS LAST, p.id",
  sale_desc: "p.sale_prc DESC NULLS LAST, p.id",
  sale_asc: "p.sale_prc ASC NULLS LAST, p.id",
  sold_newest: "p.sale_date DESC NULLS LAST, p.id",
  sold_oldest: "p.sale_date ASC NULLS LAST, p.id",
  acres_desc: "p.acres DESC NULLS LAST, p.id",
  acres_asc: "p.acres ASC NULLS LAST, p.id",
} as const;

export type SortKey = keyof typeof SORT_OPTIONS;
export const DEFAULT_SORT: SortKey = "assessed_desc";

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && v in SORT_OPTIONS;
}

const AUCTIONS_NOT_SYNCED =
  "Auction data has not been loaded yet — run the auction sync (docker compose run --rm auctions) " +
  "to pull upcoming tax-deed & foreclosure sales from the county auction sources.";

// Statuses that mean "headed to (or at) auction" — closed sales are excluded.
const ACTIVE_AUCTION_STATUSES = ["pre-sale", "upcoming", "upset-period"];

/** Join predicate between parcels p and auctions a (normalized parcel number). */
const AUCTION_JOIN =
  `a.state = p.state
   AND a.parcel_id_norm = upper(regexp_replace(p.parcel_id, '[^A-Za-z0-9]', '', 'g'))
   AND (a.co_no = p.co_no OR (a.co_no IS NULL AND (a.county IS NULL OR upper(a.county) = upper(p.county))))`;

function isMissingRelation(err: unknown, rel: string): boolean {
  return err instanceof Error && new RegExp(`relation "${rel}" does not exist`).test(err.message);
}

/** node-postgres returns NUMERIC as string; coerce to number|undefined. */
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function str(v: unknown): string | undefined {
  return v === null || v === undefined || v === "" ? undefined : String(v);
}
function isoDate(v: unknown): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

interface AreaOpts {
  distressedOnly?: boolean;
  taxDeedOnly?: boolean;
  reoOnly?: boolean;
  landOnly?: boolean;
  /**
   * Current-use preset (see USE_KINDS). Overrides `landOnly` when set to
   * anything but "any" — an operating RV park is improved property, so the two
   * together can only ever return nothing.
   */
  useKind?: UseKind;
  /** Assessed-value floor / ceiling (USD). Filters on p.jv. */
  minPrice?: number;
  maxPrice?: number;
  /** Lot-size floor / ceiling (acres). Filters on p.acres. */
  minAcres?: number;
  maxAcres?: number;
  sort?: SortKey;
  /**
   * Total match count carried over from a prior page of the same search. When
   * present we skip the (expensive) COUNT(*) — the total can't change between
   * page clicks, so re-counting on every Next/Prev is pure waste.
   */
  knownTotal?: number;
}

/** Coerce a user-supplied price to a non-negative finite number, or undefined. */
function cleanPrice(v?: number): number | undefined {
  if (v === undefined || v === null || !Number.isFinite(v) || v < 0) return undefined;
  return v;
}

/** List parcels across a ZIP or city. */
export async function searchArea(area: string, page: number, opts: AreaOpts = {}): Promise<AreaSearchResult> {
  const { taxDeedOnly = false, reoOnly = false } = opts;
  const useKind: UseKind = isUseKind(opts.useKind) ? opts.useKind : "any";
  const useCodes = USE_KINDS[useKind].codes;
  // An operating park is improved, so "vacant land only" AND a use preset is a
  // guaranteed empty result. The explicit choice wins and the note says so —
  // silently returning zero here reads as "there are none", which is a lie.
  const landOnly = useCodes.length > 0 ? false : (opts.landOnly ?? false);
  const sort: SortKey = isSortKey(opts.sort) ? opts.sort : DEFAULT_SORT;
  let minPrice = cleanPrice(opts.minPrice);
  let maxPrice = cleanPrice(opts.maxPrice);
  // A backwards range is almost certainly a typo — swap rather than return nothing.
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  let minAcres = cleanPrice(opts.minAcres);
  let maxAcres = cleanPrice(opts.maxAcres);
  if (minAcres !== undefined && maxAcres !== undefined && minAcres > maxAcres) {
    [minAcres, maxAcres] = [maxAcres, minAcres];
  }
  const knownTotal =
    Number.isInteger(opts.knownTotal) && (opts.knownTotal as number) >= 0 ? (opts.knownTotal as number) : undefined;
  const safePage = Math.max(1, Math.floor(page) || 1);
  const trimmed = (area || "").trim();
  if (!trimmed) throw new ParcelError("Enter an area (City, FL or ZIP) to search.", 400);

  // State code vs ZIP vs city. A bare 2-letter code that maps to a loaded state
  // searches the whole state (the research page's state dropdown sends these);
  // 5 digits is a ZIP; anything else is a city name.
  let where: string;
  const params: unknown[] = [];
  let label: string;
  let by: "postalcode" | "radius" | "state";
  // The state, when the query states one. Used only to warn that a use preset
  // reads a Florida-only column; a bare ZIP leaves it unknown, which is fine.
  let searchState: string | undefined;
  const stateCode = trimmed.toUpperCase();
  if (/^[A-Za-z]{2}$/.test(trimmed) && STATE_NAMES[stateCode]) {
    by = "state";
    params.push(stateCode);
    where = "p.state = $1";
    label = STATE_NAMES[stateCode];
    searchState = stateCode;
  } else if (/^\d{5}$/.test(trimmed)) {
    by = "postalcode";
    params.push(trimmed);
    where = "p.situs_zip = $1";
    label = `ZIP ${trimmed}`;
  } else {
    // A place name, which may be a CITY or a COUNTY — and the caller usually
    // does not know which. Matching only `situs_city` is what made the land
    // search return "0 match" for Volusia: the county holds 310,941 parcels and
    // no parcel anywhere has a situs city of that name, because Volusia is a
    // county. Match either, and let the trailing state narrow it.
    by = "radius";
    const [namePart, statePart] = trimmed.split(",").map((s) => s.trim());
    params.push(namePart);
    where = "(lower(p.situs_city) = lower($1) OR lower(p.county) = lower($1))";
    label = namePart;
    // "Volusia, FL" used to discard the ", FL" entirely. It is the difference
    // between one county and every same-named county in the country.
    const suffix = (statePart ?? "").toUpperCase();
    if (/^[A-Z]{2}$/.test(suffix) && STATE_NAMES[suffix]) {
      params.push(suffix);
      where += ` AND p.state = $${params.length}`;
      label = `${namePart}, ${suffix}`;
      searchState = suffix;
    }
  }
  if (landOnly) where += " AND p.is_land";
  // Current use. Same param-ordering rule as the price/acre filters: pushed
  // before the lateral join so its `params.length + N` offsets stay correct.
  if (useCodes.length > 0) {
    params.push(useCodes);
    where += ` AND p.dor_uc = ANY($${params.length})`;
  }
  // Price range on assessed (just/market) value. Pushed onto `params` before the
  // lateral join, so its `params.length + N` offsets stay correct.
  if (minPrice !== undefined) {
    params.push(minPrice);
    where += ` AND p.jv >= $${params.length}`;
  }
  if (maxPrice !== undefined) {
    params.push(maxPrice);
    where += ` AND p.jv <= $${params.length}`;
  }
  // Lot-size range on acreage (same param-ordering rule as the price filter).
  if (minAcres !== undefined) {
    params.push(minAcres);
    where += ` AND p.acres >= $${params.length}`;
  }
  if (maxAcres !== undefined) {
    params.push(maxAcres);
    where += ` AND p.acres <= $${params.length}`;
  }

  // Which auction types the distress filters ask for.
  const auctionTypes = taxDeedOnly && reoOnly
    ? ["TAXDEED", "FORECLOSURE", "TAX_FORECLOSURE"]
    : taxDeedOnly
      ? ["TAXDEED"]
      : reoOnly
        ? ["FORECLOSURE", "TAX_FORECLOSURE"]
        : null;
  const filterByAuction = auctionTypes !== null;

  // Earliest active auction per parcel (also decorates unfiltered results).
  const lateral =
    `LEFT JOIN LATERAL (
       SELECT a.auction_type, a.status, a.sale_date, a.opening_bid
       FROM auctions a
       WHERE ${AUCTION_JOIN}
         AND a.status = ANY($${params.length + 1})
         ${filterByAuction ? `AND a.auction_type = ANY($${params.length + 2})` : ""}
       ORDER BY a.sale_date ASC NULLS LAST
       LIMIT 1
     ) au ON true`;
  const lateralParams: unknown[] = [ACTIVE_AUCTION_STATUSES];
  if (filterByAuction) lateralParams.push(auctionTypes);
  const filterWhere = filterByAuction ? `${where} AND au.auction_type IS NOT NULL` : where;

  // When distress-filtering, soonest sale first still leads unless the user picked
  // a non-default sort; the chosen sort then breaks ties.
  const sortExpr = SORT_OPTIONS[sort];
  const orderBy =
    filterByAuction && sort === DEFAULT_SORT ? `au.sale_date ASC NULLS LAST, ${sortExpr}` : sortExpr;

  const pool = getPool();
  const offset = (safePage - 1) * PAGE_SIZE;
  // Fetch one extra row so hasNext is exact without depending on the count — this
  // lets pagination skip COUNT(*) entirely (see knownTotal).
  const fetchLimit = PAGE_SIZE + 1;
  const needCount = knownTotal === undefined;
  let auctionsSynced = true;

  // `parcel_zoning` is written by a separate ETL job on its own timer, so this
  // app must work whether or not it exists yet. Probed once per search rather
  // than assumed: a hard reference would turn every land search into a 500 on a
  // database where the zoning job has never run, which includes a fresh one.
  const hasZoning = await zoningTableExists();
  const zoningSelect = hasZoning ? ", z.zoning_code, z.jurisdiction, z.fetched_at AS zoning_at" : "";
  const zoningJoin = hasZoning
    ? `LEFT JOIN parcel_zoning z
         ON z.state = p.state AND z.co_no = p.co_no AND z.parcel_id = p.parcel_id`
    : "";

  // The COUNT and the page of rows are independent — run them concurrently so the
  // request waits for one round-trip, not two. COUNT is skipped when we already
  // know the total from a prior page.
  const countSql = filterByAuction
    ? `SELECT count(*)::int n FROM (SELECT 1 FROM parcels p ${lateral} WHERE ${filterWhere}) t`
    : `SELECT count(*)::int n FROM parcels p WHERE ${where}`;
  const countParams = filterByAuction ? [...params, ...lateralParams] : params;
  // Zoning is a LEFT JOIN to a table the ETL fills separately, and it must stay
  // left: `parcel_zoning` covers only the counties with an adapter and only the
  // parcels that job has reached, so an inner join would silently drop every
  // other parcel from land search. `to_regclass` guards a database where that
  // table does not exist at all — see zoningJoin below.
  const rowsSql = `SELECT p.state, p.co_no, p.parcel_id, p.one_line, p.owner_name, p.use_label, p.is_land,
            p.jv, p.lnd_val, p.acres, p.lnd_sqft, p.asmnt_yr, p.sale_prc, p.sale_date,
            au.auction_type, au.status AS auction_status, au.sale_date AS auction_date, au.opening_bid
            ${zoningSelect}
     FROM parcels p ${lateral} ${zoningJoin}
     WHERE ${filterWhere}
     ORDER BY ${orderBy}
     LIMIT ${fetchLimit} OFFSET ${offset}`;
  const rowsParams = [...params, ...lateralParams];

  let totalRes: { rows: { n: number }[] } | null;
  let rowsRes: { rows: Record<string, unknown>[] };
  try {
    [totalRes, rowsRes] = await Promise.all([
      needCount ? pool.query<{ n: number }>(countSql, countParams) : Promise.resolve(null),
      pool.query(rowsSql, rowsParams),
    ]);
  } catch (err) {
    // A missing table means that ETL hasn't been run yet.
    if (isMissingRelation(err, "parcels")) {
      throw new ParcelError("The parcel database has not been loaded yet. Run the Florida import.", 503);
    }
    if (isMissingRelation(err, "auctions")) {
      if (filterByAuction) {
        return {
          area: label, query: area, by, total: 0, page: safePage, pageSize: PAGE_SIZE,
          distressedOnly: filterByAuction, taxDeedOnly, reoOnly, landOnly, useKind,
          minPrice, maxPrice, minAcres, maxAcres, sort,
          scanned: 0, hasNext: false, rows: [],
          notes: [AUCTIONS_NOT_SYNCED],
        };
      }
      // No filter: fall back to the plain parcel query, without auction flags.
      auctionsSynced = false;
      [totalRes, rowsRes] = await Promise.all([
        needCount
          ? pool.query<{ n: number }>(`SELECT count(*)::int n FROM parcels p WHERE ${where}`, params)
          : Promise.resolve(null),
        pool.query(
          `SELECT p.state, p.co_no, p.parcel_id, p.one_line, p.owner_name, p.use_label, p.is_land,
                  p.jv, p.lnd_val, p.acres, p.lnd_sqft, p.asmnt_yr, p.sale_prc, p.sale_date,
                  NULL AS auction_type, NULL AS auction_status, NULL AS auction_date, NULL AS opening_bid
           FROM parcels p WHERE ${where}
           ORDER BY ${sortExpr}
           LIMIT ${fetchLimit} OFFSET ${offset}`,
          params,
        ),
      ]);
    } else {
      throw err;
    }
  }

  // The extra row (if present) only tells us another page exists; don't render it.
  const fetched = rowsRes.rows;
  const hasNext = fetched.length > PAGE_SIZE;
  const dataRows = hasNext ? fetched.slice(0, PAGE_SIZE) : fetched;
  const total = knownTotal ?? (totalRes?.rows[0]?.n ?? 0);
  const thisYear = new Date().getFullYear();
  const rows: AreaRow[] = dataRows.map((r) => {
    const yr = num(r.asmnt_yr);
    const amount = num(r.sale_prc);
    const date = isoDate(r.sale_date);
    const auctionType = str(r.auction_type);
    return {
      parcelId: [r.state, r.co_no, r.parcel_id].join(":"),
      oneLine: str(r.one_line),
      owner: str(r.owner_name),
      propType: str(r.use_label),
      land: r.is_land === true,
      zoning: str(r.zoning_code),
      zoningJurisdiction: str(r.jurisdiction),
      zoningAt: isoDate(r.zoning_at),
      lastDeedDate: date,
      lastDeedAmount: amount,
      lastDeedType: amount || date ? "Sale" : undefined,
      distressed: auctionType !== undefined,
      taxDeed: auctionType === "TAXDEED",
      reo: auctionType === "FORECLOSURE" || auctionType === "TAX_FORECLOSURE",
      auctionDate: isoDate(r.auction_date),
      auctionStatus: str(r.auction_status),
      openingBid: num(r.opening_bid),
      assessedTotal: num(r.jv),
      landValue: num(r.lnd_val),
      acres: num(r.acres),
      lotSqft: num(r.lnd_sqft),
      taxAmount: undefined,
      taxYear: yr,
      taxYearStale: yr ? yr <= thisYear - 3 : false,
    };
  });

  const notes: string[] = [];
  if (landOnly) {
    notes.push(`Land filter: ${total.toLocaleString()} vacant-land, agricultural, or unimproved parcels in ${label}.`);
  }
  if (useCodes.length > 0) {
    notes.push(
      `Current use "${USE_KINDS[useKind].label}": ${total.toLocaleString()} parcel(s) in ${label}. ` +
        "This is the assessor's record of how the parcel is USED — it is not zoning, and it does not establish " +
        "that RV or transient use is permitted. Confirm with a written zoning determination for the parcel.",
    );
    if (opts.landOnly) {
      notes.push(
        "Vacant-land filter ignored: an operating park is improved property, so the two filters together would " +
          "match nothing.",
      );
    }
    if (searchState && searchState !== "FL") {
      notes.push(
        `Use filters read the Florida DOR use code, which is only populated for Florida parcels — expect no ` +
          `matches in ${label}.`,
      );
    }
    if (useKind === "mh_park" || useKind === "park_like") {
      notes.push(
        "Mobile-home parks are typically zoned for PERMANENT residency. The structure depends on transient use " +
          "(normally under 30 days), so treat these as leads to check rather than as sites that already fit.",
      );
    }
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
    const range =
      minPrice !== undefined && maxPrice !== undefined
        ? `${fmt(minPrice)}–${fmt(maxPrice)}`
        : minPrice !== undefined
          ? `${fmt(minPrice)} and up`
          : `up to ${fmt(maxPrice!)}`;
    notes.push(`Assessed value ${range}: ${total.toLocaleString()} parcel(s) match in ${label}.`);
  }
  if (minAcres !== undefined || maxAcres !== undefined) {
    const fmt = (n: number) => `${n.toLocaleString()} ac`;
    const range =
      minAcres !== undefined && maxAcres !== undefined
        ? `${fmt(minAcres)}–${fmt(maxAcres)}`
        : minAcres !== undefined
          ? `${fmt(minAcres)} and up`
          : `up to ${fmt(maxAcres!)}`;
    notes.push(`Lot size ${range}: ${total.toLocaleString()} parcel(s) match in ${label}.`);
  }
  if (filterByAuction) {
    notes.push(
      total > 0
        ? `${total.toLocaleString()} parcel(s) in ${label} matched to an active county auction (${taxDeedOnly && !reoOnly ? "tax deed" : reoOnly && !taxDeedOnly ? "foreclosure" : "tax deed or foreclosure"}). Sale dates & opening bids come from the nightly auction sync.`
        : `No parcels in ${label} are matched to an active ${taxDeedOnly && !reoOnly ? "tax-deed" : "foreclosure"} auction right now. Auctions are synced nightly from county sources; try the statewide list on the Foreclosures page.`,
    );
  } else if (!auctionsSynced) {
    notes.push(AUCTIONS_NOT_SYNCED);
  }

  return {
    area: label, query: area, by, total, page: safePage, pageSize: PAGE_SIZE,
    distressedOnly: filterByAuction, taxDeedOnly, reoOnly, landOnly, useKind,
    minPrice, maxPrice, minAcres, maxAcres, sort,
    scanned: rows.length, hasNext, rows, notes,
  };
}

/**
 * Cached result of `listStates`.
 *
 * `GROUP BY state` with a count has to visit every row, and at ~19.5M parcels
 * that is a 3.1-second parallel sequential scan. It ran on every render of
 * /research and /crm, which meant a client-side navigation to either sat for
 * over three seconds showing nothing at all — next/link suppresses the
 * browser's own loading indicator, so the page simply looked dead on click.
 *
 * The answer only changes when the ETL imports a new state, which is a manual,
 * occasional job — so an hour of staleness costs nothing and the scan drops out
 * of the request path entirely.
 */
const STATES_TTL_MS = 60 * 60 * 1000;
let statesCache: { at: number; value: StateOption[] } | null = null;
let statesInFlight: Promise<StateOption[]> | null = null;

async function queryStates(): Promise<StateOption[]> {
  const pool = getPool();
  try {
    const res = await pool.query<{ state: string; n: number }>(
      `SELECT state, count(*)::int n FROM parcels WHERE state IS NOT NULL GROUP BY state`,
    );
    return res.rows
      .map((r) => ({ code: r.state, name: STATE_NAMES[r.state] ?? r.state, count: num(r.n) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    // No parcels table yet (ETL not run) — no states to offer.
    if (isMissingRelation(err, "parcels")) return [];
    throw err;
  }
}

/** The states that actually have parcels loaded, for the search dropdown. */
export async function listStates(): Promise<StateOption[]> {
  if (statesCache && Date.now() - statesCache.at < STATES_TTL_MS) {
    return statesCache.value;
  }
  // Share one scan between concurrent callers. Without this, a cold start with
  // /research and /crm open at once runs the 3-second scan once per request.
  if (!statesInFlight) {
    statesInFlight = queryStates()
      .then((value) => {
        statesCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        // Cleared on failure too, so a transient error doesn't wedge the cache.
        statesInFlight = null;
      });
  }
  return statesInFlight;
}

/** Full detail (ownership, tax, last recorded sale) for one parcel. */
export async function lookupProperty(parcelKey: string): Promise<PropertyReport> {
  const parts = (parcelKey || "").split(":");
  if (parts.length < 3) throw new ParcelError("Invalid parcel id.", 400);
  const state = parts[0];
  const coNo = Number(parts[1]);
  const parcelId = parts.slice(2).join(":");
  if (!state || !Number.isFinite(coNo) || !parcelId) throw new ParcelError("Invalid parcel id.", 400);

  const pool = getPool();
  const res = await pool.query(
    `SELECT * FROM parcels WHERE state = $1 AND co_no = $2 AND parcel_id = $3 LIMIT 1`,
    [state, coNo, parcelId],
  );
  if (res.rows.length === 0) {
    return { found: false, summary: {}, tax: {}, deeds: [], auctions: [], notes: [] };
  }
  const p = res.rows[0];
  const mailing = [p.owner_addr, p.owner_city, p.owner_state, p.owner_zip].filter(Boolean).join(", ");
  const amount = num(p.sale_prc);
  const date = isoDate(p.sale_date);
  const deeds: DeedEvent[] =
    amount || date ? [{ date, amount, docType: "Sale", distressed: false, taxDeed: false, reo: false }] : [];

  // Active county auctions matched to this parcel (tax deed / foreclosure).
  const auctions: AuctionEvent[] = [];
  const notes: string[] = [];
  try {
    const aRes = await pool.query(
      `SELECT a.* FROM auctions a, (SELECT $1::text state, $2::int co_no, $3::text parcel_id, $4::text county) p
       WHERE ${AUCTION_JOIN} AND a.status = ANY($5)
       ORDER BY a.sale_date ASC NULLS LAST`,
      [state, coNo, parcelId, p.county ?? null, ACTIVE_AUCTION_STATUSES],
    );
    for (const a of aRes.rows) {
      auctions.push({
        auctionType: str(a.auction_type),
        status: str(a.status),
        saleDate: isoDate(a.sale_date),
        saleTime: str(a.sale_time),
        closeDate: isoDate(a.close_date),
        openingBid: num(a.opening_bid),
        currentBid: num(a.current_bid),
        judgmentAmount: num(a.judgment_amount),
        caseNo: str(a.case_no),
        certNo: str(a.cert_no),
        county: str(a.county),
        detailUrl: str(a.detail_url),
      });
    }
    if (auctions.length > 0) {
      const first = auctions[0];
      notes.push(
        `This parcel is matched to an active county ${first.auctionType === "TAXDEED" ? "tax-deed" : "foreclosure"} auction` +
        (first.saleDate ? ` (sale ${first.saleDate})` : " (sale date not yet set)") +
        ". Verify with the county source before acting.",
      );
    }
  } catch {
    // auctions table not synced yet — report without auction data.
  }

  return {
    found: true,
    summary: {
      attomId: parcelKey,
      oneLine: str(p.one_line),
      apn: str(p.parcel_id),
      county: str(p.county),
      owner: str(p.owner_name),
      ownerMailing: mailing || undefined,
      absenteeOwner: p.absentee === true,
      propType: str(p.use_label),
      lotSizeAcres: num(p.acres),
    },
    tax: {
      taxYear: num(p.asmnt_yr),
      assessedTotal: num(p.jv),
      marketTotal: num(p.jv),
      landValue: num(p.lnd_val),
    },
    deeds,
    auctions,
    notes,
  };
}
