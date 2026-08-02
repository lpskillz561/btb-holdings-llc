// The numbers behind a tiny-home proposal.
//
// EVERY figure a client sees is computed here, in ordinary arithmetic, and then
// frozen onto the proposal row. The language model is handed these as given
// facts and writes prose around them — it never calculates.
//
// That division is deliberate and non-negotiable. The audience is a high-income
// taxpayer and their CPA, whose job is checking figures; a model quietly
// inventing a depreciation number in a document that informs a tax position is
// the worst failure this product could have. If you add a figure to a proposal,
// add it to this file, not to a prompt.
//
// Nothing here is tax advice, and the code is honest about that: the deduction
// modelled is a straightforward first-year depreciation estimate, and the
// conditions that most often break it in practice come back in `caveats` so
// they reach the proposal instead of being silently assumed away.

import type { UnitUse } from "./types";

/** Read an integer env override, falling back when unset or malformed. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * Share of depreciable basis deductible in year one, in basis points.
 *
 * Bonus depreciation is a moving target in statute — it phased down after the
 * TCJA and was later restored — so it is a CONFIGURED INPUT, never a constant
 * baked into a pitch. The default assumes full expensing; set
 * `CRM_BONUS_DEPRECIATION_RATE_BPS` for the rate that actually applies to the
 * acquisition year, and confirm it with the client's CPA before sending.
 */
export const DEFAULT_BONUS_RATE_BPS = () => envInt("CRM_BONUS_DEPRECIATION_RATE_BPS", 10_000);

/** Top combined federal + state marginal rate to assume when the client's isn't recorded. */
export const DEFAULT_MARGINAL_RATE_BPS = () => envInt("CRM_DEFAULT_MARGINAL_RATE_BPS", 3_700);

/**
 * Recovery period in years. 5 suits a transportable unit treated as personal
 * property; residential rental real property is 27.5 and is NOT bonus-eligible
 * as such — which is exactly why the classification drives the whole case.
 */
export const DEFAULT_USEFUL_LIFE_YEARS = () => envInt("CRM_DEFAULT_USEFUL_LIFE_YEARS", 5);

export const DEFAULT_OCCUPANCY_BPS = () => envInt("CRM_DEFAULT_OCCUPANCY_BPS", 8_500);
export const DEFAULT_OPEX_BPS = () => envInt("CRM_DEFAULT_OPEX_BPS", 3_500);

export interface EconomicsInput {
  unitCount: number;
  /** Per unit. */
  unitCostCents: number;
  /** Totals across the whole placement, not per unit. */
  siteWorkCents: number;
  softCostsCents: number;
  /** Land is never depreciable — carried for the investment total only. */
  landCostCents: number;
  marginalRateBps: number;
  bonusRateBps: number;
  usefulLifeYears: number;
  /** Gross scheduled rent per unit per month. */
  monthlyRentCents: number;
  occupancyBps: number;
  /** Operating expenses as a share of effective rent. */
  opexBps: number;
  unitUse: UnitUse;
}

export interface Economics {
  unitCount: number;
  /** unitCount × unit cost. */
  unitsSubtotalCents: number;
  improvementsCents: number;
  landCostCents: number;
  totalInvestmentCents: number;

  /** Everything except land — and zero when the use isn't a business use. */
  depreciableBasisCents: number;
  bonusDeductionCents: number;
  remainingBasisCents: number;
  firstYearRemainderCents: number;
  yearOneDeductionCents: number;
  yearOneTaxSavingsCents: number;
  /** Total investment less the year-one tax benefit. */
  netYearOneOutlayCents: number;

  grossScheduledRentCents: number;
  effectiveRentCents: number;
  annualOpexCents: number;
  annualNoiCents: number;

  /** NOI over net year-one outlay. Null when the outlay is zero or negative. */
  cashOnCashBps: number | null;
  /** Years of NOI to recover the net outlay. Null when NOI is zero or negative. */
  paybackYears: number | null;

  marginalRateBps: number;
  bonusRateBps: number;
  usefulLifeYears: number;

  /** Conditions that would change the answer. These belong in the proposal. */
  caveats: string[];
}

const pctOf = (cents: number, basisPoints: number) => Math.round((cents * basisPoints) / 10_000);

/** A business use can support a depreciation deduction; personal use cannot. */
export function isDeductibleUse(use: UnitUse): boolean {
  return use !== "personal";
}

export function computeEconomics(input: EconomicsInput): Economics {
  const unitCount = Math.max(0, Math.round(input.unitCount));
  const unitsSubtotalCents = unitCount * Math.max(0, input.unitCostCents);
  const improvementsCents = Math.max(0, input.siteWorkCents) + Math.max(0, input.softCostsCents);
  const landCostCents = Math.max(0, input.landCostCents);
  const totalInvestmentCents = unitsSubtotalCents + improvementsCents + landCostCents;

  const deductible = isDeductibleUse(input.unitUse);
  // Land is excluded here on purpose: it is not a wasting asset and generates no
  // depreciation. Including it is the most common way these pitches overstate.
  const depreciableBasisCents = deductible ? unitsSubtotalCents + improvementsCents : 0;

  const bonusRateBps = Math.min(10_000, Math.max(0, input.bonusRateBps));
  const bonusDeductionCents = pctOf(depreciableBasisCents, bonusRateBps);
  const remainingBasisCents = depreciableBasisCents - bonusDeductionCents;

  // Straight-line on whatever bonus didn't absorb. A full MACRS table (half-year
  // convention, declining balance) would be marginally kinder in year one; the
  // simpler, slightly conservative figure is the right way to be wrong here.
  const usefulLifeYears = input.usefulLifeYears > 0 ? input.usefulLifeYears : 0;
  const firstYearRemainderCents =
    usefulLifeYears > 0 ? Math.round(remainingBasisCents / usefulLifeYears) : 0;

  const yearOneDeductionCents = bonusDeductionCents + firstYearRemainderCents;
  const marginalRateBps = Math.min(10_000, Math.max(0, input.marginalRateBps));
  const yearOneTaxSavingsCents = pctOf(yearOneDeductionCents, marginalRateBps);
  const netYearOneOutlayCents = totalInvestmentCents - yearOneTaxSavingsCents;

  const grossScheduledRentCents = unitCount * Math.max(0, input.monthlyRentCents) * 12;
  const effectiveRentCents = pctOf(
    grossScheduledRentCents,
    Math.min(10_000, Math.max(0, input.occupancyBps)),
  );
  const annualOpexCents = pctOf(effectiveRentCents, Math.max(0, input.opexBps));
  const annualNoiCents = effectiveRentCents - annualOpexCents;

  const cashOnCashBps =
    netYearOneOutlayCents > 0
      ? Math.round((annualNoiCents / netYearOneOutlayCents) * 10_000)
      : null;
  const paybackYears =
    annualNoiCents > 0 ? Math.round((netYearOneOutlayCents / annualNoiCents) * 10) / 10 : null;

  return {
    unitCount,
    unitsSubtotalCents,
    improvementsCents,
    landCostCents,
    totalInvestmentCents,
    depreciableBasisCents,
    bonusDeductionCents,
    remainingBasisCents,
    firstYearRemainderCents,
    yearOneDeductionCents,
    yearOneTaxSavingsCents,
    netYearOneOutlayCents,
    grossScheduledRentCents,
    effectiveRentCents,
    annualOpexCents,
    annualNoiCents,
    cashOnCashBps,
    paybackYears,
    marginalRateBps,
    bonusRateBps,
    usefulLifeYears,
    caveats: buildCaveats(input, {
      deductible,
      landCostCents,
      bonusRateBps,
    }),
  };
}

/**
 * The conditions that most often turn a modelled deduction into a smaller (or
 * zero) real one. These are surfaced rather than assumed away — a proposal that
 * omits them is the kind a CPA sends back.
 */
function buildCaveats(
  input: EconomicsInput,
  ctx: { deductible: boolean; landCostCents: number; bonusRateBps: number },
): string[] {
  const caveats: string[] = [
    "Figures are estimates for discussion, not tax advice. The client's CPA must confirm the classification, recovery period and deduction before it is relied on.",
    "The deduction requires the unit to be placed in service — delivered, complete and available for its intended use — within the tax year being claimed. Ordering alone is not enough.",
  ];

  if (!ctx.deductible) {
    caveats.push(
      "This unit is recorded as personal use, which supports no depreciation deduction. The write-off shown is zero by design; change the use to a rental or business use if that is wrong.",
    );
  }

  if (input.unitUse === "long_term_rental") {
    caveats.push(
      "Long-term rental is generally a passive activity. Passive losses usually cannot offset wages or business income, and may be suspended until there is passive income or the property is sold, unless the client qualifies as a real estate professional.",
    );
  }

  if (input.unitUse === "short_term_rental") {
    caveats.push(
      "The short-term rental treatment depends on an average guest stay of seven days or less AND the client materially participating. If either fails, the loss is passive and the offset against other income disappears.",
    );
  }

  if (ctx.bonusRateBps >= 10_000) {
    caveats.push(
      "Assumes full first-year bonus depreciation. The rate depends on the acquisition and placed-in-service year under the statute in force — confirm the rate that applies before sending.",
    );
  } else if (ctx.bonusRateBps > 0) {
    caveats.push(
      `Assumes bonus depreciation at ${(ctx.bonusRateBps / 100).toFixed(0)}%, with the balance recovered over the ${input.usefulLifeYears}-year life.`,
    );
  }

  if (input.usefulLifeYears <= 15) {
    caveats.push(
      `Assumes the unit is personal property recovered over ${input.usefulLifeYears} years. If it is instead fixed to the land and treated as residential rental real property, the period is 27.5 years and the first-year deduction is far smaller.`,
    );
  }

  if (ctx.landCostCents > 0) {
    caveats.push(
      "Land is not depreciable and is excluded from the deduction — it appears in the investment total only.",
    );
  }

  caveats.push(
    "Selling or converting the unit to personal use early can trigger depreciation recapture, taxed as ordinary income up to the amount previously deducted.",
  );

  return caveats;
}

/**
 * How much of a client's stated write-off target this deal covers, in basis
 * points. Null when no target is on file.
 */
export function coverageBps(
  yearOneDeductionCents: number,
  targetWriteoffCents: number | null | undefined,
): number | null {
  if (!targetWriteoffCents || targetWriteoffCents <= 0) return null;
  return Math.round((yearOneDeductionCents / targetWriteoffCents) * 10_000);
}
