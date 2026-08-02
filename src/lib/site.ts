/**
 * Brand config for the BTB Holdings CRM.
 *
 * Referenced by the layout metadata and by the proposal print page, which puts
 * `name` and the disclaimer in front of a client and their CPA — so treat the
 * wording here as client-facing, not decoration.
 */

export const site = {
  name: "BTB Holdings LLC",
  shortName: "BTB Holdings",
  tagline: "Tiny home programmes for tax-advantaged ownership.",
  description:
    "BTB Holdings sources land, places tiny homes on it, and puts them in service as income-producing rental assets for owners seeking a legitimate depreciation deduction.",
  domain: "btbholdingsllc.com",
  email: "info@ziora.io",
  established: 2026,
} as const;
