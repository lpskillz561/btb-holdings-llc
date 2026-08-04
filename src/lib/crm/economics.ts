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

import { MAX_AVERAGE_RENTAL_DAYS, NOTE_TERM_MONTHS } from "./deal";
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
 * Deposit as a share of the price, in basis points. 1000 = 10%.
 *
 * Configuration, not a constant, for the same reason every other assumption
 * here is: it is a figure a CPA will check, and the sources disagree. The
 * strategy deck says "13% Down" and "~9 plus X" leverage; its own three tiers
 * are 10.8%, 12% and 11%; the executed agreements in docs/ are $155,000 on
 * $1,250,000, which is 12.4% and 8.06:1. The business has settled on 10%, which
 * is what produces the 10:1 the pitch leads with — but the day that is
 * reconciled with the paperwork, it should be an SSM write and a redeploy, not
 * a number someone has to find inside a React component.
 */
export const DEFAULT_DEPOSIT_BPS = () => envInt("CRM_DEFAULT_DEPOSIT_BPS", 1_000);

/**
 * Recovery period in years. 5 suits a transportable unit treated as personal
 * property; residential rental real property is 27.5 and is NOT bonus-eligible
 * as such — which is exactly why the classification drives the whole case.
 */
export const DEFAULT_USEFUL_LIFE_YEARS = () => envInt("CRM_DEFAULT_USEFUL_LIFE_YEARS", 5);

/**
 * Nightly occupancy assumed across the book, in basis points.
 *
 * 70%, which is the stated operating assumption and what the pro forma in
 * docs/ is headed with. Note the pro forma is internally inconsistent: it says
 * "70% occupancy" and then bills 20 nights, which is 66.7%. This model uses the
 * stated rate and derives nights from it (70% x 30 = 21), so a change to the
 * rate moves the revenue rather than leaving a hardcoded night count behind.
 * The previous default here was 85%, which nothing supported.
 */
export const DEFAULT_OCCUPANCY_BPS = () => envInt("CRM_DEFAULT_OCCUPANCY_BPS", 7_000);
export const DEFAULT_OPEX_BPS = () => envInt("CRM_DEFAULT_OPEX_BPS", 3_500);

export interface EconomicsInput {
  unitCount: number;
  /** Per unit. */
  unitCostCents: number;
  /** Totals across the whole placement, not per unit. */
  siteWorkCents: number;
  softCostsCents: number;
  /**
   * Land. Under the current model this is ALWAYS ZERO on a new proposal.
   *
   * BTB owns the ground and the client buys only the home standing on a pad, so
   * land never enters what a client is quoted — and it was never depreciable
   * anyway, so carrying it only ever inflated the investment total against an
   * unchanged deduction. What the land actually cost us is allocated per section
   * in lib/crm/portfolio.ts and is internal.
   *
   * The field survives so proposals frozen under the old model keep rendering
   * the figures they were sent with.
   */
  landCostCents: number;
  /**
   * Cash deposit. The balance is seller-financed on ./deal's terms.
   *
   * Omit or zero and the model is all-cash, which is what it assumed before
   * financing existed — so old proposals keep the figures they were frozen with.
   */
  downPaymentCents?: number;
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

  /** Cash deposit, and the note that carries the rest. */
  downPaymentCents: number;
  financedCents: number;
  monthlyNoteCents: number;
  annualDebtServiceCents: number;
  /** Cash actually at stake: the deposit, or the whole price when unfinanced. */
  cashInvestedCents: number;
  /**
   * First-year deduction per dollar of cash, in basis points — 100_000 is
   * "10 to 1". A ratio, not a rate, and conditional on a recourse note.
   */
  deductionLeverageBps: number | null;

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
  /** NOI less debt service — what the owner actually keeps. */
  annualCashFlowCents: number;

  /** Cash flow over cash invested. Null when either is zero or negative. */
  cashOnCashBps: number | null;
  /** Years of cash flow to recover the net outlay. Null when it never does. */
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
  // Clamping silently is how "3700" typed for 37% became a 100% marginal rate
  // and a proposal claiming the tax saving equalled the entire deduction. No
  // real marginal rate is above 60%, so anything past that is a data-entry
  // error and is refused rather than quietly reinterpreted.
  if (input.marginalRateBps > 6_000) {
    throw new Error(
      `A marginal rate of ${(input.marginalRateBps / 100).toFixed(0)}% is not plausible — ` +
        "rates are basis points, so 37% is 3700. Check what was entered.",
    );
  }
  const marginalRateBps = Math.min(10_000, Math.max(0, input.marginalRateBps));
  const yearOneTaxSavingsCents = pctOf(yearOneDeductionCents, marginalRateBps);

  /* ---- Seller financing -------------------------------------------------- */
  // This is the whole point of the structure and the model had none of it. The
  // buyer puts down a deposit, the balance is a recourse note guaranteed by the
  // Trust, and the deduction is taken on the FULL basis — which is what makes a
  // deduction many times the cash a real thing rather than a sales claim. Same
  // terms the contract engine writes (0%, 720 months), imported rather than
  // restated so a proposal and the note it becomes cannot disagree.
  // A deposit of zero means NO FINANCING, not a hundred-percent-financed deal.
  // Getting this backwards quoted "cash down $0, seller-financed $102,000" on a
  // blank field whose own hint promised an all-cash deal — and with no cash in
  // it, leverage and cash-on-cash both collapsed to "—".
  // ABSENT is not ZERO. Absent means "nobody has said", so the deposit tracks
  // the price at the configured default; an explicit 0 means a deliberate
  // all-cash deal and leaves the note out entirely. Conflating the two quoted a
  // client paying the full price in cash for a deduction of the same size,
  // which reads as a 1:1 rather than the 10:1 the whole pitch rests on.
  const defaultedDeposit =
    input.downPaymentCents ?? pctOf(totalInvestmentCents, DEFAULT_DEPOSIT_BPS());
  const downPaymentCents = Math.min(
    Math.max(0, Math.round(defaultedDeposit)),
    totalInvestmentCents,
  );
  const financedCents = downPaymentCents > 0 ? totalInvestmentCents - downPaymentCents : 0;
  const monthlyNoteCents =
    NOTE_TERM_MONTHS > 0 ? Math.round(financedCents / NOTE_TERM_MONTHS) : 0;
  const annualDebtServiceCents = monthlyNoteCents * 12;

  // With nothing financed the buyer's cash IS the whole investment, which is
  // exactly how this model behaved before financing existed.
  const cashInvestedCents = totalInvestmentCents - financedCents;

  // Cash out of pocket less the year-one tax benefit. NEGATIVE means the tax
  // saving exceeded the cash — the deck's "net tax savings" figure, and the
  // ordinary outcome of a financed deal.
  const netYearOneOutlayCents = cashInvestedCents - yearOneTaxSavingsCents;

  /**
   * Deduction per dollar of cash, in basis points: 100_000 is the "10 to 1"
   * the strategy deck leads with. It is a RATIO, not a rate, and it is only
   * true while the note is recourse — see the at-risk caveat below.
   */
  const deductionLeverageBps =
    cashInvestedCents > 0
      ? Math.round((yearOneDeductionCents / cashInvestedCents) * 10_000)
      : null;

  const grossScheduledRentCents = unitCount * Math.max(0, input.monthlyRentCents) * 12;
  const effectiveRentCents = pctOf(
    grossScheduledRentCents,
    Math.min(10_000, Math.max(0, input.occupancyBps)),
  );
  const annualOpexCents = pctOf(effectiveRentCents, Math.max(0, input.opexBps));
  const annualNoiCents = effectiveRentCents - annualOpexCents;
  // What the owner actually keeps. The note is serviced from rent, so quoting
  // NOI as the return on a financed deal overstates it by the debt service.
  const annualCashFlowCents = annualNoiCents - annualDebtServiceCents;

  // Return on the cash actually invested, after debt service — which is what
  // "cash on cash" means. Unfinanced, the denominator is the whole investment
  // and this is the figure it always was.
  const cashOnCashBps =
    cashInvestedCents > 0 && annualCashFlowCents > 0
      ? Math.round((annualCashFlowCents / cashInvestedCents) * 10_000)
      : null;
  const paybackYears =
    annualCashFlowCents > 0 && netYearOneOutlayCents > 0
      ? Math.round((netYearOneOutlayCents / annualCashFlowCents) * 10) / 10
      : null;

  return {
    unitCount,
    unitsSubtotalCents,
    improvementsCents,
    landCostCents,
    totalInvestmentCents,
    downPaymentCents,
    financedCents,
    monthlyNoteCents,
    annualDebtServiceCents,
    cashInvestedCents,
    deductionLeverageBps,
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
    annualCashFlowCents,
    cashOnCashBps,
    paybackYears,
    marginalRateBps,
    bonusRateBps,
    usefulLifeYears,
    caveats: buildCaveats(input, {
      deductible,
      landCostCents,
      bonusRateBps,
      financedCents,
      annualCashFlowCents,
      deductionLeverageBps,
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
  ctx: {
    deductible: boolean;
    landCostCents: number;
    bonusRateBps: number;
    financedCents: number;
    annualCashFlowCents: number;
    deductionLeverageBps: number | null;
  },
): string[] {
  const caveats: string[] = [
    "Figures are estimates for discussion, not tax advice. The client's CPA must confirm the classification, recovery period and deduction before it is relied on.",
    "The deduction requires the unit to be placed in service — delivered, complete and available for its intended use — within the tax year being claimed. Ordering alone is not enough.",
  ];

  if (ctx.financedCents > 0) {
    // The single most load-bearing sentence in a financed proposal. A deduction
    // many times the cash is only available because the buyer is AT RISK for
    // the financed balance; make the note non-recourse and §465 limits the
    // deduction to the deposit, which collapses the whole case. Stating it is
    // not a hedge — it is the condition the number depends on.
    caveats.push(
      "The first-year deduction is taken on the full basis, not on the deposit, and that depends on the note being RECOURSE and guaranteed by the Trust. Under the at-risk rules of §465 a non-recourse note would limit the deduction to the amount actually at risk — broadly the cash deposit — and the leverage shown here would not survive. This is a condition of the structure, not a formality.",
    );
    caveats.push(
      "The financed balance is a real obligation for the full term regardless of how the unit performs. The deduction arrives once; the note payment recurs.",
    );
    if (ctx.annualCashFlowCents < 0) {
      // NOT "the owner funds the shortfall" — that was wrong for this deal. The
      // strategy deck in docs/ is explicit that the lender forbears in months
      // without the income to pay, which is a materially different promise and
      // one of the four objections the structure was built to answer.
      caveats.push(
        "At the occupancy and rent modelled, income does not cover the note payment. Under this structure the lender forbears in months lacking the income to pay rather than the owner funding the gap — but forbearance defers the obligation, it does not cancel it, and the note still runs for its full term.",
      );
    }
  }

  // The cap that decides whether a headline deduction is usable THIS YEAR, and
  // the most likely reason a client's actual refund disappoints. Named in the
  // strategy deck itself, so quoting a first-year benefit without it is quoting
  // a number the deck already qualifies.
  caveats.push(
    "Section 461(l) limits how much business loss can offset non-business income in one year — roughly $313,000 single / $626,000 married filing jointly for 2025, rising to about $325,000 / $650,000 for 2026. A deduction larger than that threshold does not vanish, but the excess is carried forward as a net operating loss rather than sheltering this year's income. Where the modelled deduction exceeds the client's cap, the first-year tax benefit shown here is the gross figure and their CPA must apply the limitation to it.",
  );

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
    // Two separate tests, and it matters which one this business runs on.
    //
    // The familiar "seven days or less" figure is the §469 short-term-rental
    // route to non-passive treatment through the taxpayer's OWN participation.
    // The structure in docs/ does not use it: it clears the §50(b)(2) lodging
    // exclusion with the transient exception at UNDER 30 DAYS
    // (Reg. 1.48-1(h)(2)(ii)), and gets material participation from the trustee
    // rather than from the client's hours. Quoting seven days here described a
    // deal we do not sell. See CLAUDE.md.
    caveats.push(
      `Transient-lodging treatment depends on the average guest stay staying under ${MAX_AVERAGE_RENTAL_DAYS} days. That is the test that lifts the unit out of the lodging exclusion and makes it expensable at all — the management agreement carries it as an obligation for exactly this reason.`,
    );
    caveats.push(
      "Material participation is a separate requirement and equally load-bearing. In this structure it comes from the trustee's involvement, not from the client's own hours; if that participation is not real and documented, the loss is passive and the offset against other income disappears.",
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
