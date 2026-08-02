import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CrmNav } from "@/components/crm/CrmNav";
import { ClientsBoard } from "@/components/crm/ClientsBoard";
import { statusTone } from "@/lib/crm/tone";
import { Badge, StatTile } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { getCrmSummary, listClients } from "@/lib/crm/clients";
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

  const [summary, clients, states] = await Promise.all([
    getCrmSummary(),
    listClients(),
    listStates().catch(() => []),
  ]);

  return (
    <>
      <CrmNav
        current="/crm"
        eyebrow="Tiny home programme"
        title="Client CRM"
        intro="Every prospect, what they're solving for, what we've proposed, and what they own."
      />

      <section className="section pt-12">
        <div className="container-x space-y-12">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Clients"
              value={fmtNum(summary.clients_total)}
              hint={`${summary.by_status.owner} owner${summary.by_status.owner === 1 ? "" : "s"}, ${summary.by_status.prospect} prospect${summary.by_status.prospect === 1 ? "" : "s"}`}
            />
            <StatTile
              label="Open proposals"
              value={fmtMoneyShort(summary.open_proposal_value_cents)}
              hint="Investment value of drafts and sent proposals"
            />
            <StatTile
              label="Contracted"
              value={fmtMoneyShort(summary.active_contract_value_cents)}
              hint="Signed and active contracts"
              tone="gold"
            />
            <StatTile
              label="Deduction delivered"
              value={fmtMoneyShort(summary.writeoff_delivered_cents)}
              hint="Modelled first-year deduction across accepted proposals"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Units in service"
              value={`${summary.units_in_service} / ${summary.units_total}`}
              hint="Placed in service — the date the deduction turns on"
            />
            <StatTile
              label="Land owned"
              value={`${fmtNum(summary.acres_owned, 1)} ac`}
              hint="Across all client holdings"
            />
            <StatTile
              label="Rent run rate"
              value={fmtMoneyShort(summary.finance.annual_rent_run_rate_cents)}
              hint="Annualised, units in service"
            />
            <StatTile
              label="Outstanding"
              value={fmtMoneyShort(summary.finance.outstanding_cents)}
              hint="Invoiced and not yet collected"
            />
          </div>

          {/* Pipeline strip — where every relationship currently sits. */}
          <div className="card p-6">
            <h2 className="mb-4 text-base font-semibold text-navy-900">Pipeline</h2>
            <div className="flex flex-wrap gap-3">
              {CLIENT_STATUSES.map((stage) => (
                <div
                  key={stage}
                  className="min-w-[8.5rem] flex-1 rounded-lg border border-paper-200 bg-paper-50 px-4 py-3"
                >
                  <Badge tone={statusTone(stage)}>{LABELS.clientStatus[stage]}</Badge>
                  <p className="mt-2 font-serif text-xl text-navy-900">
                    {summary.by_status[stage]}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-4 text-lg font-semibold text-navy-900">Clients</h2>
            <ClientsBoard initial={clients} states={states} />
          </div>

          {summary.activity.length > 0 && (
            <div className="card p-6">
              <h2 className="mb-4 text-base font-semibold text-navy-900">Recent activity</h2>
              <ul className="space-y-2.5">
                {summary.activity.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="text-navy-900/85">{entry.summary}</span>
                    <span className="text-xs text-navy-900/45">
                      {entry.actor_email ? `${entry.actor_email} · ` : ""}
                      {fmtAgo(entry.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
