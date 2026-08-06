import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { ArchiveButton } from "@/components/crm/ArchiveButton";
import { statusTone } from "@/lib/crm/tone";
import { Badge, EmptyState, StatTile, Table, Td } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { fmtDate, fmtMoney, fmtMoneyShort } from "@/lib/crm/format";
import { LABELS } from "@/lib/crm/types";
import { listContractsWithClient } from "@/lib/crm/views";

export const metadata: Metadata = {
  title: "Contracts",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const contracts = await listContractsWithClient();
  const unsigned = contracts.filter(
    (c) => c.status === "draft" || c.status === "out_for_signature",
  );
  const live = contracts.filter((c) => c.status === "signed" || c.status === "active");
  const total = (rows: typeof contracts) => rows.reduce((sum, row) => sum + (row.value_cents ?? 0), 0);

  return (
    <>
      <RecordHeader
        eyebrow="Commitments"
        title="Contracts"
        actions={
          <Link href="/crm/archive" className="sf-btn-neutral">
            Archive
          </Link>
        }
        intro="What has actually been committed to, and what is still waiting on a signature."
      />

      <section className="section pt-12">
        <div className="container-x space-y-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Signed & active" value={String(live.length)} tone="gold" />
            <StatTile label="Contracted value" value={fmtMoneyShort(total(live))} />
            <StatTile
              label="Awaiting signature"
              value={String(unsigned.length)}
              hint="Drafts and out for signature"
            />
            <StatTile label="At stake" value={fmtMoneyShort(total(unsigned))} />
          </div>

          {contracts.length === 0 ? (
            <EmptyState>
              No contracts yet. Add one from a client&apos;s Contracts tab once a proposal is
              accepted.
            </EmptyState>
          ) : (
            <div className="sf-card">
              <Table
                head={["Contract", "Client", "Type", "Status", "Value", "Effective", "Signed", ""]}
              >
                {contracts.map((row) => (
                  <tr key={row.id} className="transition hover:bg-card-2">
                    <Td>
                      {/* The list was a dead end: every row named a document
                          with no way to open it. */}
                      <Link
                        href={`/crm/contracts/${row.id}`}
                        className="font-medium text-sf-600 hover:underline"
                      >
                        {row.title}
                      </Link>
                      {row.counterparty && (
                        <span className="mt-0.5 block text-xs text-ink-500">
                          {row.counterparty}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/crm/clients/${row.client_id}`}
                        className="text-ink-700 hover:text-accent-600"
                      >
                        {row.client_name}
                      </Link>
                    </Td>
                    <Td>{LABELS.contractType[row.type]}</Td>
                    <Td>
                      <Badge tone={statusTone(row.status)}>{LABELS.contractStatus[row.status]}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtMoney(row.value_cents)}</Td>
                    <Td className="whitespace-nowrap text-ink-600">
                      {fmtDate(row.effective_date)}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-600">{fmtDate(row.signed_at)}</Td>
                    <Td className="whitespace-nowrap">
                      <ArchiveButton kind="contract" id={row.id} title={row.title} />
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
