// The client presentation, slide by slide.
//
// Everything here is drawn from `docs/` — the Memorandum of Law, the three
// execution agreements, the pro forma and the strategy deck. Three rules govern
// what may appear on a slide, and all three exist because the audience is a
// taxpayer and, right behind them, their CPA:
//
// 1. NO FIGURE IS TYPED HERE. Money comes from lib/crm/presentation.ts, which
//    computes it through deal.ts and economics.ts. A slide cannot disagree with
//    the contract it becomes.
// 2. THE CAVEATS ARE PART OF THE PITCH, not a disclaimer slide nobody reads.
//    §461(l) and the recourse requirement are load-bearing: without recourse the
//    deduction is limited to the cash at risk and the whole ratio collapses, and
//    §461(l) is named in the strategy deck itself, so a first-year benefit
//    quoted without it is a figure our own sales material already qualifies.
// 3. WHERE docs/ IS WRONG, WE DO NOT REPEAT IT. The deck's FULL PURCHASE column
//    does not reconcile and its FAQ claims the structure "truly eliminates" tax
//    with no recapture to plan for. Neither appears here. Recapture on an actual
//    sale or conversion is real and is on the limits slide.
//
// Land never appears. BTB owns the ground; the client buys the home on a pad.

import type { ReactNode } from "react";
import { fmtMoney, fmtPct } from "@/lib/crm/format";
import { site } from "@/lib/site";
import type { PresentationFigures } from "@/lib/crm/presentation";
import type { Slide } from "./Deck";
import { LeverageBars, RevenueSplitBar, StructureDiagram, TierTable } from "./Charts";

/* -------------------------------------------------------------------------- */
/* Slide furniture                                                             */
/* -------------------------------------------------------------------------- */

function Frame({
  eyebrow,
  title,
  lede,
  children,
  note,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  children?: ReactNode;
  note?: string;
}) {
  return (
    <>
      <p className="deck-eyebrow">{eyebrow}</p>
      <h2 className="deck-title">{title}</h2>
      {lede ? <p className="deck-lede">{lede}</p> : null}
      {children ? <div className="mt-[3cqh]">{children}</div> : null}
      {note ? <p className="deck-note">{note}</p> : null}
    </>
  );
}

/** A row of points. Two or three; more than that is a document, not a slide. */
function Points({ items }: { items: { head: string; body: string }[] }) {
  return (
    <div
      className="grid gap-[2.2cqw]"
      style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 3)}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.head} className="border-t-2 border-gold-500/70 pt-[1.6cqh]">
          <p className="text-[1.02em] font-semibold text-paper-50">{item.head}</p>
          <p className="mt-[1cqh] text-[0.82em] leading-relaxed text-paper-50/70">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

/** A big number with its label under it. The figure IS the slide. */
function Figures({ items }: { items: { value: string; label: string; sub?: string }[] }) {
  return (
    <div
      className="grid gap-[2.2cqw]"
      style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.label}>
          <p className="font-serif text-[1.9em] font-medium leading-none text-gold-400">
            {item.value}
          </p>
          <p className="mt-[1.2cqh] text-[0.85em] text-paper-50">{item.label}</p>
          {item.sub ? (
            <p className="mt-[0.6cqh] text-[0.7em] leading-snug text-paper-50/55">{item.sub}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Authorities({ items }: { items: string[] }) {
  return (
    <ul className="mt-[2cqh] space-y-[0.9cqh] text-[0.75em] text-paper-50/55">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* The deck                                                                    */
/* -------------------------------------------------------------------------- */

export function buildSlides(
  figures: PresentationFigures,
  opts: { clientName?: string | null } = {},
): Slide[] {
  const { executed, sized, tiers, proForma, lossLimitation, constants } = figures;
  // The sized illustration when we know what the prospect is solving for,
  // otherwise the deal that has actually been signed. Never an invented number.
  const headline = sized ?? executed;
  const years = Math.round(constants.noteTermMonths / 12);

  const slides: Slide[] = [
    {
      id: "title",
      title: "Title",
      node: (
        <div className="text-center">
          <p className="deck-eyebrow">{site.name}</p>
          <h1 className="mt-[2.4cqh] font-serif text-[3em] font-medium leading-[1.08] text-paper-50">
            Own an income-producing
            <br />
            asset. Deduct it in year one.
          </h1>
          <p className="mx-auto mt-[3cqh] max-w-[44ch] text-[1.05em] text-paper-50/70">
            A transient-lodging tiny home, placed in service in a managed park, financed
            at 0% and managed for you.
          </p>
          {opts.clientName ? (
            <p className="mt-[4cqh] text-[0.85em] text-paper-50/50">
              Prepared for {opts.clientName}
            </p>
          ) : null}
        </div>
      ),
    },

    {
      id: "who",
      title: "Who this is for",
      node: (
        <Frame
          eyebrow="Qualification"
          title="Who this is for"
          lede="The structure only does useful work for someone with substantial income to shelter this year."
        >
          <Points
            items={[
              {
                head: "W-2 earners",
                body: "High income with federal withholding over $250,000.",
              },
              {
                head: "Business owners",
                body: "High income through an S-corp, C-corp or partnership.",
              },
              {
                head: "Self-employed",
                body: "High earners filing a 1099 or a Schedule C.",
              },
            ]}
          />
          <div className="mt-[3cqh]">
            <Points
              items={[
                {
                  head: "Pre-tax retirement holdings",
                  body: "$500,000 or more — the deduction is well suited to offsetting a Roth conversion.",
                },
                {
                  head: "A capital gain to offset",
                  body: "Bonus depreciation is applied against active income and capital gains alike.",
                },
              ]}
            />
          </div>
        </Frame>
      ),
    },

    {
      id: "problem",
      title: "What usually goes wrong",
      node: (
        <Frame
          eyebrow="The obstacles"
          title="Why this normally doesn't work"
          lede="Four things stop a high earner from buying a rental asset for the deduction. Each has an answer, and the answer is structural rather than a promise."
        >
          <div className="grid grid-cols-2 gap-x-[3cqw] gap-y-[2.4cqh]">
            {[
              [
                "Material participation",
                "A rental is passive unless you meet a participation test — and you have a job.",
                "The trustee participates. That status is imputed to the Trust and through to you.",
              ],
              [
                "No experience",
                "You have no connections to rental parks or relief agencies, and no time to build them.",
                "Turnkey. The Trustee acquires, deploys, manages, rents and administers the unit.",
              ],
              [
                "Financing",
                "You are not an accredited equipment buyer and you care about your debt-to-income.",
                `Seller financing at 0% over ${years} years. It is a commercial loan to the Trust and does not touch your personal credit.`,
              ],
              [
                "Rental volatility",
                "If the rent misses the payment, you are funding the gap out of pocket.",
                "You are not. The lender forbears in any month without sufficient income.",
              ],
            ].map(([head, problem, answer]) => (
              <div key={head}>
                <p className="text-[0.95em] font-semibold text-paper-50">{head}</p>
                <p className="mt-[0.8cqh] text-[0.78em] leading-relaxed text-paper-50/55">
                  {problem}
                </p>
                <p className="mt-[0.8cqh] text-[0.78em] leading-relaxed text-gold-300">{answer}</p>
              </div>
            ))}
          </div>
        </Frame>
      ),
    },

    {
      id: "asset",
      title: "What you buy",
      node: (
        <Frame
          eyebrow="The asset"
          title="A Park Model — a titled trailer, not a building"
          lede="Factory-built, transported by truck, and never anchored to the ground. That is not a detail of construction; it is the reason the tax treatment works."
        >
          <Figures
            items={[
              { value: "399", label: "Square feet or less", sub: "Of living area" },
              { value: "VIN", label: "Titled by the state", sub: "As a trailer or RV" },
              { value: "6-year", label: "MACRS property", sub: "Inside the 20-year ceiling §168(k) requires" },
              { value: "100%", label: "Bonus depreciation", sub: "Restored permanently by OBBBA" },
            ]}
          />
          <p className="mt-[3cqh] max-w-[62ch] text-[0.85em] leading-relaxed text-paper-50/70">
            A unit fixed to land is residential rental real property, recovered over 27.5
            years and not bonus-eligible. A transportable unit titled as a trailer is
            personal property. The classification is the whole argument, and it is never
            assumed — it follows from the state title.
          </p>
        </Frame>
      ),
    },

    {
      id: "land",
      title: "You own the home",
      node: (
        <Frame
          eyebrow="What you own"
          title="You own the home. We own the ground."
          lede="Your unit stands on a numbered pad in a park BTB owns and manages. You never buy land, and you are never a landlord."
        >
          <Points
            items={[
              {
                head: "Land is not depreciable",
                body: "Buying ground would add cost to your investment without adding a dollar to your deduction. So it is not in the deal.",
              },
              {
                head: "No site to find, permit or improve",
                body: "The pad, the utilities, the permits and the insurance are ours. They are paid for out of rental income.",
              },
              {
                head: "Nothing to manage",
                body: "You are not finding tenants, handling turnovers or taking calls. The Agent does all of it.",
              },
            ]}
          />
        </Frame>
      ),
    },

    {
      id: "structure",
      title: "The structure",
      node: (
        <Frame
          eyebrow="How it is held"
          title="The ownership chain"
          lede="Four entities, each doing one job. The dashed line is the one relationship that is not ownership."
        >
          <StructureDiagram />
        </Frame>
      ),
    },

    {
      id: "why-structure",
      title: "Why each leg matters",
      node: (
        <Frame
          eyebrow="Why it is built this way"
          title="Every leg is load-bearing"
          lede="This is not a wrapper around a purchase. Remove any one of these and the deduction changes or disappears."
        >
          <div className="grid grid-cols-2 gap-x-[3cqw] gap-y-[2.2cqh]">
            {[
              [
                "An irrevocable grantor trust",
                "Because it is a grantor trust, the deductions land on your own return rather than being trapped in an entity.",
              ],
              [
                "One Series per home",
                "Liability and basis stay per-unit. One unit's problem is not another unit's problem.",
              ],
              [
                "A note guaranteed by, and recourse to, the Trust",
                "This is what creates at-risk basis under §752 and §465. A non-recourse note would cap the loss at your cash — the leverage would collapse.",
              ],
              [
                "The Management Series as trustee",
                "It acquires, deploys, manages, rents and administers the unit. That participation is what makes the activity non-passive.",
              ],
            ].map(([head, body]) => (
              <div key={head} className="border-l-2 border-gold-500/70 pl-[1.4cqw]">
                <p className="text-[0.95em] font-semibold text-paper-50">{head}</p>
                <p className="mt-[0.8cqh] text-[0.8em] leading-relaxed text-paper-50/65">{body}</p>
              </div>
            ))}
          </div>
        </Frame>
      ),
    },

    {
      id: "tax-case",
      title: "The tax case",
      node: (
        <Frame
          eyebrow="The legal position"
          title="Three questions, three answers"
          lede="The opinion in our file addresses each one directly, with authority."
        >
          <div className="grid grid-cols-3 gap-[2.4cqw]">
            {[
              {
                q: "Is it qualified property?",
                a: "A state VIN makes it a trailer or RV — six-year MACRS property, inside the 20-year limit. Original use begins with you.",
                cites: ["§168(k)", "Rev. Proc. 87-56, Asset Class 00.27", "OBBBA — 100% restored from 20 Jan 2025"],
              },
              {
                q: "Isn't lodging excluded?",
                a: "It is, unless the accommodations are used by transients. Rentals normally under 30 days are transient, and that is what this unit does.",
                cites: ["§50(b)(2)(B)", "Reg. 1.48-1(h)(2)(ii)", "Shirley v. Commissioner, T.C. Memo. 2004-188", "Moore v. Commissioner, 58 T.C. 1045"],
              },
              {
                q: "Isn't it passive?",
                a: "Not where the trustee materially participates. That status is imputed to the Trust and flows through to the grantor.",
                cites: ["Frank Aragona Trust, 142 T.C. 165 (2014)", "Mattie K. Carter Trust", "PLR 201317010", "PLR 201029014"],
              },
            ].map((col) => (
              <div key={col.q}>
                <p className="font-serif text-[1.1em] text-gold-400">{col.q}</p>
                <p className="mt-[1.2cqh] text-[0.82em] leading-relaxed text-paper-50/80">{col.a}</p>
                <Authorities items={col.cites} />
              </div>
            ))}
          </div>
        </Frame>
      ),
    },

    {
      id: "thirty-days",
      title: "The 30-day test",
      node: (
        <Frame
          eyebrow="The test that matters"
          title="Normally less than 30 days"
          lede="One sentence in the regulations does the work, and the Management Agreement is written to satisfy it."
        >
          <blockquote className="border-l-2 border-gold-500 pl-[2cqw] font-serif text-[1.25em] leading-snug text-paper-50">
            “Accommodations shall be considered used on a transient basis if the rental
            period is normally less than 30 days.”
            <footer className="mt-[1.4cqh] font-sans text-[0.6em] not-italic text-paper-50/55">
              26 C.F.R. § 1.48-1(h)(2)(ii)
            </footer>
          </blockquote>
          <div className="mt-[3cqh]">
            <Points
              items={[
                {
                  head: "Predominant portion means more than half",
                  body: "And per Moore it is measured by the proportion of accommodations used by transients — not by the proportion of renters who are transient.",
                },
                {
                  head: "The Agent is contractually bound to it",
                  body: `The Management Agreement requires the average rental period to be ${constants.maxAverageRentalDays} days or less, and no lease the Agent signs may exceed it.`,
                },
                {
                  head: "Shirley is the case on point",
                  body: "Motor homes in a rental fleet, let mostly for under 30 days, held to be section 179 property. The taxpayer won.",
                },
              ]}
            />
          </div>
        </Frame>
      ),
    },

    {
      id: "terms",
      title: "The terms",
      node: (
        <Frame
          eyebrow="The deal"
          title={sized ? "Sized to your target" : "The terms, from an executed agreement"}
          lede={
            sized
              ? "The unit is priced at the deduction you are trying to achieve. The deposit is a fixed share of it and the balance is a note."
              : "These are the terms of a deal that has been signed, not an illustration."
          }
        >
          <Figures
            items={[
              { value: fmtMoney(headline.terms.purchasePriceCents), label: "Purchase price" },
              {
                value: fmtMoney(headline.terms.downPaymentCents),
                label: "Cash down",
                sub: `${fmtPct(constants.depositBps, { digits: 0 })} of the price, wired before delivery`,
              },
              {
                value: fmtMoney(headline.terms.financedCents),
                label: "Seller-financed",
                sub: `${fmtPct(headline.terms.noteRateBps, { digits: 0 })} interest`,
              },
              {
                value: fmtMoney(headline.terms.monthlyPaymentCents, { cents: true }),
                label: "Monthly payment",
                sub: `${headline.terms.noteTermMonths} payments — ${years} years`,
              },
            ]}
          />
          <p className="mt-[3cqh] text-[0.82em] leading-relaxed text-paper-50/65">
            Delivery is included to {constants.transportIncludedMiles.toLocaleString()} miles;
            beyond that it is billed at {fmtMoney(constants.transportPerMileCents)} per mile.
            Optional GAP coverage is {fmtMoney(constants.gapAnnualCents)} per year. The note is
            secured by the unit and repaid from the rental income it produces.
          </p>
        </Frame>
      ),
    },

    {
      id: "leverage",
      title: "The leverage",
      node: (
        <Frame
          eyebrow="Cash against deduction"
          title="What you put in, against what you deduct"
          lede="The deduction is on the full basis of the asset. Only the deposit is cash. That gap is the entire point of financing the purchase."
        >
          <LeverageBars
            cashCents={headline.economics.cashInvestedCents}
            deductionCents={headline.economics.yearOneDeductionCents}
            taxSavingCents={headline.economics.yearOneTaxSavingsCents}
          />
          <p className="deck-note">
            Tax saving shown at an assumed combined marginal rate of{" "}
            {fmtPct(constants.marginalRateBps)}. Your actual rate, and the benefit, are
            confirmed by your CPA. The deduction depends on the note being recourse to the
            Trust and is subject to the §461(l) limit on the following slide.
          </p>
        </Frame>
      ),
    },

    {
      id: "proforma",
      title: "The monthly income",
      node: (
        <Frame
          eyebrow="Illustrative month"
          title="Where a month of rent goes"
          lede={`At ${fmtMoney(proForma.nightlyRateCents)} a night and ${proForma.billedNights} billed nights. The note is paid off the top, before anything is split.`}
        >
          <RevenueSplitBar
            totalCents={proForma.revenueCents}
            segments={[
              { label: "Debt payment", cents: proForma.debtServiceCents },
              { label: "Operating", cents: proForma.operatingCents },
              {
                label: "Agent",
                cents: proForma.agentShareCents,
                note: `${fmtPct(10_000 - constants.revenueSplitBps, { digits: 0 })} of the remainder`,
              },
              {
                label: "To you",
                cents: proForma.ownerShareCents,
                accent: true,
                note: `${fmtPct(constants.revenueSplitBps, { digits: 0 })} of the remainder`,
              },
            ]}
          />
          <p className="deck-note">
            An illustration from our pro forma, not a projection or a guarantee of income
            for any particular unit. Nightly rates and occupancy vary by park and by season.
          </p>
        </Frame>
      ),
    },

    {
      id: "revenue-share",
      title: "The revenue share",
      node: (
        <Frame
          eyebrow="The Management Agreement"
          title="You never write a cheque after the deposit"
          lede="This is the clause clients ask about most, so it is worth reading precisely."
        >
          <Points
            items={[
              {
                head: `${fmtPct(constants.revenueSplitBps, { digits: 0 })} of income after operating expenses`,
                body: "Split evenly between the Agent and you, remitted monthly, with statements each quarter.",
              },
              {
                head: "Costs come out of rent, never out of you",
                body: "Expenses, maintenance, operation and insurance are the Agent's to recover from rental income. The Owner is expressly not liable for them for the life of the unit.",
              },
              {
                head: "The lender forbears",
                body: "In a month without sufficient income, your obligation is suspended until income resumes. You do not fund the shortfall.",
              },
            ]}
          />
          <p className="deck-note">
            Where the Agent advances an expense, it is repaid from future rental income of
            the unit — not billed to you.
          </p>
        </Frame>
      ),
    },

    {
      id: "sizes",
      title: "Sizes",
      node: (
        <Frame
          eyebrow="Entry points"
          title="Three ways in"
          lede="The deal is sized from the deduction you need. These are the common sizes; a fractional interest lets several buyers share one unit."
        >
          <TierTable
            depositLabel={fmtPct(constants.depositBps, { digits: 0 })}
            rows={tiers.map((tier) => ({
              label: tier.label,
              priceCents: tier.terms.purchasePriceCents,
              downCents: tier.terms.downPaymentCents,
              financedCents: tier.terms.financedCents,
              monthlyCents: tier.terms.monthlyPaymentCents,
              deductionCents: tier.economics.yearOneDeductionCents,
            }))}
          />
          <p className="deck-note">
            Each price is also the year-one deduction, at {fmtPct(constants.bonusRateBps, { digits: 0 })}{" "}
            bonus depreciation on the full basis. Deposits shown at our current{" "}
            {fmtPct(constants.depositBps, { digits: 0 })}.
          </p>
        </Frame>
      ),
    },

    {
      id: "limits",
      title: "The limits",
      node: (
        <Frame
          eyebrow="What constrains this"
          title="What your CPA will raise — before they do"
          lede="These are real, they are in our own file, and none of them is a reason not to proceed. They are reasons to size the deal correctly."
        >
          <div className="grid grid-cols-2 gap-x-[3cqw] gap-y-[2.2cqh]">
            {[
              [
                "§461(l) caps the loss you can use this year",
                `Business losses offset other income up to ${fmtMoney(lossLimitation.currentSingleCents)} single and ${fmtMoney(lossLimitation.currentJointCents)} jointly for ${lossLimitation.currentYear} (${fmtMoney(lossLimitation.priorSingleCents)} / ${fmtMoney(lossLimitation.priorJointCents)} for ${lossLimitation.priorYear}). Anything above that carries forward as an NOL — deferred, not lost.`,
              ],
              [
                "The note must be recourse",
                "The deduction rests on at-risk basis under §465. It is guaranteed by and recourse to the Trust, which is exactly why it works — and why the structure is not optional.",
              ],
              [
                "Recapture is real",
                "Selling the unit early, or converting it to personal use, claws the deduction back as ordinary income. There is no buyback in this programme, but a disposition is still a disposition.",
              ],
              [
                "Participation has to be documented",
                "The IRS can ask for the records that establish material participation. The Trustee maintains them and provides them.",
              ],
              [
                "Placed in service is a date",
                "The deduction lands in the year the unit is actually placed in service. Ordering in December and taking delivery in March moves it a year.",
              ],
              [
                "Enforceability of the note",
                "Our opinion concludes the note is enforceable — written, secured, with offer, acceptance and consideration — while noting the taxpayer carries the burden of showing it. We say so rather than waiting to be asked.",
              ],
            ].map(([head, body]) => (
              <div key={head}>
                <p className="text-[0.92em] font-semibold text-paper-50">{head}</p>
                <p className="mt-[0.7cqh] text-[0.75em] leading-relaxed text-paper-50/60">{body}</p>
              </div>
            ))}
          </div>
        </Frame>
      ),
    },

    {
      id: "process",
      title: "How it works",
      node: (
        <Frame
          eyebrow="The process"
          title="What actually happens"
          lede="Five steps, and the only one that needs your calendar is the first."
        >
          <ol className="grid grid-cols-5 gap-[1.8cqw]">
            {[
              ["Qualify", "We confirm with you and your CPA what you need to shelter and in which year."],
              ["Structure", "Your trust is settled and funded; a Series is formed to hold the unit."],
              ["Purchase", "Purchase, Finance and Management agreements are executed as one set. The deposit is wired."],
              ["Place in service", "The unit is delivered to a managed park, set up, and made available for rent."],
              ["Operate", "The Agent rents and administers it. You receive statements, and net income monthly."],
            ].map(([head, body], i) => (
              <li key={head}>
                <p className="font-serif text-[1.6em] leading-none text-gold-500/70">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <p className="mt-[1.2cqh] text-[0.9em] font-semibold text-paper-50">{head}</p>
                <p className="mt-[0.7cqh] text-[0.72em] leading-relaxed text-paper-50/60">{body}</p>
              </li>
            ))}
          </ol>
          <p className="deck-note">
            The three execution documents are one set — the Finance Agreement is Exhibit A
            to the Purchase Agreement. They are signed together.
          </p>
        </Frame>
      ),
    },

    {
      id: "close",
      title: "Next step",
      node: (
        <div className="text-center">
          <p className="deck-eyebrow">Next step</p>
          <h2 className="mt-[2.4cqh] font-serif text-[2.6em] font-medium leading-[1.1] text-paper-50">
            Bring your CPA into the
            <br />
            next conversation.
          </h2>
          <p className="mx-auto mt-[3cqh] max-w-[48ch] text-[1em] leading-relaxed text-paper-50/70">
            We will send the memorandum of law, the pro forma and a proposal sized to your
            own number. Nothing here is tax advice — your CPA confirms the position, and we
            would rather they test it now than after you have signed.
          </p>
          <p className="mt-[4cqh] text-[0.85em] text-paper-50/50">
            {site.name} · {site.email}
          </p>
        </div>
      ),
    },
  ];

  return slides;
}
