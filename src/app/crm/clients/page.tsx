// The client list as a section of its own.
//
// The board is also on the Overview, and both render the SAME `ClientsBoard` —
// not a copy of it. That is the point: the two surfaces answer different
// questions (the dashboard asks "how does the book look today", this page asks
// "find me this account") and a second implementation of the list would be two
// places for a column to be added and one place for it to be forgotten.
//
// It exists because clients were reachable only through the dashboard, so
// finding one meant scrolling past eight figures, the pipeline, the board and
// the activity feed every time. Every other record type in the CRM already had
// its own section; the one people open twenty times a day did not.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClientsBoard } from "@/components/crm/ClientsBoard";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { StatTile } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { getCrmSummary, listClients } from "@/lib/crm/clients";
import { fmtMoneyShort, fmtNum } from "@/lib/crm/format";
import { listAvailablePads } from "@/lib/crm/portfolio";
import { listStates } from "@/lib/parcels";

export const metadata: Metadata = {
  title: "Clients",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const [summary, clients, states, pads] = await Promise.all([
    getCrmSummary(),
    listClients(),
    // Neither of these may be the reason the list fails to render — they only
    // populate the create-client dialog.
    listStates().catch(() => []),
    listAvailablePads().catch(() => []),
  ]);

  return (
    <>
      <RecordHeader
        eyebrow="The book"
        title="Clients"
        intro="Every account, at whatever stage. Search by name or email, filter by stage, and open a card for proposals, contracts, holdings and meetings."
      />

      <section className="section pt-12">
        <div className="container-x space-y-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Clients"
              value={fmtNum(summary.clients_total)}
              hint={`${summary.by_status.owner} owner${summary.by_status.owner === 1 ? "" : "s"}`}
            />
            <StatTile
              label="Prospects"
              value={fmtNum(summary.by_status.prospect)}
              hint="Not yet under contract"
            />
            <StatTile
              label="Contracted"
              value={fmtMoneyShort(summary.active_contract_value_cents)}
              hint="Signed and active"
              tone="gold"
            />
            <StatTile
              label="Deduction delivered"
              value={fmtMoneyShort(summary.writeoff_delivered_cents)}
              hint="Modelled first-year, accepted proposals"
            />
          </div>

          <ClientsBoard initial={clients} states={states} pads={pads} />
        </div>
      </section>
    </>
  );
}
