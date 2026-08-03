import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { ArchiveButton } from "@/components/crm/ArchiveButton";
import { statusTone } from "@/lib/crm/tone";
import { Badge, EmptyState, StatTile, Table, Td } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { fmtAgo, fmtMoney, fmtMoneyShort } from "@/lib/crm/format";
import { listProposalsWithClient } from "@/lib/crm/proposals";
import { LABELS } from "@/lib/crm/types";

export const metadata: Metadata = {
  title: "Proposals",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const proposals = await listProposalsWithClient();

  const open = proposals.filter((p) => p.status === "draft" || p.status === "sent");
  const accepted = proposals.filter((p) => p.status === "accepted");
  const sum = (rows: typeof proposals, key: "total_investment_cents" | "year_one_deduction_cents") =>
    rows.reduce((total, row) => total + (row[key] ?? 0), 0);

  return (
    <>
      <RecordHeader
        eyebrow="Pipeline"
        title="Proposals"
        actions={
          <Link href="/crm/archive" className="sf-btn-neutral">
            Archive
          </Link>
        }
        intro="Every proposal across the book. Figures are frozen at drafting — a proposal says the same thing next month as it did the day it was sent."
      />

      <section className="section pt-12">
        <div className="container-x space-y-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Open" value={String(open.length)} hint="Drafts and sent" />
            <StatTile
              label="Open value"
              value={fmtMoneyShort(sum(open, "total_investment_cents"))}
              hint="Investment at stake"
            />
            <StatTile label="Accepted" value={String(accepted.length)} tone="gold" />
            <StatTile
              label="Deduction accepted"
              value={fmtMoneyShort(sum(accepted, "year_one_deduction_cents"))}
              hint="Modelled first-year"
            />
          </div>

          {proposals.length === 0 ? (
            <EmptyState>
              No proposals yet. Open a client and draft one from their Proposals tab — the figures
              come from their tax profile.
            </EmptyState>
          ) : (
            <div className="sf-card">
              <Table
                head={["Proposal", "Client", "Status", "Investment", "Deduction", "Tax benefit", "Created", ""]}
              >
                {proposals.map((row) => (
                  <tr key={row.id} className="transition hover:bg-white">
                    <Td>
                      <Link
                        href={`/crm/proposals/${row.id}`}
                        className="font-medium text-ink-900 hover:text-gold-600"
                      >
                        {row.title}
                      </Link>
                    </Td>
                    <Td>
                      <Link
                        href={`/crm/clients/${row.client_id}`}
                        className="text-ink-700 hover:text-gold-600"
                      >
                        {row.client_name}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(row.status)}>{LABELS.proposalStatus[row.status]}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtMoney(row.total_investment_cents)}</Td>
                    <Td className="whitespace-nowrap">{fmtMoney(row.year_one_deduction_cents)}</Td>
                    <Td className="whitespace-nowrap font-medium text-ink-900">
                      {fmtMoney(row.year_one_tax_savings_cents)}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-600">{fmtAgo(row.created_at)}</Td>
                    <Td className="whitespace-nowrap">
                      <ArchiveButton kind="proposal" id={row.id} title={row.title} />
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
