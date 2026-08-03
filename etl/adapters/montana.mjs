// Montana adapter — MSDI statewide cadastral parcels (all 56 counties), run by
// the Montana State Library. Owner/value attributes are integrated from the DOR
// ORION/CAMA appraisal database. Public ArcGIS *MapServer* (queryable exactly
// like a FeatureServer); we paginate it (no geometry) and yield common parcel
// records.
//
// Quirks handled here:
//   • Situs city/zip live only inside a combined `CityStateZip` string — parsed.
//   • `COUNTYCD` is Montana DOR's sequential 1–56 county number, NOT a FIPS
//     code. We store it as co_no (same DOR-county-number semantics as FL's
//     co_no); the (state, co_no, parcel_id) key stays unique per state.
//   • Some parcels are geometry-only (water, ROW, unmatched to DOR) with null
//     owner/value/PropType — skipped.

import { fetchJson } from "../lib/http.mjs";

// The Montana State Library moved this, and the old host is now NXDOMAIN:
// `gisservicemt.gov/arcgis/rest/services/MSDI_Framework/Parcels/MapServer/0` no
// longer resolves anywhere. The service is `msdi_cadastral_map_v1` at the root
// of `gisservice.mt.gov` (note the dot), and parcels are LAYER 1 — layer 0 is
// conservation easements and layer 2 is public lands, so an unchecked port of
// the old path would have imported the wrong thing rather than failed.
// Verified: layer is "Montana Parcels", maxRecordCount 2000, and all 17 fields
// in OUT_FIELDS below are present.
const MT_BASE =
  "https://gisservice.mt.gov/arcgis/rest/services/msdi_cadastral_map_v1/MapServer/1";
const PAGE = 2000; // server maxRecordCount
const OUT_FIELDS =
  "PARCELID,OwnerName,OwnerAddress1,OwnerAddress2,OwnerCity,OwnerState,OwnerZipCode,AddressLine1,CityStateZip,TotalValue,TotalLandValue,TotalBuildingValue,TotalAcres,PropType,TaxYear,CountyName,COUNTYCD";

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

/** Parse "LIBBY MT 59923" → { city, state, zip }. Best-effort; nulls if unparseable. */
function parseCityStateZip(v) {
  const t = s(v);
  if (!t) return { city: null, state: null, zip: null };
  const m = t.match(/^(.*?)[\s,]+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/);
  if (m) return { city: titleish(m[1]), state: m[2].toUpperCase(), zip: m[3] };
  return { city: titleish(t), state: null, zip: null };
}

/**
 * PropType is a single free-text field. "Vacant Land" and the agricultural /
 * resource types are land; anything starting "Improved" is improved.
 */
const VAC_RE =
  /vacant|unimprov|\bag\b|agri|farm|ranch|graz|timber|forest|wooded|acreage|open\s*space|pasture|mining|\brural\b/i;

function classify(propType) {
  const desc = s(propType);
  if (!desc) return { land: false, label: null };
  if (/^improved/i.test(desc)) return { land: false, label: desc };
  const land = VAC_RE.test(desc);
  return { land, label: desc };
}

function mapFeature(a) {
  const parcelId = s(a.PARCELID);
  if (!parcelId) return null;
  const ownerName = titleish(a.OwnerName);
  const { land, label } = classify(a.PropType);
  const value = num(a.TotalValue);
  const situsAddr = titleish(a.AddressLine1);
  // Skip geometry-only noise parcels (no owner, no value, no situs address).
  if (!ownerName && value === null && !situsAddr) return null;

  const situs = parseCityStateZip(a.CityStateZip);
  const ownerCity = titleish(a.OwnerCity);
  const ownerState = s(a.OwnerState);
  const acres = num(a.TotalAcres);
  const absentee =
    (ownerState !== null && ownerState.toUpperCase() !== "MT") ||
    (ownerCity !== null && situs.city !== null && ownerCity.toUpperCase() !== situs.city.toUpperCase());
  const oneLine = situsAddr
    ? `${situsAddr}, ${situs.city ?? ""} MT`.replace(/\s+/g, " ").trim()
    : `${situs.city ? situs.city + " " : ""}MT (Parcel ${parcelId})`.trim();

  return {
    state: "MT",
    co_no: num(a.COUNTYCD), // MT DOR county number 1–56 (not FIPS)
    county: titleish(a.CountyName),
    parcel_id: parcelId,
    dor_uc: null, // PropType is free text, not a coded domain
    use_label: label || (land ? "Vacant Land" : "Improved"),
    use_category: land ? "land" : "improved",
    is_land: land,
    situs_addr: situsAddr,
    situs_city: situs.city,
    situs_zip: situs.zip,
    one_line: oneLine,
    owner_name: ownerName,
    owner_addr: titleish([a.OwnerAddress1, a.OwnerAddress2].filter(Boolean).join(" ")),
    owner_city: ownerCity,
    owner_state: ownerState,
    owner_zip: s(a.OwnerZipCode),
    absentee,
    legal: null,
    jv: value,
    lnd_val: num(a.TotalLandValue),
    lnd_sqft: acres ? Math.round(acres * 43560) : null,
    acres,
    sale_prc: null,
    sale_yr: null,
    sale_mo: null,
    sale_date: null,
    asmnt_yr: num(a.TaxYear),
  };
}

export const state = "MT";

/**
 * Async generator yielding MT parcel records.
 *
 * `signal` comes from the stall watchdog in import.mjs. Without it this loop
 * could sit inside one `fetch` indefinitely — which it did, for two hours,
 * holding an open COPY on the other end.
 */
export async function* parcels({ onlyCounties = [], maxRecords = 0, signal } = {}) {
  let where = "1=1";
  if (onlyCounties.length) {
    const list = onlyCounties.map((c) => `'${c.toUpperCase().replace(/'/g, "''")}'`).join(",");
    where = `UPPER(CountyName) IN (${list})`;
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
    const data = await fetchJson(`${MT_BASE}/query?${qs.toString()}`, {
      label: `MT parcels @${offset}`,
      signal,
    });
    if (data.error) throw new Error(`MT query error: ${JSON.stringify(data.error)}`);
    const feats = data.features || [];
    for (const ft of feats) {
      const p = mapFeature(ft.attributes);
      if (p) {
        yield p;
        yielded++;
        if (maxRecords && yielded >= maxRecords) return;
      }
    }
    if (!data.exceededTransferLimit && feats.length < PAGE) break;
    if (feats.length === 0) break;
    offset += PAGE;
  }
}
