// Florida auction adapter — RealAuction county sites (<county>.realtaxdeed.com
// for tax deed sales, <county>.realforeclose.com for foreclosure auctions).
//
// The platform is a ColdFusion app; everything routes through /index.cfm:
//   1. Calendar:  ?zaction=USER&zmethod=CALENDAR&selCalDate=MM/DD/YYYY
//      → HTML with <div ... dayid='MM/DD/YYYY'> cells; cells with a CALTEXT
//        span ("Tax Deed" / "Foreclosure") are sale days.
//   2. Preview:   ?zaction=AUCTION&Zmethod=PREVIEW&AUCTIONDATE=MM/DD/YYYY
//      → sets the auction date in the CF session (cookie).
//   3. Items:     ?zaction=AUCTION&Zmethod=UPDATE&FNC=LOAD&AREA=W&PageDir=…
//      → JSON {retHTML, rlist}; retHTML is token-compressed HTML (see TOKENS,
//        lifted from the site's /CORE/System/JS/auction.js LoadNewArea()).
//        AREA=W is the waiting/upcoming list; PageDir=1 advances the session's
//        page cursor, so pages MUST be fetched sequentially per site.
//
// Browsing is public (no login), but RealAuction's user agreement has an
// anti-automation clause — the same sales are FL public record published by
// the clerks (FS 197.512). Keep the polite throttle; see etl/README.md.

import { normalizeParcelId, money, usDateToIso, sleep } from "../lib/auctionsCommon.mjs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const THROTTLE_MS = 1200;

// FL DOR county numbers match parcels.co_no (NAL). Hosts verified 2026-07:
// most counties run tax deeds on realtaxdeed.com; Brevard & Manatee run them
// on their realforeclose instance; Hernando has no RealForeclose site.
// Not on RealAuction (need separate adapters): St. Lucie & Charlotte tax deeds
// (Grant Street ClerkAuction / clerk site).
export const FL_SITES = [
  { county: "Brevard", co_no: 15, host: "brevard.realforeclose.com" },
  { county: "Broward", co_no: 16, host: "broward.realtaxdeed.com" },
  { county: "Broward", co_no: 16, host: "broward.realforeclose.com" },
  { county: "Charlotte", co_no: 18, host: "charlotte.realforeclose.com" },
  { county: "Citrus", co_no: 19, host: "citrus.realtaxdeed.com" },
  { county: "Citrus", co_no: 19, host: "citrus.realforeclose.com" },
  { county: "Duval", co_no: 26, host: "duval.realtaxdeed.com" },
  { county: "Duval", co_no: 26, host: "duval.realforeclose.com" },
  { county: "Hernando", co_no: 37, host: "hernando.realtaxdeed.com" },
  { county: "Hillsborough", co_no: 39, host: "hillsborough.realtaxdeed.com" },
  { county: "Hillsborough", co_no: 39, host: "hillsborough.realforeclose.com" },
  { county: "Lake", co_no: 45, host: "lake.realtaxdeed.com" },
  { county: "Lake", co_no: 45, host: "lake.realforeclose.com" },
  { county: "Lee", co_no: 46, host: "lee.realtaxdeed.com" },
  { county: "Lee", co_no: 46, host: "lee.realforeclose.com" },
  { county: "Manatee", co_no: 51, host: "manatee.realforeclose.com" },
  { county: "Marion", co_no: 52, host: "marion.realtaxdeed.com" },
  { county: "Marion", co_no: 52, host: "marion.realforeclose.com" },
  // Miami-Dade's realtaxdeed and realforeclose subdomains alias ONE instance
  // that serves both auction types — scrape it once (the sync also dedupes by
  // county + AID as a safety net for other aliased pairs).
  { county: "Miami-Dade", co_no: 23, host: "miamidade.realtaxdeed.com" },
  { county: "Orange", co_no: 58, host: "orange.realtaxdeed.com" },
  { county: "Orange", co_no: 58, host: "orange.realforeclose.com" },
  { county: "Osceola", co_no: 59, host: "osceola.realtaxdeed.com" },
  { county: "Osceola", co_no: 59, host: "osceola.realforeclose.com" },
  { county: "Palm Beach", co_no: 60, host: "palmbeach.realtaxdeed.com" },
  { county: "Palm Beach", co_no: 60, host: "palmbeach.realforeclose.com" },
  { county: "Pasco", co_no: 61, host: "pasco.realtaxdeed.com" },
  { county: "Pasco", co_no: 61, host: "pasco.realforeclose.com" },
  { county: "Pinellas", co_no: 62, host: "pinellas.realtaxdeed.com" },
  { county: "Pinellas", co_no: 62, host: "pinellas.realforeclose.com" },
  { county: "Polk", co_no: 63, host: "polk.realtaxdeed.com" },
  { county: "Polk", co_no: 63, host: "polk.realforeclose.com" },
  { county: "Sarasota", co_no: 68, host: "sarasota.realtaxdeed.com" },
  { county: "Sarasota", co_no: 68, host: "sarasota.realforeclose.com" },
  { county: "Volusia", co_no: 74, host: "volusia.realtaxdeed.com" },
  { county: "Volusia", co_no: 74, host: "volusia.realforeclose.com" },
];

// retHTML token map from the site's auction.js.
const TOKENS = [
  ["@A", '<div class="'],
  ["@B", "</div>"],
  ["@C", 'class="'],
  ["@D", "<div>"],
  ["@E", "AUCTION"],
  ["@F", "</td><td"],
  ["@G", "</td></tr>"],
  ["@H", "<tr><td "],
  ["@I", "table"],
  ["@J", 'p_back="NextCheck='],
  ["@K", 'style="Display:none"'],
  ["@L", "/index.cfm?zaction=auction&zmethod=details&AID="],
];

function decodeRetHtml(retHTML) {
  let h = retHTML;
  for (const [k, v] of TOKENS) h = h.replaceAll(k, v);
  return h;
}

/** Simple per-host cookie jar (CFID/CFTOKEN session). */
function makeJar() {
  const cookies = new Map();
  return {
    absorb(res) {
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
  };
}

async function get(url, jar, referer, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      await sleep(THROTTLE_MS);
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          ...(referer ? { Referer: referer } : {}),
          ...(jar.header() ? { Cookie: jar.header() } : {}),
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      jar.absorb(res);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (i < attempts) await sleep(1500 * i);
    }
  }
  throw new Error(`${url} failed after ${attempts} attempts: ${lastErr.message}`);
}

/** Sale days on one month's calendar: [{date: 'MM/DD/YYYY', kind}]. */
function parseCalendar(html) {
  const days = [];
  const re = /dayid='(\d{2}\/\d{2}\/\d{4})'/g;
  let m;
  while ((m = re.exec(html))) {
    const windowHtml = html.slice(m.index, m.index + 900);
    const cal = windowHtml.match(/class='CALTEXT'>([^<]+)</);
    if (!cal) continue;
    const kind = cal[1].trim();
    if (kind) days.push({ date: m[1], kind });
  }
  return days;
}

/**
 * Parse decoded item HTML into label/value pairs per AUCTION_ITEM block.
 * Counties render fields as either table rows (<td class="AD_LBL">…</td>
 * <td class="AD_DTA">…</td>, e.g. Palm Beach) or plain divs
 * (<div class="AD_LBL">…</div><div class="AD_DTA">…</div>, e.g. Orange) —
 * pair AD_LBL/AD_DTA in document order to cover both. An empty label
 * continues the previous field (address line 2).
 */
function parseItems(html) {
  const items = [];
  const blocks = html.split(/<div id="AITEM_/).slice(1);
  for (const block of blocks) {
    const aid = block.match(/^(\d+)/)?.[1] ?? null;
    const fields = {};
    let lastLabel = null;
    let pending = null; // AD_LBL text awaiting its AD_DTA
    const partRe = /class="(AD_LBL|AD_DTA)"[^>]*>(.*?)<\/(?:td|div)>/gs;
    let m;
    while ((m = partRe.exec(block))) {
      const text = m[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      if (m[1] === "AD_LBL") {
        pending = text.replace(/:\s*$/, "");
      } else if (pending !== null) {
        if (pending) {
          fields[pending] = text;
          lastLabel = pending;
        } else if (lastLabel) {
          fields[`${lastLabel} (cont)`] = text;
        }
        pending = null;
      }
    }
    if (aid || Object.keys(fields).length) items.push({ aid, fields });
  }
  return items;
}

/** All upcoming (AREA=W) items for one sale day, following session paging. */
async function dayItems(host, date, log) {
  const jar = makeJar();
  const previewUrl = `https://${host}/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&AUCTIONDATE=${encodeURIComponent(date)}`;
  await get(previewUrl, jar);

  const all = [];
  const seenRlists = new Set();
  for (let page = 0; page < 40; page++) {
    const loadUrl =
      `https://${host}/index.cfm?zaction=AUCTION&Zmethod=UPDATE&FNC=LOAD&AREA=W` +
      `&PageDir=${page === 0 ? 0 : 1}&doR=0&tx=${Date.now()}&bypassPage=0`;
    const raw = await get(loadUrl, jar, previewUrl);
    const brace = raw.indexOf("{");
    if (brace < 0) break;
    let data;
    try {
      data = JSON.parse(raw.slice(brace));
    } catch {
      log(`  ${host} ${date}: unparseable LOAD response on page ${page + 1}, stopping.`);
      break;
    }
    const rlist = (data.rlist ?? "").trim();
    if (!rlist || seenRlists.has(rlist)) break;
    seenRlists.add(rlist);
    const items = parseItems(decodeRetHtml(data.retHTML ?? ""));
    all.push(...items);
    if (items.length < 10) break; // short page = last page
  }
  return all;
}

/** "BOCA RATON, FL- 33434" -> { city, zip }. */
function parseCityLine(line) {
  const m = String(line ?? "").match(/^(.*?),?\s*FL\s*-?\s*(\d{5})?/i);
  if (!m) return { city: null, zip: null };
  const city = m[1].trim() || null;
  return { city, zip: m[2] ?? null };
}

function toRecord(site, day, item, fetchedAt) {
  const f = item.fields;
  // Some counties omit the per-item "Auction Type" row (e.g. Orange) — fall
  // back to the calendar day's kind ("Tax Deed" / "Foreclosure").
  const rawType = ((f["Auction Type"] ?? "") || day.kind).toUpperCase();
  const auctionType = rawType.includes("TAX") ? "TAXDEED" : rawType.includes("FORECLOS") ? "FORECLOSURE" : rawType || null;
  // Some counties label the parcel differently (Citrus/Hernando: "Alternate Key").
  const parcelRaw = f["Parcel ID"] ?? f["Parcel Number"] ?? f["Alternate Key"] ?? null;
  const { city, zip } = parseCityLine(f["Property Address (cont)"]);
  return {
    state: "FL",
    county: site.county,
    co_no: site.co_no,
    source: site.host.includes("realtaxdeed") ? "realtaxdeed" : "realforeclose",
    auction_type: auctionType,
    status: "upcoming",
    status_detail: null,
    property_type: null,
    case_no: f["Case #"] ?? null,
    cert_no: f["Certificate #"] ?? null,
    source_item_id: item.aid,
    sale_date: usDateToIso(day.date),
    sale_time: null,
    close_date: null,
    opening_bid: money(f["Opening Bid"]),
    current_bid: null,
    judgment_amount: money(f["Final Judgment Amount"]),
    assessed_value: money(f["Assessed Value"]),
    parcel_id_raw: parcelRaw,
    parcel_id_norm: normalizeParcelId(parcelRaw),
    situs_addr: f["Property Address"] ?? null,
    situs_city: city,
    situs_zip: zip,
    detail_url: item.aid ? `https://${site.host}/index.cfm?zaction=auction&zmethod=details&AID=${item.aid}` : null,
    fetched_at: fetchedAt,
  };
}

/** First day of the month `offset` months from now, as MM/DD/YYYY. */
function monthStart(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${mm}/01/${d.getFullYear()}`;
}

/**
 * Async generator yielding FL auction records from every configured site.
 * A site that errors is logged and skipped so one county can't kill the run.
 */
export async function* auctions({ onlyCounties = [], monthsAhead = 4, maxRecords = 0, log = console.log } = {}) {
  let sites = FL_SITES;
  if (onlyCounties.length) {
    const wanted = onlyCounties.map((c) => c.trim().toLowerCase());
    sites = sites.filter((s) => wanted.includes(s.county.toLowerCase()));
  }
  const fetchedAt = new Date().toISOString();
  let yielded = 0;

  for (const site of sites) {
    try {
      const jar = makeJar();
      const saleDays = [];
      for (let mo = 0; mo < monthsAhead; mo++) {
        const url =
          `https://${site.host}/index.cfm?zaction=USER&zmethod=CALENDAR` +
          (mo === 0 ? "" : `&selCalDate=${encodeURIComponent(monthStart(mo))}`);
        const html = await get(url, jar);
        for (const day of parseCalendar(html)) {
          if (!saleDays.some((d) => d.date === day.date)) saleDays.push(day);
        }
      }
      log(`  ${site.host}: ${saleDays.length} sale day(s) in the next ${monthsAhead} months`);

      for (const day of saleDays) {
        const items = await dayItems(site.host, day.date, log);
        for (const item of items) {
          yield toRecord(site, day, item, fetchedAt);
          if (maxRecords && ++yielded >= maxRecords) return;
        }
        if (items.length) log(`    ${site.host} ${day.date} (${day.kind}): ${items.length} item(s)`);
      }
    } catch (err) {
      log(`  WARN ${site.host} failed, skipping: ${err.message}`);
    }
  }
}
