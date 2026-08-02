// The deal terms behind a contract set.
//
// Same rule as ./economics: every number that reaches a document is computed
// here in ordinary arithmetic and frozen onto the row. Nothing about a contract
// is ever written by a language model. A model that rephrases a payment amount
// has changed a signed obligation, which is a strictly worse failure than
// getting a proposal estimate wrong.
//
// The STRUCTURE is fixed and the PRICE varies. That split is deliberate: the
// memorandum's economic-substance reasoning is built on this exact shape — a
// real deposit, a recourse note guaranteed by the Trust, income that services
// the note — so the shape is not a per-deal input. Only the amount is.
//
// See CLAUDE.md and docs/ for where these constants come from.

/** Seller financing carries no interest in this structure. */
export const NOTE_RATE_BPS = 0;

/** 720 months. Long by design: the payment must be serviceable from rent alone. */
export const NOTE_TERM_MONTHS = 720;

/** Rental income splits evenly between Agent and Owner AFTER operating expenses. */
export const REVENUE_SPLIT_BPS = 5_000;

/** Optional GAP coverage, per year. */
export const GAP_ANNUAL_CENTS = 200_000;

/** Delivery included; beyond this the buyer is billed per mile. */
export const TRANSPORT_INCLUDED_MILES = 1_000;
export const TRANSPORT_PER_MILE_CENTS = 1_000;

/**
 * The transient-lodging ceiling.
 *
 * 30, not 7. This is the Reg. 1.48-1(h)(2)(ii) / §50(b)(2)(B) test that lifts
 * the asset out of the lodging exclusion so it can be expensed at all. The
 * familiar 7-day figure is the §469 short-term-rental test, which this
 * structure does not use — it establishes material participation through the
 * trustee instead. Conflating the two is the single easiest way to describe
 * this deal wrongly.
 */
export const MAX_AVERAGE_RENTAL_DAYS = 30;

export interface DealTermsInput {
  purchasePriceCents: number;
  downPaymentCents: number;
}

export interface DealTerms {
  purchasePriceCents: number;
  downPaymentCents: number;
  /** Price less deposit. The principal of the installment note. */
  financedCents: number;
  noteRateBps: number;
  noteTermMonths: number;
  monthlyPaymentCents: number;
  revenueSplitBps: number;
  gapAnnualCents: number;
  transportIncludedMiles: number;
  transportPerMileCents: number;
  maxAverageRentalDays: number;
  /** Blocking problems with the terms themselves. Non-empty means do not send. */
  problems: string[];
}

export function computeDealTerms(input: DealTermsInput): DealTerms {
  const purchasePriceCents = Math.max(0, Math.round(input.purchasePriceCents));
  const downPaymentCents = Math.max(0, Math.round(input.downPaymentCents));

  const problems: string[] = [];
  if (purchasePriceCents <= 0) {
    problems.push("The purchase price must be greater than zero.");
  }
  if (downPaymentCents > purchasePriceCents) {
    problems.push(
      "The down payment exceeds the purchase price, which would make the financed balance negative.",
    );
  }
  if (downPaymentCents <= 0) {
    // Not merely a data-entry nicety. The opinion leans on a real deposit as
    // part of the economic-substance argument; a zero-down deal is a different
    // transaction than the one that was blessed.
    problems.push(
      "The down payment is zero. The tax opinion in docs/ rests in part on a substantial deposit — confirm before generating.",
    );
  }

  const financedCents = Math.max(0, purchasePriceCents - downPaymentCents);

  // Rounded to the cent. Money is BIGINT cents everywhere (see CLAUDE.md), so
  // this is an integer and the last payment absorbs the rounding drift rather
  // than the schedule quietly disagreeing with the principal.
  const monthlyPaymentCents =
    NOTE_TERM_MONTHS > 0 ? Math.round(financedCents / NOTE_TERM_MONTHS) : 0;

  return {
    purchasePriceCents,
    downPaymentCents,
    financedCents,
    noteRateBps: NOTE_RATE_BPS,
    noteTermMonths: NOTE_TERM_MONTHS,
    monthlyPaymentCents,
    revenueSplitBps: REVENUE_SPLIT_BPS,
    gapAnnualCents: GAP_ANNUAL_CENTS,
    transportIncludedMiles: TRANSPORT_INCLUDED_MILES,
    transportPerMileCents: TRANSPORT_PER_MILE_CENTS,
    maxAverageRentalDays: MAX_AVERAGE_RENTAL_DAYS,
    problems,
  };
}

/**
 * Total of the scheduled payments.
 *
 * At 0% this should equal the financed principal, and where it does not the
 * difference is pure rounding across 720 payments. Surfaced so Schedule A can
 * state the truth rather than an amount that fails to add up under a CPA's
 * calculator.
 */
export function scheduledTotalCents(terms: DealTerms): number {
  return terms.monthlyPaymentCents * terms.noteTermMonths;
}

export function roundingDriftCents(terms: DealTerms): number {
  return scheduledTotalCents(terms) - terms.financedCents;
}
