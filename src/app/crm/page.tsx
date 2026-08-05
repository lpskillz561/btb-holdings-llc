import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { ClientsBoard } from "@/components/crm/ClientsBoard";
import { TodoSummary } from "@/components/crm/TodoSummary";
import { statusTone } from "@/lib/crm/tone";
import { Badge, Stat, StatStrip } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { listAvailablePads } from "@/lib/crm/portfolio";
import { getCrmSummary, listClients } from "@/lib/crm/clients";
import { listTodos } from "@/lib/crm/todos";
import { fmtAgo, fmtMoneyShort, fmtNum } from "@/lib/crm/format";
import { CLIENT_STATUSES, LABELS } from "@/lib/crm/types";
import { listStates } from "@/lib/parcels";

export const metadata: Metadata = {
  title: "Client CRM",
  description: "Prospects, proposals, contracts and holdings for the tiny-home programme.",
  robots: { index: false, follow: false },
};

// Live data on every request — a CRM that shows a cached pipeline is worse than
// one that takes an extra 80ms.
export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const user = await getCrmPageUser();
  // 404 rather than a redirect: an account without CRM access shouldn't learn
  // that the section exists.
  if (!user) notFound();

  const [summary, clients, states, pads, todos] = await Promise.all([
    getCrmSummary(),
    listClients(),
    listStates().catch(() => []),
    // Offered in the create-client dialog so a new client can be placed on land
    // BTB already owns at the moment they are taken on.
    listAvailablePads().catch(() => []),
    // The shared board must never be the reason the dashboard fails to render.
    // Read-only here; it is edited at /crm/todos, which is why the assignee list
    // is no longer fetched on this page.
    listTodos().catch(() => []),
  ]);

  return (
    <>
      <RecordHeader
        eyebrow="Tiny home programme"
        title="Client CRM"
        intro="Every prospect, what they're solving for, what we've proposed, and what they own."
        actions={
          <div className="flex shrink-0 gap-2">
            <Link href="/crm/presentations" className="sf-btn-neutral">
              All decks
            </Link>
            {/* A new tab, deliberately: the presenter shares that one tab in
                Meet and keeps the CRM open behind it. Opening in place would put
                the pipeline on the shared screen the moment they finish
                presenting.

                The track is NAMED rather than left to the default. A bare
                /crm/present still opens the full deck for anyone holding that
                link, and the button people actually press opens the short one —
                which is the deck this is for. */}
            <a
              href="/crm/present?track=first-call"
              target="_blank"
              rel="noopener"
              className="sf-btn-brand"
            >
              Show presentation
            </a>
          </div>
        }
      />

      <section className="section pt-8">
        <div className="container-x space-y-8">
          {/* One band, eight figures. The book (top row) reads before the
              operations (bottom row); eight separate cards gave every number
              equal weight, which is the same as giving none any. */}
          <StatStrip>
            <Stat
              label="Clients"
              value={fmtNum(summary.clients_total)}
              hint={`${summary.by_status.owner} owner${summary.by_status.owner === 1 ? "" : "s"}, ${summary.by_status.prospect} prospect${summary.by_status.prospect === 1 ? "" : "s"}`}
            />
            <Stat
              label="Open proposals"
              value={fmtMoneyShort(summary.open_proposal_value_cents)}
              hint="Investment value of drafts and sent proposals"
            />
            <Stat
              label="Contracted"
              value={fmtMoneyShort(summary.active_contract_value_cents)}
              hint="Signed and active contracts"
              tone="gold"
            />
            <Stat
              label="Deduction delivered"
              value={fmtMoneyShort(summary.writeoff_delivered_cents)}
              hint="Modelled first-year deduction across accepted proposals"
            />
            <Stat
              label="Units in service"
              value={`${summary.units_in_service} / ${summary.units_total}`}
              hint="Placed in service — the date the deduction turns on"
            />
            <Stat
              label="Land owned"
              value={`${fmtNum(summary.acres_owned, 1)} ac`}
              hint="Across all client holdings"
            />
            <Stat
              label="Rent run rate"
              value={fmtMoneyShort(summary.finance.annual_rent_run_rate_cents)}
              hint="Annualised, units in service"
            />
            <Stat
              label="Outstanding"
              value={fmtMoneyShort(summary.finance.outstanding_cents)}
              hint="Invoiced and not yet collected"
            />
          </StatStrip>

          {/* Pipeline, the board and the activity feed share a row: each is
              glanced at, none earns the full width, and stacking them pushed the
              client list — the thing people come here to work in — below the
              fold. The board is a LIST here and is edited at /crm/todos. */}
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="sf-card p-6">
              <h2 className="mb-4 text-base font-semibold text-ink-900">Pipeline</h2>
              <div className="grid grid-cols-2 gap-3">
                {CLIENT_STATUSES.map((stage) => (
                  <div
                    key={stage}
                    className="rounded-lg border border-ink-200 bg-white px-4 py-3"
                  >
                    <Badge tone={statusTone(stage)}>{LABELS.clientStatus[stage]}</Badge>
                    <p className="mt-2 text-xl font-semibold text-ink-900">
                      {summary.by_status[stage]}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <TodoSummary todos={todos} />

            <div className="sf-card p-6">
              <h2 className="mb-4 text-base font-semibold text-ink-900">Recent activity</h2>
              {summary.activity.length === 0 ? (
                <p className="text-sm text-ink-600">Nothing yet.</p>
              ) : (
                <ul className="space-y-3">
                  {summary.activity.slice(0, 8).map((entry) => (
                    <li key={entry.id} className="text-sm leading-snug">
                      <span className="text-ink-800">{entry.summary}</span>
                      <span className="mt-0.5 block text-xs text-ink-500">
                        {entry.actor_email ? `${entry.actor_email} · ` : ""}
                        {fmtAgo(entry.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold text-ink-900">Clients</h2>
              {/* The same board has its own section now. This link is what
                  makes that discoverable from the screen people already open. */}
              <Link
                href="/crm/clients"
                className="text-sm font-medium text-sf-600 hover:underline"
              >
                Open clients →
              </Link>
            </div>
            <ClientsBoard initial={clients} states={states} pads={pads} />
          </div>
        </div>
      </section>
    </>
  );
}
