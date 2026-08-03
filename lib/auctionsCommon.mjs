// Shared schema + helpers for the auction sync (tax deed / foreclosure sales).
// Mirrors lib/common.mjs: adapters yield records keyed by AUCTION_COLUMNS; the
// sync bulk-loads them into a staging table then swaps that state's rows into
// the live `auctions` table.

export const AUCTION_COLUMNS = [
  "state", "county", "co_no", "source", "auction_type", "status", "status_detail",
  "property_type", "case_no", "cert_no", "source_item_id",
  "sale_date", "sale_time", "close_date",
  "opening_bid", "current_bid", "judgment_amount", "assessed_value",
  "parcel_id_raw", "parcel_id_norm",
  "situs_addr", "situs_city", "situs_zip",
  "detail_url", "fetched_at",
];

// auction_type: TAXDEED | FORECLOSURE (FL judicial) | TAX_FORECLOSURE (NC GS 105)
// status:       pre-sale (filed, sale not yet scheduled) | upcoming |
//               upset-period (NC 10-day window) | closed | unknown
const COLDEF = `
  state          text,
  county         text,
  co_no          int,
  source         text,
  auction_type   text,
  status         text,
  status_detail  text,
  property_type  text,
  case_no        text,
  cert_no        text,
  source_item_id text,
  sale_date      date,
  sale_time      text,
  close_date     date,
  opening_bid    numeric,
  current_bid    numeric,
  judgment_amount numeric,
  assessed_value numeric,
  parcel_id_raw  text,
  parcel_id_norm text,
  situs_addr     text,
  situs_city     text,
  situs_zip      text,
  detail_url     text,
  fetched_at     timestamptz`;

export const AUCTIONS_LIVE_DDL = `CREATE TABLE IF NOT EXISTS auctions (id bigserial PRIMARY KEY,${COLDEF}\n)`;
export const AUCTIONS_STAGING_DDL = `CREATE TABLE auctions_staging (${COLDEF}\n)`;

export const AUCTION_INDEXES = [
  ["state_idx", "(state)"],
  ["sale_date_idx", "(sale_date)"],
  ["pid_norm_idx", "(state, parcel_id_norm)"],
  ["type_idx", "(auction_type)"],
];

// Expression index on `parcels` so the web app can join auctions by normalized
// parcel id (auction sites and assessment rolls format parcel numbers
// differently — dashes, dots, spaces).
export const PARCELS_NORM_INDEX =
  "CREATE INDEX IF NOT EXISTS parcels_pid_norm_idx ON parcels " +
  "(state, upper(regexp_replace(parcel_id, '[^A-Za-z0-9]', '', 'g')))";

/** Normalize a parcel number for cross-source joins: uppercase alnum only. */
export function normalizeParcelId(raw) {
  if (raw === null || raw === undefined) return null;
  const norm = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return norm || null;
}

/** "$2,562.48" -> 2562.48 (null when unparseable/blank). */
export function money(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "07/15/2026" or "7/15/2026" -> "2026-07-15" (null when unparseable). */
export function usDateToIso(v) {
  const m = String(v ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
