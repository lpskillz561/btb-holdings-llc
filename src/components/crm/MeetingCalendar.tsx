// The month grid.
//
// A server component: the whole thing is derived from the month key and the rows,
// and every date decision is made in the office timezone rather than the
// runtime's, so there is nothing here a browser would compute differently. See
// lib/crm/tz.ts for why that matters.

import Link from "next/link";
import { fmtTime } from "@/lib/crm/format";
import type { MeetingRow } from "@/lib/crm/meetings";
import { dayKeyInTz } from "@/lib/crm/tz";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Every day drawn in the grid for `monthKey` ("YYYY-MM"), padded out to whole
 * weeks. Built from UTC arithmetic on a date-only basis — these are calendar
 * squares, not instants, so no zone is involved in laying them out. The zone
 * matters only when deciding which square a *meeting* belongs to, which is
 * `dayKeyInTz` below.
 */
function monthGrid(monthKey: string): { key: string; inMonth: boolean }[] {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());

  const last = new Date(Date.UTC(year, month, 0));
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));

  const days: { key: string; inMonth: boolean }[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push({
      key: d.toISOString().slice(0, 10),
      inMonth: d.getUTCMonth() === month - 1,
    });
  }
  return days;
}

export function MeetingCalendar({
  monthKey,
  meetings,
  timeZone,
  today,
}: {
  monthKey: string;
  meetings: MeetingRow[];
  timeZone: string;
  /** "YYYY-MM-DD" in the office zone, resolved by the page. */
  today: string;
}) {
  const byDay = new Map<string, MeetingRow[]>();
  for (const meeting of meetings) {
    const key = dayKeyInTz(meeting.occurred_at, timeZone);
    const list = byDay.get(key);
    if (list) list.push(meeting);
    else byDay.set(key, [meeting]);
  }

  return (
    <div className="sf-card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-ink-200 bg-ink-50">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-ink-500"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {monthGrid(monthKey).map(({ key, inMonth }) => {
          const dayMeetings = byDay.get(key) ?? [];
          const isToday = key === today;
          return (
            <div
              key={key}
              className={`min-h-28 border-b border-r border-ink-200 p-1.5 ${
                inMonth ? "bg-card" : "bg-ink-50/60"
              }`}
            >
              <div
                className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  isToday
                    ? "bg-sf-500 font-semibold text-white"
                    : inMonth
                      ? "text-ink-700"
                      : "text-ink-400"
                }`}
              >
                {Number(key.slice(8, 10))}
              </div>
              <div className="space-y-1">
                {dayMeetings.map((meeting) => (
                  <MeetingChip key={meeting.id} meeting={meeting} timeZone={timeZone} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MeetingChip({ meeting, timeZone }: { meeting: MeetingRow; timeZone: string }) {
  // Unfiled calls are tinted, not hidden: an unmatched call that looks identical
  // to a filed one is how it stays unfiled forever.
  const tone = meeting.client_id
    ? "bg-sf-50 text-sf-700 hover:bg-sf-100"
    : "bg-warn-50 text-warn-700 hover:bg-warn-100";

  const body = (
    <span className="block truncate">
      <span className="tabular-nums">{fmtTime(meeting.occurred_at, timeZone)}</span>{" "}
      {meeting.client_name ?? meeting.title}
    </span>
  );

  return meeting.client_id ? (
    <Link
      href={`/crm/clients/${meeting.client_id}`}
      title={`${meeting.title} — ${meeting.client_name}`}
      className={`block rounded px-1.5 py-1 text-[11px] leading-tight transition ${tone}`}
    >
      {body}
    </Link>
  ) : (
    <span
      title={`${meeting.title} — not filed under a client`}
      className={`block rounded px-1.5 py-1 text-[11px] leading-tight ${tone}`}
    >
      {body}
    </span>
  );
}
