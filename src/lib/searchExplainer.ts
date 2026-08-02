// Canonical, vetted explanation of how the Florida parcel search works and
// where its accuracy limits are. Single source of truth for the on-screen info
// tooltips in PropertyResearch, and (via SEARCH_EXPLAINER_SYSTEM_PROMPT) for the
// "Assess with AI" system prompt.

export interface SearchExplainerTopic {
  title: string;
  body: string;
}

export const SEARCH_EXPLAINER = {
  offMarket: {
    title: "Why are these “off market”?",
    body:
      "These are Florida county assessment records (FL Department of Revenue roll) — " +
      "ownership, land use and assessed values — not for-sale listings. A parcel can " +
      "show “off market” on Zillow and still appear here; that is expected. This view " +
      "is built for sourcing UNLISTED parcels and their owners to approach directly, " +
      "not a feed of homes already for sale.",
  },
  landClassification: {
    title: "How “Vacant Land” is decided",
    body:
      "Land is identified by the official Florida DOR use code — e.g. 00 Vacant " +
      "Residential, 10 Vacant Commercial, 50-69 Agricultural, 99 Acreage not zoned " +
      "agricultural — not a keyword guess. That makes the classification precise. " +
      "The “Land” tag covers vacant lots, acreage, and agricultural parcels.",
  },
  deedHistory: {
    title: "Sale & distress data",
    body:
      "The sale shown is the most recent recorded sale from the assessment roll " +
      "(price + date). Tax Deed and Foreclosure tags come from a nightly sync of " +
      "county auction systems (Florida RealTaxDeed / RealForeclose counties, and North " +
      "Carolina tax-foreclosure trustee listings) matched to parcels by parcel number — " +
      "they mark properties with an ACTIVE upcoming sale, with the sale date and opening " +
      "bid where published. Assessed value is the roll’s just/market value; the roll " +
      "does not carry the annual tax billed.",
  },
  coverage: {
    title: "Coverage",
    body:
      "Parcels cover Florida (statewide assessment roll) and North Carolina (NC OneMap; " +
      "no ZIPs, search by city), refreshed on a schedule. Auction coverage: ~19 large FL " +
      "counties on the RealAuction platform and ~28 NC counties whose tax foreclosures " +
      "run through the Kania Law Firm — not every county, so an unflagged parcel isn't " +
      "guaranteed auction-free. Vacant land often has no situs street address, so those " +
      "rows show the city + parcel number instead.",
  },
} satisfies Record<string, SearchExplainerTopic>;

/** The same knowledge as a system prompt for the AI assessment feature. */
export const SEARCH_EXPLAINER_SYSTEM_PROMPT = [
  "You are a research assistant embedded in Ziora's Florida parcel search tool.",
  "When a user asks about a listing or the results, explain accurately and never overstate.",
  "Ground every answer in these facts about how the search works:",
  "",
  `- ${SEARCH_EXPLAINER.offMarket.body}`,
  `- ${SEARCH_EXPLAINER.landClassification.body}`,
  `- ${SEARCH_EXPLAINER.deedHistory.body}`,
  `- ${SEARCH_EXPLAINER.coverage.body}`,
  "",
  "Records are indicative Florida assessment-roll data, not a title commitment. If unsure, say so.",
].join("\n");
