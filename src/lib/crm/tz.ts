// The one timezone meetings are read in.
//
// This exists because "which day was that call on" has to have exactly one
// answer. `occurred_at` is stored as a UTC instant, and a call at 01:00 UTC is
// the previous evening on the US east coast — so bucketing by the server's
// timezone puts it on Tuesday's square while a browser formatting the same row
// in local time labels it Monday. Both are defensible and the disagreement is
// the bug: the calendar and the client card would show one call on two days.
//
// So: one configured office timezone, applied on both sides. It also removes the
// hydration hazard, since the server and the browser now format from the same
// explicit rule rather than from wherever each happens to be running — the
// container is UTC and nobody who works here is.
//
// Reader-local time is deliberately NOT used. Whoever is on the call is working
// office hours, and a calendar that silently reshuffles when someone opens it
// from a hotel in another timezone is worse than one that is consistently the
// office's.

/** IANA zone the CRM reads meeting times in. `CRM_TIMEZONE` overrides. */
export function officeTimeZone(): string {
  const configured = (process.env.CRM_TIMEZONE ?? "").trim();
  if (!configured) return "America/New_York";
  // A bad zone throws inside Intl at render time, on every page that shows a
  // meeting. Fall back rather than take the CRM down over a typo in SSM.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: configured });
    return configured;
  } catch {
    console.error(`crm: CRM_TIMEZONE "${configured}" is not a valid IANA zone; using America/New_York`);
    return "America/New_York";
  }
}

/**
 * The calendar day an instant falls on, as "YYYY-MM-DD" in the given zone.
 *
 * `en-CA` because its short date format IS ISO order, which makes this a
 * formatting call rather than arithmetic on a shifted Date — the latter is where
 * off-by-one-day bugs live.
 */
export function dayKeyInTz(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Short label for the zone itself — "EDT" — so a time on screen is unambiguous. */
export function tzAbbreviation(timeZone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(at);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}
