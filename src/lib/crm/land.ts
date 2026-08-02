// Land sourcing for a specific client.
//
// This is the join between the CRM and the parcel database the portal already
// runs on: the same `searchArea` that powers /research, but pre-filtered to the
// criteria on the client's record, with each result saveable to their shortlist
// and assessable against their particular tax and income position.
//
// Nothing here re-implements parcel search. It narrows it, records the answer,
// and asks the model a question only this client's record makes answerable.

import { lookupProperty, searchArea, type AreaSearchResult, type SortKey } from "@/lib/parcels";
import { CrmError, logActivity, newId, nowIso, query, queryOne, str } from "./db";
import { buildSystemPrompt, isAiConfigured, structuredChat } from "./ai";
import { fmtAcres, fmtMoney } from "./format";
import { getClient } from "./clients";
import type { CrmClient, CrmSavedParcel } from "./types";

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

export interface ClientLandSearchParams {
  area?: string | null;
  page?: number;
  landOnly?: boolean;
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
    landOnly: params.landOnly ?? true,
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
