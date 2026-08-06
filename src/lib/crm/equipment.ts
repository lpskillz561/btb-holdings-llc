// The numbers behind the AMUSEMENT EQUIPMENT programme — the second product line.
//
// Same rule as ./economics and ./deal, for the same reason: the audience is a
// high-income taxpayer and their CPA, so every figure that reaches a slide or a
// document is computed here in ordinary arithmetic. Nothing is typed into a
// component and nothing is written by a language model.
//
// WHY A SEPARATE MODULE FROM ./economics
//
// The two programmes share a statute (§168(k)) and nothing else. The tiny-home
// model turns on the transient-lodging exception at 30 days, on land BTB owns,
// and on material participation established through a TRUSTEE. None of that is
// true here: this asset is listed property under §280F, it sits in somebody
// else's venue, and the buyer's own trade or business owns it outright. Folding
// it into `computeEconomics` would mean a `unitUse` value that carried a
// completely different set of caveats, and the failure mode of getting that
// wrong is a proposal that argues the wrong tax position — which is exactly the
// bug the 7-day/30-day note in CLAUDE.md exists to prevent. Two products, two
// modules, one statute quoted in both.
//
// PURITY MATTERS HERE. This module is imported by the browser-side calculator as
// well as by server components, so it reads NO environment and touches NO Node
// API. Configuration is resolved on the server by `equipmentConfig()` below and
// passed in; `process.env` in a client component is silently `undefined`, which
// would mean the calculator quietly using different defaults than the deck.

import { fmtMoney } from "./format";
import { LOSS_LIMITATION } from "./economics";

/* -------------------------------------------------------------------------- */
/* The asset                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Rev. Proc. 87-56, Asset Class 79.0 "Recreation" — coin-operated amusement
 * devices, including video games and pinball machines.
 *
 * Ten-year class life, SEVEN-year GDS recovery. Seven is the number that
 * matters: §168(k) requires a recovery period of 20 years or less, and seven
 * clears it comfortably. (The Park Model is Class 00.27 at six years — a
 * different class, a different table, and not interchangeable.)
 */
export const EQUIPMENT_ASSET_CLASS = "79.0";
export const EQUIPMENT_ASSET_CLASS_NAME = "Recreation";
export const EQUIPMENT_RECOVERY_YEARS = 7;
export const EQUIPMENT_CLASS_LIFE_YEARS = 10;
export const EQUIPMENT_ADS_RECOVERY_YEARS = 10;

/**
 * The §280F listed-property threshold: qualified business use must EXCEED this.
 *
 * Not a rounding of "about half". At or below 50% the asset drops out of MACRS
 * entirely and is recovered straight-line over the ADS period — no bonus
 * depreciation at all — and any excess already deducted is recaptured as
 * ordinary income. This is the single largest difference between this product
 * and the tiny homes, and the calculator refuses to show a bonus deduction
 * below it rather than printing a number the taxpayer cannot claim.
 */
export const LISTED_PROPERTY_MIN_BUSINESS_USE_BPS = 5_000;

/* -------------------------------------------------------------------------- */
/* Configuration — the terms BTB sells on                                      */
/* -------------------------------------------------------------------------- */

export interface EquipmentConfig {
  unitPriceCents: number;
  depositBps: number;
  noteTermMonths: number;
  noteRateBps: number;
  /** Gross monthly collections per unit, low and high case. */
  conservativeMonthlyGrossCents: number;
  optimisticMonthlyGrossCents: number;
  /** Share of GROSS collections returned to players. */
  customerPayoutBps: number;
  /** Shares of what remains AFTER the player payout — see the note on SPLIT. */
  venueOperatorBps: number;
  serviceBps: number;
}

/**
 * Defaults, as plain constants so the client bundle has them too.
 *
 * These mirror the terms the programme is being sold on: $150,000 a unit, 10%
 * down, and the balance on a 0% dealer note over 180 months. Unlike the tiny
 * homes — where 0% over 720 months is FIXED because the memorandum's
 * economic-substance reasoning is built on that exact shape — the rate and term
 * here are inputs the calculator lets a presenter move, because a buyer
 * financing this through their own bank is a normal outcome rather than a
 * different deal.
 */
export const EQUIPMENT_DEFAULTS: EquipmentConfig = {
  unitPriceCents: 15_000_000,
  depositBps: 1_000,
  noteTermMonths: 180,
  noteRateBps: 0,
  conservativeMonthlyGrossCents: 500_000,
  optimisticMonthlyGrossCents: 1_000_000,
  customerPayoutBps: 3_000,
  venueOperatorBps: 1_500,
  serviceBps: 3_000,
};

/**
 * The revenue split is TWO-STAGE, and reading it as one stage is the easiest
 * way to get this model wrong.
 *
 * The player payout comes off GROSS collections. The venue operator's share and
 * the service/licensing charge are then taken from what is LEFT, not from gross.
 * At the optimistic case that is 30% of $10,000 = $3,000 to players, leaving
 * $7,000; 15% of $7,000 = $1,050 to the venue and 30% of $7,000 = $2,100 to
 * service. Read as flat shares of gross those last two would be $1,500 and
 * $3,000, and the monthly net would come out roughly $1,350 light.
 */
export const SPLIT_IS_TWO_STAGE = true;

/**
 * Server-side configuration. **Do not call this from a client component** —
 * `process.env` is not populated there and every override would silently
 * revert to the default. Resolve on the server, pass the result down.
 */
export function equipmentConfig(): EquipmentConfig {
  const envInt = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.round(n) : fallback;
  };
  return {
    unitPriceCents: envInt("CRM_EQUIPMENT_UNIT_PRICE_CENTS", EQUIPMENT_DEFAULTS.unitPriceCents),
    depositBps: envInt("CRM_EQUIPMENT_DEPOSIT_BPS", EQUIPMENT_DEFAULTS.depositBps),
    noteTermMonths: envInt("CRM_EQUIPMENT_TERM_MONTHS", EQUIPMENT_DEFAULTS.noteTermMonths),
    noteRateBps: envInt("CRM_EQUIPMENT_RATE_BPS", EQUIPMENT_DEFAULTS.noteRateBps),
    conservativeMonthlyGrossCents: envInt(
      "CRM_EQUIPMENT_GROSS_LOW_CENTS",
      EQUIPMENT_DEFAULTS.conservativeMonthlyGrossCents,
    ),
    optimisticMonthlyGrossCents: envInt(
      "CRM_EQUIPMENT_GROSS_HIGH_CENTS",
      EQUIPMENT_DEFAULTS.optimisticMonthlyGrossCents,
    ),
    customerPayoutBps: envInt(
      "CRM_EQUIPMENT_PAYOUT_BPS",
      EQUIPMENT_DEFAULTS.customerPayoutBps,
    ),
    venueOperatorBps: envInt("CRM_EQUIPMENT_VENUE_BPS", EQUIPMENT_DEFAULTS.venueOperatorBps),
    serviceBps: envInt("CRM_EQUIPMENT_SERVICE_BPS", EQUIPMENT_DEFAULTS.serviceBps),
  };
}

/* -------------------------------------------------------------------------- */
/* Computation                                                                 */
/* -------------------------------------------------------------------------- */

export type FilingStatus = "single" | "joint";

export interface EquipmentInput {
  config: EquipmentConfig;
  unitCount: number;
  /** Overrides `config.unitPriceCents` when the presenter moves the slider. */
  unitPriceCents?: number;
  depositBps?: number;
  noteTermMonths?: number;
  noteRateBps?: number;
  /** Gross monthly collections per unit. Defaults to the optimistic case. */
  monthlyGrossCents?: number;
  marginalRateBps: number;
  bonusRateBps: number;
  /** Qualified business use, §280F. Below the threshold there is no bonus. */
  businessUseBps: number;
  filingStatus: FilingStatus;
}

export interface EquipmentMonthly {
  grossCents: number;
  customerPayoutCents: number;
  venueOperatorCents: number;
  serviceCents: number;
  debtServiceCents: number;
  /** Gross less every operating line AND debt service. What the owner keeps. */
  netCents: number;
  /** Net BEFORE debt service — the operating result on its own. */
  noiBeforeDebtCents: number;
}

export interface EquipmentDeal {
  unitCount: number;
  unitPriceCents: number;
  totalPurchaseCents: number;
  depositBps: number;
  downPaymentCents: number;
  financedCents: number;
  noteTermMonths: number;
  noteRateBps: number;
  monthlyPaymentCents: number;
  totalInterestCents: number;

  /** Per unit and for the whole fleet. */
  perUnitMonthly: EquipmentMonthly;
  fleetMonthly: EquipmentMonthly;
  annualNetCents: number;

  /* ---- The deduction ---- */
  businessUseBps: number;
  /** False below the §280F threshold — ADS straight-line only, no bonus. */
  qualifiesForBonus: boolean;
  depreciableBasisCents: number;
  bonusDeductionCents: number;
  firstYearRemainderCents: number;
  yearOneDeductionCents: number;

  /* ---- What actually lands in year one ---- */
  /** Deduction × marginal rate, before any limit. The headline, and a ceiling. */
  grossTaxSavingsCents: number;
  /** Year-one operating profit the deduction offsets before anything else. */
  businessIncomeCents: number;
  netBusinessLossCents: number;
  lossLimitCents: number;
  /** The part of the loss §461(l) lets offset other income this year. */
  allowedAgainstOtherIncomeCents: number;
  /** The rest — an NOL carryforward. Deferred, not lost. */
  carryforwardCents: number;
  /** `allowed` × marginal rate. What a first year realistically produces. */
  cappedTaxSavingsCents: number;

  /* ---- Position ---- */
  /** Down payment less the year-one benefit. Negative means cash-positive. */
  netYearOnePositionCents: number;
  /** Months of net cash flow to recover the deposit. Null if it never does. */
  breakEvenMonths: number | null;
  /** Same, counting the §461(l)-capped tax benefit. 0 = immediate. */
  breakEvenMonthsWithTax: number | null;

  caveats: string[];
}

/** A level-payment amortising note. At 0% it is simply principal ÷ months. */
export function monthlyPaymentCents(
  principalCents: number,
  annualRateBps: number,
  months: number,
): number {
  if (months <= 0 || principalCents <= 0) return 0;
  if (annualRateBps <= 0) return Math.round(principalCents / months);
  const r = annualRateBps / 10_000 / 12;
  return Math.round((principalCents * r) / (1 - Math.pow(1 + r, -months)));
}

export interface AmortRow {
  month: number;
  paymentCents: number;
  principalCents: number;
  interestCents: number;
  balanceCents: number;
}

/**
 * The schedule, month by month.
 *
 * The FINAL payment absorbs the rounding rather than the balance being left a
 * few cents from zero — the same choice `deal.ts` makes, and for the same
 * reason: a schedule whose last line does not clear the principal is the first
 * thing a CPA circles.
 */
export function amortize(
  principalCents: number,
  annualRateBps: number,
  months: number,
): AmortRow[] {
  const payment = monthlyPaymentCents(principalCents, annualRateBps, months);
  const r = annualRateBps > 0 ? annualRateBps / 10_000 / 12 : 0;
  const rows: AmortRow[] = [];
  let balance = principalCents;
  for (let month = 1; month <= months; month++) {
    const interest = r > 0 ? Math.round(balance * r) : 0;
    let principalPart = payment - interest;
    let paid = payment;
    if (month === months || principalPart >= balance) {
      principalPart = balance;
      paid = balance + interest;
    }
    balance -= principalPart;
    rows.push({
      month,
      paymentCents: paid,
      principalCents: principalPart,
      interestCents: interest,
      balanceCents: balance,
    });
    if (balance <= 0) break;
  }
  return rows;
}

const pctOf = (cents: number, bps: number) => Math.round((cents * bps) / 10_000);

export function computeEquipmentDeal(input: EquipmentInput): EquipmentDeal {
  const { config } = input;

  const unitCount = Math.max(0, Math.round(input.unitCount));
  const unitPriceCents = Math.max(0, Math.round(input.unitPriceCents ?? config.unitPriceCents));
  const totalPurchaseCents = unitCount * unitPriceCents;

  const depositBps = Math.min(10_000, Math.max(0, input.depositBps ?? config.depositBps));
  const downPaymentCents = pctOf(totalPurchaseCents, depositBps);
  const financedCents = totalPurchaseCents - downPaymentCents;

  const noteTermMonths = Math.max(0, Math.round(input.noteTermMonths ?? config.noteTermMonths));
  const noteRateBps = Math.max(0, Math.round(input.noteRateBps ?? config.noteRateBps));
  const monthlyPayment = monthlyPaymentCents(financedCents, noteRateBps, noteTermMonths);
  const totalInterestCents = Math.max(0, monthlyPayment * noteTermMonths - financedCents);

  /* ---- The month ------------------------------------------------------- */
  const grossPerUnit = Math.max(
    0,
    Math.round(input.monthlyGrossCents ?? config.optimisticMonthlyGrossCents),
  );
  // Two-stage, per the note on SPLIT_IS_TWO_STAGE. Getting this flat under-
  // states the owner's net by the difference between the two readings.
  const payoutPerUnit = pctOf(grossPerUnit, config.customerPayoutBps);
  const afterPayoutPerUnit = grossPerUnit - payoutPerUnit;
  const venuePerUnit = pctOf(afterPayoutPerUnit, config.venueOperatorBps);
  const servicePerUnit = pctOf(afterPayoutPerUnit, config.serviceBps);
  const noiBeforeDebtPerUnit = grossPerUnit - payoutPerUnit - venuePerUnit - servicePerUnit;

  // Debt service is a FLEET obligation, so the per-unit view carries its share.
  const debtPerUnit = unitCount > 0 ? Math.round(monthlyPayment / unitCount) : 0;

  const perUnitMonthly: EquipmentMonthly = {
    grossCents: grossPerUnit,
    customerPayoutCents: payoutPerUnit,
    venueOperatorCents: venuePerUnit,
    serviceCents: servicePerUnit,
    debtServiceCents: debtPerUnit,
    noiBeforeDebtCents: noiBeforeDebtPerUnit,
    netCents: noiBeforeDebtPerUnit - debtPerUnit,
  };

  const fleetMonthly: EquipmentMonthly = {
    grossCents: grossPerUnit * unitCount,
    customerPayoutCents: payoutPerUnit * unitCount,
    venueOperatorCents: venuePerUnit * unitCount,
    serviceCents: servicePerUnit * unitCount,
    debtServiceCents: monthlyPayment,
    noiBeforeDebtCents: noiBeforeDebtPerUnit * unitCount,
    netCents: noiBeforeDebtPerUnit * unitCount - monthlyPayment,
  };
  const annualNetCents = fleetMonthly.netCents * 12;

  /* ---- The deduction ---------------------------------------------------- */
  const businessUseBps = Math.min(10_000, Math.max(0, Math.round(input.businessUseBps)));
  // §280F: at or below 50% the asset leaves MACRS for ADS straight-line and
  // bonus is unavailable outright. Modelling a partial bonus here would print a
  // deduction the taxpayer is barred from claiming.
  const qualifiesForBonus = businessUseBps > LISTED_PROPERTY_MIN_BUSINESS_USE_BPS;

  // Basis is proportionate to qualified business use — the personal share is
  // never depreciable, whichever side of the threshold the asset falls.
  const depreciableBasisCents = pctOf(totalPurchaseCents, businessUseBps);

  const bonusRateBps = Math.min(10_000, Math.max(0, input.bonusRateBps));
  const bonusDeductionCents = qualifiesForBonus
    ? pctOf(depreciableBasisCents, bonusRateBps)
    : 0;
  const remainingBasisCents = depreciableBasisCents - bonusDeductionCents;
  // Straight-line on the remainder, over GDS when bonus applies and over the
  // longer ADS period when §280F has forced the asset out of MACRS. Slightly
  // conservative in both cases, which is the right direction to be wrong.
  const recoveryYears = qualifiesForBonus
    ? EQUIPMENT_RECOVERY_YEARS
    : EQUIPMENT_ADS_RECOVERY_YEARS;
  const firstYearRemainderCents = Math.round(remainingBasisCents / recoveryYears);
  const yearOneDeductionCents = bonusDeductionCents + firstYearRemainderCents;

  /* ---- What lands in year one ------------------------------------------ */
  // Same guard as ./economics: "3700" typed for 37% once became a 100% rate and
  // a proposal claiming the saving equalled the whole deduction.
  if (input.marginalRateBps > 6_000) {
    throw new Error(
      `A marginal rate of ${(input.marginalRateBps / 100).toFixed(0)}% is not plausible — ` +
        "rates are basis points, so 37% is 3700. Check what was entered.",
    );
  }
  const marginalRateBps = Math.min(10_000, Math.max(0, input.marginalRateBps));
  const grossTaxSavingsCents = pctOf(yearOneDeductionCents, marginalRateBps);

  // §461(l) properly: the deduction offsets this activity's OWN income first,
  // and only the net loss that remains is tested against the cap. Testing the
  // gross deduction against the cap would understate the usable benefit for a
  // fleet that earns anything at all.
  const businessIncomeCents = Math.max(0, annualNetCents);
  const netBusinessLossCents = Math.max(0, yearOneDeductionCents - businessIncomeCents);
  const lossLimitCents =
    input.filingStatus === "joint"
      ? LOSS_LIMITATION.currentJointCents
      : LOSS_LIMITATION.currentSingleCents;
  const allowedAgainstOtherIncomeCents = Math.min(netBusinessLossCents, lossLimitCents);
  const carryforwardCents = netBusinessLossCents - allowedAgainstOtherIncomeCents;
  // The offset against the activity's own income is worth the marginal rate too
  // — it is income that would otherwise have been taxed.
  const shelteredOwnIncomeCents = Math.min(yearOneDeductionCents, businessIncomeCents);
  const cappedTaxSavingsCents = pctOf(
    allowedAgainstOtherIncomeCents + shelteredOwnIncomeCents,
    marginalRateBps,
  );

  /* ---- Position --------------------------------------------------------- */
  const netYearOnePositionCents = downPaymentCents - cappedTaxSavingsCents;
  const breakEvenMonths =
    fleetMonthly.netCents > 0 ? Math.ceil(downPaymentCents / fleetMonthly.netCents) : null;
  const breakEvenMonthsWithTax =
    netYearOnePositionCents <= 0
      ? 0
      : fleetMonthly.netCents > 0
        ? Math.ceil(netYearOnePositionCents / fleetMonthly.netCents)
        : null;

  return {
    unitCount,
    unitPriceCents,
    totalPurchaseCents,
    depositBps,
    downPaymentCents,
    financedCents,
    noteTermMonths,
    noteRateBps,
    monthlyPaymentCents: monthlyPayment,
    totalInterestCents,
    perUnitMonthly,
    fleetMonthly,
    annualNetCents,
    businessUseBps,
    qualifiesForBonus,
    depreciableBasisCents,
    bonusDeductionCents,
    firstYearRemainderCents,
    yearOneDeductionCents,
    grossTaxSavingsCents,
    businessIncomeCents,
    netBusinessLossCents,
    lossLimitCents,
    allowedAgainstOtherIncomeCents,
    carryforwardCents,
    cappedTaxSavingsCents,
    netYearOnePositionCents,
    breakEvenMonths,
    breakEvenMonthsWithTax,
    caveats: buildEquipmentCaveats({
      businessUseBps,
      qualifiesForBonus,
      carryforwardCents,
      marginalRateBps,
      bonusRateBps,
      noteRateBps,
      financedCents,
      filingStatus: input.filingStatus,
      lossLimitCents,
    }),
  };
}

/**
 * The conditions that turn a modelled deduction into a smaller or zero real one.
 *
 * The listed-property entries come FIRST and are not optional. This programme's
 * whole compliance burden is §280F/§274(d), and it is the one thing a buyer who
 * has read about the tiny homes will not be expecting.
 */
function buildEquipmentCaveats(ctx: {
  businessUseBps: number;
  qualifiesForBonus: boolean;
  carryforwardCents: number;
  marginalRateBps: number;
  bonusRateBps: number;
  noteRateBps: number;
  financedCents: number;
  filingStatus: FilingStatus;
  lossLimitCents: number;
}): string[] {
  const caveats: string[] = [
    "Figures are estimates for discussion, not tax advice. The client's CPA must confirm the classification, recovery period and deduction before it is relied on.",
    "Amusement equipment is LISTED PROPERTY under §280F — property used for entertainment, recreation or amusement. Qualified business use must EXCEED 50% every year, and §274(d) requires contemporaneous records: the dates and duration of use, the business purpose, and the split between business and personal use. This is a materially heavier record-keeping obligation than the tiny-home programme carries, and it does not end after year one.",
    "If qualified business use falls to 50% or below in any later year, the asset drops from MACRS to ADS straight-line and the excess depreciation already claimed is recaptured as ordinary income under §280F(b)(2). The deduction is not final when it is claimed.",
    "The deduction requires the equipment to be placed in service — delivered, installed and available for its intended use — inside the tax year being claimed. Ordering alone is not enough, and a unit sited in January is a next-year deduction.",
  ];

  if (!ctx.qualifiesForBonus) {
    caveats.push(
      `Qualified business use is recorded at ${(ctx.businessUseBps / 100).toFixed(0)}%, which does not exceed the §280F 50% threshold. Bonus depreciation is therefore UNAVAILABLE and the figures above recover the basis straight-line over ${EQUIPMENT_ADS_RECOVERY_YEARS} years under ADS. This is not a haircut on the deduction; it is a different depreciation regime.`,
    );
  }

  caveats.push(
    `Section 461(l) limits how much business loss can offset non-business income in one year — about ${fmtMoney(ctx.lossLimitCents)} for a ${ctx.filingStatus === "joint" ? "married filing jointly" : "single"} filer in ${LOSS_LIMITATION.currentYear}. Any excess carries forward as a net operating loss rather than sheltering this year's income.`,
  );

  if (ctx.carryforwardCents > 0) {
    caveats.push(
      `At this sizing the modelled deduction produces ${fmtMoney(ctx.carryforwardCents)} of loss that §461(l) defers to later years. The first-year benefit shown is the capped figure; the gross figure beside it is what the deduction would be worth with no limit and should never be quoted on its own.`,
    );
  }

  caveats.push(
    `The tax benefit is modelled at a flat ${(ctx.marginalRateBps / 100).toFixed(1)}% marginal rate applied to the whole usable deduction. A deduction of this size normally reduces income through several brackets rather than being absorbed entirely at the top one, so the blended rate — and the benefit — will usually be lower than shown.`,
  );

  if (ctx.financedCents > 0) {
    caveats.push(
      "The first-year deduction is taken on the full cost, not on the deposit, and that depends on the buyer being AT RISK for the financed balance under §465. A non-recourse note would limit the deduction to the cash actually at risk and the leverage shown here would not survive.",
    );
    caveats.push(
      "The financed balance is a real obligation for the full term regardless of how the equipment performs. The deduction arrives once; the payment recurs. There is no forbearance term in this programme — that is a feature of the tiny-home finance agreement and it does not carry across.",
    );
  }

  caveats.push(
    "The equipment must be used in a genuine trade or business under §162, with a profit motive. In this programme the buyer's own business owns and operates it, so material participation under §469 is the BUYER's to establish and document — it is not supplied by a trustee the way it is in the tiny-home structure.",
  );

  caveats.push(
    "Collections are hypothetical and vary with location, foot traffic, machine type and season. They are not a projection, a guarantee or a representation of income for any particular unit or venue.",
  );

  caveats.push(
    "Equipment that returns cash or prizes to players is regulated at STATE and often municipal level, and is prohibited outright in some jurisdictions. Siting, licensing and the legality of the payout model are the venue's and the buyer's to confirm before any unit is placed. Nothing in this model is an opinion that a given machine is lawful in a given state.",
  );

  caveats.push(
    "Selling the equipment or converting it to personal use claws the deduction back as ordinary income under §1245, up to the amount previously deducted.",
  );

  if (ctx.bonusRateBps >= 10_000) {
    caveats.push(
      "Assumes 100% bonus depreciation, permanently restored by OBBBA for qualified property acquired and placed in service on or after 20 January 2025. Confirm the rate in force for the acquisition year before sending.",
    );
  }

  return caveats;
}

/* -------------------------------------------------------------------------- */
/* Where the market's own material does not reconcile                          */
/* -------------------------------------------------------------------------- */

/**
 * Contradictions in the published arcade-depreciation material this programme
 * competes with, recorded so nobody re-imports them.
 *
 * Same discipline as the pro forma and strategy-deck notes in SKILL.md: where a
 * source contradicts itself we name it rather than laundering it. Every figure
 * this module produces is derived, so none of these can leak in — but a
 * presenter WILL be shown the competing site by a prospect, and being able to
 * say which line does not add up is worth more than matching it.
 */
export const MARKET_MATERIAL_NOTES = [
  "The published revenue model finances $140,000 against a $150,000 unit while stating a 10% deposit. Ten percent of $150,000 leaves $135,000 financed, not $140,000 — the two cannot both be right, and its $777.77 monthly payment is the $140,000 figure over 180 months.",
  "Its headline scenario takes $1,500,000 of income to $0 of federal tax on a $1,500,000 deduction and does not mention §461(l) at all. For a joint filer the excess business loss cap admits roughly $650,000 against non-business income in 2026; the rest carries forward. The scenario as published is not achievable in year one.",
  "It reports a 5,435% 'ROI on down payment' by dividing fifteen years of undiscounted gross cash flow by the deposit. That is not a return on investment under any convention, it is not annualised, and it should not be repeated.",
  "It shows 30% of gross going to 'prize payouts and jackpot distributions'. That is a cash-payout amusement device, not a conventional arcade cabinet, and it is regulated or prohibited in a number of states.",
] as const;
