// North Carolina adapter — NC OneMap statewide parcels (all 100 counties,
// standardized). Public ArcGIS FeatureServer; we paginate it (no geometry) and
// yield common parcel records. Note: the source has no situs ZIP, so NC parcels
// are searchable by city, not ZIP.

import { fetchJson } from "../lib/http.mjs";

const NC_BASE =
  "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/0";
const PAGE = 5000;
const OUT_FIELDS =
  "parno,ownname,mailadd,mcity,mstate,mzip,siteadd,scity,parval,landval,gisacres,struct,parusecode,parusedesc,cntyname,cntyfips";

// Vacant / unimproved / agricultural use descriptions (NC use strings vary by county).
const VAC_RE = /vac|unimprov|\bag\b|agri|farm|timber|forest|wooded|acreage|open\s*space|pasture/i;

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

/** Land = no structure on the parcel, or a vacant/agricultural use description. */
function classify(parusedesc, struct) {
  const desc = s(parusedesc);
  const hasStruct = (s(struct) ?? "").toUpperCase() === "Y";
  const vac = desc ? VAC_RE.test(desc) : false;
  return { land: !hasStruct || vac, label: desc || (hasStruct ? "Improved" : "Vacant") };
}

function mapFeature(a) {
  const parcelId = s(a.parno);
  if (!parcelId) return null;
  const { land, label } = classify(a.parusedesc, a.struct);
  const situsAddr = titleish(a.siteadd);
  const situsCity = titleish(a.scity);
  const ownerCity = titleish(a.mcity);
  const ownerState = s(a.mstate);
  const acres = num(a.gisacres);
  const absentee =
    (ownerState !== null && ownerState.toUpperCase() !== "NC") ||
    (ownerCity !== null && situsCity !== null && ownerCity.toUpperCase() !== situsCity.toUpperCase());
  const oneLine = situsAddr
    ? `${situsAddr}, ${situsCity ?? ""} NC`.replace(/\s+/g, " ").trim()
    : `${situsCity ? situsCity + " " : ""}NC (Parcel ${parcelId})`.trim();

  return {
    state: "NC",
    co_no: num(a.cntyfips),
    county: titleish(a.cntyname),
    parcel_id: parcelId,
    dor_uc: s(a.parusecode),
    use_label: label,
    use_category: land ? "land" : "improved",
    is_land: land,
    situs_addr: situsAddr,
    situs_city: situsCity,
    situs_zip: null,
    one_line: oneLine,
    owner_name: titleish(a.ownname),
    owner_addr: titleish(a.mailadd),
    owner_city: ownerCity,
    owner_state: ownerState,
    owner_zip: s(a.mzip),
    absentee,
    legal: null,
    jv: num(a.parval),
    lnd_val: num(a.landval),
    lnd_sqft: acres ? Math.round(acres * 43560) : null,
    acres,
    sale_prc: null,
    sale_yr: null,
    sale_mo: null,
    sale_date: null,
    asmnt_yr: null,
  };
}

export const state = "NC";

/** Async generator yielding NC parcel records. */
export async function* parcels({ onlyCounties = [], maxRecords = 0, signal } = {}) {
  let where = "1=1";
  if (onlyCounties.length) {
    const list = onlyCounties.map((c) => `'${c.toUpperCase().replace(/'/g, "''")}'`).join(",");
    where = `UPPER(cntyname) IN (${list})`;
  }
  let offset = 0;
  let yielded = 0;
  for (;;) {
    const qs = new URLSearchParams({
      where,
      outFields: OUT_FIELDS,
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      returnGeometry: "false",
      f: "json",
    });
    const data = await fetchJson(`${NC_BASE}/query?${qs.toString()}`, {
      label: `NC parcels @${offset}`,
      signal,
    });
    if (data.error) throw new Error(`NC query error: ${JSON.stringify(data.error)}`);
    const feats = data.features || [];
    for (const ft of feats) {
      const p = mapFeature(ft.attributes);
      if (p) {
        yield p;
        yielded++;
        if (maxRecords && yielded >= maxRecords) return;
      }
    }
    if (feats.length < PAGE) break; // last page
    offset += PAGE;
  }
}
