// Zoning sync.
//
//   DATABASE_URL=postgres://… node zoning.mjs
//   DATABASE_URL=… ZONING_COUNTY=orange-fl LIMIT=500 node zoning.mjs   # bounded
//
// Fills `parcel_zoning`, which is joined to `parcels` at read time. It is NOT a
// column on `parcels`: that table is deleted and re-inserted per state on every
// monthly import, so a column there would be blanked every month without a
// single error to show for it. See lib/zoning.mjs.
//
// Runs on its own timer, not inside the parcel import. Zoning is published by
// counties on their own schedules and has nothing to do with the assessment
// roll, so coupling the two would mean a zoning failure could abort a parcel
// refresh - or, worse, a slow county service holding the `flock` that the
// import needs.

import pg from "pg";
import { ORANGE_FL, orangeZoningRows } from "./adapters/zoningOrangeFl.mjs";
import { ZONING_DDL, ZONING_INDEXES, writeZoning } from "./lib/zoning.mjs";

const { Client } = pg;

const COUNTIES = {
  "orange-fl": { meta: ORANGE_FL, rows: orangeZoningRows },
};

const BATCH = 500;

/**
 * Which of our parcels to ask about.
 *
 * NOT all of them, and that is the design. The county service answers in 10-20
 * seconds per request whatever it is asked, so the full 496,798-record county
 * is about thirteen hours; the parcels anyone will actually look at are a few
 * thousand. The default selector is "land we could conceivably build a park on,
 * plus anything already shortlisted" - and shortlisted parcels come first,
 * because those are the ones someone is deciding about this week.
 *
 * Widen it with ZONING_MIN_ACRES, or replace it outright with ZONING_WHERE for
 * a one-off. Refreshing is cheap: only rows older than ZONING_MAX_AGE_DAYS are
 * re-asked, so a nightly run costs almost nothing once it has caught up.
 */
async function selectParcels(client, { state, county }) {
  const minAcres = Number(process.env.ZONING_MIN_ACRES || 2);
  const maxAge = Number(process.env.ZONING_MAX_AGE_DAYS || 90);
  const limit = Number(process.env.LIMIT || 5000);
  const extra = process.env.ZONING_WHERE ? `AND (${process.env.ZONING_WHERE})` : "";

  // `crm_saved_parcels` belongs to the CRM, not to this importer, so its
  // absence must not be an error - a database with no CRM tables is a perfectly
  // valid target for a parcel-only load.
  const { rows: hasSaved } = await client.query(
    `SELECT to_regclass('public.crm_saved_parcels') IS NOT NULL AS present`,
  );
  const savedJoin = hasSaved[0]?.present
    ? `LEFT JOIN crm_saved_parcels s
         ON s.parcel_key = p.state || ':' || p.co_no || ':' || p.parcel_id`
    : "";
  const savedCol = hasSaved[0]?.present ? "(s.id IS NOT NULL)" : "false";

  const { rows } = await client.query(
    `SELECT DISTINCT p.parcel_id, p.co_no, p.situs_addr, p.owner_name, ${savedCol} AS shortlisted
       FROM parcels p
       ${savedJoin}
       LEFT JOIN parcel_zoning z
         ON z.state = p.state AND z.co_no = p.co_no AND z.parcel_id = p.parcel_id
      WHERE p.state = $1 AND p.county ILIKE $2
        AND (z.fetched_at IS NULL OR z.fetched_at < now() - ($3 || ' days')::interval)
        AND (${savedCol} OR (p.is_land AND p.acres >= $4))
        ${extra}
      ORDER BY shortlisted DESC, p.parcel_id
      LIMIT $5`,
    [state, county, String(maxAge), minAcres, limit],
  );
  return rows;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const key = (process.env.ZONING_COUNTY || "orange-fl").toLowerCase();
  const entry = COUNTIES[key];
  if (!entry) {
    throw new Error(`Unknown ZONING_COUNTY "${key}". Known: ${Object.keys(COUNTIES).join(", ")}`);
  }

  const client = new Client({ connectionString });
  await client.connect();
  const started = Date.now();
  try {
    await client.query(ZONING_DDL);
    for (const sql of ZONING_INDEXES) await client.query(sql);

    const { state, county } = entry.meta;
    console.log(`[zoning] ${key}: choosing ${county}, ${state} parcels to refresh…`);
    const parcels = await selectParcels(client, entry.meta);
    console.log(`[zoning] ${parcels.length.toLocaleString()} parcels to ask about`);
    if (parcels.length === 0) {
      // Not an error: everything in scope may simply be fresh, or the parcel
      // import may not have run for this county yet. Writing zero rows silently
      // would look identical to a broken adapter, so say which it is.
      console.log("[zoning] nothing due - either all current, or no parcels imported here yet.");
      return;
    }

    let batch = [];
    let written = 0;
    const iter = entry.rows({ parcels, log: (m) => console.log(m) });

    let result = await iter.next();
    while (!result.done) {
      batch.push(result.value);
      if (batch.length >= BATCH) {
        written += await writeZoning(client, batch);
        batch = [];
      }
      result = await iter.next();
    }
    if (batch.length) written += await writeZoning(client, batch);

    // The generator's return value carries why records were dropped. Printing
    // it is the point: a run that matched 12 of 490,000 is a broken id mapping,
    // and it looks exactly like a successful run if you only count writes.
    const s = result.value ?? {};
    console.log(
      `[zoning] asked ${(s.asked ?? 0).toLocaleString()} — ` +
        `county answered ${(s.answered ?? 0).toLocaleString()}, ` +
        `wrote ${written.toLocaleString()}, ` +
        `address mismatch ${(s.addressMismatch ?? 0).toLocaleString()}, ` +
        `no code ${(s.noZoning ?? 0).toLocaleString()}`,
    );
    // A collapse in the answer rate is the signature of the parcel-id encoding
    // changing under us, and it looks exactly like a successful run if you only
    // count what was written.
    if ((s.asked ?? 0) > 200 && (s.answered ?? 0) / (s.asked || 1) < 0.2) {
      console.warn(
        "[zoning] WARNING: the county answered for under a fifth of the parcels asked. " +
          "Check swapParcelId against a known address before trusting this run.",
      );
    }
    if ((s.addressMismatch ?? 0) > (s.emitted ?? 0)) {
      console.warn(
        "[zoning] WARNING: more address mismatches than matches. The id mapping is " +
          "probably wrong; nothing was written for those, which is the guard working.",
      );
    }
    console.log(`[zoning] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[zoning] FAILED: ${err.message}`);
  process.exitCode = 1;
});
