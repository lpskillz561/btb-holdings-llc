// Badge colour for a status value.
//
// This lives in lib/, NOT in components/crm/ui.tsx, and the distinction is
// load-bearing: ui.tsx is a "use client" module, and a server component may
// *render* a client component but may not *call* a function exported from one.
// Every CRM section page is a server component that colours a status badge, so
// putting this beside <Badge> made all five of them fail at request time.
//
// Pure data with no React import, so both sides can use it freely.

export type Tone = "neutral" | "gold" | "green" | "amber" | "red" | "navy";

/**
 * Maps a status from any CRM enum to a badge tone — warmer as a relationship or
 * record progresses, red once it has gone wrong. The enums deliberately share
 * vocabulary ("accepted", "signed", "in_service"), so one map serves them all.
 */
export function statusTone(status: string): Tone {
  switch (status) {
    case "owner":
    case "active":
    case "accepted":
    case "signed":
    case "in_service":
    case "acquired":
    case "paid":
    // A pad earning money and a park full of them are the same good news.
    case "occupied":
    case "operating":
      return "green";
    // Ready but empty: capacity that exists and isn't working yet.
    case "available":
      return "navy";
    case "contracted":
    case "proposal_sent":
    case "sent":
    case "out_for_signature":
    case "under_contract":
    case "installed":
    case "delivered":
    case "invoiced":
    case "reserved":
    case "developing":
    case "building":
      return "gold";
    case "lost":
    case "declined":
    case "terminated":
    case "rejected":
    case "overdue":
      return "red";
    case "dormant":
    case "expired":
    case "void":
    case "retired":
      return "amber";
    default:
      return "neutral";
  }
}
