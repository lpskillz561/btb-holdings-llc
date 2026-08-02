// BTB's own book: the land we own, the pads on it, and what they earn.
//
// Distinct from ./clients, which answers "where does this account stand". This
// answers "what do we own, how much of it is working, and how much is left to
// build" — the questions that only exist now that BTB holds the land and the
// client holds only the home.
//
// Every money aggregate is cast ::bigint on purpose. `sum(bigint)` returns
// NUMERIC, node-postgres hands NUMERIC back as a *string*, and a string fails
// Number.isFinite and renders as an em dash. See CLAUDE.md.

import { CrmError, buildInsert, logActivity, newId, nowIso, query } from "./db";
import { DEFAULT_OCCUPANCY_BPS } from "./economics";
import type { CrmPad, CrmPark, CrmParkComment, CrmUnit } from "./types";

/** Nights in the modelled month. Occupancy is applied to this. */
export const NIGHTS_PER_MONTH = 30;

export interface ParkCapacity extends CrmPark {
  pad_count: number;
  occupied_pads: number;
  available_pads: number;
  /** Planned or building — capacity that exists on paper but earns nothing yet. */
  pipeline_pads: number;
  out_of_service_pads: number;
  /** Square footage of pads with a home on them. */
  occupied_sqft: number;
  total_pad_sqft: number;
  /** Land cost plus the site work across its pads. Never depreciable as land. */
  land_basis_cents: number;
  pad_site_work_cents: number;
  /** Sum of nightly rates on occupied pads. The revenue model's input. */
  occupied_nightly_cents: number;
}

/**
 * Every park with its pad counts.
 *
 * A LEFT JOIN so a park with no pads yet still appears — that is exactly the
 * park someone needs to see, because it is the one with work outstanding.
 */
export async function listParksWithCapacity(): Promise<ParkCapacity[]> {
  return query<ParkCapacity>(`
    SELECT
      p.*,
      count(d.id)::int                                                       AS pad_count,
      count(d.id) FILTER (WHERE d.status = 'occupied')::int                  AS occupied_pads,
      count(d.id) FILTER (WHERE d.status = 'available')::int                 AS available_pads,
      count(d.id) FILTER (WHERE d.status IN ('planned','building'))::int     AS pipeline_pads,
      count(d.id) FILTER (WHERE d.status = 'out_of_service')::int            AS out_of_service_pads,
      COALESCE(sum(d.pad_sqft) FILTER (WHERE d.status = 'occupied'), 0)::bigint AS occupied_sqft,
      COALESCE(sum(d.pad_sqft), 0)::bigint                                   AS total_pad_sqft,
      (COALESCE(p.purchase_price_cents, 0)
        + COALESCE(p.closing_costs_cents, 0))::bigint                        AS land_basis_cents,
      COALESCE(sum(d.site_work_cents), 0)::bigint                            AS pad_site_work_cents,
      COALESCE(sum(d.nightly_rate_cents)
        FILTER (WHERE d.status = 'occupied'), 0)::bigint                     AS occupied_nightly_cents
    FROM crm_parks p
    LEFT JOIN crm_pads d ON d.park_id = p.id
    GROUP BY p.id
    ORDER BY p.name ASC
  `);
}

export interface PadWithOccupant extends CrmPad {
  park_name: string;
  unit_id: string | null;
  unit_label: string | null;
  /** NULL where BTB owns the home standing on this pad. */
  unit_client_id: string | null;
  client_name: string | null;
}

/** Pads for one park, each with whatever home is standing on it. */
export async function listPadsForPark(parkId: string): Promise<PadWithOccupant[]> {
  return query<PadWithOccupant>(
    `SELECT d.*, p.name AS park_name,
            u.id AS unit_id, u.label AS unit_label, u.client_id AS unit_client_id,
            c.name AS client_name
     FROM crm_pads d
     JOIN crm_parks p ON p.id = d.park_id
     LEFT JOIN crm_units u ON u.pad_id = d.id
     LEFT JOIN crm_clients c ON c.id = u.client_id
     WHERE d.park_id = $1
     ORDER BY d.label ASC`,
    [parkId],
  );
}

export interface ClientFootprint {
  unit_id: string;
  unit_label: string;
  unit_status: string;
  build_method: string | null;
  purchase_price_cents: number | null;
  pad_id: string | null;
  pad_label: string | null;
  pad_sqft: number | null;
  nightly_rate_cents: number | null;
  park_id: string | null;
  park_name: string | null;
  park_acres: number | null;
  /**
   * The client's footprint as a share of the park, in basis points.
   *
   * Computed in SQL rather than in the page so the number is the same wherever
   * it is read. 43,560 is square feet in an acre.
   */
  share_of_park_bps: number | null;
}

/**
 * What a client owns and where it sits — the answer to "how much of our land
 * are they occupying".
 */
export async function getClientFootprint(clientId: string): Promise<ClientFootprint[]> {
  return query<ClientFootprint>(
    `SELECT
       u.id AS unit_id, u.label AS unit_label, u.status AS unit_status,
       u.build_method, u.purchase_price_cents,
       d.id AS pad_id, d.label AS pad_label, d.pad_sqft, d.nightly_rate_cents,
       p.id AS park_id, p.name AS park_name, p.acres AS park_acres,
       CASE
         WHEN p.acres IS NULL OR p.acres <= 0 OR d.pad_sqft IS NULL THEN NULL
         ELSE round((d.pad_sqft / (p.acres * 43560.0)) * 10000)::int
       END AS share_of_park_bps
     FROM crm_units u
     LEFT JOIN crm_pads d ON d.id = u.pad_id
     LEFT JOIN crm_parks p ON p.id = d.park_id
     WHERE u.client_id = $1
     ORDER BY u.created_at DESC`,
    [clientId],
  );
}

export interface BookSummary {
  parks: number;
  acres: number;
  pads_total: number;
  pads_occupied: number;
  pads_available: number;
  pads_pipeline: number;
  /** Homes BTB owns and rents itself (client_id IS NULL). */
  btb_units: number;
  btb_units_in_service: number;
  /** Homes owned by clients, sitting on BTB pads. */
  client_units: number;
  client_units_in_service: number;
  land_basis_cents: number;
  site_work_cents: number;
  /** Nightly rate across every occupied pad. */
  occupied_nightly_cents: number;
}

export async function getBookSummary(): Promise<BookSummary> {
  const [row] = await query<BookSummary>(`
    SELECT
      (SELECT count(*) FROM crm_parks WHERE status <> 'prospect')::int        AS parks,
      (SELECT COALESCE(sum(acres), 0) FROM crm_parks
          WHERE status <> 'prospect')::double precision                        AS acres,
      (SELECT count(*) FROM crm_pads)::int                                    AS pads_total,
      (SELECT count(*) FROM crm_pads WHERE status = 'occupied')::int          AS pads_occupied,
      (SELECT count(*) FROM crm_pads WHERE status = 'available')::int         AS pads_available,
      (SELECT count(*) FROM crm_pads WHERE status IN ('planned','building'))::int AS pads_pipeline,
      (SELECT count(*) FROM crm_units WHERE client_id IS NULL)::int           AS btb_units,
      (SELECT count(*) FROM crm_units WHERE client_id IS NULL
          AND status = 'in_service')::int                                     AS btb_units_in_service,
      (SELECT count(*) FROM crm_units WHERE client_id IS NOT NULL)::int       AS client_units,
      (SELECT count(*) FROM crm_units WHERE client_id IS NOT NULL
          AND status = 'in_service')::int                                     AS client_units_in_service,
      (SELECT COALESCE(sum(COALESCE(purchase_price_cents,0)
          + COALESCE(closing_costs_cents,0)), 0) FROM crm_parks
          WHERE status <> 'prospect')::bigint                                  AS land_basis_cents,
      (SELECT COALESCE(sum(site_work_cents), 0) FROM crm_pads)::bigint        AS site_work_cents,
      (SELECT COALESCE(sum(nightly_rate_cents), 0) FROM crm_pads
          WHERE status = 'occupied')::bigint                                  AS occupied_nightly_cents
  `);
  return row;
}

export interface MonthProjection {
  month: number;
  label: string;
  nights: number;
  gross_cents: number;
}

/**
 * Twelve months of projected gross rental revenue across the occupied pads.
 *
 * A projection, not history — there is no booking data yet, so this is the
 * nightly rate times occupancy, and it says so wherever it is drawn. When real
 * bookings land, this is the function to replace, not the chart.
 *
 * Deliberately flat month to month: inventing a seasonality curve would make
 * the chart look informative while being fiction. A real curve belongs here
 * once there is data to derive one from.
 */
export function projectYear(
  nightlyCents: number,
  occupancyBps: number = DEFAULT_OCCUPANCY_BPS(),
): MonthProjection[] {
  const nights = Math.round((NIGHTS_PER_MONTH * occupancyBps) / 10_000);
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return labels.map((label, i) => ({
    month: i + 1,
    label,
    nights,
    gross_cents: nightlyCents * nights,
  }));
}

export function annualGrossCents(
  nightlyCents: number,
  occupancyBps: number = DEFAULT_OCCUPANCY_BPS(),
): number {
  return projectYear(nightlyCents, occupancyBps).reduce((sum, m) => sum + m.gross_cents, 0);
}

/* -------------------------------------------------------------------------- */
/* Placing a client on land we already own                                     */
/* -------------------------------------------------------------------------- */

/** Pads that can actually take a home, newest parks first. */
export async function listAvailablePads(): Promise<
  { id: string; label: string; park_id: string; park_name: string; pad_sqft: number | null }[]
> {
  return query(
    `SELECT d.id, d.label, d.park_id, p.name AS park_name, d.pad_sqft
     FROM crm_pads d
     JOIN crm_parks p ON p.id = d.park_id
     WHERE d.status = 'available'
     ORDER BY p.name ASC, d.label ASC`,
  );
}

/**
 * Put a client's home on one of our pads.
 *
 * This is the operation the client form needs and did not have: under the
 * current model a new client is placed on land BTB already owns, so "which pad"
 * is part of taking them on, not an afterthought.
 *
 * Creates the home and flips the pad to occupied together. The pad status is
 * what every capacity figure counts, so leaving it `available` with a home
 * standing on it would overstate what BTB can still sell.
 */
export async function placeClientOnPad(
  clientId: string,
  padId: string,
  label: string,
  actor?: string | null,
): Promise<CrmUnit> {
  const [pad] = await query<{ id: string; status: string; park_name: string }>(
    `SELECT d.id, d.status, p.name AS park_name
     FROM crm_pads d JOIN crm_parks p ON p.id = d.park_id
     WHERE d.id = $1`,
    [padId],
  );
  if (!pad) throw new CrmError("That pad does not exist.", 404);
  if (pad.status === "occupied") {
    throw new CrmError("That pad already has a home on it.", 409);
  }

  const stamp = nowIso();
  const { sql, params } = buildInsert("crm_units", {
    id: newId(),
    client_id: clientId,
    pad_id: padId,
    label: label.trim() || `Home on ${pad.park_name}`,
    status: "planned",
    unit_use: "short_term_rental",
    created_at: stamp,
    updated_at: stamp,
  });
  const [unit] = await query<CrmUnit>(sql, params);

  await query(`UPDATE crm_pads SET status = 'occupied', updated_at = $2 WHERE id = $1`, [
    padId,
    stamp,
  ]);

  await logActivity({
    entity_type: "unit",
    entity_id: unit.id,
    client_id: clientId,
    verb: "placed",
    summary: `Placed ${unit.label} on pad ${padId} at ${pad.park_name}`,
    actor_email: actor ?? null,
  });
  return unit;
}

/* -------------------------------------------------------------------------- */
/* Land prospects — saved listings and the discussion about them               */
/* -------------------------------------------------------------------------- */

export interface LandProspect extends CrmPark {
  comment_count: number;
  last_comment_at: string | null;
}

/**
 * Land we are considering buying: a park record with a listing on it.
 *
 * A prospect and a park BTB owns are the same row at different points in its
 * life, so buying one is a status change rather than a copy between two tables.
 */
export async function listLandProspects(): Promise<LandProspect[]> {
  return query<LandProspect>(`
    SELECT p.*,
           count(c.id)::int      AS comment_count,
           max(c.created_at)     AS last_comment_at
    FROM crm_parks p
    LEFT JOIN crm_park_comments c ON c.park_id = p.id
    WHERE p.listing_url IS NOT NULL
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `);
}

export async function listParkComments(parkId: string): Promise<CrmParkComment[]> {
  return query<CrmParkComment>(
    `SELECT * FROM crm_park_comments WHERE park_id = $1 ORDER BY created_at ASC`,
    [parkId],
  );
}

export async function addParkComment(
  parkId: string,
  authorEmail: string,
  body: string,
): Promise<CrmParkComment> {
  const text = body.trim();
  if (!text) throw new CrmError("A comment cannot be empty.", 400);

  const stamp = nowIso();
  const { sql, params } = buildInsert("crm_park_comments", {
    id: newId(),
    park_id: parkId,
    author_email: authorEmail,
    body: text,
    created_at: stamp,
    updated_at: stamp,
  });
  const [row] = await query<CrmParkComment>(sql, params);
  return row;
}

/**
 * A readable name from a listing URL, for when someone just pastes a link.
 *
 * Zillow encodes the address in the slug — ".../homedetails/123-Main-St-
 * Bozeman-MT-59715/12345_zpid/" — so the common case gets a real name with no
 * typing. Anything unrecognised falls back to the host, which is at least
 * honest about what we know.
 */
export function nameFromListingUrl(url: string): string {
  try {
    const u = new URL(url);
    const slug = u.pathname
      .split("/")
      .filter(Boolean)
      .find((seg) => /-/.test(seg) && !/_zpid$/.test(seg));
    if (slug) {
      const pretty = slug.replace(/-/g, " ").replace(/\s+/g, " ").trim();
      if (pretty.length > 3) return pretty;
    }
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "Saved listing";
  }
}

/* -------------------------------------------------------------------------- */
/* Backfilling a saved listing from county records                            */
/* -------------------------------------------------------------------------- */

export interface ParsedListingAddress {
  street: string | null;
  state: string | null;
  zip: string | null;
  houseNumber: string | null;
}

/**
 * Pull an address out of a listing URL.
 *
 * Zillow, Redfin and Realtor all put the address in the path slug, which is
 * public information in a link somebody chose to paste — no page is fetched and
 * nothing is scraped. "40-Acres-Gallatin-Rd-Bozeman-MT-59718" gives us the
 * state and ZIP reliably; the street/city boundary is genuinely ambiguous in a
 * hyphen-joined slug, so only the leading house number is trusted from it.
 */
export function parseListingAddress(url: string): ParsedListingAddress {
  const empty = { street: null, state: null, zip: null, houseNumber: null };
  try {
    const seg = new URL(url).pathname
      .split("/")
      .filter(Boolean)
      .find((s) => /-[A-Z]{2}-\d{5}$/i.test(s));
    if (!seg) return empty;
    const parts = seg.split("-");
    const zip = parts.at(-1) ?? null;
    const state = (parts.at(-2) ?? "").toUpperCase() || null;
    const rest = parts.slice(0, -2);
    const houseNumber = /^\d+$/.test(rest[0] ?? "") ? rest[0] : null;
    return { street: rest.join(" ") || null, state, zip, houseNumber };
  } catch {
    return empty;
  }
}

export interface BackfillResult {
  matched: boolean;
  reason: string;
  park?: CrmPark;
}

/**
 * Fill a saved listing's blanks from the parcel database.
 *
 * DELIBERATELY CONSERVATIVE. It fills only when the ZIP and house number
 * identify exactly ONE parcel. Attaching the wrong parcel's acreage and
 * assessed value to a listing someone is about to spend a million dollars
 * against is far worse than leaving the fields blank, so an ambiguous match
 * writes nothing and says why.
 *
 * It also never overwrites a value a human typed — asking price in particular
 * is MLS data the county does not have, and is the one field that must survive.
 */
export async function backfillProspect(parkId: string): Promise<BackfillResult> {
  const [park] = await query<CrmPark>(`SELECT * FROM crm_parks WHERE id = $1`, [parkId]);
  if (!park) throw new CrmError("No such listing.", 404);
  if (!park.listing_url) return { matched: false, reason: "This record has no listing link." };

  const addr = parseListingAddress(park.listing_url);
  if (!addr.zip || !addr.state) {
    return { matched: false, reason: "Could not read an address from that link." };
  }

  const candidates = await query<{
    county: string | null; state: string | null; situs_city: string | null;
    situs_addr: string | null; acres: number | null; jv: number | null;
    lnd_val: number | null; owner_name: string | null; parcel_id: string | null;
  }>(
    `SELECT county, state, situs_city, situs_addr, acres, jv, lnd_val, owner_name, parcel_id
     FROM parcels
     WHERE situs_zip = $1
       AND state = $2
       AND ($3::text IS NULL OR situs_addr ILIKE $3 || ' %')
     LIMIT 5`,
    [addr.zip, addr.state, addr.houseNumber],
  ).catch(() => []);

  if (candidates.length === 0) {
    return {
      matched: false,
      reason: `No parcel in ${addr.state} ${addr.zip} matched. That state may not be imported yet.`,
    };
  }
  if (candidates.length > 1) {
    return {
      matched: false,
      reason: `${candidates.length} parcels matched that address — too ambiguous to fill automatically.`,
    };
  }

  const p = candidates[0];
  // COALESCE keeps anything already recorded: the county cannot tell us the
  // asking price, and a human's entry outranks a guess.
  const [updated] = await query<CrmPark>(
    `UPDATE crm_parks SET
       county            = COALESCE(county, $2),
       state             = COALESCE(state, $3),
       city              = COALESCE(city, $4),
       address           = COALESCE(address, $5),
       acres             = COALESCE(acres, $6),
       assessed_value_cents = COALESCE(assessed_value_cents, $7),
       parcel_key        = COALESCE(parcel_key, $8),
       updated_at        = $9
     WHERE id = $1
     RETURNING *`,
    [
      parkId, p.county, p.state, p.situs_city, p.situs_addr, p.acres,
      p.jv === null ? null : Math.round(p.jv * 100),
      p.parcel_id ? `${p.state}:${p.parcel_id}` : null,
      nowIso(),
    ],
  );

  return {
    matched: true,
    reason: `Matched parcel ${p.parcel_id ?? ""} in ${p.county ?? "?"} County${
      p.owner_name ? `, owned by ${p.owner_name}` : ""
    }.`,
    park: updated,
  };
}

/** Backfill every saved listing that is still missing acreage or value. */
export async function backfillAllProspects(): Promise<{ filled: number; skipped: number }> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM crm_parks
     WHERE listing_url IS NOT NULL
       AND (acres IS NULL OR assessed_value_cents IS NULL)`,
  );
  let filled = 0;
  let skipped = 0;
  for (const r of rows) {
    const res = await backfillProspect(r.id).catch(() => ({ matched: false } as BackfillResult));
    res.matched ? filled++ : skipped++;
  }
  return { filled, skipped };
}
