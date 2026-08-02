// The client-facing document.
//
// Delivery is print-to-PDF: this page is the proposal and nothing else. The
// site header and footer are dropped by the @media print rules in globals.css,
// and the "Print" button carries .no-print so it never appears on the page the
// client receives.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { PrintButton } from "@/components/crm/PrintButton";
import { getCrmPageUser } from "@/lib/crm/access";
import { getClient } from "@/lib/crm/clients";
import { CrmError } from "@/lib/crm/db";
import { fmtDate } from "@/lib/crm/format";
import { getProposal } from "@/lib/crm/proposals";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Proposal",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ProposalPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const { id } = await params;
  const proposal = await getProposal(id).catch((err) => {
    if (err instanceof CrmError && err.status === 404) notFound();
    throw err;
  });
  const client = await getClient(proposal.client_id);

  return (
    <div className="mx-auto max-w-[52rem] px-6 py-10 print:px-0 print:py-0">
      <div className="no-print mb-8 flex items-center justify-between border-b border-paper-200 pb-4">
        <a href={`/crm/proposals/${proposal.id}`} className="link-underline text-sm">
          ← Back to the record
        </a>
        <PrintButton />
      </div>

      <header className="mb-10 border-b border-paper-300 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-600">
          {site.name}
        </p>
        <h1 className="mt-3 font-serif text-3xl font-medium text-navy-900">{proposal.title}</h1>
        <p className="mt-2 text-sm text-navy-900/60">
          Prepared for {client.legal_name || client.name}
          {" · "}
          {fmtDate(proposal.created_at)}
          {proposal.valid_until ? ` · valid until ${fmtDate(proposal.valid_until)}` : ""}
        </p>
      </header>

      <article className="text-navy-900/85">
        <Markdown>{proposal.body_md}</Markdown>
      </article>

      <footer className="mt-12 border-t border-paper-300 pt-5 text-xs leading-relaxed text-navy-900/50">
        <p>
          {site.name}. This document is prepared for discussion and is not tax, legal, or investment
          advice. Figures are estimates based on the assumptions stated above; the tax treatment of
          any acquisition depends on facts that must be confirmed with your own CPA before you rely
          on it.
        </p>
      </footer>
    </div>
  );
}
