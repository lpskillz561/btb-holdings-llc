// Colorado adapter — statewide public parcels aggregated by the Colorado
// Governor's Office of Information Technology (OIT) via the annual county data
// call. Public ArcGIS FeatureServer; we paginate it (no geometry) and yield
// common parcel records.
//
// Coverage caveat: the composite currently carries ~44 of Colorado's 64
// counties (all populous Front Range counties are present; ~20 small/rural
// counties — incl. Montrose, Delta, Fremont — are absent). See README.
//
// Licensing caveat: the service's copyrightText states "Resale of this data is
// strictly forbidden." Internal research/analytics use is fine; redistributing
// or reselling the raw dataset is not. Attribution: State of Colorado / OIT.
//
// Source fields are all strings for money/value (cast on ingest); there is no
// discrete land-value field, and county code is the 3-digit county FIPS only
// (state 08 dropped, not zero-padded).

import { fetchJson } from "../lib/http.mjs";

const CO_BASE =
  "https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0";
const PAGE = 2000; // server maxRecordCount
const OUT_FIELDS =
  "parcel_id,owner,ownerAdd,ownAddCty,ownAddStt,ownAddZip,situsAdd,sitAddCty,sitAddZip,apprValTot,landAcres,landSqft,landUseCde,landUseDsc,saleDate,salePrice,countyName,countyFips";

// Vacant / unimproved / agricultural use descriptions (CO use strings vary by county).
const VAC_RE =
  /vac|unimprov|\bag\b|agri|farm|ranch|graz|timber|forest|wooded|acreage|meadow|open\s*space|pasture|mining|natural\s*resource/i;

function s(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
function num(v) {
  const t = s(v);
  if (t === null) return null;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function titleish(v) {
  const t = s(v);
  return t ? t.replace(/\s+/g, " ") : null;
}

/**
 * Land = a vacant/agricultural use description, or a class code in the vacant
 * (0xxx) / agricultural (5xxx) / natural-resources (6xxx) abstract ranges.
 * Colorado assessor abstract codes: 0=vacant, 1=residential, 2=commercial,
 * 4=industrial, 5=agricultural, 6=natural resources, 9=exempt.
 */
function classify(landUseDsc, landUseCde) {
  const desc = s(landUseDsc);
  const code = s(landUseCde);
  const vacByDesc = desc ? VAC_RE.test(desc) : false;
  const vacByCode = code ? /^[056]/.test(code) : false;
  const land = vacByDesc || vacByCode;
  return { land, label: desc || (land ? "Vacant/Land" : "Improved") };
}

function mapFeature(a) {
  const parcelId = s(a.parcel_id);
  if (!parcelId) return null;
  const { land, label } = classify(a.landUseDsc, a.landUseCde);
  const situsAddr = titleish(a.situsAdd);
  const situsCity = titleish(a.sitAddCty);
  const situsZip = s(a.sitAddZip);
  const ownerCity = titleish(a.ownAddCty);
  const ownerState = s(a.ownAddStt);
  const acres = num(a.landAcres);
  const sqft = num(a.landSqft);
  const absentee =
    (ownerState !== null && ownerState.toUpperCase() !== "CO") ||
    (ownerCity !== null && situsCity !== null && ownerCity.toUpperCase() !== situsCity.toUpperCase());
  const oneLine = situsAddr
    ? `${situsAddr}, ${situsCity ?? ""} CO`.replace(/\s+/g, " ").trim()
    : `${situsCity ? situsCity + " " : ""}CO (Parcel ${parcelId})`.trim();

  return {
    state: "CO",
    // countyFips is the 3-digit county FIPS only (unpadded); num() drops any
    // leading zero, which is fine for an integer county key.
    co_no: num(a.countyFips),
    county: titleish(a.countyName),
    parcel_id: parcelId,
    dor_uc: s(a.landUseCde),
    use_label: label,
    use_category: land ? "land" : "improved",
    is_land: land,
    situs_addr: situsAddr,
    situs_city: situsCity,
    situs_zip: situsZip,
    one_line: oneLine,
    owner_name: titleish(a.owner),
    owner_addr: titleish(a.ownerAdd),
    owner_city: ownerCity,
    owner_state: ownerState,
    owner_zip: s(a.ownAddZip),
    absentee,
    legal: null,
    jv: num(a.apprValTot), // total appraised value (string in source)
    lnd_val: null, // CO composite carries no discrete land value
    lnd_sqft: sqft ?? (acres ? Math.round(acres * 43560) : null),
    acres,
    sale_prc: num(a.salePrice),
    sale_yr: null,
    sale_mo: null,
    sale_date: null,
    asmnt_yr: null,
  };
}

export const state = "CO";

/** Async generator yielding CO parcel records. */
export async function* parcels({ onlyCounties = [], maxRecords = 0, signal } = {}) {
  let where = "1=1";
  if (onlyCounties.length) {
    const list = onlyCounties.map((c) => `'${c.toUpperCase().replace(/'/g, "''")}'`).join(",");
    where = `UPPER(countyName) IN (${list})`;
  }
  let offset = 0;
  let yielded = 0;
  for (;;) {
    const qs = new URLSearchParams({
      where,
      outFields: OUT_FIELDS,
      // A stable sort keeps resultOffset paging consistent across requests.
      orderByFields: "OBJECTID",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      returnGeometry: "false",
      f: "json",
    });
    const data = await fetchJson(`${CO_BASE}/query?${qs.toString()}`, {
      label: `CO parcels @${offset}`,
      signal,
    });
    if (data.error) throw new Error(`CO query error: ${JSON.stringify(data.error)}`);
    const feats = data.features || [];
    for (const ft of feats) {
      const p = mapFeature(ft.attributes);
      if (p) {
        yield p;
        yielded++;
        if (maxRecords && yielded >= maxRecords) return;
      }
    }
    // Prefer the server's own "more rows remain" flag; fall back to page size.
    if (!data.exceededTransferLimit && feats.length < PAGE) break;
    if (feats.length === 0) break;
    offset += PAGE;
  }
}
