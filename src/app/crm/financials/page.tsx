import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { statusTone } from "@/lib/crm/tone";
import { Badge, EmptyState, StatTile, Table, Td } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { clientFinance } from "@/lib/crm/clients";
import { fmtDate, fmtMoney, fmtMoneyShort } from "@/lib/crm/format";
import { LABELS } from "@/lib/crm/types";
import { listTransactionsWithClient, profitabilityByClient } from "@/lib/crm/views";

export const metadata: Metadata = {
  title: "Financials",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function FinancialsPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const [finance, byClient, transactions] = await Promise.all([
    clientFinance(null),
    profitabilityByClient(),
    listTransactionsWithClient(150),
  ]);

  // Clients with no money movement at all would pad the table without saying
  // anything; the pipeline view already accounts for them.
  const active = byClient.filter(
    (row) => row.income_cents !== 0 || row.expense_cents !== 0 || row.outstanding_cents !== 0,
  );

  return (
    <>
      <RecordHeader
        eyebrow="Money"
        title="Financials"
        intro="Cash in and out across the programme, and which accounts are carrying it."
      />

      <section className="section pt-12">
        <div className="container-x space-y-12">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Received" value={fmtMoneyShort(finance.income_cents)} hint="Paid income" />
            <StatTile label="Spent" value={fmtMoneyShort(finance.expense_cents)} hint="Paid expenses" />
            <StatTile label="Net" value={fmtMoneyShort(finance.net_cents)} tone="gold" />
            <StatTile
              label="Outstanding"
              value={fmtMoneyShort(finance.outstanding_cents)}
              hint="Invoiced, not collected"
            />
          </div>

          <div>
            <h2 className="mb-4 text-lg font-semibold text-ink-900">By client</h2>
            {active.length === 0 ? (
              <EmptyState>
                No transactions recorded yet. Add them from a client&apos;s Financials tab.
              </EmptyState>
            ) : (
              <div className="sf-card">
                <Table head={["Client", "Received", "Spent", "Net", "Outstanding"]}>
                  {active.map((row) => (
                    <tr key={row.client_id} className="transition hover:bg-white">
                      <Td>
                        <Link
                          href={`/crm/clients/${row.client_id}`}
                          className="font-medium text-ink-900 hover:text-gold-600"
                        >
                          {row.client_name}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">{fmtMoney(row.income_cents)}</Td>
                      <Td className="whitespace-nowrap">{fmtMoney(row.expense_cents)}</Td>
                      <Td
                        className={`whitespace-nowrap font-medium ${
                          row.net_cents < 0 ? "text-red-700" : "text-ink-900"
                        }`}
                      >
                        {fmtMoney(row.net_cents)}
                      </Td>
                      <Td className="whitespace-nowrap">{fmtMoney(row.outstanding_cents)}</Td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-4 text-lg font-semibold text-ink-900">Recent transactions</h2>
            {transactions.length === 0 ? (
              <EmptyState>Nothing recorded yet.</EmptyState>
            ) : (
              <div className="sf-card">
                <Table head={["Date", "Description", "Client", "Category", "Amount", "Status"]}>
                  {transactions.map((row) => (
                    <tr key={row.id} className="transition hover:bg-white">
                      <Td className="whitespace-nowrap text-ink-600">
                        {fmtDate(row.occurred_on)}
                      </Td>
                      <Td>
                        <span className="font-medium text-ink-900">{row.description}</span>
                        {row.invoice_number && (
                          <span className="mt-0.5 block text-xs text-ink-500">
                            #{row.invoice_number}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {row.client_id ? (
                          <Link
                            href={`/crm/clients/${row.client_id}`}
                            className="text-ink-700 hover:text-gold-600"
                          >
                            {row.client_name}
                          </Link>
                        ) : (
                          <span className="text-ink-500">—</span>
                        )}
                      </Td>
                      <Td>{LABELS.txCategory[row.category]}</Td>
                      <Td
                        className={`whitespace-nowrap font-medium ${
                          row.kind === "expense" ? "text-red-700" : "text-emerald-700"
                        }`}
                      >
                        {row.kind === "expense" ? "−" : "+"}
                        {fmtMoney(row.amount_cents)}
                      </Td>
                      <Td>
                        <Badge tone={statusTone(row.status)}>{LABELS.txStatus[row.status]}</Badge>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
