"use client";

// The client list: search, stage filter, and the "Add client" dialog.
//
// Seeded from a server render so the first paint has data, then refetched
// client-side when a filter changes. Rows stay visible (dimmed) while a new
// query is in flight rather than collapsing to a spinner — the same treatment
// the parcel search uses, for the same reason.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ClientListRow } from "@/lib/crm/clients";
import { fmtAgo, fmtMoney } from "@/lib/crm/format";
import { CLIENT_STATUSES, LABELS, type ClientStatus } from "@/lib/crm/types";
import { AiTriage } from "./AiTriage";
import { apiGet, qs } from "./api";
import { ClientForm, type AvailablePad, type StateOption } from "./ClientForm";
import { statusTone } from "@/lib/crm/tone";
import { Badge, Dialog, EmptyState, ErrorNote, Table, Td, useDialog } from "./ui";
import { Dropdown } from "./Dropdown";

export function ClientsBoard({
  initial,
  states,
  pads = [],
}: {
  initial: ClientListRow[];
  states: StateOption[];
  /** Unoccupied pads, so a new client can be sited when they are taken on. */
  pads?: AvailablePad[];
}) {
  const [rows, setRows] = useState(initial);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ClientStatus | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, openDialog, closeDialog] = useDialog();

  const load = useCallback(async (q: string, stage: string) => {
    setLoading(true);
    setError("");
    try {
      setRows(await apiGet<ClientListRow[]>(`/api/crm/clients${qs({ q, status: stage })}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load clients.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced: typing a name shouldn't fire a query per keystroke. The initial
  // render is skipped — the server already supplied that exact result set.
  const [primed, setPrimed] = useState(false);
  useEffect(() => {
    if (!primed) {
      setPrimed(true);
      return;
    }
    const timer = setTimeout(() => void load(search, status), 250);
    return () => clearTimeout(timer);
  }, [search, status, load, primed]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          aria-label="Search clients"
          className="field max-w-xs"
        />
        <Dropdown
          value={status}
          onChange={(v) => setStatus(v as ClientStatus | "")}
          aria-label="Filter by stage"
          className="w-[14rem]"
          options={[
            { value: "", label: "All stages" },
            ...CLIENT_STATUSES.map((s) => ({ value: s, label: LABELS.clientStatus[s] })),
          ]}
        />
        <div className="flex-1" />
        <button type="button" className="sf-btn-brand" onClick={openDialog}>
          Add client
        </button>
      </div>

      {/* Answers the question the list itself cannot: not "find me this
          account" but "which of these has gone quiet". Behind a press — this
          component is mounted on both the Overview and /crm/clients, so an
          on-mount call would bill twice for one view of the dashboard.
          `nameFor` reads from the rows already loaded rather than asking the
          model for a name it could get wrong. */}
      <AiTriage nameFor={(id) => rows.find((r) => r.id === id)?.name} />

      <ErrorNote>{error}</ErrorNote>

      <div className={`sf-card mt-3 ${loading ? "opacity-60 transition-opacity" : ""}`}>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              action={
                <button type="button" className="sf-btn-brand" onClick={openDialog}>
                  Add your first client
                </button>
              }
            >
              {search || status
                ? "No clients match that filter."
                : "No clients yet. Add the first prospect to start tracking proposals, contracts and holdings."}
            </EmptyState>
          </div>
        ) : (
          <Table
            head={["Client", "Stage", "Target deduction", "Invested", "Holdings", "Last touched"]}
          >
            {rows.map((row) => (
              <tr key={row.id} className="transition hover:bg-sf-50">
                <Td>
                  <Link href={`/crm/clients/${row.id}`} className="font-semibold text-ink-900 hover:text-accent-600">
                    {row.name}
                  </Link>
                  <span className="mt-0.5 block text-xs text-ink-500">
                    {row.email ?? LABELS.entityType[row.entity_type]}
                  </span>
                </Td>
                <Td>
                  <Badge tone={statusTone(row.status)}>{LABELS.clientStatus[row.status]}</Badge>
                </Td>
                <Td className="whitespace-nowrap">{fmtMoney(row.target_writeoff_cents)}</Td>
                <Td className="whitespace-nowrap">{fmtMoney(row.invested_cents)}</Td>
                <Td className="whitespace-nowrap text-ink-700">
                  {row.unit_count} unit{row.unit_count === 1 ? "" : "s"} · {row.property_count} land
                </Td>
                <Td className="whitespace-nowrap text-ink-900/55">{fmtAgo(row.updated_at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <Dialog open={open} onClose={closeDialog} title="Add client" size="lg">
        <ClientForm
          pads={pads}
          states={states}
          onCancel={closeDialog}
          onSaved={(client) => {
            closeDialog();
            // Show it immediately rather than waiting for a refetch; the row has
            // no rollups yet, which is correct — a new client has none.
            setRows((current) => [
              { ...client, proposal_count: 0, contract_count: 0, unit_count: 0, property_count: 0, invested_cents: 0, modelled_writeoff_cents: 0 },
              ...current,
            ]);
          }}
        />
      </Dialog>
    </>
  );
}
