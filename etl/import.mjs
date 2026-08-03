// Multi-state parcel importer.
//
// Loads one state's parcels into a staging table, then swaps ONLY that state's
// rows into the live `parcels` table (per-state partial refresh), so states
// coexist. Each state has an adapter that produces common parcel records.
// Streams live progress (counties done/total, rows, phase, recent log lines)
// into the dashboard's Mongo so the UI can show a progress bar + log.
//
//   STATE=FL node import.mjs                    # all Florida (default)
//   STATE=NC node import.mjs                    # all North Carolina
//   STATE=ALL node import.mjs                   # every registered state
//   STATE=NC ONLY_COUNTIES="Wake,Durham" ...    # a subset
//   STATE=NC MAX_RECORDS=5000 ...               # cap (testing)
//
// Deps: pg, pg-copy-streams, unzipper, csv-parse, mongodb

import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import pg from "pg";
import { MongoClient } from "mongodb";
import copyStreams from "pg-copy-streams";
import unzipper from "unzipper";
import { parse } from "csv-parse";
import { discoverNalFiles } from "./lib/fdor.mjs";
import { fetchBuffer } from "./lib/http.mjs";
import { nalRowToParcel } from "./lib/transform.mjs";
import { PARCEL_COLUMNS, LIVE_DDL, STAGING_DDL, INDEXES, csvCell } from "./lib/common.mjs";
import * as northCarolina from "./adapters/northCarolina.mjs";
import * as colorado from "./adapters/colorado.mjs";
import * as montana from "./adapters/montana.mjs";

const { Client } = pg;
const copyFrom = copyStreams.from;
const COPY_SQL = `COPY parcels_staging (${PARCEL_COLUMNS.join(",")}) FROM STDIN WITH (FORMAT csv)`;

// ---------- Run reporter: best-effort progress + log to the dashboard Mongo ----------

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
  const id = `parcel:${state}:${startedAt.toISOString()}`;
  // Only meaningful for FL, and only when pinned — loadFlorida logs the roll it
  // actually resolved, which is the authoritative one.
  const roll =
    process.env.ROLL_YEAR && process.env.ROLL_TYPE
      ? `${process.env.ROLL_YEAR}${process.env.ROLL_TYPE}`
      : "auto";
  const dbName = process.env.PARCELS_MONGO_DB || "ziora_parcels";
  const logLines = [];
  let progress = { phase: "starting", done: 0, total: 0, rows: 0, current: null };
  let lastFlush = 0;
  let warned = false;

  async function write(doc) {
    try {
      const m = await getMongo();
      if (!m) return;
      await m.db(dbName).collection("parcel_imports").replaceOne({ _id: id }, doc, { upsert: true });
    } catch (e) {
      if (!warned) {
        console.log(`(dashboard reporting unavailable, non-fatal: ${e.message})`);
        warned = true;
      }
    }
  }

  function doc(status, extra) {
    return {
      _id: id, runAt: startedAt, startedAt, state, scope, roll,
      status, progress, log: logLines.slice(-25), source: "etl-parcel-import",
      ...extra,
    };
  }

  return {
    /** Log a line to console AND the rolling buffer shown on the dashboard. */
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
      await write(doc("running", { completedAt: null, durationMs: 0, error: null, totalRows: 0, countyCount: 0, counties: [] }));
    },
    /** Throttled progress write (min 2.5s apart unless forced). */
    async flush(force = false) {
      const now = Date.now();
      if (!force && now - lastFlush < 2500) return;
      lastFlush = now;
      await write(doc("running", { completedAt: null, durationMs: now - startMs, error: null, totalRows: progress.rows, countyCount: progress.done, counties: [] }));
    },
    async finish({ status, totalRows, counties, error }) {
      progress = { ...progress, phase: status === "success" ? "done" : "failed", current: null };
      await write(doc(status, { completedAt: new Date(), durationMs: Date.now() - startMs, error: error ?? null, totalRows, countyCount: counties.length, counties }));
    },
  };
}

// ---------- Florida: download-per-county NAL files ----------

async function loadCountyFile(client, file, { signal, onRow } = {}) {
  // Retries were already here; the deadline is what was missing. A county file
  // that starts arriving and then stops would previously hang the run forever.
  const buf = await fetchBuffer(file.url, { label: file.fileName, signal });
  const dir = await unzipper.Open.buffer(buf);
  const csvEntry = dir.files.find((f) => /\.csv$/i.test(f.path));
  if (!csvEntry) throw new Error(`no CSV inside ${file.fileName}`);

  const copy = client.query(copyFrom(COPY_SQL));
  let count = 0;
  const toCopyRows = new Transform({
    objectMode: true,
    transform(record, _enc, cb) {
      const parcel = nalRowToParcel(record, file.countyName);
      if (!parcel) return cb();
      count++;
      onRow?.(count);
      cb(null, PARCEL_COLUMNS.map((c) => csvCell(parcel[c])).join(",") + "\n");
    },
  });

  try {
    await pipeline(
      csvEntry.stream(),
      new Transform({
        transform(chunk, _e, cb) {
          cb(null, chunk.toString("latin1"));
        },
      }),
      parse({ columns: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true }),
      toCopyRows,
      copy,
      { signal },
    );
    return count;
  } catch (err) {
    // Same reasoning as copyObjects: never abandon an open COPY, or its lock on
    // parcels_staging outlives the failure.
    copy.destroy(err);
    await new Promise((resolve) => {
      copy.once("close", resolve);
      setTimeout(resolve, 5000).unref?.();
    });
    throw err;
  }
}

async function loadFlorida(client, only, reporter) {
  const watchdog = startStallWatchdog("FL", reporter);
  try {
    const { roll, files: discovered } = await discoverNalFiles({ signal: watchdog.signal });
    let files = discovered;
    if (only.length) files = files.filter((f) => only.includes(f.countyName.toLowerCase()));
    reporter.setProgress({ total: files.length, done: 0, rows: 0 });
    // Log the roll that was actually used. With auto-detection this is no
    // longer derivable from the environment, and "which roll is live" is the
    // first question anyone asks of a parcel table.
    reporter.log(`Discovered ${files.length} FL county files (roll ${roll}).`);
    await reporter.flush(true);

    let rows = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const t0 = Date.now();
      // Counted per row rather than per county, so a county that stops
      // mid-stream trips the watchdog instead of looking like a slow one.
      const n = await loadCountyFile(client, file, {
        signal: watchdog.signal,
        onRow: (c) => watchdog.beat(rows + c),
      });
      rows += n;
      reporter.setProgress({ done: i + 1, rows, current: file.countyName });
      reporter.log(
        `  ${file.countyName}${file.countyNo ? ` (${file.countyNo})` : ""}: ` +
          `${n.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await reporter.flush();
    }
  } finally {
    watchdog.stop();
  }
}

// ---------- Stall watchdog ----------

/**
 * Abort a load that has stopped producing rows.
 *
 * The per-request deadlines in lib/http.mjs are the real fix; this is the
 * backstop for the hang nobody has thought of yet. It exists because the
 * failure mode that cost an afternoon was *silence* — a run that is wedged and
 * a run that is merely slow look identical from the outside, and the last thing
 * in the journal was a "Streaming…" line written two hours earlier.
 *
 * So it does two jobs. It aborts a load with no rows for ETL_STALL_TIMEOUT_MS
 * (default 15 minutes), and until then it prints a heartbeat, so "nothing is
 * happening" is a thing you can see rather than a thing you have to infer.
 */
function startStallWatchdog(label, reporter) {
  const stallMs = Number(process.env.ETL_STALL_TIMEOUT_MS || 900_000);
  const tickMs = Math.min(30_000, stallMs);
  const heartbeatEvery = Math.max(1, Math.round(300_000 / tickMs)); // ~5 min

  const controller = new AbortController();
  let rows = 0;
  let lastRow = Date.now();
  let ticks = 0;

  const timer = setInterval(() => {
    const idleMs = Date.now() - lastRow;
    if (idleMs >= stallMs) {
      const mins = Math.round(idleMs / 60_000);
      reporter.log(
        `  ${label}: STALLED — no rows for ${mins} min at ${rows.toLocaleString()} rows. Aborting.`,
      );
      controller.abort(
        new Error(`${label} stalled: no rows for ${mins} min (limit ${Math.round(stallMs / 60_000)} min)`),
      );
      clearInterval(timer);
      return;
    }
    if (++ticks % heartbeatEvery === 0) {
      reporter.log(
        `  ${label}: ${rows.toLocaleString()} rows, ${Math.round(idleMs / 1000)}s since the last one.`,
      );
    }
  }, tickMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    beat(n) {
      rows = n;
      lastRow = Date.now();
    },
    stop() {
      clearInterval(timer);
    },
  };
}

// ---------- Generic object-stream loader (NC and future states) ----------

async function copyObjects(client, iterable, onProgress, { signal, onRow } = {}) {
  const copy = client.query(copyFrom(COPY_SQL));
  let n = 0;
  try {
    for await (const p of iterable) {
      const line = PARCEL_COLUMNS.map((c) => csvCell(p[c])).join(",") + "\n";
      // The signal covers the wait for backpressure too. Without it a COPY that
      // stops draining is another way to sit here forever.
      if (!copy.write(line)) await once(copy, "drain", { signal });
      onRow?.(++n);
      if (n % 25_000 === 0 && onProgress) await onProgress(n);
    }
    copy.end();
    await once(copy, "finish");
    return n;
  } catch (err) {
    // CANCEL the COPY rather than walking away from it. An abandoned COPY keeps
    // its transaction — and its lock on parcels_staging — open until the process
    // itself dies, which is exactly what blocked every other import for two
    // hours. Destroying the stream sends CopyFail, so the lock goes now and the
    // connection is usable again for the ROLLBACK that follows.
    copy.destroy(err);
    await new Promise((resolve) => {
      copy.once("close", resolve);
      setTimeout(resolve, 5000).unref?.();
    });
    throw err;
  }
}

// Generic loader for adapters that expose `parcels({onlyCounties, maxRecords})`
// as an async generator of common parcel records (NC, CO, MT — any queryable
// statewide source). `label` is the state code used in progress/log lines.
async function loadObjectAdapter(client, adapter, label, source, only, maxRecords, reporter) {
  reporter.setProgress({ total: 0, current: `streaming ${source}` });
  reporter.log(`Streaming ${source} parcels${only.length ? " (" + only.join(", ") + ")" : ""}…`);
  await reporter.flush(true);

  const watchdog = startStallWatchdog(label, reporter);
  try {
    const total = await copyObjects(
      client,
      adapter.parcels({ onlyCounties: only, maxRecords, signal: watchdog.signal }),
      async (n) => {
        reporter.setProgress({ rows: n });
        reporter.log(`  ${label}: ${n.toLocaleString()} rows loaded`);
        await reporter.flush();
      },
      { signal: watchdog.signal, onRow: watchdog.beat },
    );
    reporter.setProgress({ rows: total });
  } finally {
    watchdog.stop();
  }
}

// ---------- Live table (create + migrate + index, idempotent) ----------

async function ensureLive(client) {
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await client.query(LIVE_DDL);
  await client.query("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS state text");
  await client.query("UPDATE parcels SET state = 'FL' WHERE state IS NULL");
  for (const [suffix, def] of INDEXES) {
    await client.query(`CREATE INDEX IF NOT EXISTS parcels_${suffix} ON parcels ${def}`);
  }
}

// ---------- One state: load into staging, partial-swap, report ----------

const LOADERS = {
  FL: (client, only, _max, reporter) => loadFlorida(client, only.map((s) => s.toLowerCase()), reporter),
  NC: (client, only, maxRecords, reporter) =>
    loadObjectAdapter(client, northCarolina, "NC", "NC OneMap", only, maxRecords, reporter),
  CO: (client, only, maxRecords, reporter) =>
    loadObjectAdapter(client, colorado, "CO", "Colorado OIT parcels", only, maxRecords, reporter),
  MT: (client, only, maxRecords, reporter) =>
    loadObjectAdapter(client, montana, "MT", "MT MSDI cadastral", only, maxRecords, reporter),
};

async function importState(client, state, only, maxRecords) {
  const startedAt = new Date();
  const startMs = Date.now();
  const scope = only.length ? only.join(", ") : `all ${state}`;
  const reporter = makeReporter(state, scope, startedAt, startMs);
  const loader = LOADERS[state];
  try {
    if (!loader) {
      throw new Error(`Unknown STATE '${state}'. Supported: ${Object.keys(LOADERS).join(", ")}, ALL.`);
    }
    await reporter.start();
    reporter.log(`Starting ${state} import (${scope}).`);
    await client.query("DROP TABLE IF EXISTS parcels_staging");
    await client.query(STAGING_DDL);
    await loader(client, only, maxRecords, reporter);

    reporter.setProgress({ phase: "swapping", current: null });
    reporter.log("Load complete — building indexes & swapping into live table…");
    await reporter.flush(true);

    const grand = (await client.query("SELECT count(*)::int n FROM parcels_staging")).rows[0].n;
    const counties = (
      await client.query(
        "SELECT county AS name, count(*)::int rows FROM parcels_staging GROUP BY county ORDER BY rows DESC",
      )
    ).rows.map((r) => ({ name: r.name, rows: r.rows }));
    if (grand === 0) throw new Error(`No rows loaded for ${state} — aborting swap to protect live data.`);

    await client.query("BEGIN");
    await client.query("DELETE FROM parcels WHERE state = $1", [state]);
    await client.query(
      `INSERT INTO parcels (${PARCEL_COLUMNS.join(",")}) SELECT ${PARCEL_COLUMNS.join(",")} FROM parcels_staging`,
    );
    await client.query("COMMIT");
    await client.query("DROP TABLE IF EXISTS parcels_staging");
    await client.query("ANALYZE parcels");

    reporter.log(`Swap complete. ${state} is live (${grand.toLocaleString()} parcels).`);
    await reporter.finish({ status: "success", totalRows: grand, counties });
    return { state, status: "success", totalRows: grand };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    reporter.log(`ERROR: ${err?.message ?? err}`);
    await reporter.finish({ status: "failed", totalRows: 0, counties: [], error: String(err?.message ?? err) });
    console.error(`${state} import failed: ${err?.message ?? err}`);
    return { state, status: "failed" };
  }
}

async function main() {
  const STATE = (process.env.STATE || "FL").toUpperCase();
  const only = (process.env.ONLY_COUNTIES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const maxRecords = Number(process.env.MAX_RECORDS || "0") || 0;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await ensureLive(client);
    const states = STATE === "ALL" ? Object.keys(LOADERS) : [STATE];
    const results = [];
    for (const st of states) {
      if (states.length > 1) console.log(`\n===== ${st} =====`);
      results.push(await importState(client, st, only, maxRecords));
    }
    const failed = results.filter((r) => r.status === "failed");
    if (states.length > 1) {
      console.log(`\nAll states done. ${results.length - failed.length} ok, ${failed.length} failed.`);
    }
    if (failed.length) process.exitCode = 1;
  } finally {
    await client.end();
    await closeMongo();
  }
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
