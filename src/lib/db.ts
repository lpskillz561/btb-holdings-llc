// Postgres connection pool for the Florida parcel database (loaded by the ETL
// in /etl). A single module-level pool is reused across requests; stashed on
// globalThis so `next dev` HMR doesn't leak pools.

import { Pool, types } from "pg";

// node-postgres returns BIGINT (oid 20) as a string, because a 64-bit integer
// can exceed Number.MAX_SAFE_INTEGER. Every BIGINT we store is money in cents
// (see src/lib/crm/types.ts), which stays far inside the safe range — 2^53
// cents is ~$90 trillion — so parse it as a number and spare every call site a
// manual coercion. The parcel queries are unaffected: they select ::int counts
// and NUMERIC values, and already coerce defensively.
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

declare global {
  // eslint-disable-next-line no-var
  var _zioraPgPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — the parcel database is unavailable.");
  }
  if (!global._zioraPgPool) {
    global._zioraPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return global._zioraPgPool;
}
