// Everything withdrawn from the board.
//
// The only place archived proposals and contracts are visible, and the only way
// back. Deliberately not a filter on the main lists: "archived" should take a
// deliberate step to reach, or it is just another status people scroll past.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { RestoreButton } from "@/components/crm/RestoreButton";
import { Badge, EmptyState, Table, Td } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { listArchived } from "@/lib/crm/archive";
import { fmtAgo } from "@/lib/crm/format";
import { LABELS } from "@/lib/crm/types";

export const metadata: Metadata = {
  title: "Archive",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const rows = await listArchived();

  return (
    <>
      <RecordHeader
        eyebrow="Withdrawn"
        title="Archive"
        breadcrumb={[{ href: "/crm", label: "CRM" }]}
        intro="Proposals and contracts taken off the board. They are out of every list and every total until restored — nothing here has been deleted."
      />

      <section className="section pt-12">
        <div className="container-x space-y-6">
          {rows.length === 0 ? (
            <EmptyState>
              Nothing is archived. Archiving a proposal or contract from its list puts it here, and
              it can be brought back at any time.
            </EmptyState>
          ) : (
            <div className="sf-card">
              <Table head={["Document", "Type", "Client", "Status when archived", "Archived", ""]}>
                {rows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`} className="border-t border-ink-200">
                    <Td>
                      <Link
                        href={`/crm/${row.kind === "proposal" ? "proposals" : "contracts"}/${row.id}`}
                        className="font-medium text-ink-900 hover:text-sf-600 hover:underline"
                      >
                        {row.title}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone="neutral">
                        {row.kind === "proposal" ? "Proposal" : "Contract"}
                      </Badge>
                    </Td>
                    <Td>
                      {row.client_id ? (
                        <Link
                          href={`/crm/clients/${row.client_id}`}
                          className="text-ink-700 hover:text-sf-600 hover:underline"
                        >
                          {row.client_name ?? "Client"}
                        </Link>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </Td>
                    {/* The status it held when it was withdrawn — the reason
                        `archived` is not itself a status. */}
                    <Td className="text-ink-700">
                      {row.kind === "proposal"
                        ? (LABELS.proposalStatus[
                            row.status as keyof typeof LABELS.proposalStatus
                          ] ?? row.status)
                        : (LABELS.contractStatus[
                            row.status as keyof typeof LABELS.contractStatus
                          ] ?? row.status)}
                    </Td>
                    <Td className="text-ink-600">
                      {fmtAgo(row.archived_at)}
                      {row.archived_by ? ` · ${row.archived_by}` : ""}
                    </Td>
                    <Td>
                      <RestoreButton kind={row.kind} id={row.id} title={row.title} />
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
