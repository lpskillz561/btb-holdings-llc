import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { ProposalView } from "@/components/crm/ProposalView";
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
      />
      <section className="section pt-12">
        <div className="container-x">
          <ProposalView proposal={proposal} clientName={client.name} />
        </div>
      </section>
    </>
  );
}
