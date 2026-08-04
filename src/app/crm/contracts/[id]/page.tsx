// One contract, inside the CRM.
//
// This route did not exist: the only way to see a generated document was
// /print, which is the client-facing packet. So an operator wanting to check a
// figure had to open the thing they would send to a counterparty, and the
// contract scope of the AI panel was wired but unreachable from any URL.
//
// It shows the SET, not just the one document, because the three are
// cross-referenced and a figure only makes sense against the other two.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { Badge, Detail, SectionHeading } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { getClient } from "@/lib/crm/clients";
import { getContractWithSet } from "@/lib/crm/contracts-gen";
import { CrmError } from "@/lib/crm/db";
import { fmtDate, fmtMoney } from "@/lib/crm/format";
import { statusTone } from "@/lib/crm/tone";
import { LABELS } from "@/lib/crm/types";

export const metadata: Metadata = {
  title: "Contract",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const { id } = await params;
  const { contract, set } = await getContractWithSet(id).catch((err) => {
    if (err instanceof CrmError && err.status === 404) notFound();
    throw err;
  });
  const client = await getClient(contract.client_id).catch(() => null);

  return (
    <>
      <RecordHeader
        eyebrow="Contract"
        title={contract.title}
        breadcrumb={[
          { href: "/crm/contracts", label: "Contracts" },
          ...(client ? [{ href: `/crm/clients/${client.id}`, label: client.name }] : []),
        ]}
        intro={client ? `${client.name} · ${LABELS.contractType[contract.type] ?? contract.type}` : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {/* The packet, not this document alone: the three are
                cross-referenced and one on its own is not executable. */}
            <Link href={`/crm/contracts/${contract.id}/print`} className="sf-btn-brand shrink-0">
              Print the packet
            </Link>
            <Link
              href={`/crm/contracts/${contract.id}/print?only=1`}
              className="sf-btn-neutral shrink-0"
            >
              This document only
            </Link>
          </div>
        }
      />

      <section className="section">
        <div className="container-x space-y-6">
          {contract.not_for_execution && (
            <div className="rounded-lg border-2 border-err-500 bg-err-100 px-5 py-4">
              <p className="text-sm font-bold text-err-700">NOT FOR EXECUTION — do not send</p>
              <p className="mt-1 text-sm text-ink-800">
                Generated before the seller and wire details existed, so the wire instructions
                are placeholders rather than an account. Set{" "}
                <code className="text-xs">{contract.config_issues ?? "the missing values"}</code>{" "}
                and generate a fresh set; this one does not become valid retroactively.
              </p>
            </div>
          )}
          <div className="sf-card p-5">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Status">
                <Badge tone={statusTone(contract.status)}>{contract.status}</Badge>
              </Detail>
              <Detail label="Value">{fmtMoney(contract.value_cents)}</Detail>
              <Detail label="Counterparty">{contract.counterparty ?? "—"}</Detail>
              <Detail label="Created">{fmtDate(contract.created_at)}</Detail>
              <Detail label="Effective">{fmtDate(contract.effective_date) || "—"}</Detail>
              <Detail label="Signed">{fmtDate(contract.signed_at) || "Not signed"}</Detail>
              <Detail label="From proposal">
                {/* The link that makes the figures checkable. A contract whose
                    proposal cannot be found is one generated before the two
                    were tied together, and is worth re-reading by hand. */}
                {contract.proposal_id ? (
                  <Link
                    href={`/crm/proposals/${contract.proposal_id}`}
                    className="text-sf-600 hover:underline"
                  >
                    Open the proposal →
                  </Link>
                ) : (
                  <span className="text-warn-700">Not linked — figures were entered by hand</span>
                )}
              </Detail>
              <Detail label="Documents in set">{set.length}</Detail>
            </dl>
          </div>

          {set.length > 1 && (
            <div className="sf-card p-5">
              <SectionHeading title="The rest of the set" count={set.length - 1} />
              <ul className="space-y-2">
                {set
                  .filter((c) => c.id !== contract.id)
                  .map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/crm/contracts/${c.id}`}
                        className="flex items-center justify-between rounded border border-ink-200 px-3 py-2 text-sm transition hover:bg-sf-50"
                      >
                        <span className="text-ink-900">{c.title}</span>
                        <span className="sf-meta">{fmtMoney(c.value_cents)}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
              <p className="sf-meta mt-3">
                Generated together and cross-referenced — the Finance Agreement is Exhibit A to the
                Purchase Agreement. A packet missing one is not executable.
              </p>
            </div>
          )}

          <div className="sf-card p-6">
            {/* variant="document" — the default components flatten h1/h2/h3 to
                one weight, which makes a contract unnavigable. */}
            <Markdown variant="document">{contract.body_md ?? "_No body._"}</Markdown>
          </div>
        </div>
      </section>
    </>
  );
}
