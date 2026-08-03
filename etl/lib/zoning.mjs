// Zoning, kept in its OWN table on purpose.
//
// `import.mjs` refreshes a state by `DELETE FROM parcels WHERE state = $1`
// followed by a re-insert from staging. So a zoning column ON `parcels` would
// be silently blanked by every monthly run, and nothing would report it: the
// import would succeed, the row count would be right, and the column would just
// be null again. Zoning comes from a different publisher on a different
// cadence, so it lives in `parcel_zoning` and is joined at read time.
//
// **This is not the assessment roll's `dor_uc`.** `dor_uc` is what the property
// appraiser records a parcel as being USED as. Zoning is what the jurisdiction
// PERMITS. They disagree constantly and only the second one governs what may be
// built - see the note on RV use in the README.

/**
 * Keyed by the same (state, co_no, parcel_id) the CRM already joins parcels on.
 * `zoning_code` is stored EXACTLY as the county publishes it, prefix and all
 * (`ORG-A-1`, `WG-C-2`, `BAY-E`): the prefix is the jurisdiction, which is the
 * difference between a county district and a city one, and normalising it away
 * would lose the only thing that says which rulebook applies.
 */
export const ZONING_DDL = `
CREATE TABLE IF NOT EXISTS parcel_zoning (
  state        text NOT NULL,
  co_no        int  NOT NULL,
  parcel_id    text NOT NULL,
  zoning_code  text,
  jurisdiction text,
  source       text NOT NULL,
  source_key   text,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state, co_no, parcel_id)
)`;

export const ZONING_INDEXES = [
  // The CRM filters "show me parcels zoned X in this county".
  "CREATE INDEX IF NOT EXISTS parcel_zoning_code_idx ON parcel_zoning (state, co_no, zoning_code)",
];

/**
 * The county and the assessment roll encode the same parcel differently.
 *
 * Orange County FL publishes `SS-TT-RR-…`; the FDOR NAL ships `TT-RR-SS-…`.
 * Same fifteen digits, same trailing nine, first and third two-digit groups
 * exchanged. Traced by looking one parcel up by address in both:
 *
 *   ours   272128000000016  -> 3400 CLARCONA RD  (LOST LAKE RV PARK)
 *   county 282127000000016  -> 3400 CLARCONA RD  (LOST LAKE RV PARK)
 *
 * The swap is its own inverse, so one function converts in both directions.
 *
 * THE DANGER IS NOT A MISS, IT IS A HIT. The two encodings share an id space:
 * `312428000000005` exists in both datasets as DIFFERENT parcels. So joining
 * without the swap does not fail loudly, it attaches the wrong parcel's zoning
 * to a million-dollar land decision. Never write a row this produces without
 * also passing `addressesAgree` below.
 */
export function swapParcelId(id) {
  const s = String(id ?? "").trim();
  if (!/^\d{15}$/.test(s)) return null;
  return s.slice(4, 6) + s.slice(2, 4) + s.slice(0, 2) + s.slice(6);
}

/** The leading house number of a situs address, or null. */
function houseNumber(addr) {
  const m = String(addr ?? "").trim().match(/^(\d+)/);
  return m ? m[1] : null;
}

/** Owner names, reduced to something two publishers might both produce. */
function normOwner(name) {
  const s = String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  return s.length >= 6 ? s : null;
}

/**
 * The guard on the swap: the two records must corroborate each other on
 * something other than the id itself.
 *
 * Either the street numbers agree, or the owner names do. Street names are not
 * compared - the two publishers abbreviate differently ("N FORT WILDERNESS TRL"
 * vs "FORT WILDERNESS TRAIL") and that would reject good matches.
 *
 * THE OWNER LEG IS NOT OPTIONAL POLISH. A third of the land parcels we care
 * about have no street address at all - vacant land usually does not - so a
 * house-number-only guard rejected 1,566 of 5,000 in the first production run,
 * not because they were wrong but because they were unconfirmable. Measured:
 * 3,662 of Orange's 10,717 land parcels over 2 acres have no house number.
 *
 * UNKNOWN IS STILL NOT AGREEMENT. If neither leg can be evaluated, this returns
 * false and the row is skipped. A zoning code we cannot prove belongs to the
 * parcel is worse than none, because the reader cannot tell the difference.
 */
export function addressesAgree(ourAddr, theirAddr, ourOwner, theirOwner) {
  const a = houseNumber(ourAddr);
  const b = houseNumber(theirAddr);
  if (a !== null && b !== null) return a === b;

  const oa = normOwner(ourOwner);
  const ob = normOwner(theirOwner);
  if (oa !== null && ob !== null) {
    // Prefix rather than equality: one side truncates long names, and the roll
    // and the county disagree about trailing "ETAL", "TRUSTEE", "LLC".
    const n = Math.min(oa.length, ob.length, 14);
    return n >= 6 && oa.slice(0, n) === ob.slice(0, n);
  }
  return false;
}

/**
 * Upsert a batch. `fetched_at` moves on every write so a stale row is visible
 * as stale rather than merely old.
 */
export async function writeZoning(client, rows) {
  if (rows.length === 0) return 0;

  // Deduplicate by key before the upsert. Postgres refuses a statement whose
  // ON CONFLICT target is hit twice in one command - "cannot affect row a
  // second time" - and the county layer really does return a parcel more than
  // once, because a parcel with several polygons is several rows there and one
  // row here. Verified there are no duplicate (state, co_no, parcel_id) in
  // `parcels` itself, so the duplication is entirely upstream.
  //
  // Last wins, which is arbitrary and fine: the duplicates are the same parcel
  // carrying the same zoning code.
  const unique = new Map();
  for (const r of rows) unique.set(`${r.state}|${r.co_no}|${r.parcel_id}`, r);
  rows = [...unique.values()];

  const values = [];
  const params = [];
  rows.forEach((r, i) => {
    const o = i * 7;
    values.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7})`);
    params.push(r.state, r.co_no, r.parcel_id, r.zoning_code, r.jurisdiction, r.source, r.source_key);
  });
  const sql =
    `INSERT INTO parcel_zoning (state, co_no, parcel_id, zoning_code, jurisdiction, source, source_key)
     VALUES ${values.join(",")}
     ON CONFLICT (state, co_no, parcel_id) DO UPDATE SET
       zoning_code  = EXCLUDED.zoning_code,
       jurisdiction = EXCLUDED.jurisdiction,
       source       = EXCLUDED.source,
       source_key   = EXCLUDED.source_key,
       fetched_at   = now()`;
  const res = await client.query(sql, params);
  return res.rowCount ?? rows.length;
}
