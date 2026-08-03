// Nightly auction sync — tax deed & foreclosure sales into the `auctions`
// table, alongside (and joinable to) the `parcels` assessment data.
//
// Mirrors import.mjs: each state's adapter yields common auction records,
// which are bulk-loaded into a staging table then swapped in per state
// (full snapshot replace — the upcoming-auction set is small and changes
// daily). Run progress streams to the dashboard Mongo (`auction_syncs`).
//
//   node auctions.mjs                              # FL + NC (default)
//   AUCTION_STATE=FL node auctions.mjs             # one state
//   ONLY_COUNTIES="Palm Beach" MAX_RECORDS=25 ...  # a subset (testing)
//   MONTHS_AHEAD=6 ...                             # FL calendar horizon
//
// Sources: FL — RealAuction county sites (see adapters/realauctionFl.mjs and
// the ToS note in README.md); NC — Kania Law Firm tax-foreclosure listings.

import { once } from "node:events";
import pg from "pg";
import { MongoClient } from "mongodb";
import copyStreams from "pg-copy-streams";
import { csvCell } from "./lib/common.mjs";
import {
  AUCTION_COLUMNS, AUCTIONS_LIVE_DDL, AUCTIONS_STAGING_DDL, AUCTION_INDEXES, PARCELS_NORM_INDEX,
} from "./lib/auctionsCommon.mjs";
import * as realauctionFl from "./adapters/realauctionFl.mjs";
import * as kaniaNc from "./adapters/kaniaNc.mjs";

const { Client } = pg;
const copyFrom = copyStreams.from;
const COPY_SQL = `COPY auctions_staging (${AUCTION_COLUMNS.join(",")}) FROM STDIN WITH (FORMAT csv)`;

// ---------- Run reporter (same pattern as import.mjs, `auction_syncs` collection) ----------

let mongoClient = null;
async function getMongo() {
  if (!process.env.MONGO_URI) return null;
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
  }
  return mongoClient;
}
async function closeMongo() {
  try {
    await mongoClient?.close();
  } catch {
    /* ignore */
  }
  mongoClient = null;
}

function makeReporter(state, scope, startedAt, startMs) {
  const id = `auction:${state}:${startedAt.toISOString()}`;
  const dbName = process.env.PARCELS_MONGO_DB || "ziora_parcels";
  const logLines = [];
  let progress = { phase: "starting", done: 0, total: 0, rows: 0, current: null };
  let lastFlush = 0;
  let warned = false;

  async function write(doc) {
    try {
      const m = await getMongo();
      if (!m) return;
      await m.db(dbName).collection("auction_syncs").replaceOne({ _id: id }, doc, { upsert: true });
    } catch (e) {
      if (!warned) {
        console.log(`(dashboard reporting unavailable, non-fatal: ${e.message})`);
        warned = true;
      }
    }
  }

  function doc(status, extra) {
    return {
      _id: id, runAt: startedAt, startedAt, state, scope,
      status, progress, log: logLines.slice(-25), source: "etl-auction-sync",
      ...extra,
    };
  }

  return {
    log(line) {
      console.log(line);
      logLines.push(line);
      if (logLines.length > 60) logLines.shift();
    },
    setProgress(p) {
      progress = { ...progress, ...p };
    },
    async start() {
      progress = { phase: "loading", done: 0, total: 0, rows: 0, current: null };
      await write(doc("running", {
        completedAt: null, durationMs: 0, error: null,
        totalRows: 0, upcoming: 0, matchedParcels: 0, countyCount: 0, counties: [], byType: [], nextSaleDate: null,
      }));
    },
    async flush(force = false) {
      const now = Date.now();
      if (!force && now - lastFlush < 2500) return;
      lastFlush = now;
      await write(doc("running", {
        completedAt: null, durationMs: now - startMs, error: null,
        totalRows: progress.rows, upcoming: 0, matchedParcels: 0, countyCount: 0, counties: [], byType: [], nextSaleDate: null,
      }));
    },
    async finish({ status, totalRows = 0, upcoming = 0, matchedParcels = 0, counties = [], byType = [], nextSaleDate = null, error }) {
      progress = { ...progress, phase: status === "success" ? "done" : "failed", current: null };
      await write(doc(status, {
        completedAt: new Date(), durationMs: Date.now() - startMs, error: error ?? null,
        totalRows, upcoming, matchedParcels, countyCount: counties.length, counties, byType, nextSaleDate,
      }));
    },
  };
}

// ---------- Load + swap ----------

async function copyRecords(client, iterable, reporter) {
  const copy = client.query(copyFrom(COPY_SQL));
  let n = 0;
  for await (const rec of iterable) {
    const line = AUCTION_COLUMNS.map((c) => csvCell(rec[c])).join(",") + "\n";
    if (!copy.write(line)) await once(copy, "drain");
    n++;
    reporter.setProgress({ rows: n, current: rec.county });
    await reporter.flush();
  }
  copy.end();
  await once(copy, "finish");
  return n;
}

async function ensureLive(client) {
  await client.query(AUCTIONS_LIVE_DDL);
  for (const [suffix, def] of AUCTION_INDEXES) {
    await client.query(`CREATE INDEX IF NOT EXISTS auctions_${suffix} ON auctions ${def}`);
  }
  // Join index on parcels (skipped when the parcel import hasn't run yet).
  try {
    await client.query(PARCELS_NORM_INDEX);
  } catch (err) {
    console.log(`(parcels join index skipped: ${err.message})`);
  }
}

const ADAPTERS = {
  FL: (opts) => realauctionFl.auctions(opts),
  NC: (opts) => kaniaNc.auctions(opts),
};

async function syncState(client, state, only, maxRecords, monthsAhead) {
  const startedAt = new Date();
  const startMs = Date.now();
  const scope = only.length ? only.join(", ") : `all ${state}`;
  const reporter = makeReporter(state, scope, startedAt, startMs);
  try {
    await reporter.start();
    reporter.log(`Starting ${state} auction sync (${scope}).`);
    await client.query("DROP TABLE IF EXISTS auctions_staging");
    await client.query(AUCTIONS_STAGING_DDL);

    const iterable = ADAPTERS[state]({ onlyCounties: only, maxRecords, monthsAhead, log: (l) => reporter.log(l) });
    const loaded = await copyRecords(client, iterable, reporter);

    reporter.setProgress({ phase: "swapping", current: null });
    await reporter.flush(true);

    // Some RealAuction subdomain pairs alias one instance (e.g. Miami-Dade
    // serves tax deeds AND foreclosures on both hosts) — drop exact re-reads
    // of the same auction item.
    const deduped = await client.query(
      `DELETE FROM auctions_staging s
       USING auctions_staging d
       WHERE s.source_item_id IS NOT NULL
         AND s.ctid > d.ctid
         AND s.state = d.state AND s.county = d.county
         AND s.source_item_id = d.source_item_id`,
    );
    if (deduped.rowCount) reporter.log(`  deduplicated ${deduped.rowCount} aliased item(s).`);

    const counties = (
      await client.query("SELECT county AS name, count(*)::int rows FROM auctions_staging GROUP BY county ORDER BY rows DESC")
    ).rows.map((r) => ({ name: r.name, rows: r.rows }));
    const byType = (
      await client.query("SELECT auction_type AS type, count(*)::int rows FROM auctions_staging GROUP BY auction_type ORDER BY rows DESC")
    ).rows.map((r) => ({ type: r.type, rows: r.rows }));

    // Unlike the parcel import, zero rows is a legal outcome for FL (no sales
    // scheduled) — but a fully-empty NC snapshot means the source broke, since
    // Kania always returns closed-sale history too.
    if (state === "NC" && loaded === 0) {
      throw new Error("NC returned 0 rows — refusing to wipe the previous snapshot (source likely broken).");
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM auctions WHERE state = $1", [state]);
    await client.query(
      `INSERT INTO auctions (${AUCTION_COLUMNS.join(",")}) SELECT ${AUCTION_COLUMNS.join(",")} FROM auctions_staging`,
    );
    await client.query("COMMIT");
    await client.query("DROP TABLE IF EXISTS auctions_staging");
    await client.query("ANALYZE auctions");

    const stats = (
      await client.query(
        `SELECT
           count(*) FILTER (WHERE status IN ('pre-sale','upcoming','upset-period'))::int AS upcoming,
           min(sale_date) FILTER (WHERE sale_date >= current_date) AS next_sale
         FROM auctions WHERE state = $1`,
        [state],
      )
    ).rows[0];
    let matched = 0;
    try {
      matched = (
        await client.query(
          `SELECT count(DISTINCT a.id)::int n
           FROM auctions a JOIN parcels p
             ON p.state = a.state
            AND upper(regexp_replace(p.parcel_id, '[^A-Za-z0-9]', '', 'g')) = a.parcel_id_norm
            AND (a.co_no IS NULL OR a.co_no = p.co_no)
           WHERE a.state = $1`,
          [state],
        )
      ).rows[0].n;
    } catch {
      /* parcels table not loaded yet */
    }

    const nextSaleDate = stats.next_sale ? new Date(stats.next_sale).toISOString().slice(0, 10) : null;
    reporter.log(
      `Auction sync complete. ${state}: ${loaded.toLocaleString()} auctions live ` +
      `(${stats.upcoming} upcoming, ${matched} matched to parcels${nextSaleDate ? `, next sale ${nextSaleDate}` : ""}).`,
    );
    await reporter.finish({
      status: "success", totalRows: loaded, upcoming: stats.upcoming, matchedParcels: matched,
      counties, byType, nextSaleDate,
    });
    return { state, status: "success", totalRows: loaded };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    reporter.log(`ERROR: ${err?.message ?? err}`);
    await reporter.finish({ status: "failed", error: String(err?.message ?? err) });
    console.error(`${state} auction sync failed: ${err?.message ?? err}`);
    return { state, status: "failed" };
  }
}

async function main() {
  const STATE = (process.env.AUCTION_STATE || process.env.STATE || "ALL").toUpperCase();
  const only = (process.env.ONLY_COUNTIES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const maxRecords = Number(process.env.MAX_RECORDS || "0") || 0;
  const monthsAhead = Number(process.env.MONTHS_AHEAD || "4") || 4;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await ensureLive(client);
    const states = STATE === "ALL" ? Object.keys(ADAPTERS) : [STATE];
    for (const st of states) {
      if (!ADAPTERS[st]) throw new Error(`Unknown AUCTION_STATE '${st}'. Supported: ${Object.keys(ADAPTERS).join(", ")}, ALL.`);
    }
    const results = [];
    for (const st of states) {
      if (states.length > 1) console.log(`\n===== ${st} auctions =====`);
      results.push(await syncState(client, st, only, maxRecords, monthsAhead));
    }
    if (results.some((r) => r.status === "failed")) process.exitCode = 1;
  } finally {
    await client.end();
    await closeMongo();
  }
}

main().catch((err) => {
  console.error("Auction sync failed:", err);
  process.exit(1);
});
