// Proposals — the document a client and their CPA actually read.
//
// The split that matters: the ECONOMICS COLUMNS are computed in ./economics and
// frozen onto the row at generation time, while `body_md` is prose the model
// wrote around them. They are stored and rendered separately, so editing the
// prose can never corrupt a figure, and a proposal still says the same thing
// next month after the underlying units change.
//
// That is also why the economics columns are not patchable. A proposal is a
// commercial document; to quote something different, generate a new one.

import {
  CrmError,
  buildInsert,
  buildUpdate,
  bps,
  cents,
  date,
  logActivity,
  newId,
  nowIso,
  num,
  oneOf,
  query,
  queryOne,
  str,
} from "./db";
import {
  DEFAULT_BONUS_RATE_BPS,
  DEFAULT_MARGINAL_RATE_BPS,
  DEFAULT_OCCUPANCY_BPS,
  DEFAULT_OPEX_BPS,
  DEFAULT_USEFUL_LIFE_YEARS,
  computeEconomics,
  coverageBps,
  type Economics,
} from "./economics";
import { buildSystemPrompt, isAiConfigured, structuredChat } from "./ai";
import { fmtMoney, fmtPct } from "./format";
import { getClient } from "./clients";
import { PROPOSAL_STATUSES, UNIT_USES, type CrmProposal, type UnitUse } from "./types";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listProposals(params: URLSearchParams = new URLSearchParams()): Promise<CrmProposal[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  // Archived proposals are off the board here too. Filtering only the page
  // query would leave the REST list showing rows that have "disappeared"
  // everywhere else — the same data by another door.
  if (params.get("archived") !== "true") where.push("p.archived_at IS NULL");
  const clientId = params.get("client_id");
  if (clientId) {
    binds.push(clientId);
    where.push(`p.client_id = $${binds.length}`);
  }
  const status = params.get("status");
  if (status && (PROPOSAL_STATUSES as readonly string[]).includes(status)) {
    binds.push(status);
    where.push(`p.status = $${binds.length}`);
  }
  return query<CrmProposal>(
    `SELECT p.* FROM crm_proposals p
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY p.created_at DESC LIMIT 300`,
    binds,
  );
}

/** Proposals with their client's name, for the global list. */
export async function listProposalsWithClient(): Promise<(CrmProposal & { client_name: string })[]> {
  return query<CrmProposal & { client_name: string }>(
    `SELECT p.*, c.name AS client_name
     FROM crm_proposals p JOIN crm_clients c ON c.id = p.client_id
     WHERE p.archived_at IS NULL
     ORDER BY p.created_at DESC LIMIT 300`,
  );
}

export async function getProposal(id: string): Promise<CrmProposal> {
  const row = await queryOne<CrmProposal>(`SELECT * FROM crm_proposals WHERE id = $1`, [id]);
  if (!row) throw new CrmError("Proposal not found.", 404);
  return row;
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                  */
/* -------------------------------------------------------------------------- */

export interface GenerateInput {
  client_id: string;
  title?: string;
  unit_count?: unknown;
  unit_cost?: unknown;
  site_work?: unknown;
  soft_costs?: unknown;
  land_cost?: unknown;
  /** Cash deposit; the balance is seller-financed on ./deal's terms. */
  down_payment?: unknown;
  marginal_rate?: unknown;
  bonus_rate?: unknown;
  useful_life_years?: unknown;
  monthly_rent?: unknown;
  occupancy?: unknown;
  opex?: unknown;
  unit_use?: unknown;
  valid_until?: unknown;
  instructions?: unknown;
}

const PROPOSAL_SCHEMA = {
  name: "tiny_home_proposal",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "executive_summary",
      "why_this_works",
      "the_asset",
      "the_tax_case",
      "operations",
      "timeline",
      "risks",
      "next_steps",
    ],
    properties: {
      executive_summary: {
        type: "string",
        description:
          "3-5 sentences for the client. What they are buying, what it produces, and what it does for their tax position. Reference the supplied figures; never restate them differently.",
      },
      why_this_works: {
        type: "string",
        description:
          "Why this is a real asset with real income rather than a paper deduction. Ground it in the rental operation.",
      },
      the_asset: {
        type: "string",
        description:
          "The land and the unit(s): what gets bought, sited and placed in service, and what the client ends up owning.",
      },
      the_tax_case: {
        type: "string",
        description:
          "How the deduction arises, in plain language a CPA would sign off on. State that land is not depreciable. Name the classification assumed and why it matters. Do NOT restate or recompute any dollar figure — a table of the figures is rendered separately.",
      },
      operations: {
        type: "string",
        description:
          "Who manages the unit, how it is rented, and what the client is and is not responsible for.",
      },
      timeline: {
        type: "string",
        description:
          "Realistic phases from signature to placed-in-service, and what that means for which tax year the deduction lands in.",
      },
      risks: {
        type: "array",
        items: { type: "string" },
        description:
          "Plain-language risks. Short sentences. Cover the commercial ones; the tax caveats are appended separately, so do not duplicate them.",
      },
      next_steps: {
        type: "array",
        items: { type: "string" },
        description: "Ordered, concrete actions, including confirming the position with their CPA.",
      },
    },
  },
} as const;

interface Generated {
  executive_summary: string;
  why_this_works: string;
  the_asset: string;
  the_tax_case: string;
  operations: string;
  timeline: string;
  risks: string[];
  next_steps: string[];
}

/**
 * Assemble the stored markdown. The figures table is rendered from the frozen
 * columns here, in code — the model contributes prose only.
 */
function renderBody(g: Generated, e: Economics, clientName: string): string {
  const figures = [
    "| | |",
    "|---|---|",
    `| Units | ${e.unitCount} |`,
    `| Units subtotal | ${fmtMoney(e.unitsSubtotalCents)} |`,
    `| Site work & soft costs | ${fmtMoney(e.improvementsCents)} |`,
    `| Land | ${fmtMoney(e.landCostCents)} |`,
    `| **Total investment** | **${fmtMoney(e.totalInvestmentCents)}** |`,
    `| Depreciable basis (excludes land) | ${fmtMoney(e.depreciableBasisCents)} |`,
    `| First-year deduction | ${fmtMoney(e.yearOneDeductionCents)} |`,
    `| Assumed marginal rate | ${fmtPct(e.marginalRateBps)} |`,
    `| **Estimated first-year tax benefit** | **${fmtMoney(e.yearOneTaxSavingsCents)}** |`,
    `| Net first-year outlay | ${fmtMoney(e.netYearOneOutlayCents)} |`,
    `| Projected net operating income | ${fmtMoney(e.annualNoiCents)} / yr |`,
    `| Cash-on-cash on net outlay | ${fmtPct(e.cashOnCashBps)} |`,
    `| Payback on net outlay | ${e.paybackYears === null ? "—" : `${e.paybackYears} yrs`} |`,
  ].join("\n");

  const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

  return [
    `## Summary\n\n${g.executive_summary}`,
    `## The figures\n\n${figures}`,
    `## Why this works\n\n${g.why_this_works}`,
    `## The asset\n\n${g.the_asset}`,
    `## The tax case\n\n${g.the_tax_case}`,
    `## Operations\n\n${g.operations}`,
    `## Timeline\n\n${g.timeline}`,
    `## Risks\n\n${list(g.risks)}`,
    `## What this depends on\n\n${list(e.caveats)}`,
    `## Next steps\n\n${list(g.next_steps)}`,
    `---\n\nPrepared for ${clientName} by Ziora Capital Holdings. Figures are estimates for discussion and are not tax, legal, or investment advice. Confirm the tax treatment with your own CPA before relying on it.`,
  ].join("\n\n");
}

export async function generateProposal(
  input: GenerateInput,
  actor?: string | null,
): Promise<CrmProposal> {
  if (!isAiConfigured()) {
    throw new CrmError(
      "AI proposal drafting is unavailable: OPENAI_API_KEY is not set on the web service.",
      503,
    );
  }

  const client = await getClient(input.client_id);

  // Every input either comes from the request, falls back to the client record,
  // or falls back to a configured default — in that order.
  const unitCount = Math.max(1, Math.round(num(input.unit_count) ?? 1));
  const unitCostCents = cents(input.unit_cost) ?? 0;
  if (unitCostCents <= 0) {
    throw new CrmError("Enter the cost per unit — the whole model depends on it.", 400);
  }

  const marginalRateBps =
    bps(input.marginal_rate) ?? client.marginal_rate_bps ?? DEFAULT_MARGINAL_RATE_BPS();
  const unitUse = oneOf<UnitUse>(input.unit_use, UNIT_USES, "long_term_rental");

  const economics = computeEconomics({
    unitCount,
    unitCostCents,
    siteWorkCents: cents(input.site_work) ?? 0,
    softCostsCents: cents(input.soft_costs) ?? 0,
    landCostCents: cents(input.land_cost) ?? 0,
    // undefined, NOT 0, when nobody supplied one. computeEconomics reads
    // absent as "use the configured default deposit" and an explicit 0 as a
    // deliberate all-cash deal; collapsing both to 0 here made every
    // API-generated proposal all-cash and destroyed the 10:1.
    downPaymentCents: cents(input.down_payment) ?? undefined,
    marginalRateBps,
    bonusRateBps: bps(input.bonus_rate) ?? DEFAULT_BONUS_RATE_BPS(),
    usefulLifeYears: num(input.useful_life_years) ?? DEFAULT_USEFUL_LIFE_YEARS(),
    monthlyRentCents: cents(input.monthly_rent) ?? 0,
    occupancyBps: bps(input.occupancy) ?? DEFAULT_OCCUPANCY_BPS(),
    opexBps: bps(input.opex) ?? DEFAULT_OPEX_BPS(),
    unitUse,
  });

  const coverage = coverageBps(economics.yearOneDeductionCents, client.target_writeoff_cents);
  const system = await buildSystemPrompt(client.id);

  const brief = [
    `Write the proposal for ${client.name}.`,
    "",
    "## What is being proposed",
    `- ${unitCount} tiny home unit(s), used as: ${unitUse.replace(/_/g, " ")}`,
    `- Recovery period assumed: ${economics.usefulLifeYears} years`,
    `- Bonus depreciation assumed: ${fmtPct(economics.bonusRateBps, { digits: 0 })}`,
    "",
    "## Figures — ALREADY CALCULATED. Use exactly these, never recompute or restate them differently.",
    `- Units subtotal: ${fmtMoney(economics.unitsSubtotalCents)}`,
    `- Site work and soft costs: ${fmtMoney(economics.improvementsCents)}`,
    `- Land: ${fmtMoney(economics.landCostCents)} (NOT depreciable)`,
    `- Total investment: ${fmtMoney(economics.totalInvestmentCents)}`,
    `- Depreciable basis: ${fmtMoney(economics.depreciableBasisCents)}`,
    `- First-year deduction: ${fmtMoney(economics.yearOneDeductionCents)}`,
    `- Assumed marginal rate: ${fmtPct(economics.marginalRateBps)}`,
    `- Estimated first-year tax benefit: ${fmtMoney(economics.yearOneTaxSavingsCents)}`,
    `- Net first-year outlay: ${fmtMoney(economics.netYearOneOutlayCents)}`,
    `- Projected annual net operating income: ${fmtMoney(economics.annualNoiCents)}`,
    `- Cash-on-cash on net outlay: ${fmtPct(economics.cashOnCashBps)}`,
    `- Payback: ${economics.paybackYears === null ? "not reached from operations alone" : `${economics.paybackYears} years`}`,
    coverage !== null
      ? `- This covers ${fmtPct(coverage, { digits: 0 })} of the ${fmtMoney(client.target_writeoff_cents)} deduction the client is targeting.`
      : "",
    "",
    "A table of these figures is rendered separately above your prose — reference them in sentences rather than tabulating them again.",
    "",
    "## Conditions that will be appended verbatim after your sections — do not repeat them",
    ...economics.caveats.map((c) => `- ${c}`),
  ]
    .filter(Boolean)
    .join("\n");

  const instructions = str(input.instructions);

  const generated = await structuredChat<Generated>(
    [
      { role: "system", content: `${system}\n\n---\n\n${brief}` },
      {
        role: "user",
        content: instructions || `Draft the proposal for ${client.name}.`,
      },
    ],
    PROPOSAL_SCHEMA as never,
  );

  const id = newId();
  const ts = nowIso();
  const title = str(input.title) || `Tiny home programme — ${client.name}`;

  const values = {
    id,
    client_id: client.id,
    title,
    status: "draft",
    unit_count: economics.unitCount,
    unit_cost_cents: unitCostCents,
    site_work_cents: cents(input.site_work) ?? 0,
    soft_costs_cents: cents(input.soft_costs) ?? 0,
    land_cost_cents: economics.landCostCents,
    down_payment_cents: economics.downPaymentCents,
    marginal_rate_bps: economics.marginalRateBps,
    bonus_rate_bps: economics.bonusRateBps,
    useful_life_years: economics.usefulLifeYears,
    monthly_rent_cents: cents(input.monthly_rent) ?? 0,
    occupancy_bps: bps(input.occupancy) ?? DEFAULT_OCCUPANCY_BPS(),
    opex_bps: bps(input.opex) ?? DEFAULT_OPEX_BPS(),
    total_investment_cents: economics.totalInvestmentCents,
    depreciable_basis_cents: economics.depreciableBasisCents,
    year_one_deduction_cents: economics.yearOneDeductionCents,
    year_one_tax_savings_cents: economics.yearOneTaxSavingsCents,
    net_year_one_outlay_cents: economics.netYearOneOutlayCents,
    financed_cents: economics.financedCents,
    monthly_note_cents: economics.monthlyNoteCents,
    annual_debt_service_cents: economics.annualDebtServiceCents,
    cash_invested_cents: economics.cashInvestedCents,
    deduction_leverage_bps: economics.deductionLeverageBps,
    annual_noi_cents: economics.annualNoiCents,
    annual_cash_flow_cents: economics.annualCashFlowCents,
    cash_on_cash_bps: economics.cashOnCashBps,
    payback_years: economics.paybackYears,
    body_md: renderBody(generated, economics, client.name),
    valid_until: date(input.valid_until),
    created_by: actor ?? null,
    created_at: ts,
    updated_at: ts,
  };

  const { sql, params } = buildInsert("crm_proposals", values);
  const row = (await query<CrmProposal>(sql, params))[0];

  await logActivity({
    entity_type: "crm_proposals",
    entity_id: id,
    client_id: client.id,
    verb: "created",
    summary: `Drafted proposal "${title}" — ${fmtMoney(economics.totalInvestmentCents)} investment, ${fmtMoney(economics.yearOneDeductionCents)} first-year deduction`,
    actor_email: actor,
  });

  return row;
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/** Prose, title, validity and status are editable. The frozen economics are not. */
const PATCHABLE = ["title", "body_md", "status", "valid_until"] as const;

export async function updateProposal(
  id: string,
  body: Record<string, unknown>,
  actor?: string | null,
): Promise<CrmProposal> {
  const existing = await getProposal(id);

  const patch: Record<string, unknown> = {};
  if ("title" in body) patch.title = str(body.title) ?? existing.title;
  if ("body_md" in body) patch.body_md = String(body.body_md ?? "");
  if ("valid_until" in body) patch.valid_until = date(body.valid_until);
  if ("status" in body) patch.status = oneOf(body.status, PROPOSAL_STATUSES, existing.status);

  // "Sent" is a one-way stamp: record when it happened, and don't overwrite the
  // original date if the status is toggled back and forth later.
  const nowSent = patch.status === "sent" && existing.status !== "sent";
  if (nowSent && !existing.sent_at) {
    (patch as Record<string, unknown>).sent_at = nowIso();
  }

  const update = buildUpdate("crm_proposals", id, patch, [...PATCHABLE, "sent_at"]);
  if (!update) return existing;
  const row = (await query<CrmProposal>(update.sql, update.params))[0];

  if (nowSent) {
    // Sending a proposal moves the relationship on, but never backwards — a
    // client who is already contracted stays contracted.
    await query(
      `UPDATE crm_clients SET status = 'proposal_sent', updated_at = $2
       WHERE id = $1 AND status IN ('prospect','qualified')`,
      [existing.client_id, nowIso()],
    );
  }

  await logActivity({
    entity_type: "crm_proposals",
    entity_id: id,
    client_id: existing.client_id,
    verb: patch.status && patch.status !== existing.status ? "status_changed" : "updated",
    summary:
      patch.status && patch.status !== existing.status
        ? `Proposal "${row.title}" marked ${String(patch.status).replace(/_/g, " ")}`
        : `Edited proposal "${row.title}"`,
    actor_email: actor,
  });
  return row;
}

export async function deleteProposal(id: string, actor?: string | null): Promise<void> {
  const existing = await getProposal(id);
  await query(`DELETE FROM crm_proposals WHERE id = $1`, [id]);
  await logActivity({
    entity_type: "crm_proposals",
    entity_id: id,
    client_id: existing.client_id,
    verb: "deleted",
    summary: `Deleted proposal "${existing.title}"`,
    actor_email: actor,
  });
}
