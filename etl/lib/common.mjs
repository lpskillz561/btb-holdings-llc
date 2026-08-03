// Shared schema, column list, and helpers for the multi-state parcel importer.
// Each state adapter produces records keyed by PARCEL_COLUMNS; the importer
// bulk-loads them into a staging table then swaps only that state's rows.

export const PARCEL_COLUMNS = [
  "state", "co_no", "county", "parcel_id", "dor_uc", "use_label", "use_category", "is_land",
  "situs_addr", "situs_city", "situs_zip", "one_line",
  "owner_name", "owner_addr", "owner_city", "owner_state", "owner_zip", "absentee",
  "legal", "jv", "lnd_val", "lnd_sqft", "acres",
  "sale_prc", "sale_yr", "sale_mo", "sale_date", "asmnt_yr",
];

// Column definitions shared by the live and staging tables.
const COLDEF = `
  state        text,
  co_no        int,
  county       text,
  parcel_id    text,
  dor_uc       text,
  use_label    text,
  use_category text,
  is_land      boolean,
  situs_addr   text,
  situs_city   text,
  situs_zip    text,
  one_line     text,
  owner_name   text,
  owner_addr   text,
  owner_city   text,
  owner_state  text,
  owner_zip    text,
  absentee     boolean,
  legal        text,
  jv           numeric,
  lnd_val      numeric,
  lnd_sqft     numeric,
  acres        numeric,
  sale_prc     numeric,
  sale_yr      int,
  sale_mo      text,
  sale_date    date,
  asmnt_yr     int`;

export const LIVE_DDL = `CREATE TABLE IF NOT EXISTS parcels (id bigserial PRIMARY KEY,${COLDEF}\n)`;
export const STAGING_DDL = `CREATE TABLE parcels_staging (${COLDEF}\n)`;

// Permanent indexes on the live `parcels` table (created idempotently).
export const INDEXES = [
  ["state_idx", "(state)"],
  ["zip_idx", "(situs_zip)"],
  ["city_idx", "(lower(situs_city))"],
  ["land_zip_idx", "(situs_zip) WHERE is_land"],
  ["cat_idx", "(use_category)"],
  // Composite indexes use state-prefixed names so they are created fresh even on
  // a pre-multistate table that already has parcels_county_idx / parcels_parcel_idx.
  ["state_county_idx", "(state, co_no)"],
  ["state_parcel_idx", "(state, co_no, parcel_id)"],
  ["owner_idx", "USING gin (owner_name gin_trgm_ops)"],
  // Filter+sort covering indexes for the area search's default order (assessed
  // value, high→low). The trailing "jv DESC NULLS LAST" matches the query's
  // ORDER BY exactly, so the top-of-page rows come straight off the index
  // instead of sorting the whole state/ZIP/city subset. The consumer is
  // src/lib/parcels.ts in the btb-holdings-llc repo, which is a SEPARATE repo:
  // these column names are its API, so renaming one is a breaking change over
  // there and needs a search in that tree first.
  ["state_jv_idx", "(state, jv DESC NULLS LAST)"],
  ["zip_jv_idx", "(situs_zip, jv DESC NULLS LAST)"],
  ["city_jv_idx", "(lower(situs_city), jv DESC NULLS LAST)"],
  // Same idea for the lot-size (acreage) filter + sort, which the land search
  // leans on. Matches "WHERE state|zip|city … ORDER BY acres DESC NULLS LAST".
  ["state_acres_idx", "(state, acres DESC NULLS LAST)"],
  ["zip_acres_idx", "(situs_zip, acres DESC NULLS LAST)"],
  ["city_acres_idx", "(lower(situs_city), acres DESC NULLS LAST)"],
  // County BY NAME. `state_county_idx` above is (state, co_no) — the numeric
  // assessor code — which is no use to a search for "Volusia". Without these the
  // area search's county match is a sequential scan of 12M rows. The land search
  // ranks counties and then lists parcels inside one, so this is its hot path,
  // and the acres variant matches its "largest first" ORDER BY exactly.
  ["county_name_idx", "(lower(county))"],
  ["county_name_acres_idx", "(lower(county), acres DESC NULLS LAST)"],
  ["state_county_name_idx", "(state, lower(county))"],
];

/** CSV-escape one value for COPY ... WITH (FORMAT csv). Null -> empty. */
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
