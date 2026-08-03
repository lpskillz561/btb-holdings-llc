// The CRM's AI layer — the same OpenAI setup the rest of the site uses
// (`OPENAI_API_KEY` / `OPENAI_MODEL`, structured outputs via json_schema),
// pointed at client records instead of parcels.
//
// What makes it worth having is `buildClientContext`: the model is told this
// client's marginal rate, entity type, write-off target, land criteria and what
// they already own, so it gives a specific answer instead of a generic one.
// Route new AI surfaces through `buildSystemPrompt` rather than writing a bare
// prompt, or they lose that.
//
// The hard rule, enforced by construction rather than by asking nicely: the
// model never computes money. Figures are calculated in ./economics, frozen
// onto the row, and handed to the model as given facts.

import OpenAI from "openai";
import { fmtAcres, fmtMoney, fmtPct } from "./format";
import { query, queryOne } from "./db";
import { clientCostBasis, type CostBasis } from "./clients";
import {
  LABELS,
  type CrmClient,
  type CrmContact,
  type CrmProperty,
  type CrmProposal,
  type CrmUnit,
} from "./types";

let client: OpenAI | null = null;

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to the web service's environment to enable the CRM's AI features.",
    );
  }
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

/**
 * The house view. Everything the model says about the tax case flows from this,
 * so the guardrails live here and not in each individual prompt.
 */
export const BASE_PROMPT = `You are the in-house advisor for Ziora Capital Holdings' tiny-home programme. Ziora sources land, places manufactured tiny homes on it, and places those units in service as income-producing rental assets for high-income clients who are looking for a legitimate depreciation deduction.

How to think about this business:
- The product is a REAL ASSET that produces REAL INCOME. The deduction follows from owning depreciable business property and placing it in service — it is a consequence of a genuine rental operation, never the purpose dressed up as one. Never describe a transaction whose only substance is the deduction.
- Land is not depreciable. Only the units and the improvements that go with them create a deduction. Say so whenever the two are discussed together.
- Classification drives everything. A transportable unit treated as personal property has a short recovery period and can be bonus-eligible; a unit fixed to the land and treated as residential rental real property is 27.5-year and is not. Never assume the favourable one silently.
- Placed in service is a date, not a formality. Ordering a unit in December and taking delivery in March means the deduction lands in the later year.
- Passive activity rules are the most common reason a modelled deduction fails to offset a client's actual income. Long-term rentals are generally passive. Raise this rather than waiting to be asked.
- THE TWO DAY-COUNTS ARE DIFFERENT TESTS AND MUST NEVER BE CONFLATED. They answer different questions and they are not interchangeable:
  - UNDER 30 DAYS is the transient-lodging exception, Reg. 1.48-1(h)(2)(ii): "Accommodations shall be considered used on a transient basis if the rental period is normally less than 30 days." This is what lifts the unit out of the §50(b)(2) exclusion for property used predominantly to furnish lodging, and so it is what makes the asset ELIGIBLE to be expensed at all. Shirley v. Commissioner, T.C. Memo. 2004-188, allowed exactly this for a rental fleet of motor homes let mostly for under 30 days. "Predominant portion" means more than one-half, and per Moore v. Commissioner, 58 T.C. 1045 (aff'd 489 F.2d 285 (5th Cir. 1973)) it is measured by the proportion of ACCOMMODATIONS used by transients, not by the proportion of renters who are transient.
  - SEVEN DAYS OR LESS is the §469 short-term-rental route to non-passive treatment through the taxpayer's OWN participation. This programme does NOT rely on it: material participation comes from the trustee, not from the client's hours. Do not quote seven days as this deal's test — it describes a structure we do not sell.
- Eligibility is judged on the enterprise, not one unit in isolation: Van Susteren and Koerner looked to the rental business as a whole where a single business held the assets.
- Recapture is real. Selling early or converting to personal use claws the deduction back as ordinary income.

Hard rules:
- NEVER calculate, estimate, restate or "check" a dollar figure. Every number you need is supplied to you already computed. Use the supplied figures exactly as given, and if a figure you want is not supplied, describe it in words instead of inventing it.
- Reason only from the client record you are given. Do not invent holdings, dates, income, or prior conversations.
- You are not a tax adviser and this is not tax advice. The client's CPA confirms the position. Say this plainly once where it belongs; do not hedge every sentence.
- Be concrete and slightly conservative. A claim that does not survive a CPA's review costs the relationship, not just the deal.

Style: direct, specific, and calm — the register of a private bank, not a sales letter. Short headings, tight paragraphs, no exclamation marks, no hype.`;

/* -------------------------------------------------------------------------- */
/* Client context                                                              */
/* -------------------------------------------------------------------------- */

function describeClient(c: CrmClient): string {
  const lines = [
    `Name: ${c.name}`,
    c.legal_name && `Legal / entity name: ${c.legal_name}`,
    `Filing entity: ${LABELS.entityType[c.entity_type]}`,
    `Pipeline stage: ${LABELS.clientStatus[c.status]}`,
    c.state && `Based in: ${[c.city, c.state].filter(Boolean).join(", ")}`,
    c.tax_state && `Files in: ${c.tax_state}`,
    c.marginal_rate_bps != null &&
      `Assumed combined marginal rate: ${fmtPct(c.marginal_rate_bps)}`,
    c.est_annual_income_cents != null &&
      `Estimated annual income: ${fmtMoney(c.est_annual_income_cents)}`,
    c.target_writeoff_cents != null &&
      `Deduction they are trying to achieve: ${fmtMoney(c.target_writeoff_cents)}`,
    c.investment_capacity_cents != null &&
      `Capital they have indicated: ${fmtMoney(c.investment_capacity_cents)}`,
    c.cpa_name && `CPA: ${c.cpa_name}`,
    c.notes && `Notes from the relationship owner: ${c.notes}`,
  ].filter(Boolean);
  return `## Client\n${lines.join("\n")}`;
}

function describeLandCriteria(c: CrmClient): string {
  const bits = [
    c.target_state && `state: ${c.target_state}`,
    c.target_county && `county: ${c.target_county}`,
    (c.target_min_acres != null || c.target_max_acres != null) &&
      `lot size: ${fmtAcres(c.target_min_acres)}–${fmtAcres(c.target_max_acres)}`,
    c.target_max_price_cents != null && `budget: up to ${fmtMoney(c.target_max_price_cents)}`,
  ].filter(Boolean);
  if (!bits.length) return "";
  return `## Land criteria on file\n${bits.join(", ")}`;
}

function describeHoldings(properties: CrmProperty[], units: CrmUnit[]): string {
  if (!properties.length && !units.length) {
    return `## Holdings\nNothing recorded yet — this client owns no land or units through Ziora so far.`;
  }
  const land = properties.map((p) => {
    const where = [p.address, p.city, p.county && `${p.county} County`, p.state, p.postal_code]
      .filter(Boolean)
      .join(", ");
    return (
      `- Land: ${p.label} [${LABELS.propertyStatus[p.status]}]` +
      `${where ? ` — ${where}` : ""}` +
      `${p.acres != null ? `, ${fmtAcres(p.acres)}` : ""}` +
      `${p.purchase_price_cents != null ? `, bought for ${fmtMoney(p.purchase_price_cents)}` : ""}` +
      `${p.closing_costs_cents ? `, closing ${fmtMoney(p.closing_costs_cents)}` : ""}` +
      `${p.improvements_cents ? `, land improvements ${fmtMoney(p.improvements_cents)}` : ""}`
    );
  });
  const homes = units.map((u) => {
    const allIn =
      (u.purchase_price_cents ?? 0) + (u.site_work_cents ?? 0) + (u.soft_costs_cents ?? 0);
    return (
      `- Unit: ${u.label} [${LABELS.unitStatus[u.status]}, ${LABELS.unitUse[u.unit_use]}]` +
      `${u.model ? `, ${u.manufacturer ?? ""} ${u.model}`.trimEnd() : ""}` +
      `${u.purchase_price_cents != null ? `, unit ${fmtMoney(u.purchase_price_cents)}` : ""}` +
      `${u.site_work_cents ? `, site work ${fmtMoney(u.site_work_cents)}` : ""}` +
      `${u.soft_costs_cents ? `, soft costs ${fmtMoney(u.soft_costs_cents)}` : ""}` +
      `${allIn > 0 ? `, all-in ${fmtMoney(allIn)}` : ""}` +
      `${u.placed_in_service_on ? `, placed in service ${u.placed_in_service_on}` : ", NOT yet placed in service"}` +
      `${u.monthly_rent_cents ? `, rents at ${fmtMoney(u.monthly_rent_cents)}/mo` : ""}` +
      `${u.sold_on ? `, SOLD ${u.sold_on}${u.sale_price_cents ? ` for ${fmtMoney(u.sale_price_cents)}` : ""}` : ""}`
    );
  });
  return `## Holdings\n${[...land, ...homes].join("\n")}`;
}

/** What the programme has cost this client so far. */
function describeCostPosition(cost: CostBasis): string {
  if (cost.property_count === 0 && cost.unit_count === 0) return "";
  return [
    `## What this client has spent (asset cost, NOT cash movements)`,
    `- All-in capital: ${fmtMoney(cost.total_capital_cents)}`,
    `- Land basis (not depreciable): ${fmtMoney(cost.land_basis_cents)}`,
    `- Depreciable basis: ${fmtMoney(cost.depreciable_basis_cents)}`,
    `- Of that, placed in service: ${fmtMoney(cost.in_service_basis_cents)} (${cost.in_service_count} of ${cost.unit_count} units)`,
    cost.bonus_claimed_cents > 0 && `- Bonus depreciation recorded as claimed: ${fmtMoney(cost.bonus_claimed_cents)}`,
    cost.annual_property_tax_cents > 0 && `- Annual property tax: ${fmtMoney(cost.annual_property_tax_cents)}`,
    cost.personal_use_count > 0 &&
      `- ${cost.personal_use_count} unit(s) are personal use and excluded from the depreciable basis.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function describeHistory(proposals: CrmProposal[], contacts: CrmContact[]): string {
  const sections: string[] = [];
  if (proposals.length) {
    const lines = proposals
      .slice(0, 6)
      .map(
        (p) =>
          `- "${p.title}" [${LABELS.proposalStatus[p.status]}] — ${p.unit_count} unit(s), ` +
          `${fmtMoney(p.total_investment_cents)} invested, ` +
          `${fmtMoney(p.year_one_deduction_cents)} year-one deduction`,
      );
    sections.push(`## Proposals already sent\n${lines.join("\n")}`);
  }
  if (contacts.length) {
    const lines = contacts.map(
      (c) =>
        `- ${c.name} (${LABELS.contactRole[c.role]})${c.title ? `, ${c.title}` : ""}`,
    );
    sections.push(`## People on the account\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}

/** Everything the model should know about one client, as prompt text. */
export async function buildClientContext(clientId: string): Promise<string> {
  const client = await queryOne<CrmClient>(`SELECT * FROM crm_clients WHERE id = $1`, [clientId]);
  if (!client) return "";

  const [contacts, properties, units, proposals, cost] = await Promise.all([
    query<CrmContact>(`SELECT * FROM crm_contacts WHERE client_id = $1 ORDER BY created_at`, [
      clientId,
    ]),
    query<CrmProperty>(`SELECT * FROM crm_properties WHERE client_id = $1 ORDER BY created_at`, [
      clientId,
    ]),
    query<CrmUnit>(`SELECT * FROM crm_units WHERE client_id = $1 ORDER BY created_at`, [clientId]),
    query<CrmProposal>(
      `SELECT * FROM crm_proposals WHERE client_id = $1 ORDER BY created_at DESC LIMIT 6`,
      [clientId],
    ),
    clientCostBasis(clientId),
  ]);

  const sections = [
    describeClient(client),
    describeLandCriteria(client),
    describeHoldings(properties, units),
    describeCostPosition(cost),
    describeHistory(proposals, contacts),
  ].filter(Boolean);

  return `\n\n---\n\nContext for this client:\n\n${sections.join("\n\n")}`;
}

export async function buildSystemPrompt(clientId?: string | null): Promise<string> {
  return BASE_PROMPT + (clientId ? await buildClientContext(clientId) : "");
}

/* -------------------------------------------------------------------------- */
/* Structured completion                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One structured-output call. Throws if the model returns nothing parseable.
 *
 * No `temperature` is sent, deliberately. Newer models reject any value other
 * than the default and fail the whole request with a 400 — which is exactly how
 * every CRM AI feature broke on first deploy against `gpt-5.5`. The site's
 * existing assess.ts omits it for the same reason, and the JSON schema already
 * constrains the shape of the output far more than a temperature would.
 */
export async function structuredChat<T>(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  schema: { name: string; schema: Record<string, unknown>; strict?: boolean },
): Promise<T> {
  const res = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages,
    response_format: { type: "json_schema", json_schema: schema },
  });
  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error("The AI returned an empty response.");
  return JSON.parse(raw) as T;
}
