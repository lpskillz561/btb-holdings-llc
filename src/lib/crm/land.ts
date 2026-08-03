// Land sourcing for a specific client.
//
// This is the join between the CRM and the parcel database the portal already
// runs on: the same `searchArea` that powers /research, but pre-filtered to the
// criteria on the client's record, with each result saveable to their shortlist
// and assessable against their particular tax and income position.
//
// Nothing here re-implements parcel search. It narrows it, records the answer,
// and asks the model a question only this client's record makes answerable.

import {
  lookupProperty,
  searchArea,
  type AreaSearchResult,
  type SortKey,
  type UseKind,
} from "@/lib/parcels";
import { CrmError, logActivity, newId, nowIso, query, queryOne, str } from "./db";
import { buildSystemPrompt, isAiConfigured, structuredChat } from "./ai";
import { fmtAcres, fmtMoney } from "./format";
import {
  MIN_VIABLE_PADS,
  PAD_FOOTPRINT_SQFT,
  USABLE_SHARE_BPS,
  siteFit,
} from "./siteScore";
import { getClient } from "./clients";
import type { CrmClient, CrmSavedParcel } from "./types";

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

export interface ClientLandSearchParams {
  area?: string | null;
  page?: number;
  landOnly?: boolean;
  /** Current-use preset over the FL DOR code. Not zoning — see USE_KINDS. */
  useKind?: UseKind;
  minAcres?: number | null;
  maxAcres?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  sort?: SortKey;
  knownTotal?: number;
}

/**
 * Run a parcel search on the client's behalf.
 *
 * Every criterion falls back to the client record, so opening the tab and
 * pressing search immediately reflects what was agreed with them — the point of
 * having the search inside the client card rather than beside it. An explicit
 * parameter always wins, so the operator can still range outside the brief.
 *
 * Prices on the client record are cents (as everywhere in the CRM); `searchArea`
 * deals in whole dollars, so they are converted here rather than at the edges.
 */
export async function searchLandForClient(
  client: CrmClient,
  params: ClientLandSearchParams,
): Promise<AreaSearchResult> {
  const area = str(params.area) ?? client.target_county ?? client.target_state;
  if (!area) {
    throw new CrmError(
      "No search area. Set a target state or county on the client, or type an area to search.",
      400,
    );
  }

  const maxPriceDollars =
    params.maxPrice ??
    (client.target_max_price_cents != null ? client.target_max_price_cents / 100 : undefined);

  return searchArea(area, params.page ?? 1, {
    // Vacant land by default: a parcel with a house on it isn't a tiny-home site.
    // A current-use preset overrides this inside searchArea, because an existing
    // park is improved property.
    landOnly: params.landOnly ?? true,
    useKind: params.useKind,
    minAcres: params.minAcres ?? client.target_min_acres ?? undefined,
    maxAcres: params.maxAcres ?? client.target_max_acres ?? undefined,
    minPrice: params.minPrice ?? undefined,
    maxPrice: maxPriceDollars ?? undefined,
    sort: params.sort,
    knownTotal: params.knownTotal,
  });
}

/* -------------------------------------------------------------------------- */
/* Shortlist                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Add a parcel to a client's shortlist.
 *
 * The parcel's details are copied onto the row rather than joined at read time.
 * The assessment roll is re-imported wholesale by the ETL, so a parcel can
 * change or vanish underneath us; a shortlist that renders blank after a
 * re-import is worse than one holding a slightly stale snapshot. The
 * `parcel_key` is kept so the live record is always one lookup away.
 *
 * Re-saving the same parcel refreshes that snapshot and leaves the operator's
 * status and notes alone (unique index `crm_saved_parcels_uniq`).
 */
export async function saveParcelForClient(
  clientId: string,
  parcelKey: string,
  actor?: string | null,
): Promise<CrmSavedParcel> {
  const client = await getClient(clientId);
  const key = str(parcelKey);
  if (!key) throw new CrmError("A parcel id is required.", 400);

  const report = await lookupProperty(key);
  if (!report.found) throw new CrmError("That parcel is no longer in the parcel database.", 404);

  const row = await queryOne<CrmSavedParcel>(
    `INSERT INTO crm_saved_parcels
       (id, client_id, parcel_key, status, one_line, owner_name, state, county, acres,
        assessed_value_cents, land_value_cents, saved_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'shortlisted', $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     ON CONFLICT (client_id, parcel_key) DO UPDATE SET
       one_line = EXCLUDED.one_line,
       owner_name = EXCLUDED.owner_name,
       state = EXCLUDED.state,
       county = EXCLUDED.county,
       acres = EXCLUDED.acres,
       assessed_value_cents = EXCLUDED.assessed_value_cents,
       land_value_cents = EXCLUDED.land_value_cents,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      newId(),
      clientId,
      key,
      report.summary.oneLine ?? null,
      report.summary.owner ?? null,
      key.split(":")[0] || null,
      report.summary.county ?? null,
      report.summary.lotSizeAcres ?? null,
      report.tax.assessedTotal != null ? Math.round(report.tax.assessedTotal * 100) : null,
      report.tax.landValue != null ? Math.round(report.tax.landValue * 100) : null,
      actor ?? null,
      nowIso(),
    ],
  );
  if (!row) throw new CrmError("Could not save the parcel.", 500);

  await logActivity({
    entity_type: "crm_saved_parcels",
    entity_id: row.id,
    client_id: clientId,
    verb: "shortlisted",
    summary: `Shortlisted ${report.summary.oneLine ?? key} for ${client.name}`,
    actor_email: actor,
  });
  return row;
}

/**
 * Promote a shortlisted parcel to a land holding once it's actually acquired,
 * carrying the snapshot across so nothing is re-typed.
 */
export async function convertSavedParcelToHolding(
  savedId: string,
  actor?: string | null,
): Promise<{ property_id: string }> {
  const saved = await queryOne<CrmSavedParcel>(`SELECT * FROM crm_saved_parcels WHERE id = $1`, [
    savedId,
  ]);
  if (!saved) throw new CrmError("Saved parcel not found.", 404);

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM crm_properties WHERE client_id = $1 AND parcel_key = $2`,
    [saved.client_id, saved.parcel_key],
  );
  if (existing) {
    throw new CrmError("That parcel is already recorded as a land holding for this client.", 409);
  }

  const id = newId();
  const ts = nowIso();
  await query(
    `INSERT INTO crm_properties
       (id, client_id, label, status, parcel_key, address, county, state, acres,
        assessed_value_cents, created_at, updated_at)
     VALUES ($1, $2, $3, 'under_contract', $4, $5, $6, $7, $8, $9, $10, $10)`,
    [
      id,
      saved.client_id,
      saved.one_line ?? saved.parcel_key,
      saved.parcel_key,
      saved.one_line,
      saved.county,
      saved.state,
      saved.acres,
      saved.assessed_value_cents,
      ts,
    ],
  );
  await query(
    `UPDATE crm_saved_parcels SET status = 'under_contract', updated_at = $2 WHERE id = $1`,
    [savedId, ts],
  );

  await logActivity({
    entity_type: "crm_properties",
    entity_id: id,
    client_id: saved.client_id,
    verb: "created",
    summary: `Promoted ${saved.one_line ?? saved.parcel_key} from shortlist to a land holding`,
    actor_email: actor,
  });
  return { property_id: id };
}

/* -------------------------------------------------------------------------- */
/* AI fit assessment                                                           */
/* -------------------------------------------------------------------------- */

export interface ParcelFit {
  verdict: "Strong fit" | "Worth a look" | "Poor fit";
  confidence: "low" | "medium" | "high";
  headline: string;
  rationale: string;
  strengths: string[];
  concerns: string[];
  nextSteps: string[];
  dataGaps: string[];
}

const FIT_SCHEMA = {
  name: "parcel_client_fit",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "verdict",
      "confidence",
      "headline",
      "rationale",
      "strengths",
      "concerns",
      "nextSteps",
      "dataGaps",
    ],
    properties: {
      verdict: { type: "string", enum: ["Strong fit", "Worth a look", "Poor fit"] },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      headline: { type: "string" },
      rationale: { type: "string" },
      strengths: { type: "array", items: { type: "string" } },
      concerns: { type: "array", items: { type: "string" } },
      nextSteps: { type: "array", items: { type: "string" } },
      dataGaps: { type: "array", items: { type: "string" } },
    },
  },
} as const;

const FIT_BRIEF = `Assess this specific parcel as a site for THIS client's tiny-home placement — not as a generic land deal.

Judge it on:
- Fit against the client's recorded land criteria, budget and capital.
- Whether the lot can plausibly host the number of units this client's deduction target implies. You may reason about scale in words; do not compute dollar figures.
- Siting reality: acreage, land classification, and whether the assessment record suggests unimproved land.
- What would have to be true for this to work — access, utilities, septic/well, zoning and short-term-rental rules — none of which is in the assessment roll, so route them to dataGaps and nextSteps rather than assuming them.

Hard limits on what you can see: this is county assessment-roll data only. You do NOT have zoning, permitted use, utility availability, road access, flood zone, topography, deed restrictions, or whether the owner will sell. Never assert any of those. An assessed value is not a market price and not an asking price.

Be willing to say "Poor fit". A shortlist that says yes to everything is worthless.`;

/**
 * An AI read on one parcel for one client. The result is cached on the saved
 * row, so re-opening the shortlist doesn't re-bill the model; pass `force` to
 * refresh after the client's criteria change.
 */
export async function assessParcelFit(
  clientId: string,
  parcelKey: string,
  opts: { force?: boolean } = {},
): Promise<ParcelFit> {
  if (!isAiConfigured()) {
    throw new CrmError(
      "AI assessment is unavailable: OPENAI_API_KEY is not set on the web service.",
      503,
    );
  }

  const saved = await queryOne<CrmSavedParcel>(
    `SELECT * FROM crm_saved_parcels WHERE client_id = $1 AND parcel_key = $2`,
    [clientId, parcelKey],
  );
  if (saved?.fit_json && !opts.force) {
    try {
      return JSON.parse(saved.fit_json) as ParcelFit;
    } catch {
      // Corrupt cache — fall through and regenerate.
    }
  }

  const client = await getClient(clientId);
  const report = await lookupProperty(parcelKey);
  if (!report.found) throw new CrmError("That parcel is no longer in the parcel database.", 404);

  const system = await buildSystemPrompt(clientId);

  const fit = await structuredChat<ParcelFit>(
    [
      { role: "system", content: `${system}\n\n---\n\n${FIT_BRIEF}` },
      {
        role: "user",
        content: [
          `Assess this parcel for ${client.name}.`,
          "",
          "--- PARCEL RECORD (county assessment roll) ---",
          JSON.stringify(report, null, 2),
          "",
          "--- SUMMARY IN WORDS (use these, do not recompute) ---",
          `Lot size: ${fmtAcres(report.summary.lotSizeAcres)}`,
          `Assessed value: ${report.tax.assessedTotal != null ? fmtMoney(Math.round(report.tax.assessedTotal * 100)) : "unknown"}`,
          `Assessor's land value: ${report.tax.landValue != null ? fmtMoney(Math.round(report.tax.landValue * 100)) : "unknown"}`,
          `Owner appears absentee: ${report.summary.absenteeOwner ? "yes" : "no"}`,
        ].join("\n"),
      },
    ],
    FIT_SCHEMA as never,
  );

  if (saved) {
    await query(`UPDATE crm_saved_parcels SET fit_json = $2, updated_at = $3 WHERE id = $1`, [
      saved.id,
      JSON.stringify(fit),
      nowIso(),
    ]);
  }
  return fit;
}

/* -------------------------------------------------------------------------- */
/* BTB's own land — is this a park site?                                       */
/* -------------------------------------------------------------------------- */

/**
 * The same read, asked the other question.
 *
 * `assessParcelFit` above judges a parcel against ONE CLIENT's criteria, and
 * needs the parcel already shortlisted for them. Under the current model the
 * client never buys ground — BTB does — so the global land search needs a
 * different question entirely: would this make a park? Different facts,
 * different brief, same hard limits on what an assessment roll can tell you.
 *
 * Deliberately NOT cached. The client version caches on the saved row because a
 * shortlist gets re-opened; this one is a button someone presses on a specific
 * row they are already looking at, so a cache would be a table to maintain for
 * a cost nobody is paying twice.
 */
const SITE_BRIEF = `Assess this parcel as a site for BTB to BUY and develop into a tiny-home park.

BTB owns the land. Clients buy only the home, which stands on a numbered pad BTB provides and manages. So the question is not "is this good land" in the abstract — it is whether this parcel would carry enough pads, at a land cost per pad that leaves the programme's economics intact.

Judge it on:
- The pad capacity and land-cost-per-pad figures supplied below. They are ALREADY CALCULATED — use them exactly and never recompute or restate a dollar figure.
- Whether the parcel clears the minimum viable pad count, and by how much. A site one pad over the line is not the same as one with room to phase.
- Whether the land classification and assessed value are consistent with genuinely unimproved ground rather than something already built on.
- Shape and scale risk you can reason about in words: a very large acreage at a low value per acre may be remote or unusable, and a small high-value lot may be priced as development land already.

Hard limits on what you can see: county assessment-roll data only. You do NOT have zoning, permitted use, utility availability, road access, flood zone, topography, wetlands, deed restrictions, short-term-rental rules, or whether the owner will sell. Those decide whether a park is possible at all, so route every one of them to dataGaps and nextSteps rather than assuming them. An assessed value is not a market price and not an asking price.

Be willing to say "Poor fit". A search that likes everything tells nobody anything.`;

/** Split "FL:64:1234-56" into its parts. Returns null on anything malformed. */
function splitParcelKey(key: string): { state: string; coNo: number; parcelId: string } | null {
  const parts = String(key ?? "").split(":");
  if (parts.length < 3) return null;
  const [state, coNo, ...rest] = parts;
  const n = Number(coNo);
  if (!state || !Number.isFinite(n)) return null;
  // Rejoin the remainder: a parcel id may itself contain a colon.
  return { state: state.toUpperCase(), coNo: n, parcelId: rest.join(":") };
}

interface ParcelRow {
  state: string;
  county: string | null;
  parcel_id: string;
  one_line: string | null;
  owner_name: string | null;
  use_label: string | null;
  is_land: boolean | null;
  acres: number | null;
  jv: number | null;
  lnd_val: number | null;
}

export async function assessParkSite(parcelKey: string): Promise<ParcelFit> {
  if (!isAiConfigured()) {
    throw new CrmError(
      "AI assessment is unavailable: OPENAI_API_KEY is not set on the web service.",
      503,
    );
  }

  const key = splitParcelKey(parcelKey);
  if (!key) throw new CrmError("That parcel reference is not valid.", 400);

  // Looked up server-side rather than trusted from the browser: the figures the
  // model reasons from must come from the database, not from a form field.
  const parcel = await queryOne<ParcelRow>(
    `SELECT state, county, parcel_id, one_line, owner_name, use_label, is_land, acres, jv, lnd_val
       FROM parcels WHERE state = $1 AND co_no = $2 AND parcel_id = $3 LIMIT 1`,
    [key.state, key.coNo, key.parcelId],
  );
  if (!parcel) throw new CrmError("That parcel is not in the database.", 404);

  // `parcels` is the ETL's table and its numerics come back as STRINGS —
  // node-postgres renders NUMERIC that way (same trap as the money aggregates
  // in CLAUDE.md). Skipping this coercion is not a formatting bug: siteFit
  // tests `typeof acres === "number"`, so a 640-acre parcel silently scored
  // ZERO pads and the model confidently advised rejecting it. lib/parcels.ts
  // coerces for exactly this reason.
  const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const acres = toNum(parcel.acres);
  const jv = toNum(parcel.jv);
  const lndVal = toNum(parcel.lnd_val);

  // Assessment-roll money is whole dollars; the CRM is cents.
  const assessedCents = jv != null ? Math.round(jv * 100) : null;
  const landValueCents = lndVal != null ? Math.round(lndVal * 100) : null;
  const fit = siteFit(acres, landValueCents ?? assessedCents);

  const facts = [
    `Parcel: ${parcel.one_line ?? parcel.parcel_id}`,
    `County: ${parcel.county ?? "unknown"}, ${parcel.state}`,
    `Owner of record: ${parcel.owner_name ?? "not recorded"}`,
    `Assessment classification: ${parcel.use_label ?? "not recorded"}${parcel.is_land ? " (flagged as land)" : ""}`,
    `Lot size: ${fmtAcres(acres)}`,
    `Assessed total: ${assessedCents == null ? "not recorded" : fmtMoney(assessedCents)}`,
    `Assessed land value: ${landValueCents == null ? "not recorded" : fmtMoney(landValueCents)}`,
    "",
    "## Pad economics — ALREADY CALCULATED. Use exactly these; never recompute.",
    `- Usable area assumed: ${USABLE_SHARE_BPS() / 100}% of the lot`,
    `- Pad footprint assumed: ${PAD_FOOTPRINT_SQFT().toLocaleString()} sq ft including access and setback`,
    `- Pads this parcel would carry: ${fit.padsThatFit}`,
    `- Minimum pad count considered viable: ${MIN_VIABLE_PADS()}`,
    `- Clears that minimum: ${fit.viable ? "yes" : "no"}`,
    `- Land cost per pad: ${fit.landCostPerPadCents == null ? "cannot be computed — no assessed value" : fmtMoney(fit.landCostPerPadCents)}`,
  ].join("\n");

  const system = await buildSystemPrompt(null);
  return structuredChat<ParcelFit>(
    [
      { role: "system", content: system },
      { role: "user", content: `${SITE_BRIEF}\n\n## The parcel\n${facts}` },
    ],
    FIT_SCHEMA,
  );
}
