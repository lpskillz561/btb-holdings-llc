// Who the contracts name.
//
// The sample documents in docs/ name MH SERVICES LLC as Seller, Creditor and
// Agent. BTB Holdings takes that role, which moves three things with it: the
// party block, the WIRE INSTRUCTIONS the buyer sends $155,000 to, and the
// Management Series that serves as trustee. The first is cosmetic. The second
// two are not — a purchase agreement carrying the wrong account number is worse
// than no agreement, and the trustee identity is what the material-participation
// leg of the tax opinion rests on (see CLAUDE.md).
//
// So none of it is hardcoded. Every field is configuration, and anything unset
// renders as a loud marker rather than a plausible blank, with
// `sellerConfigIssues()` giving the UI something to refuse to send on.

import { site } from "@/lib/site";

/** Unset required fields render as this, so an incomplete draft is obvious. */
export function missing(envVar: string): string {
  return `[[ SET ${envVar} ]]`;
}

function req(envVar: string): string {
  return process.env[envVar]?.trim() || missing(envVar);
}

function opt(envVar: string): string | null {
  return process.env[envVar]?.trim() || null;
}

export interface Party {
  legalName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  phone: string | null;
  /** Drives the governing-law and arbitration-venue clauses. */
  stateOfOrganization: string;
  signatoryName: string | null;
  signatoryTitle: string;
}

export interface WireInstructions {
  bankName: string;
  accountName: string;
  bankAddress: string;
  accountNumber: string;
  routingNumber: string;
}

/**
 * Seller / Creditor / Agent — one entity across all three documents, which is
 * why it is one function. In the samples that entity was MH Services; here it
 * is BTB Holdings unless the environment says otherwise.
 */
export function getSeller(): Party {
  return {
    legalName: process.env.CRM_SELLER_LEGAL_NAME?.trim() || site.name.toUpperCase(),
    addressLine1: req("CRM_SELLER_ADDRESS1"),
    addressLine2: opt("CRM_SELLER_ADDRESS2"),
    city: req("CRM_SELLER_CITY"),
    state: req("CRM_SELLER_STATE"),
    postalCode: req("CRM_SELLER_POSTAL"),
    phone: opt("CRM_SELLER_PHONE"),
    // Nevada by default: the structure in the memorandum is a Nevada series LLC
    // and the sample documents choose Nevada law and Clark County venue.
    stateOfOrganization: process.env.CRM_SELLER_STATE_OF_ORG?.trim() || "Nevada",
    signatoryName: opt("CRM_SELLER_SIGNATORY"),
    signatoryTitle: process.env.CRM_SELLER_SIGNATORY_TITLE?.trim() || "Manager",
  };
}

export function getWireInstructions(): WireInstructions {
  return {
    bankName: req("CRM_WIRE_BANK_NAME"),
    accountName: process.env.CRM_WIRE_ACCOUNT_NAME?.trim() || getSeller().legalName,
    bankAddress: req("CRM_WIRE_BANK_ADDRESS"),
    accountNumber: req("CRM_WIRE_ACCOUNT_NUMBER"),
    routingNumber: req("CRM_WIRE_ROUTING_NUMBER"),
  };
}

/** Venue for the arbitration and governing-law clauses. */
export function getVenue(): { state: string; county: string } {
  return {
    state: getSeller().stateOfOrganization,
    county: process.env.CRM_SELLER_COUNTY?.trim() || "Clark County",
  };
}

/**
 * Everything still unconfigured, as human-readable labels.
 *
 * Callers use a non-empty result to keep a generated set in draft and off the
 * screen of anyone who might send it. Wire fields come first because they are
 * the ones that cost money to get wrong.
 */
export function sellerConfigIssues(): string[] {
  const issues: string[] = [];
  const seller = getSeller();
  const wire = getWireInstructions();

  const check = (label: string, value: string) => {
    if (value.startsWith("[[ SET ")) issues.push(label);
  };

  check("Wire: bank name", wire.bankName);
  check("Wire: bank address", wire.bankAddress);
  check("Wire: account number", wire.accountNumber);
  check("Wire: routing number", wire.routingNumber);
  check("Seller address", seller.addressLine1);
  check("Seller city", seller.city);
  check("Seller state", seller.state);
  check("Seller postal code", seller.postalCode);

  return issues;
}

/** One-line address, for the party blocks at the head of each document. */
export function formatAddress(p: Party): string {
  const street = [p.addressLine1, p.addressLine2].filter(Boolean).join(", ");
  return `${street}, ${p.city}, ${p.state} ${p.postalCode}`;
}
