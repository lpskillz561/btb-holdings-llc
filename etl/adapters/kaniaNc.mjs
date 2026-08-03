// North Carolina auction adapter — The Kania Law Firm's tax-foreclosure
// listings (kanialawfirm.com). Kania runs tax foreclosures for ~28 NC counties
// and publishes one statewide Ninja Tables dataset; the table's public AJAX
// endpoint returns clean JSON for every county in one call.
//
// The canonical /tax-foreclosures/foreclosure-listings/ page carries the LIVE
// pipeline table (filed cases with "Sale date not yet set", scheduled sales,
// and upset-bid windows). Per-county pages carry an older archived table with
// a different schema — don't scrape those.
//
// NC context: these are judicial / in-rem tax foreclosure sales (GS 105-374 /
// 105-375) followed by a 10-day upset-bid period (GS 1-339.25) that restarts
// with each upset bid — `currentbid` + `closedate` track that window, so the
// nightly sync keeps rows fresh until they actually close.

import { normalizeParcelId, money, usDateToIso, sleep } from "../lib/auctionsCommon.mjs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const LISTING_PAGE = "https://kanialawfirm.com/tax-foreclosures/foreclosure-listings/";

async function getText(url, referer) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...(referer ? { Referer: referer } : {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Scrape table_id + ninja_table_public_nonce from the listing page. */
async function discoverTable() {
  const html = await getText(LISTING_PAGE);
  const m = html.match(
    /admin-ajax\.php\?action=wp_ajax_ninja_tables_public_action&table_id=(\d+)&[^"']*ninja_table_public_nonce=([a-f0-9]+)/,
  );
  if (!m) throw new Error("Kania listing page: could not find Ninja Tables id/nonce (page layout changed?)");
  return { tableId: m[1], nonce: m[2] };
}

const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/**
 * address: "(0000041) NC 90 HWY E, Stony Point<br />7384 NC HWY 90 E, Stony Point"
 * — one line per parcel in the sale; each may carry a "(parcel)" prefix and a
 * trailing ", City". Use the first line for street/city.
 */
function parseAddress(html) {
  const first = strip(String(html ?? "").split(/<br\s*\/?>/i)[0] ?? "").replace(/^\([^)]*\)\s*/, "");
  if (!first) return { street: null, city: null };
  const comma = first.lastIndexOf(",");
  if (comma < 0) return { street: first, city: null };
  return {
    street: first.slice(0, comma).trim() || null,
    city: first.slice(comma + 1).trim() || null,
  };
}

/** saledatetime: "6/29/2026 11:00:00 AM" or "<span class='red'>Sale date not yet set</span>". */
function parseSaleDateTime(html) {
  const text = strip(html);
  const date = usDateToIso(text);
  if (!date) return { date: null, time: null, note: text || null };
  const time = text.match(/\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M/i)?.[0]?.replace(/:\d{2}\s/, " ") ?? null;
  return { date, time, note: null };
}

function deriveStatus(saleDate, closeDate, statusText, todayIso) {
  if (statusText && /closed|sold|funds/i.test(statusText)) return "closed";
  if (saleDate && saleDate >= todayIso) return "upcoming";
  if (closeDate && closeDate >= todayIso) return "upset-period"; // sale held, upset window open
  if (!saleDate) return "pre-sale"; // case filed, sale not yet scheduled
  if (closeDate && closeDate < todayIso) return "closed";
  return "unknown";
}

/** Async generator yielding NC tax-foreclosure records (all Kania counties). */
export async function* auctions({ onlyCounties = [], maxRecords = 0, log = console.log } = {}) {
  const { tableId, nonce } = await discoverTable();
  await sleep(500);
  const url =
    `https://kanialawfirm.com/wp-admin/admin-ajax.php?action=wp_ajax_ninja_tables_public_action` +
    `&table_id=${tableId}&target_action=get-all-data&default_sorting=old_first` +
    `&skip_rows=0&limit_rows=0&ninja_table_public_nonce=${nonce}`;
  const rows = JSON.parse(await getText(url, LISTING_PAGE));
  if (!Array.isArray(rows)) throw new Error("Kania AJAX endpoint did not return a row array");
  log(`  kanialawfirm.com: ${rows.length} active listing rows (table ${tableId})`);

  const wanted = onlyCounties.map((c) => c.trim().toLowerCase());
  const fetchedAt = new Date().toISOString();
  const todayIso = fetchedAt.slice(0, 10);
  let yielded = 0;

  for (const row of rows) {
    const v = row?.value ?? row;
    const county = strip(v.county);
    if (!county) continue;
    if (wanted.length && !wanted.includes(county.toLowerCase())) continue;

    const { street, city } = parseAddress(v.address);
    // Multi-parcel sales list one parcel per line; match on the first.
    const parcels = String(v.parcel ?? "").split(/<br\s*\/?>/i).map(strip).filter(Boolean);
    const { date: saleDate, time, note } = parseSaleDateTime(v.saledatetime);
    const closeDate = usDateToIso(strip(v.closedate));
    const statusText = strip(v.salestatus) || null;

    yield {
      state: "NC",
      county,
      co_no: null, // joined to parcels by normalized parcel id + county name
      source: "kania",
      auction_type: "TAX_FORECLOSURE",
      status: deriveStatus(saleDate, closeDate, statusText, todayIso),
      status_detail: statusText ?? note,
      property_type: strip(v.propertytype) || null,
      case_no: strip(v.courtfile) || null,
      cert_no: null,
      source_item_id: strip(v.ourfile) || null,
      sale_date: saleDate,
      sale_time: time,
      close_date: closeDate,
      opening_bid: money(strip(v.openingbid)),
      current_bid: money(strip(v.currentbid)),
      judgment_amount: null,
      assessed_value: null,
      parcel_id_raw: parcels.join("; ") || null,
      parcel_id_norm: normalizeParcelId(parcels[0]),
      situs_addr: street,
      situs_city: city,
      situs_zip: null,
      detail_url: LISTING_PAGE,
      fetched_at: fetchedAt,
    };
    if (maxRecords && ++yielded >= maxRecords) return;
  }
}
