// The execution packet.
//
// Delivery is print-to-PDF, the same way proposals are delivered: this page is
// the documents and nothing else, with the site chrome dropped by the @media
// print rules in globals.css.
//
// It prints the whole SET rather than the one document that was clicked. The
// three are cross-referenced — the Finance Agreement is Exhibit A to the
// Purchase Agreement — so a packet missing one is not executable, and printing
// them separately is how that happens. `?only=1` prints the single document for
// the cases where a counterparty has asked for exactly one.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { PrintButton } from "@/components/crm/PrintButton";
import { getCrmPageUser } from "@/lib/crm/access";
import { getClient } from "@/lib/crm/clients";
import { getContractWithSet } from "@/lib/crm/contracts-gen";
import { CrmError } from "@/lib/crm/db";
import { fmtDate, fmtMoney } from "@/lib/crm/format";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contract",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ContractPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ only?: string }>;
}) {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const { id } = await params;
  const { only } = await searchParams;

  const { contract, set } = await getContractWithSet(id).catch((err) => {
    if (err instanceof CrmError && err.status === 404) notFound();
    throw err;
  });
  const client = await getClient(contract.client_id);
  const documents = only ? [contract] : set;

  return (
    <div className="mx-auto max-w-[52rem] px-6 py-10 print:px-0 print:py-0">
      <div className="no-print mb-8 flex items-center justify-between border-b border-paper-200 pb-4">
        <a href="/crm/contracts" className="link-underline text-sm">
          ← Back to contracts
        </a>
        <PrintButton />
      </div>

      {documents.length > 1 ? (
        <header className="mb-10 border-b border-paper-300 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-600">
            {site.name}
          </p>
          <h1 className="mt-3 font-serif text-3xl font-medium text-navy-900">Execution packet</h1>
          <p className="mt-2 text-sm text-navy-900/60">
            {contract.buyer_legal_name || client.legal_name || client.name}
            {" · "}
            {fmtDate(contract.generated_at || contract.created_at)}
          </p>
          {contract.purchase_price_cents !== null ? (
            <p className="mt-4 text-sm text-navy-900/70">
              Purchase price {fmtMoney(contract.purchase_price_cents, { cents: true })} · deposit{" "}
              {fmtMoney(contract.down_payment_cents, { cents: true })} · financed{" "}
              {fmtMoney(contract.financed_cents, { cents: true })} over{" "}
              {contract.note_term_months?.toLocaleString("en-US")} months at{" "}
              {fmtMoney(contract.monthly_payment_cents, { cents: true })} per month.
            </p>
          ) : null}
          <ol className="mt-4 list-decimal pl-5 text-sm text-navy-900/60">
            {documents.map((d) => (
              <li key={d.id}>{d.title}</li>
            ))}
          </ol>
        </header>
      ) : null}

      {documents.map((doc, i) => (
        <article
          key={doc.id}
          className={`text-navy-900/85 ${i > 0 ? "mt-16 print:mt-0 print:break-before-page" : ""}`}
        >
          {doc.body_md ? (
            <Markdown variant="document">{doc.body_md}</Markdown>
          ) : (
            // A hand-recorded contract row has no generated body. Say so plainly
            // rather than printing an empty page that looks like a failure.
            <div className="rounded-lg border border-paper-300 bg-paper-100 p-6">
              <h2 className="font-serif text-xl text-navy-900">{doc.title}</h2>
              <p className="mt-2 text-sm text-navy-900/70">
                This contract was recorded by hand and has no generated document. The signed copy,
                if there is one, is at{" "}
                {doc.document_url ? (
                  <a className="link-underline" href={doc.document_url}>
                    {doc.document_url}
                  </a>
                ) : (
                  "no recorded location."
                )}
              </p>
            </div>
          )}
        </article>
      ))}

      <footer className="mt-12 border-t border-paper-300 pt-5 text-xs leading-relaxed text-navy-900/50">
        <p>
          {site.name}. These documents are drafts prepared for review and are not legal or tax
          advice. They take effect only on execution by both parties. The tax treatment described in
          the accompanying materials depends on facts that must be confirmed with your own CPA and
          counsel before you rely on them.
        </p>
      </footer>
    </div>
  );
}
