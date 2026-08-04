import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { ProposalView } from "@/components/crm/ProposalView";
import { GenerateContracts } from "@/components/crm/GenerateContracts";
import { query } from "@/lib/crm/db";
import { getCrmPageUser } from "@/lib/crm/access";
import { getClient } from "@/lib/crm/clients";
import { CrmError } from "@/lib/crm/db";
import { fmtMoney } from "@/lib/crm/format";
import { getProposal } from "@/lib/crm/proposals";

export const metadata: Metadata = {
  title: "Proposal",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const { id } = await params;
  const proposal = await getProposal(id).catch((err) => {
    if (err instanceof CrmError && err.status === 404) notFound();
    throw err;
  });
  const client = await getClient(proposal.client_id);
  // Only to word the button — "Generate another set" reads very differently
  // from "Generate contracts" when a set already exists.
  const [{ n: contractCount }] = await query<{ n: number }>(
    `SELECT count(*)::int n FROM crm_contracts WHERE proposal_id = $1 AND archived_at IS NULL`,
    [proposal.id],
  ).catch(() => [{ n: 0 }]);

  return (
    <>
      <RecordHeader
        eyebrow="Proposal"
        title={proposal.title}
        intro={`${client.name} · ${fmtMoney(proposal.total_investment_cents)} investment · ${fmtMoney(proposal.year_one_deduction_cents)} first-year deduction`}
        breadcrumb={[
          { href: "/crm", label: "CRM" },
          { href: `/crm/clients/${client.id}`, label: client.name },
        ]}
        actions={
          // The ONLY route to a contract set that carries the proposal's own
          // figures. Generation was previously reachable by API alone, which
          // meant the safe path was the one nobody could take.
          <GenerateContracts
            clientId={client.id}
            proposalId={proposal.id}
            investmentCents={proposal.total_investment_cents}
            depositCents={proposal.down_payment_cents}
            existingCount={contractCount}
          />
        }
      />
      <section className="section pt-12">
        <div className="container-x">
          <ProposalView proposal={proposal} clientName={client.name} />
        </div>
      </section>
    </>
  );
}
