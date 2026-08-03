// Create any missing indexes on the live `parcels` table, without a full
// re-import. Safe to run against production: each index is built with
// CREATE INDEX CONCURRENTLY, which does not block reads or writes.
//
//   DATABASE_URL=postgres://… node etl/reindex.mjs
//   # or through docker compose, alongside the other one-off ETL commands:
//   docker compose run --rm import node reindex.mjs
//
// The index list is the single source of truth in lib/common.mjs, so this
// stays in sync with what a normal import would create. Re-running is a no-op
// for indexes that already exist.

import pg from "pg";
import { INDEXES } from "./lib/common.mjs";

const { Client } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    // gin_trgm_ops (owner_idx) needs the pg_trgm extension.
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");

    for (const [suffix, def] of INDEXES) {
      const name = `parcels_${suffix}`;
      process.stdout.write(`• ${name} … `);
      const started = Date.now();
      try {
        // CONCURRENTLY cannot run inside a transaction; node-pg's Client is in
        // autocommit mode here (no explicit BEGIN), so this is fine.
        await client.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON parcels ${def}`);
        console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      } catch (err) {
        // A prior interrupted CONCURRENTLY build can leave an INVALID index that
        // IF NOT EXISTS won't replace — surface it so the operator can DROP it.
        console.log(`FAILED: ${err.message}`);
      }
    }
    console.log("Done. Existing indexes are left untouched.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
