// What every field on the equipment workbench MEANS, and the rule behind it.
//
// Two facets per entry, deliberately, because they answer different questions
// and staff conflate them constantly:
//
//   usage — what the number is, how to read it, what moving it does
//   legal — the provision it answers to, and how it breaks
//
// A field can be simple to use and dangerous to get wrong. "Qualified business
// use" is a percentage box; it is also the difference between a §168(k)
// deduction and an ADS schedule with recapture attached. Splitting the two
// means the second half never gets compressed into a hint that reads like a
// form label.
//
// ONE HOME, and it is this file. These strings are microcopy, not prompt text,
// so they are NOT loaded into the AI — but they state the same doctrine as
// SKILL.md §6, and two statements of a rule can disagree. **If a rule changes,
// change it in both**: `knowledge/SKILL.md` §6 for what the model says, and
// here for what the screen says. The statutory anchors in `cites` are the
// join — keep them identical in both places so a search for "§280F" finds
// every copy.
//
// Not imported by the deck. `EquipmentCalculator` deliberately carries none of
// this: an internal glossary explaining our own compliance burden is not
// something to render on a prospect's screen share, and it would ship a few KB
// of legal prose into the presentation bundle for nothing.
//
// **These are working notes for BTB staff, not advice to a client.** Nothing
// here should be pasted into anything a taxpayer reads — the proposal caveats
// from `computeEquipmentDeal` are the client-facing text.

export interface GlossaryEntry {
  /** Matches the label on screen, so the tooltip and the field cannot drift. */
  term: string;
  usage: string;
  legal: string;
  /** Statutory anchors. Keep these identical to SKILL.md §6. */
  cites?: string[];
}

export const EQUIPMENT_GLOSSARY = {
  /* ---- Inputs ---------------------------------------------------------- */

  units: {
    term: "Units",
    usage:
      "How many machines are in the placement. Everything below scales from it — purchase price, the note, and the fleet's monthly. There is no volume discount modelled: ten units is ten times one unit, so a better break-even at scale comes from the deposit and the collections moving together, not from a cheaper machine.",
    legal:
      "Each machine is a separate item of listed property and is tested for business use on its own. A fleet does not average: if three of twelve sit in storage all year, that is three assets failing the >50% test, not a fleet comfortably passing it. Each is also separately placed in service, so a delivery that straddles year end splits the deduction across two years.",
    cites: ["§280F(d)(4)", "§168(k) — placed in service"],
  },

  pricePerUnit: {
    term: "Price per unit",
    usage:
      "The invoice price of one machine. This is what the deduction is computed from, which makes it the most consequential number on the page — a 10% move here moves the year-one deduction by the same 10%.",
    legal:
      "Basis is cost. Paying above what the equipment would fetch at arm's length does not buy a larger deduction; it buys a valuation an examiner can challenge, and the excess is not depreciable. Acquisition from a related party disqualifies the property from bonus depreciation outright, so who the seller is matters as much as the price.",
    cites: ["§1012", "§168(k)(2)(E)(ii)", "§179(d)(2)(A)–(C)"],
  },

  deposit: {
    term: "Deposit",
    usage:
      "Cash out of pocket at signing; the balance is financed. Lowering it raises the note payment and improves the leverage ratio — it does NOT change the deduction, which is on the full cost either way. That gap between cash in and deduction out is the whole pitch.",
    legal:
      "Taking the deduction on the full cost rather than on the cash depends on the buyer being at risk for the financed balance. If the note is non-recourse — if the lender's only remedy is the equipment itself — the loss is limited to the amount actually at risk, which is broadly the deposit, and the leverage collapses. This is a condition of the structure, not a formality.",
    cites: ["§465"],
  },

  term: {
    term: "Term",
    usage:
      "Months over which the financed balance amortises. A longer term lowers the payment and improves monthly cash flow, and costs more total interest whenever the rate is above zero.",
    legal:
      "The term has NO effect on the depreciation deduction, which follows the 7-year recovery period, not the loan. This is the point clients most often have backwards. A 180-month note against a 7-year asset means the payment outlives the deduction by eight years — the write-off is long gone while the obligation runs on.",
    cites: ["§168(a)", "Rev. Proc. 87-56, Asset Class 79.0"],
  },

  interestRate: {
    term: "Interest rate",
    usage:
      "APR on the financed balance. At 0% the payment is simply principal divided by months; above zero the schedule is a real amortisation and the early payments are mostly interest.",
    legal:
      "Interest is deductible separately as a business expense — it is NOT part of the §168(k) deduction and the two must never be added together. Separately, a 0% note on a deferred-payment sale can attract imputed interest: the imputed-principal rules discount the payments at the applicable federal rate, recharacterise part of each payment as interest, and REDUCE the stated principal, which reduces basis and therefore the deduction. There is a small-transaction exception around $250,000 of total payments, so a single machine may sit outside it where a fleet does not. Route this to the CPA before quoting a 0% fleet deal.",
    cites: ["§163", "§1274", "§483", "§1274(c)(3)"],
  },

  collections: {
    term: "Collections per unit per month",
    usage:
      "Gross money through the machine before anything is taken out. This is the input with the least evidence behind it and the one most likely to be wrong — it is illustrative, never a projection, and it drives every downstream figure on the page.",
    legal:
      "Real collections are what make this a trade or business rather than a hobby. Equipment producing nothing has no profit motive to point at, and hobby-loss treatment denies the loss entirely. Per-machine collection records are the evidence, and they are the same records the >50% business-use test leans on.",
    cites: ["§162", "§183"],
  },

  marginalRate: {
    term: "Marginal rate",
    usage:
      "The client's own rate, applied flat to the usable deduction. Where no rate is on the client record this defaults to the top federal rate with NO state component, which is conservative for a buyer in a taxing state and exact for one in Nevada or Florida.",
    legal:
      "A deduction of this size normally reduces income through several brackets rather than being absorbed entirely at the top one, so the benefit shown is a ceiling rather than an estimate. Quoting a benefit at a rate the client does not actually pay is a misstatement in a document that goes to their CPA — record their real combined rate before anything is sent.",
    cites: ["§1"],
  },

  businessUse: {
    term: "Qualified business use",
    usage:
      "The share of total use that is genuine business use. The deck and the proposal assume 100%. Drag it to 50% or below and every figure on this page changes shape at once — that is the §280F cliff, and it is a cliff rather than a slope.",
    legal:
      "Amusement equipment is LISTED PROPERTY, so qualified business use must EXCEED 50% — at exactly 50% it fails. Below the line the asset leaves MACRS for 10-year ADS straight line, bonus depreciation is unavailable outright, and excess depreciation already claimed is recaptured as ordinary income. The test is applied EVERY year, not just the first. Leasing to a 5% owner or a related person does not count as qualified business use.",
    cites: ["§280F(b)(1)", "§280F(b)(2)", "§280F(d)(4)", "§280F(d)(6)(C)", "§168(k)(2)(D)(i)"],
  },

  filingStatus: {
    term: "Filing status",
    usage:
      "Sets the §461(l) cap, and joint is exactly double single. It is the input most likely to be assumed rather than asked, and getting it wrong overstates the usable first-year benefit by a factor of two.",
    legal:
      "The excess business loss limitation applies at the INDIVIDUAL level, not at the entity. A partnership or S-corp passes the loss through and each owner applies their own cap on their own return. The thresholds are indexed annually.",
    cites: ["§461(l)"],
  },

  /* ---- Headline tiles --------------------------------------------------- */

  totalPurchase: {
    term: "Total purchase",
    usage: "Units multiplied by the price per unit. The gross cost of the placement, before any financing.",
    legal:
      "This is the figure the deduction is built on, subject to the business-use share below. It is not what the buyer pays in year one — confusing the purchase price with the cash outlay is how a proposal ends up claiming a client spent $1.5m when they wired $150,000.",
    cites: ["§1012"],
  },

  cashDown: {
    term: "Cash down",
    usage: "The deposit in dollars. The only money that actually leaves the buyer's account at signing.",
    legal:
      "Cost basis and cash movement are different things and must never be added together. This number belongs in a cash-flow statement; the purchase price belongs in the depreciation schedule.",
  },

  yearOneBenefit: {
    term: "Year-one benefit",
    usage:
      "The tax saving that realistically lands in the first year — AFTER the §461(l) cap, at the marginal rate shown. This is the figure to quote. The gross figure lower down the page is the one the competing material in this market leads with.",
    legal:
      "It is still an estimate and still a ceiling: it assumes the whole usable deduction is absorbed at the top marginal rate rather than stacking down through brackets, and it assumes the business-use and at-risk conditions hold. Never describe it as money received or refunded.",
    cites: ["§461(l)", "§1"],
  },

  netYearOnePosition: {
    term: "Net year-one position",
    usage:
      "Cash down less the year-one benefit. Negative — shown as cash positive — means the tax saving exceeded what was wired, which is the ordinary outcome of a financed deal at these sizes.",
    legal:
      "Being cash positive in year one is not the same as being profitable. The note runs for its full term regardless, the deduction arrives once, and the carryforward below is deferred rather than earned. A client who hears 'cash positive from day one' and understands 'this pays for itself' has been mis-sold.",
  },

  financed: {
    term: "Financed",
    usage: "Purchase price less the deposit. The principal of the note.",
    legal:
      "This is the amount the buyer must be at risk for if the full-cost deduction is to survive, and it is a real obligation for the whole term whatever the equipment does. There is no forbearance clause in this programme — that term belongs to the tiny-home finance agreement and does not carry across.",
    cites: ["§465"],
  },

  monthlyPayment: {
    term: "Monthly payment",
    usage:
      "The level payment on the note. At 0% it is principal divided by the term; above zero it is a standard amortising payment and the total interest tile beside it stops being zero.",
    legal:
      "The payment is not deductible. Only the interest component is a deductible expense, and the principal component is a return of borrowed money — the deduction for the equipment itself came through depreciation, not through paying the note down. Deducting both would be deducting the same cost twice.",
    cites: ["§163", "§168"],
  },

  netMonthly: {
    term: "Net monthly",
    usage:
      "What reaches the owner after the player payout, the venue share, the service charge and the note. This is the operating result, and it is the number a client should be shown rather than gross collections.",
    legal:
      "It is ordinary business income and is taxable. It also reduces the loss available to offset other income — the deduction offsets this activity's own profit before §461(l) is ever reached, which is exactly what the deduction table below walks through.",
    cites: ["§61", "§461(l)"],
  },

  depositRecovered: {
    term: "Deposit recovered",
    usage:
      "How long the net cash flow takes to return the deposit, and separately how long once the tax benefit is counted. 'Immediate' means the year-one benefit alone exceeded the cash down.",
    legal:
      "A payback period is not a return. It ignores the remaining term of the note, the time value of money, and the risk that collections do not materialise. Presenting it as a 'return' — or annualising it — is how the competing material arrives at figures in the thousands of percent.",
  },

  /* ---- The deduction ---------------------------------------------------- */

  depreciableBasis: {
    term: "Depreciable basis",
    usage:
      "Purchase price multiplied by the qualified business-use share. The personal-use portion is never depreciable, whichever side of the §280F threshold the asset lands on.",
    legal:
      "Basis is cost, reduced by the non-business share and by any imputed-interest adjustment on a below-market note. It is also the ceiling on §1245 recapture later — everything deducted here comes back as ordinary income on a sale or a conversion to personal use.",
    cites: ["§1012", "§1245", "§280F(d)(6)"],
  },

  bonusDepreciation: {
    term: "Bonus depreciation",
    usage:
      "The first-year write-off of the full basis. Shows zero whenever business use is not above 50%, and that zero is correct rather than a bug — see the amber banner above when it appears.",
    legal:
      "Permanently restored to 100% by OBBBA for qualified property acquired and placed in service on or after 20 January 2025. Qualified property needs a recovery period of 20 years or less — 7 years here — original use beginning with the taxpayer or a qualifying used-property acquisition, and no acquisition from a related party. Property forced onto ADS by the listed-property rules is excluded outright.",
    cites: ["§168(k)", "§168(k)(2)(D)(i)", "Rev. Proc. 87-56, Asset Class 79.0"],
  },

  firstYearRemainder: {
    term: "First-year remainder",
    usage:
      "Straight-line recovery on whatever bonus did not absorb. At 100% bonus this is zero; below the §280F threshold, where bonus is unavailable, it becomes the entire first-year deduction and is computed over 10-year ADS.",
    legal:
      "Deliberately simpler and slightly smaller than a full MACRS table with its half-year convention and declining balance. Being conservative in the client's disfavour is the right direction to be wrong in a figure that reaches their CPA.",
    cites: ["§168(g)", "§168(b)"],
  },

  yearOneDeduction: {
    term: "Year-one deduction",
    usage:
      "Bonus plus the remainder — the total depreciation deduction for the first year, before any limit is applied to it. Everything below this line is about how much of it is usable now.",
    legal:
      "A deduction is not a tax saving and not a refund. It reduces taxable income; what it is worth depends on the rate, the brackets it displaces and the limits below.",
    cites: ["§168"],
  },

  activityOwnIncome: {
    term: "Less: this activity's own income",
    usage:
      "The equipment's own annual net. The deduction offsets this first, before any question of sheltering other income arises.",
    legal:
      "This ordering is what §461(l) actually requires — the limitation tests the NET business loss, not the gross deduction. Testing the gross figure against the cap would understate the usable benefit for any fleet that earns anything at all.",
    cites: ["§461(l)(3)"],
  },

  netBusinessLoss: {
    term: "Net business loss",
    usage: "The deduction less the activity's own income. This, not the deduction, is what the cap is measured against.",
    legal:
      "Aggregated across all of the taxpayer's trades and businesses, not just this one. A client with other business income may have far less net loss than this line suggests, and one with other business losses may have far more. The CPA runs it at the return level.",
    cites: ["§461(l)"],
  },

  lossCap: {
    term: "§461(l) cap",
    usage:
      "The most business loss that can offset non-business income this year, set by filing status and indexed annually. Joint is double single.",
    legal:
      "Wages are NON-business income for this purpose, which is the trap: a W-2 earner's salary is exactly what the cap restricts the loss from sheltering. Do not carry across the argument that an employee is 'in the business of being an employee' — that reasoning belongs to a different Code section doing a different job.",
    cites: ["§461(l)"],
  },

  allowedOtherIncome: {
    term: "Allowed against other income",
    usage:
      "The part of the loss that actually shelters wages, other business income or gains this year. With the sheltered own-income above, this is what produces the year-one benefit tile.",
    legal:
      "Allowed for §461(l) purposes only. The at-risk and passive-activity rules are applied BEFORE this one and can reduce it further — if the buyer does not materially participate in the equipment activity, the loss is passive and may be suspended regardless of this line.",
    cites: ["§461(l)", "§465", "§469"],
  },

  carryforward: {
    term: "Carried forward as NOL",
    usage:
      "The excess the cap defers. Deferred, not lost — it becomes a net operating loss carryforward and is available in later years.",
    legal:
      "It carries forward indefinitely but its use in any later year is capped at 80% of that year's taxable income, so a large carryforward can take several years to absorb. Describing it as merely 'delayed by a year' overstates how quickly it comes back.",
    cites: ["§461(l)(2)", "§172(a)(2)"],
  },

  grossVsCapped: {
    term: "Year-one tax benefit, gross vs after the cap",
    usage:
      "The struck-through figure is the whole deduction at the marginal rate. The green figure is what survives §461(l). Only the second is ever sent.",
    legal:
      "The gross figure is what the competing published material quotes — its headline scenario takes $1.5m of income to $0 of federal tax without mentioning the cap at all. Repeating that would contradict the limits slide in our own deck two positions later, and it is not achievable in year one for the filer it describes.",
    cites: ["§461(l)"],
  },

  /* ---- The month --------------------------------------------------------- */

  grossCollections: {
    term: "Gross collections",
    usage:
      "Everything through the machines before any deduction. Never quote this as income — the owner sees roughly a third of it.",
    legal:
      "Gross receipts of the business, reportable in full, with the payout and operating shares below taken as expenses rather than netted at source. How the operator actually reports it depends on who holds the cash and under what agreement.",
    cites: ["§61", "§162"],
  },

  playerPayout: {
    term: "Player payout",
    usage:
      "The share returned to players, taken off GROSS before anything else. At 30% it is the largest single line, and it is what distinguishes this equipment from a conventional arcade cabinet where the player buys a play and receives nothing back.",
    legal:
      "This is the line with the real legal exposure on the page. Equipment that returns cash or prizes may be a regulated gaming device under state law — licensed in some states, prohibited outright in others, and often regulated at municipal level too. Federally, if the machine falls within the statutory definition of a gambling device, the Johnson Act requires manufacturers and DEALERS to register annually with the Attorney General and restricts transport into prohibiting states, which is an obligation on the seller as well as the operator. Payouts above the reporting thresholds can also carry information-reporting duties. Whether a given machine is inside any of these definitions is a question for counsel and the venue's licence — never opine on it, and never tell a client a machine is lawful in their state.",
    cites: ["15 U.S.C. §§1171–1178 (Johnson Act)", "15 U.S.C. §1173", "state gaming statutes"],
  },

  venueOperator: {
    term: "Venue operator",
    usage:
      "The host location's share, taken from what remains AFTER the player payout — not from gross. Read flat against gross this line looks larger than it is.",
    legal:
      "The revenue-share agreement with the venue is what puts the equipment into service somewhere it genuinely earns, which is the §162 trade-or-business fact. It is also where the location's own licensing obligations sit. A placement agreement that is never signed leaves the business purpose resting on nothing.",
    cites: ["§162"],
  },

  serviceCharge: {
    term: "Software, service & repairs",
    usage:
      "Licensing, technology and upkeep, taken from what remains after the player payout, on the same basis as the venue share.",
    legal:
      "Ordinary and necessary operating expenses, deductible as incurred — separate from the depreciation of the equipment itself and not part of basis. A capital improvement that materially adds to the machine's value is a different animal and is capitalised, not expensed.",
    cites: ["§162", "§263(a)"],
  },

  debtService: {
    term: "Debt service",
    usage:
      "The note payment, shown here as a monthly cost against collections so the net line is what the owner actually keeps.",
    legal:
      "Shown in full because this is a cash-flow table. Only the interest portion is deductible; the principal portion is not an expense at all. Reading this line as a deduction double-counts the cost of the equipment against the depreciation already taken above.",
    cites: ["§163", "§168"],
  },

  netToOwner: {
    term: "Net to the owner",
    usage:
      "Collections less every operating line and the note. The honest answer to 'what does this pay me', and the figure that belongs in any conversation about income.",
    legal:
      "Taxable ordinary income, and it reduces the loss available to shelter other income. If the buyer does not materially participate in the activity, it is also passive income — which changes how the losses behave and is the buyer's own question to answer here, since no trustee supplies participation in this programme.",
    cites: ["§61", "§469"],
  },

  /* ---- Sections ---------------------------------------------------------- */

  amortisation: {
    term: "Amortisation",
    usage:
      "The note month by month, with the operating result beside it so the net cash position is visible over the whole term. Long schedules are elided in the middle and say so.",
    legal:
      "The split between principal and interest is what determines the deductible portion of each payment, which is why the columns are shown separately rather than as a single payment figure. On a 0% note there is no interest column to speak of — until imputed-interest rules recharacterise part of it, which the rate field above explains.",
    cites: ["§163", "§1274"],
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof EQUIPMENT_GLOSSARY;
