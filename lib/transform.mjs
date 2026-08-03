// Transform one FDOR NAL CSV row (object keyed by column name) into the parcel
// record we store. Pure function — unit-testable against a real county CSV
// without any database.

import { classifyUseCode } from "./useCodes.mjs";
import { canonicalCountyName } from "./fdor.mjs";

const SQFT_PER_ACRE = 43560;

function s(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
function n(v) {
  const t = s(v);
  if (t === null) return null;
  const num = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(num) ? num : null;
}
function titleish(v) {
  const t = s(v);
  return t ? t.replace(/\s+/g, " ") : null;
}

// Counties are inconsistent: some store OWN_STATE as "FL", others as "Florida"
// or "FLA". Normalize to a 2-letter USPS code so absentee detection and display
// are correct. Unknown values pass through uppercased.
const STATE_ABBR = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL", FLA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL",
  INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA",
  MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN",
  MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK",
  OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY",
};
function normalizeState(v) {
  const t = s(v);
  if (t === null) return null;
  const up = t.toUpperCase();
  return STATE_ABBR[up] || up;
}

/** Two-digit month string ("01".."12") from SALE_MO, else null. */
function saleDate(yr, mo) {
  const y = n(yr);
  const m = s(mo);
  if (!y || y < 1900 || y > 2100) return null;
  const mm = m && /^\d{1,2}$/.test(m) ? String(Math.min(12, Math.max(1, parseInt(m, 10)))).padStart(2, "0") : "01";
  return `${y}-${mm}-01`;
}

/**
 * @param {Record<string,string>} row  one NAL CSV row
 * @param {string} [countyName]        display name from the file (fallback if row lacks it)
 * @returns parcel record or null if it has no usable parcel id
 */
export function nalRowToParcel(row, countyName) {
  const parcelId = s(row.PARCEL_ID);
  if (!parcelId) return null;

  const use = classifyUseCode(row.DOR_UC);

  const situsAddr = titleish(row.PHY_ADDR1);
  const situsCity = titleish(row.PHY_CITY);
  const situsZipRaw = s(row.PHY_ZIPCD);
  const situsZip = situsZipRaw ? situsZipRaw.slice(0, 5) : null;

  const ownerName = titleish(row.OWN_NAME);
  const ownerCity = titleish(row.OWN_CITY);
  const ownerState = normalizeState(row.OWN_STATE);
  const ownerZip = s(row.OWN_ZIPCD);
  const ownerAddr = titleish(row.OWN_ADDR1);

  // Absentee: owner mails out of FL, or to a different city than the parcel sits in.
  const absentee =
    (ownerState !== null && ownerState !== "FL") ||
    (ownerCity !== null && situsCity !== null && ownerCity.toUpperCase() !== situsCity.toUpperCase());

  const lndSqft = n(row.LND_SQFOOT);
  const acres = lndSqft ? Math.round((lndSqft / SQFT_PER_ACRE) * 100) / 100 : null;

  // Display line. Vacant land often has no situs street address, so fall back to
  // city + parcel id (the Zillow link / detail lookup handle the null case).
  const oneLine = situsAddr
    ? `${situsAddr}, ${situsCity ?? ""} FL ${situsZip ?? ""}`.replace(/\s+/g, " ").trim()
    : `${situsCity ? situsCity + " " : ""}FL (Parcel ${parcelId})`.trim();

  return {
    state: "FL",
    co_no: n(row.CO_NO),
    county: canonicalCountyName(countyName || ""),
    parcel_id: parcelId,
    dor_uc: s(row.DOR_UC),
    use_label: use.label,
    use_category: use.category,
    is_land: use.land,
    situs_addr: situsAddr,
    situs_city: situsCity,
    situs_zip: situsZip,
    one_line: oneLine,
    owner_name: ownerName,
    owner_addr: ownerAddr,
    owner_city: ownerCity,
    owner_state: ownerState,
    owner_zip: ownerZip,
    absentee,
    legal: titleish(row.S_LEGAL),
    jv: n(row.JV),
    lnd_val: n(row.LND_VAL),
    lnd_sqft: lndSqft,
    acres,
    sale_prc: n(row.SALE_PRC1),
    sale_yr: n(row.SALE_YR1),
    sale_mo: s(row.SALE_MO1),
    sale_date: saleDate(row.SALE_YR1, row.SALE_MO1),
    asmnt_yr: n(row.ASMNT_YR),
  };
}
