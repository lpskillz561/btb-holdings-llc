// Current-use presets over the Florida DOR use code.
//
// Deliberately its own module, with NO database import: `lib/parcels.ts` pulls
// in `getPool`, so a "use client" component that imported these constants from
// there would drag `pg` into the browser bundle. Same reason `statusTone` lives
// in `lib/crm/tone.ts` rather than beside the component that uses it.
//
// **THESE ARE NOT ZONING.** `dor_uc` is the property appraiser's record of how a
// parcel is USED. Zoning is what the jurisdiction PERMITS, is set per county and
// per municipality, and appears in neither the NAL roll nor FDOR's statewide
// cadastral (checked: its only use field is DOR_UC). Only zoning answers "may we
// put RVs here", so these presets produce a shortlist to investigate and can
// never establish permission.
//
// Why the codes are split the way they are: the tax case depends on TRANSIENT
// use — rentals normally under 30 days, per §50(b)(2)(B) and Reg.
// 1.48-1(h)(2)(ii). Code 036 (Camp) is the closest thing the roll has to a
// campground or RV park. Code 028 skews to mobile-home parks, which are usually
// permanent residency and therefore the WRONG side of that test, so it is a
// separate option rather than folded in with campgrounds.
//
// Neither is clean. Searching the roll for parcels named like RV parks finds
// them spread across vacant residential, mobile home, condominium and more,
// because RV resort lots are often individually owned; and 036 holds youth
// camps, churches and 516 acres of Walt Disney Parks and Resorts alongside real
// RV resorts. Treat every result as a lead.

export const USE_KINDS = {
  any: { label: "Any use", codes: [] as string[] },
  rv_camp: { label: "Campground / RV (DOR 036)", codes: ["036"] },
  mh_park: { label: "Mobile home park (DOR 028)", codes: ["028"] },
  lodging: { label: "Hotel / motel (DOR 039)", codes: ["039"] },
  park_like: { label: "Any park or lodging (028/036/039)", codes: ["028", "036", "039"] },
} as const;

export type UseKind = keyof typeof USE_KINDS;

export function isUseKind(v: unknown): v is UseKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(USE_KINDS, v);
}

/**
 * Coverage: Florida only. The Montana adapter sets `dor_uc` to null — its
 * PropType is free text, not a coded domain — so these filters can only ever
 * match FL rows. `searchArea` says so in its notes rather than returning a
 * confusing zero.
 */
export const USE_KIND_STATES = ["FL"];
