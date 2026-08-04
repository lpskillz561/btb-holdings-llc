// The figures behind the client presentation.
//
// Same rule as ./economics and ./deal, and for the same reason: a slide shown to
// a taxpayer and their CPA is a representation about a deal. Nothing here is a
// number typed into a component. The deck asks this module, this module asks
// computeDealTerms and computeEconomics, and a slide therefore cannot disagree
// with the contract it turns into.
//
// Where a figure comes from `docs/` rather than from code — the pro forma's
// nightly rate and operating line — it is transcribed here once, with the
// document named, so there is one place to correct it.

import {
  computeDealTerms,
  roundingDriftCents,
  GAP_ANNUAL_CENTS,
  MAX_AVERAGE_RENTAL_DAYS,
  NOTE_TERM_MONTHS,
  REVENUE_SPLIT_BPS,
  TRANSPORT_INCLUDED_MILES,
  TRANSPORT_PER_MILE_CENTS,
  type DealTerms,
} from "./deal";
import {
  DEFAULT_BONUS_RATE_BPS,
  DEFAULT_DEPOSIT_BPS,
  DEFAULT_MARGINAL_RATE_BPS,
  computeEconomics,
  type Economics,
} from "./economics";

/** Read an integer env override, falling back when unset or malformed. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/* -------------------------------------------------------------------------- */
/* The executed example, from docs/                                            */
/* -------------------------------------------------------------------------- */

/**
 * The deal in `Equipment Purchase Agreement 155k.docx` and its Schedule A.
 *
 * Quoted as history — "here is one that has been signed" — not as the price
 * anyone is being offered. The offer is sized from the buyer's own write-off,
 * below.
 */
export const EXECUTED_PRICE_CENTS = 125_000_000;
export const EXECUTED_DOWN_CENTS = 15_500_000;

/**
 * The monthly pro forma, transcribed from `PRO FORMA FOR RV300.pdf`.
 *
 * Deliberately NOT derived. That document is the one buyers are actually shown,
 * and it bills **20 nights** at $300 while its own heading says 70% occupancy —
 * 20 of 30 nights is 66.7%. Deriving nights from the stated rate would produce
 * $6,300 and silently disagree with the paper in the client's hand, so the deck
 * shows the document's arithmetic and describes the input as billed nights
 * rather than repeating an occupancy figure that does not reconcile.
 *
 * Its debt line ($1,562) is likewise the document's own, and differs from the
 * $1,520.83 on the executed Schedule A because the two describe different
 * sizings. The deck labels this an illustration for that reason.
 */
export const PRO_FORMA = {
  nightlyRateCents: 30_000,
  billedNights: 20,
  revenueCents: 600_000,
  debtServiceCents: 156_200,
  operatingCents: 221_900,
  /** The remainder after debt and operating, split 50/50 by the Management Agreement. */
  agentShareCents: 110_950,
  ownerShareCents: 110_950,
} as const;

/**
 * The deposit schedule for the three entry points, in basis points.
 *
 * 13% / 12% / 10%, stepping DOWN with size — a partner decision (August 2026)
 * that supersedes both a flat `CRM_DEFAULT_DEPOSIT_BPS` and the deck's own
 * published downs (12% / 10.8% / 11%, which are not monotonic and whose FULL
 * PURCHASE column does not reconcile). The premium on the smaller entries
 * covers BTB's setup and management overhead; the multi tier sits at the
 * standing 10%, so the largest ticket is the one that shows the headline 10:1
 * and a multi buyer always puts down less cash than the same exposure bought
 * as single units — `multiUnitCashSavedCents` below is that saving, computed
 * so the slide can prove it rather than assert it.
 *
 * There is still NO management fee as a line item: no document in docs/ names
 * one. The Management Agreement's entire compensation is the 50/50 revenue
 * split, and its clause 4(c) says the Owner is never liable for anything
 * beyond it. The overhead the premium covers lives INSIDE the down payment —
 * breaking it out as a "fee" on a slide would name a charge a CPA cannot find
 * in the paperwork.
 *
 * Same rule as every other assumption: configuration, not constants. An SSM
 * write and a redeploy reprice the slide; nobody edits a component.
 */
export const TIER_DEPOSIT_BPS = {
  fractional: () => envInt("CRM_TIER_DEPOSIT_BPS_FRACTIONAL", 1_300),
  single: () => envInt("CRM_TIER_DEPOSIT_BPS_SINGLE", 1_200),
  multi: () => envInt("CRM_TIER_DEPOSIT_BPS_MULTI", 1_000),
} as const;

/** §461(l) excess business loss caps. From the strategy deck's own appendix. */
export const LOSS_LIMITATION = {
  currentYear: 2026,
  currentSingleCents: 32_500_000,
  currentJointCents: 65_000_000,
  priorYear: 2025,
  priorSingleCents: 31_300_000,
  priorJointCents: 62_600_000,
} as const;

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

export interface DealIllustration {
  label: string;
  terms: DealTerms;
  economics: Economics;
  /** 720 × the payment, less the principal. Rounding, surfaced rather than hidden. */
  driftCents: number;
  /**
   * The deposit as a share of the price, DERIVED from the two figures shown —
   * never the rate that was asked for. The executed example is $155,000 on
   * $1,250,000, and a label that said "10%" beside those two numbers would be
   * the deck contradicting itself on one slide.
   */
  depositBps: number;
}

/**
 * Size a deal from the write-off the buyer is trying to achieve.
 *
 * The unit is priced at the target, the deposit is the configured share of it
 * and the balance is the 0% note — which is the whole shape of the offer. Rent
 * is left at zero: the presentation quotes the pro forma from `docs/` for
 * income and never implies a per-client rent projection we have not underwritten.
 */
export function illustrate(label: string, priceCents: number, depositCents?: number): DealIllustration {
  const price = Math.max(0, Math.round(priceCents));
  const down = depositCents ?? Math.round((price * DEFAULT_DEPOSIT_BPS()) / 10_000);
  const terms = computeDealTerms({ purchasePriceCents: price, downPaymentCents: down });

  const economics = computeEconomics({
    unitCount: 1,
    unitCostCents: price,
    siteWorkCents: 0,
    softCostsCents: 0,
    // BTB owns the ground. This is zero on every new quote, by design.
    landCostCents: 0,
    downPaymentCents: down,
    marginalRateBps: DEFAULT_MARGINAL_RATE_BPS(),
    bonusRateBps: DEFAULT_BONUS_RATE_BPS(),
    usefulLifeYears: 5,
    monthlyRentCents: 0,
    occupancyBps: 0,
    opexBps: 0,
    // Transient lodging, let for under 30 days. Not `long_term_rental`: that is
    // a different asset, a different test and a different answer.
    unitUse: "transient_rental",
  });

  return {
    label,
    terms,
    economics,
    driftCents: roundingDriftCents(terms),
    depositBps: price > 0 ? Math.round((down / price) * 10_000) : 0,
  };
}

/** One entry-point row: the deposit is the tier's own rate, not the default. */
function tier(label: string, priceCents: number, depositBps: number): DealIllustration {
  return illustrate(label, priceCents, Math.round((priceCents * depositBps) / 10_000));
}

export interface PresentationFigures {
  /** The signed example in docs/. */
  executed: DealIllustration;
  /** Sized to whatever this prospect says they need to shelter. */
  sized: DealIllustration | null;
  /** Three illustrative sizes, each at its own rate from `TIER_DEPOSIT_BPS`. */
  tiers: DealIllustration[];
  /**
   * Cash a multi-unit buyer keeps versus assembling the same purchase from
   * single units at the single-unit rate. The bulk discount, as a dollar
   * figure the slide can show — zero if the schedule is ever configured so
   * that bulk is not cheaper, in which case the slide says nothing.
   */
  multiUnitCashSavedCents: number;
  proForma: typeof PRO_FORMA;
  lossLimitation: typeof LOSS_LIMITATION;
  constants: {
    noteTermMonths: number;
    revenueSplitBps: number;
    maxAverageRentalDays: number;
    gapAnnualCents: number;
    transportIncludedMiles: number;
    transportPerMileCents: number;
    depositBps: number;
    marginalRateBps: number;
    bonusRateBps: number;
  };
}

/**
 * Everything the deck needs.
 *
 * `targetWriteoffCents` is the prospect's own number when we have it — the deal
 * is sized from the write-off, so a pitch that already knows it should show it
 * rather than a generic tier.
 *
 * The tiers are computed at `TIER_DEPOSIT_BPS` — see the note on that constant.
 * The deposit rate is the only input per row; the financed balance and the note
 * payment are derived from it, so every row reconciles by construction.
 */
export function buildPresentationFigures(targetWriteoffCents?: number | null): PresentationFigures {
  const tiers = [
    tier("Fractional", 25_000_000, TIER_DEPOSIT_BPS.fractional()),
    tier("Single unit", 125_000_000, TIER_DEPOSIT_BPS.single()),
    tier("Multi-unit", 500_000_000, TIER_DEPOSIT_BPS.multi()),
  ];
  const [, single, multi] = tiers;
  // What the multi price would cost in cash down if bought as single units.
  const singlyCents =
    single.terms.purchasePriceCents > 0
      ? (multi.terms.purchasePriceCents / single.terms.purchasePriceCents) *
        single.terms.downPaymentCents
      : 0;

  return {
    executed: illustrate("Executed example", EXECUTED_PRICE_CENTS, EXECUTED_DOWN_CENTS),
    sized:
      targetWriteoffCents && targetWriteoffCents > 0
        ? illustrate("Sized to your target", targetWriteoffCents)
        : null,
    tiers,
    multiUnitCashSavedCents: Math.max(0, Math.round(singlyCents - multi.terms.downPaymentCents)),
    proForma: PRO_FORMA,
    lossLimitation: LOSS_LIMITATION,
    constants: {
      noteTermMonths: NOTE_TERM_MONTHS,
      revenueSplitBps: REVENUE_SPLIT_BPS,
      maxAverageRentalDays: MAX_AVERAGE_RENTAL_DAYS,
      gapAnnualCents: GAP_ANNUAL_CENTS,
      transportIncludedMiles: TRANSPORT_INCLUDED_MILES,
      transportPerMileCents: TRANSPORT_PER_MILE_CENTS,
      depositBps: DEFAULT_DEPOSIT_BPS(),
      marginalRateBps: DEFAULT_MARGINAL_RATE_BPS(),
      bonusRateBps: DEFAULT_BONUS_RATE_BPS(),
    },
  };
}
