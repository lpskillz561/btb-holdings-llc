// Zoning for Orange County, Florida.
//
// One ArcGIS layer carries the zoning of the county AND of every municipality
// inside it, because the codes are jurisdiction-prefixed: `ORG-A-1` is
// unincorporated Orange, `WG-C-2` is Winter Garden, `BAY-E` is Bay Lake. That
// is why this is a county adapter and not a county-plus-seven-cities problem -
// the split that makes zoning hard elsewhere does not exist here.
//
// It reads the PARCEL layer, not the zoning-polygon layer, because that layer
// already carries `ZONING_CODE` keyed by parcel number. No spatial join, no
// PostGIS, no polygon download.
//
// **It is driven by OUR parcels, not by the county's.** Measured: this service
// answers in 10-20 seconds whatever you ask it, at any offset, so crawling all
// 496,798 county records at 200 per page is ~2,500 requests and about thirteen
// hours. Asking only for the parcels we actually hold and care about is the
// same data in minutes. It also means we never store zoning for a parcel that
// is not in our roll, which we could not join to anything anyway.
//
// What it CANNOT tell you is whether a use is permitted. There is no RV
// district in Orange County: of 65 district codes none names RVs, and the
// established RV parks sit in agricultural and commercial districts -
// Christmas RV Park is `ORG-A-2`, Lost Lake RV Park is `ORG-A-1`, Winter Garden
// RV Park is `WG-C-2`. Zoning narrows a search. A written determination is
// still what answers the question.

import { fetchJson } from "../lib/http.mjs";
import { addressesAgree, swapParcelId } from "../lib/zoning.mjs";

const SERVICE =
  "https://ocgis4.ocfl.net/arcgis/rest/services/AGOL_Open_Data/MapServer/56/query";

/**
 * Parcels per request.
 *
 * The query goes as a POST body, so this is not bounded by URL length - a GET
 * starts returning **403** somewhere between 80 and 120 ids, because the query
 * string passes IIS's 2,048-byte limit and the filter in front of this service
 * rejects it before ArcGIS ever sees it. Measured: GET is fine at 80 and 403s
 * at 120; POST is fine at 500. 200 leaves room and matches the service's own
 * page size, so a batch never needs paginating.
 */
const BATCH = 200;

export const ORANGE_FL = {
  state: "FL",
  county: "Orange",
  source: "ocfl-agol-parcels-56",
};

/**
 * Fetch zoning for one batch of OUR parcels.
 *
 * `rows` are `{ parcel_id, co_no, situs_addr }` from our own table. Their ids
 * are swapped into the county's encoding to ask, and the answer is matched back
 * by the same swap - which is its own inverse.
 */
async function fetchBatch(rows) {
  const bySwapped = new Map();
  for (const r of rows) {
    const swapped = swapParcelId(r.parcel_id);
    if (swapped) bySwapped.set(swapped, r);
  }
  if (bySwapped.size === 0) return { features: [], bySwapped };

  const ids = [...bySwapped.keys()].map((id) => `'${id}'`).join(",");
  // NOTE the WAF. `PARCEL IN (...)` is accepted, but `ZONING_CODE <> ''` and
  // `PARCEL > 'x'` both get a 403 from the IIS filter in front of this service
  // - not an ArcGIS error, an HTML "You do not have permission to view this
  // directory or page". Isolated by bisecting the query. So: no empty-string
  // comparison and no keyset pagination. Blank codes are dropped in code.
  const sp = new URLSearchParams({
    where: `PARCEL IN (${ids})`,
    outFields: "PARCEL,ZONING_CODE,SITUS,NAME1",
    returnGeometry: "false",
    f: "json",
  });
  // POST, not GET. See BATCH: a long `IN (...)` in a query string trips the
  // 2,048-byte limit and comes back 403 from the WAF rather than from ArcGIS.
  const body = await fetchJson(SERVICE, {
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: sp.toString(),
    },
    label: `${SERVICE} (${bySwapped.size} parcels)`,
  });
  if (body?.error) {
    throw new Error(`Orange County zoning service: ${body.error.message ?? "unknown error"}`);
  }
  return { features: body?.features ?? [], bySwapped };
}

/**
 * Yield zoning rows for the parcels handed in.
 *
 * Every row is address-checked before it is emitted. The two encodings share an
 * id space - `312428000000005` is a real parcel in BOTH datasets and a
 * different one in each - so an unchecked swap does not merely miss, it
 * attaches a neighbouring parcel's zoning to a million-dollar land decision.
 * See `swapParcelId`.
 */
export async function* orangeZoningRows({ parcels, log = () => {} } = {}) {
  const stats = { asked: 0, answered: 0, noZoning: 0, addressMismatch: 0, emitted: 0 };

  for (let i = 0; i < parcels.length; i += BATCH) {
    const chunk = parcels.slice(i, i + BATCH);
    stats.asked += chunk.length;
    const { features, bySwapped } = await fetchBatch(chunk);
    stats.answered += features.length;

    // A parcel with several polygons is several rows in the county layer and
    // one parcel here, so the same PARCEL can come back more than once per
    // batch. Emitting it twice is harmless downstream (writeZoning dedupes) but
    // would double-count `emitted` and make the stats lie.
    const seen = new Set();

    for (const f of features) {
      const a = f.attributes ?? {};
      const ours = bySwapped.get(String(a.PARCEL));
      if (!ours) continue;
      if (seen.has(ours.parcel_id)) continue;
      seen.add(ours.parcel_id);
      if (!addressesAgree(ours.situs_addr, a.SITUS, ours.owner_name, a.NAME1)) {
        stats.addressMismatch++;
        continue;
      }
      const code = String(a.ZONING_CODE ?? "").trim();
      if (!code) {
        stats.noZoning++;
        continue;
      }
      stats.emitted++;
      yield {
        state: ORANGE_FL.state,
        co_no: ours.co_no,
        parcel_id: ours.parcel_id,
        zoning_code: code,
        // The prefix before the first dash is the jurisdiction whose rulebook
        // applies. `ORG` is unincorporated Orange; anything else is a city.
        jurisdiction: code.includes("-") ? code.slice(0, code.indexOf("-")) : null,
        source: ORANGE_FL.source,
        source_key: String(a.PARCEL),
      };
    }
    log(`  …${Math.min(i + BATCH, parcels.length).toLocaleString()}/${parcels.length.toLocaleString()} parcels`);
  }
  return stats;
}
