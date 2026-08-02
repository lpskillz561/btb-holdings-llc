// Generating the execution set for one client.
//
// Three documents, one transaction, one `deal_group_id`. They are never
// generated singly: the Finance Agreement is Exhibit A to the Purchase
// Agreement and the Management Agreement produces the income that services the
// note, so any one alone describes a deal that cannot be executed.
//
// No model is involved at any point. `contract-templates.ts` holds the legal
// text and `deal.ts` computes the figures; this module only assembles them,
// refuses to produce a set that would be unsafe to send, and freezes the result.

import { CrmError, buildInsert, cents, date, logActivity, newId, nowIso, query, str } from "./db";
import { getClient } from "./clients";
import { computeDealTerms } from "./deal";
import {
  renderEquipmentFinanceAgreement,
  renderEquipmentPurchaseAgreement,
  renderManagementAgreement,
  type ContractContext,
} from "./contract-templates";
import { formatAddress, getSeller, sellerConfigIssues } from "./parties";
import type { ContractType, CrmContract } from "./types";

export interface GenerateContractsInput {
  client_id?: unknown;
  /** Whole dollars, coerced to cents by `cents()` — see CLAUDE.md. */
  purchase_price?: unknown;
  down_payment?: unknown;

  /** The Series that actually buys. Falls back to the client's legal name. */
  buyer_legal_name?: unknown;
  buyer_address?: unknown;
  trust_name?: unknown;

  unit_description?: unknown;
  unit_vin?: unknown;
  collateral_location?: unknown;

  wire_due_date?: unknown;
  funding_date?: unknown;
  first_payment_date?: unknown;
  management_start_date?: unknown;
  management_end_date?: unknown;
}

const TITLES: Record<(typeof ORDER)[number], string> = {
  equipment_purchase: "Equipment Purchase Agreement",
  equipment_finance: "Equipment Financing Agreement (Installment Note)",
  management: "Management and Revenue Share Agreement",
};

/** Execution order. Purchase first: the other two hang off it. */
const ORDER = ["equipment_purchase", "equipment_finance", "management"] as const;

export interface GeneratedSet {
  deal_group_id: string;
  contracts: CrmContract[];
  /** Non-blocking things a human should still look at before sending. */
  warnings: string[];
}

export async function generateContractSet(
  input: GenerateContractsInput,
  actor?: string | null,
): Promise<GeneratedSet> {
  const clientId = str(input.client_id);
  if (!clientId) throw new CrmError("A client is required to generate contracts.", 400);
  const client = await getClient(clientId);

  // 1. The party block must be real before anything is rendered. A purchase
  //    agreement carrying a placeholder account number is worse than no
  //    agreement at all, so this refuses rather than producing a draft someone
  //    might skim and send.
  const configIssues = sellerConfigIssues();
  if (configIssues.length > 0) {
    throw new CrmError(
      `These contracts name ${getSeller().legalName} as Seller, Creditor and Agent, but the following are not configured: ${configIssues.join(
        ", ",
      )}. Set the CRM_SELLER_* and CRM_WIRE_* variables before generating.`,
      400,
    );
  }

  // 2. The figures.
  const purchasePriceCents = cents(input.purchase_price) ?? 0;
  const downPaymentCents = cents(input.down_payment) ?? 0;
  const terms = computeDealTerms({ purchasePriceCents, downPaymentCents });
  if (terms.problems.length > 0) {
    throw new CrmError(terms.problems.join(" "), 400);
  }

  // 3. The merge context.
  const buyerLegalName =
    str(input.buyer_legal_name) || client.legal_name || client.name;
  const buyerAddress =
    str(input.buyer_address) ||
    [client.city, client.state].filter(Boolean).join(", ") ||
    "__________________ (buyer address)";

  const ctx: ContractContext = {
    buyerLegalName,
    buyerAddress,
    trustName: str(input.trust_name) || `${buyerLegalName} Trust`,
    clientDisplayName: client.name,
    unitDescription: str(input.unit_description) || "A-frame park model RV.",
    unitVin: str(input.unit_vin),
    collateralLocation: str(input.collateral_location),
    agreementDate: nowIso(),
    wireDueDate: date(input.wire_due_date),
    fundingDate: date(input.funding_date),
    firstPaymentDate: date(input.first_payment_date),
    managementStartDate: date(input.management_start_date),
    managementEndDate: date(input.management_end_date),
    terms,
  };

  const warnings = collectWarnings(ctx);

  // 4. Render, then insert as one set.
  const bodies: Record<(typeof ORDER)[number], string> = {
    equipment_purchase: renderEquipmentPurchaseAgreement(ctx),
    equipment_finance: renderEquipmentFinanceAgreement(ctx),
    management: renderManagementAgreement(ctx),
  };

  const dealGroupId = newId();
  const generatedAt = nowIso();
  const contracts: CrmContract[] = [];

  for (const type of ORDER) {
    const values = {
      id: newId(),
      client_id: client.id,
      title: TITLES[type],
      type: type as ContractType,
      status: "draft",
      // The management agreement carries no principal; giving it the purchase
      // price would triple the pipeline value across the set.
      value_cents: type === "management" ? 0 : terms.purchasePriceCents,
      counterparty: getSeller().legalName,
      effective_date: type === "management" ? ctx.managementStartDate : ctx.fundingDate,
      end_date: type === "management" ? ctx.managementEndDate : null,

      deal_group_id: dealGroupId,
      purchase_price_cents: terms.purchasePriceCents,
      down_payment_cents: terms.downPaymentCents,
      financed_cents: terms.financedCents,
      note_rate_bps: terms.noteRateBps,
      note_term_months: terms.noteTermMonths,
      monthly_payment_cents: terms.monthlyPaymentCents,
      revenue_split_bps: terms.revenueSplitBps,
      buyer_legal_name: ctx.buyerLegalName,
      trust_name: ctx.trustName,
      unit_vin: ctx.unitVin,
      collateral_location: ctx.collateralLocation,
      body_md: bodies[type],
      generated_at: generatedAt,
      created_at: generatedAt,
      updated_at: generatedAt,
    };
    const { sql, params } = buildInsert("crm_contracts", values);
    const [row] = await query<CrmContract>(sql, params);
    contracts.push(row);
  }

  await logActivity({
    entity_type: "contract",
    entity_id: dealGroupId,
    client_id: client.id,
    verb: "generated",
    summary: `Generated the execution set for ${ctx.buyerLegalName}: purchase, finance and management.`,
    actor_email: actor ?? null,
  });

  return { deal_group_id: dealGroupId, contracts, warnings };
}

/**
 * Things that do not justify refusing to generate, but that a person must
 * resolve before the set is executable. Surfaced rather than silently left as
 * blanks in the rendered document.
 */
function collectWarnings(ctx: ContractContext): string[] {
  const warnings: string[] = [];

  if (!ctx.unitVin) {
    warnings.push(
      "No VIN. The VIN is what classifies the unit as a trailer/RV and therefore as 6-year property — the whole bonus depreciation position depends on it. The manufacturer provides it on delivery.",
    );
  }
  if (!ctx.collateralLocation) {
    warnings.push(
      "No collateral location. It appears in Schedule A, in the delivery terms and in the management agreement.",
    );
  }
  if (!ctx.wireDueDate) warnings.push("No wire deadline set on the purchase agreement.");
  if (!ctx.fundingDate) warnings.push("No funding date set on Schedule A.");
  if (!ctx.firstPaymentDate) warnings.push("No first payment date set on Schedule A.");
  if (!ctx.managementStartDate || !ctx.managementEndDate) {
    warnings.push("The management agreement term is incomplete.");
  }

  return warnings;
}

/**
 * One contract plus its siblings, in execution order.
 *
 * Takes the id of ANY document in the set, because that is what a link from a
 * list row carries. A contract with no `deal_group_id` (recorded by hand rather
 * than generated) comes back as a set of one.
 */
export async function getContractWithSet(
  id: string,
): Promise<{ contract: CrmContract; set: CrmContract[] }> {
  const [contract] = await query<CrmContract>(`SELECT * FROM crm_contracts WHERE id = $1`, [id]);
  if (!contract) throw new CrmError("Contract not found.", 404);
  const set = contract.deal_group_id ? await getContractSet(contract.deal_group_id) : [contract];
  return { contract, set };
}

/** The set, in execution order. */
export async function getContractSet(dealGroupId: string): Promise<CrmContract[]> {
  const rows = await query<CrmContract>(
    `SELECT * FROM crm_contracts WHERE deal_group_id = $1`,
    [dealGroupId],
  );
  const rank = (t: string) => {
    const i = (ORDER as readonly string[]).indexOf(t);
    return i === -1 ? ORDER.length : i;
  };
  return rows.sort((a, b) => rank(a.type) - rank(b.type));
}
