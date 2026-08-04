// The meetings calendar.
//
// Global section rather than a per-client view, for the reason every other
// section exists: a client card answers "where does this account stand", and
// this answers what no single record can — what is on this week, and which calls
// came in without a client attached to them.
//
// Every date here is decided in the office timezone (lib/crm/tz.ts), never the
// container's, so the grid and the client card cannot disagree about which day a
// call was on.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AttachMeeting } from "@/components/crm/AttachMeeting";
import { MeetingCalendar } from "@/components/crm/MeetingCalendar";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { Badge, EmptyState, StatTile } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { listClientOptions } from "@/lib/crm/clients";
import { fmtDateTime } from "@/lib/crm/format";
import { meetingsInRange, unassignedMeetings, upcomingMeetings } from "@/lib/crm/meetings";
import { statusTone } from "@/lib/crm/tone";
import { dayKeyInTz, officeTimeZone, tzAbbreviation } from "@/lib/crm/tz";
import { LABELS } from "@/lib/crm/types";

export const metadata: Metadata = {
  title: "Meetings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** "YYYY-MM" → the half-open UTC bounds that cover that month generously.
 *
 * A day either side, because the grid buckets by office time: a call at 00:30 on
 * the 1st, local, is the previous day in UTC and would fall outside a bound
 * computed from the month alone. Over-fetching by two days is free; a call
 * missing from the calendar is not.
 */
function monthBounds(monthKey: string): { from: string; to: string } {
  const [year, month] = monthKey.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1));
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(Date.UTC(year, month, 1));
  to.setUTCDate(to.getUTCDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function shiftMonth(monthKey: string, by: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const timeZone = officeTimeZone();
  const now = new Date();
  const today = dayKeyInTz(now.toISOString(), timeZone);

  const requested = (await searchParams).month;
  // Validated rather than trusted: `monthBounds` would produce `NaN` bounds from
  // a malformed value, and a NaN date stringifies into a query that matches
  // nothing — an empty calendar that looks like "no meetings" rather than an error.
  const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested ?? "")
    ? requested!
    : today.slice(0, 7);

  const { from, to } = monthBounds(monthKey);
  const [meetings, unassigned, upcoming, clients] = await Promise.all([
    meetingsInRange(from, to),
    unassignedMeetings(),
    upcomingMeetings(6),
    listClientOptions(),
  ]);

  const monthLabel = new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <>
      <RecordHeader
        eyebrow="Calls"
        title="Meetings"
        intro={`Every call on the book, and the ones that arrived without a client attached. Times are ${tzAbbreviation(timeZone, now)}.`}
      />

      <section className="section pt-12">
        <div className="container-x space-y-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="This month" value={String(meetings.length)} hint={monthLabel} />
            <StatTile label="Scheduled ahead" value={String(upcoming.length)} hint="Next calls due" />
            <StatTile
              label="Summarised"
              value={String(meetings.filter((m) => m.summary_md).length)}
              hint="Of this month's calls"
              tone="gold"
            />
            <StatTile
              label="Unfiled"
              value={String(unassigned.length)}
              hint="No client attached"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-ink-900">{monthLabel}</h2>
            <div className="flex items-center gap-2">
              <Link href={`/crm/meetings?month=${shiftMonth(monthKey, -1)}`} className="sf-btn-neutral">
                ← Prev
              </Link>
              <Link href="/crm/meetings" className="sf-btn-neutral">
                Today
              </Link>
              <Link href={`/crm/meetings?month=${shiftMonth(monthKey, 1)}`} className="sf-btn-neutral">
                Next →
              </Link>
            </div>
          </div>

          <MeetingCalendar
            monthKey={monthKey}
            meetings={meetings}
            timeZone={timeZone}
            today={today}
          />

          {unassigned.length > 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-ink-900">Not filed under a client</h2>
                <p className="mt-1 text-sm text-ink-600">
                  These calls have no client on them. Nothing guesses — a call filed under
                  the wrong account is worse than one sitting here, and until it is filed it
                  is not in that client&apos;s AI context.
                </p>
              </div>
              <div className="space-y-3">
                {unassigned.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="sf-card flex flex-wrap items-center justify-between gap-4 p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{meeting.title}</p>
                      <p className="mt-0.5 text-sm text-ink-600">
                        {fmtDateTime(meeting.occurred_at, timeZone)} ·{" "}
                        {LABELS.meetingPlatform[meeting.platform]} ·{" "}
                        {LABELS.meetingSource[meeting.source]}
                      </p>
                    </div>
                    <AttachMeeting meetingId={meeting.id} clients={clients} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-ink-900">Coming up</h2>
            {upcoming.length === 0 ? (
              <EmptyState>
                Nothing scheduled. Log a call from a client&apos;s Meetings tab.
              </EmptyState>
            ) : (
              <div className="space-y-3">
                {upcoming.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="sf-card flex flex-wrap items-center justify-between gap-4 p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{meeting.title}</p>
                      <p className="mt-0.5 text-sm text-ink-600">
                        {fmtDateTime(meeting.occurred_at, timeZone)}
                        {meeting.client_id && meeting.client_name ? (
                          <>
                            {" · "}
                            <Link
                              href={`/crm/clients/${meeting.client_id}`}
                              className="text-sf-600 hover:underline"
                            >
                              {meeting.client_name}
                            </Link>
                          </>
                        ) : (
                          " · not filed under a client"
                        )}
                      </p>
                    </div>
                    <Badge tone={statusTone(meeting.status)}>
                      {LABELS.meetingStatus[meeting.status]}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
