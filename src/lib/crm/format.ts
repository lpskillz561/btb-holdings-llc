// Display formatting for the CRM. Imported by both server and client
// components, so it must stay free of any Node-only dependency.
//
// This is the ONLY place cents are divided by 100 and basis points by 100.
// Everything upstream — database, API, economics — stays in integers.

/** Integer cents → "$1,250,000". Whole dollars; `cents: true` keeps the pennies. */
export function fmtMoney(
  value: number | null | undefined,
  opts: { cents?: boolean; blank?: string } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return opts.blank ?? "—";
  return (value / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
}

/** Integer cents → "$1.3M" / "$820k", for dashboard tiles where width is tight. */
export function fmtMoneyShort(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const dollars = value / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Basis points → "37.0%". */
export function fmtPct(
  bps: number | null | undefined,
  opts: { digits?: number; blank?: string } = {},
): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return opts.blank ?? "—";
  return `${(bps / 100).toFixed(opts.digits ?? 1)}%`;
}

/**
 * Deduction leverage, in basis points, as the ratio people actually say out
 * loud: 100000 → "10.0:1". Not a percentage — "1000%" is the same number and
 * nobody describes this deal that way.
 */
export function fmtLeverage(bps: number | null | undefined, blank = "—"): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return blank;
  return `${(bps / 10_000).toFixed(1)}:1`;
}

/** "2026-03-14" → "Mar 14, 2026". Passes through anything unparseable. */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Relative age for the activity feed — "3 days ago". */
export function fmtAgo(value: string | null | undefined): string {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return value;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "minute"],
    [3600, "hour"],
    [86_400, "day"],
    [604_800, "week"],
    [2_629_800, "month"],
    [31_557_600, "year"],
  ];
  let chosen: [number, Intl.RelativeTimeFormatUnit] = units[0];
  for (const unit of units) {
    if (seconds >= unit[0]) chosen = unit;
  }
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  return rtf.format(-Math.round(seconds / chosen[0]), chosen[1]);
}

export const SQFT_PER_ACRE = 43_560;

/** Lot size: acres, dropping to square feet for small parcels. */
export function fmtAcres(acres: number | null | undefined): string {
  if (acres === null || acres === undefined || !Number.isFinite(acres)) return "—";
  if (acres >= 0.1) return `${acres.toLocaleString("en-US", { maximumFractionDigits: 2 })} ac`;
  return `${Math.round(acres * SQFT_PER_ACRE).toLocaleString()} sq ft`;
}

/** The unit a lot size was typed in. Listings state both; the column holds acres. */
export type LotUnit = "acres" | "sqft";

/**
 * A typed lot size, in whichever unit the listing stated it, → the `acres` the
 * column holds. Blank or unparseable is null, which clears the column.
 *
 * Rounded at six places so 10,890 sq ft stores as 0.25 rather than
 * 0.2500000000000001, which would then render back as a different number.
 */
export function acresFromInput(input: string | null | undefined, unit: LotUnit): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = input.replace(/[,\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return unit === "sqft" ? Math.round((n / SQFT_PER_ACRE) * 1e6) / 1e6 : n;
}

/**
 * `acres` → what a lot-size input should show. Small parcels come back in
 * square feet, because that is the unit the listing they came from used, and
 * "0.23 ac" is not what the person editing is looking at in another tab.
 */
export function acresToInput(acres: number | null | undefined): {
  value: string;
  unit: LotUnit;
} {
  if (acres === null || acres === undefined || !Number.isFinite(acres)) {
    return { value: "", unit: "acres" };
  }
  if (acres < 0.1) return { value: String(Math.round(acres * SQFT_PER_ACRE)), unit: "sqft" };
  return { value: String(acres), unit: "acres" };
}

/** "1,250" or "—". */
export function fmtNum(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/**
 * "$1,250,000" as typed by a human → 125000000 cents. The inverse of fmtMoney,
 * and the only place a form string becomes money. Null for blank/unparseable.
 */
export function parseMoneyToCents(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = input.replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Integer cents → the plain "1250000" a money input should show. */
export function centsToInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(value / 100);
}

/** Basis points → the plain "37" a percent input should show. */
export function bpsToInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(value / 100);
}
