"use client";

// The client card: one place that answers "where does this account stand".
//
// State lives here rather than in each tab so an edit made on one tab is
// reflected on the others without a page round-trip — adding a unit updates the
// financial rollups; shortlisting a parcel is visible from Holdings.
//
// Every tab is also reachable as a global section (/crm/proposals, /contracts,
// /holdings, /financials) which answers the cross-client questions a single
// record cannot. Both views render the same records; neither is the "real" one.

import Link from "next/link";
import { useState } from "react";
import type { ClientDetail } from "@/lib/crm/clients";
import { fmtAgo, fmtAcres, fmtDate, fmtMoney, fmtPct } from "@/lib/crm/format";
import {
  LABELS,
  PROPOSAL_STATUSES,
  type CrmProposal,
  type CrmSavedParcel,
} from "@/lib/crm/types";
import { AdvisorTab } from "./AdvisorTab";
import { ClientForm, type StateOption } from "./ClientForm";
import { LandSearchTab } from "./LandSearchTab";
import { MeetingsTab } from "./MeetingsTab";
import { ProposalGenerator, type ProposalDefaults } from "./ProposalGenerator";
import { apiPatch } from "./api";
import {
  CONTACT_SPEC,
  CONTRACT_SPEC,
  PROPERTY_SPEC,
  RecordDialog,
  TRANSACTION_SPEC,
  UNIT_SPEC,
  type Choices,
  type RecordSpec,
} from "./RecordForm";
import { statusTone } from "@/lib/crm/tone";
import { Badge, Detail, Dialog, EmptyState, ErrorNote, SectionHeading, StatTile, Table, Td, useDialog } from "./ui";
import { Dropdown } from "./Dropdown";

type Row = Record<string, unknown>;

const TABS = [
  "Overview",
  // Ahead of the paperwork on purpose: what was said on the last call is the
  // thing you want before dialling, and it is the context the rest is read in.
  "Meetings",
  "Proposals",
  "Contracts",
  "Holdings",
  "Financials",
  "Land search",
  "AI advisor",
] as const;
type Tab = (typeof TABS)[number];

export function ClientCard({
  detail: initial,
  states,
  proposalDefaults,
  aiEnabled,
  timeZone,
  notetaker,
}: {
  detail: ClientDetail;
  states: StateOption[];
  proposalDefaults: ProposalDefaults;
  aiEnabled: boolean;
  /**
   * The office zone, resolved server-side — `process.env` is not readable here.
   * Meeting times are shown in it rather than the reader's, so this card and the
   * calendar cannot put the same call on two different days. See lib/crm/tz.ts.
   */
  timeZone: string;
  /**
   * The notetaker bot's display name, or null when RECALL_API_KEY is unset.
   * Resolved server-side for the same reason as `timeZone` — `process.env` is
   * not readable from a client component.
   */
  notetaker: string | null;
}) {
  const [detail, setDetail] = useState(initial);
  const [tab, setTab] = useState<Tab>("Overview");
  const [error, setError] = useState("");
  const client = detail.client;

  /** Replace one collection on the detail bundle. */
  function patchDetail<K extends keyof ClientDetail>(key: K, value: ClientDetail[K]) {
    setDetail((current) => ({ ...current, [key]: value }));
  }

  /** Insert-or-replace by id, newest first — what every add/edit dialog needs. */
  function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
    return rows.some((r) => r.id === row.id)
      ? rows.map((r) => (r.id === row.id ? row : r))
      : [row, ...rows];
  }

  return (
    <>
      <div className="border-b border-ink-200">
        <div className="container-x flex gap-1 overflow-x-auto">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition ${
                tab === name
                  ? "border-sf-500 font-semibold text-sf-600"
                  : "border-transparent text-ink-600 hover:text-ink-900"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <section className="section pt-10">
        <div className="container-x">
          <ErrorNote>{error}</ErrorNote>

          {tab === "Overview" && (
            <OverviewTab
              detail={detail}
              states={states}
              onClientSaved={(saved) => patchDetail("client", saved)}
              onContactsChanged={(rows) => patchDetail("contacts", rows)}
              upsert={upsert}
            />
          )}

          {tab === "Meetings" && (
            <MeetingsTab
              clientId={client.id}
              clientName={client.name}
              meetings={detail.meetings}
              aiEnabled={aiEnabled}
              timeZone={timeZone}
              notetaker={notetaker}
              onChanged={(rows) => patchDetail("meetings", rows)}
            />
          )}

          {tab === "Proposals" && (
            <ProposalsTab
              detail={detail}
              defaults={proposalDefaults}
              aiEnabled={aiEnabled}
              onChanged={(rows) => patchDetail("proposals", rows)}
              onError={setError}
              upsert={upsert}
            />
          )}

          {tab === "Contracts" && (
            <CollectionTab
              spec={CONTRACT_SPEC}
              clientId={client.id}
              rows={detail.contracts as unknown as Row[]}
              onChanged={(rows) => patchDetail("contracts", rows as unknown as ClientDetail["contracts"])}
              head={["Contract", "Type", "Status", "Value", "Signed"]}
              render={(row) => [
                <span key="t" className="font-medium text-ink-900">{String(row.title)}</span>,
                LABELS.contractType[row.type as keyof typeof LABELS.contractType],
                <Badge key="s" tone={statusTone(String(row.status))}>
                  {LABELS.contractStatus[row.status as keyof typeof LABELS.contractStatus]}
                </Badge>,
                fmtMoney(row.value_cents as number),
                fmtDate(row.signed_at as string | null),
              ]}
              empty="No contracts yet. Add one when a proposal is accepted."
            />
          )}

          {tab === "Holdings" && (
            <HoldingsTab detail={detail} patchDetail={patchDetail} />
          )}

          {tab === "Financials" && (
            <FinancialsTab
              detail={detail}
              onChanged={(rows) =>
                patchDetail("transactions", rows as unknown as ClientDetail["transactions"])
              }
            />
          )}

          {tab === "Land search" && (
            <LandSearchTab
              client={client}
              saved={detail.savedParcels}
              onSavedChange={(rows: CrmSavedParcel[]) => patchDetail("savedParcels", rows)}
            />
          )}

          {tab === "AI advisor" && <AdvisorTab client={client} aiEnabled={aiEnabled} />}
        </div>
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

function OverviewTab({
  detail,
  states,
  onClientSaved,
  onContactsChanged,
  upsert,
}: {
  detail: ClientDetail;
  states: StateOption[];
  onClientSaved: (client: ClientDetail["client"]) => void;
  onContactsChanged: (rows: ClientDetail["contacts"]) => void;
  upsert: <T extends { id: string }>(rows: T[], row: T) => T[];
}) {
  const [editing, openEdit, closeEdit] = useDialog();
  const [contactOpen, setContactOpen] = useState(false);
  const [contact, setContact] = useState<Row | undefined>();
  const client = detail.client;

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="space-y-8 lg:col-span-2">
        <div className="sf-card p-6">
          <SectionHeading
            title="Client"
            action={
              <button type="button" className="sf-btn-neutral" onClick={openEdit}>
                Edit
              </button>
            }
          />
          <dl className="grid gap-5 sm:grid-cols-3">
            <Detail label="Stage">
              <Badge tone={statusTone(client.status)}>{LABELS.clientStatus[client.status]}</Badge>
            </Detail>
            <Detail label="Health">
              <Badge tone={client.health === "green" ? "green" : client.health === "amber" ? "amber" : "red"}>
                {LABELS.health[client.health]}
              </Badge>
            </Detail>
            <Detail label="Source">{LABELS.source[client.source]}</Detail>
            <Detail label="Filing entity">{LABELS.entityType[client.entity_type]}</Detail>
            <Detail label="Email">{client.email ?? "—"}</Detail>
            <Detail label="Phone">{client.phone ?? "—"}</Detail>
            <Detail label="Location">
              {[client.city, client.state].filter(Boolean).join(", ") || "—"}
            </Detail>
            <Detail label="Files in">{client.tax_state ?? "—"}</Detail>
            <Detail label="Relationship owner">{client.owner_email ?? "—"}</Detail>
          </dl>
          {client.notes && (
            <div className="mt-6 border-t border-ink-200 pt-4">
              <p className="whitespace-pre-wrap text-sm text-ink-700">{client.notes}</p>
            </div>
          )}
        </div>

        <div className="sf-card p-6">
          <SectionHeading
            title="People"
            count={detail.contacts.length}
            action={
              <button
                type="button"
                className="sf-btn-neutral"
                onClick={() => {
                  setContact(undefined);
                  setContactOpen(true);
                }}
              >
                Add contact
              </button>
            }
          />
          {detail.contacts.length === 0 ? (
            <EmptyState>
              No one on file. Add the principal, and their CPA — the CPA is who decides whether the
              proposal survives.
            </EmptyState>
          ) : (
            <Table head={["Name", "Role", "Email", "Phone"]}>
              {detail.contacts.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer transition hover:bg-card-2"
                  onClick={() => {
                    setContact(row as unknown as Row);
                    setContactOpen(true);
                  }}
                >
                  <Td>
                    <span className="font-medium text-ink-900">{row.name}</span>
                    {row.title && <span className="mt-0.5 block text-xs text-ink-500">{row.title}</span>}
                  </Td>
                  <Td>{LABELS.contactRole[row.role]}</Td>
                  <Td>{row.email ?? "—"}</Td>
                  <Td>{row.phone ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="sf-card p-6">
          <h3 className="mb-4 text-base font-semibold text-ink-900">Tax profile</h3>
          <dl className="space-y-4">
            <Detail label="Deduction targeted">{fmtMoney(client.target_writeoff_cents)}</Detail>
            <Detail label="Marginal rate">{fmtPct(client.marginal_rate_bps)}</Detail>
            <Detail label="Estimated income">{fmtMoney(client.est_annual_income_cents)}</Detail>
            <Detail label="Capital available">{fmtMoney(client.investment_capacity_cents)}</Detail>
            <Detail label="CPA">
              {client.cpa_name ?? "—"}
              {client.cpa_email && (
                <span className="block text-xs text-ink-600">{client.cpa_email}</span>
              )}
            </Detail>
          </dl>
        </div>

        <div className="sf-card p-6">
          <h3 className="mb-4 text-base font-semibold text-ink-900">Land criteria</h3>
          <dl className="space-y-4">
            <Detail label="Where">
              {[client.target_county, client.target_state].filter(Boolean).join(", ") || "—"}
            </Detail>
            <Detail label="Lot size">
              {client.target_min_acres || client.target_max_acres
                ? `${fmtAcres(client.target_min_acres)} – ${fmtAcres(client.target_max_acres)}`
                : "—"}
            </Detail>
            <Detail label="Budget">{fmtMoney(client.target_max_price_cents)}</Detail>
          </dl>
        </div>

        <CostPositionCard detail={detail} />

        {detail.activity.length > 0 && (
          <div className="sf-card p-6">
            <h3 className="mb-4 text-base font-semibold text-ink-900">Activity</h3>
            <ul className="space-y-3">
              {detail.activity.slice(0, 12).map((entry) => (
                <li key={entry.id} className="text-sm">
                  <p className="text-ink-800">{entry.summary}</p>
                  <p className="text-xs text-ink-500">{fmtAgo(entry.created_at)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Dialog open={editing} onClose={closeEdit} title={`Edit ${client.name}`} wide>
        <ClientForm
          client={client}
          states={states}
          onCancel={closeEdit}
          onSaved={(saved) => {
            onClientSaved(saved);
            closeEdit();
          }}
        />
      </Dialog>

      <RecordDialog
        spec={CONTACT_SPEC}
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        row={contact}
        fixed={{ client_id: client.id }}
        onSaved={(row) =>
          onContactsChanged(
            upsert(detail.contacts, row as unknown as ClientDetail["contacts"][number]),
          )
        }
        onDeleted={() =>
          onContactsChanged(detail.contacts.filter((c) => c.id !== (contact?.id as string)))
        }
      />
    </div>
  );
}

/**
 * What the client is in for, all in.
 *
 * Kept visibly separate from the Financials tab: this is what the assets cost,
 * that is what cash has moved. Adding the two together would double-count every
 * deal, so they never appear in the same total.
 */
function CostPositionCard({ detail }: { detail: ClientDetail }) {
  const c = detail.cost;
  if (c.property_count === 0 && c.unit_count === 0) return null;

  const rows: [string, number, string?][] = [
    ["Land", c.land_cents],
    ["Closing costs", c.land_closing_cents],
    ["Land improvements", c.land_improvements_cents],
    ["Units", c.unit_cents],
    ["Site work", c.unit_site_work_cents],
    ["Soft costs", c.unit_soft_costs_cents],
  ];

  return (
    <div className="sf-card p-6">
      <h3 className="text-base font-semibold text-ink-900">Cost position</h3>
      <p className="mb-4 mt-1 text-xs text-ink-600">
        What the assets cost. Separate from the Financials tab, which tracks cash — the two
        are never added together.
      </p>

      <dl className="space-y-2 text-sm">
        {rows
          .filter(([, value]) => value > 0)
          .map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-ink-600">{label}</dt>
              <dd className="text-ink-800">{fmtMoney(value)}</dd>
            </div>
          ))}
        <div className="flex justify-between gap-3 border-t border-ink-200 pt-2">
          <dt className="font-semibold text-ink-900">All-in</dt>
          <dd className="font-semibold text-ink-900">{fmtMoney(c.total_capital_cents)}</dd>
        </div>
      </dl>

      <dl className="mt-5 space-y-2 border-t border-ink-200 pt-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-600">Depreciable basis</dt>
          <dd className="text-ink-800">{fmtMoney(c.depreciable_basis_cents)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-600">
            In service
            <span className="ml-1 text-xs text-ink-500">
              ({c.in_service_count}/{c.unit_count} units)
            </span>
          </dt>
          <dd className="text-ink-800">{fmtMoney(c.in_service_basis_cents)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-600">Land basis (not depreciable)</dt>
          <dd className="text-ink-800">{fmtMoney(c.land_basis_cents)}</dd>
        </div>
        {c.bonus_claimed_cents > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-600">Bonus claimed</dt>
            <dd className="text-ink-800">{fmtMoney(c.bonus_claimed_cents)}</dd>
          </div>
        )}
        {c.annual_property_tax_cents > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-600">Property tax / yr</dt>
            <dd className="text-ink-800">{fmtMoney(c.annual_property_tax_cents)}</dd>
          </div>
        )}
      </dl>

      {/* The two states that silently shrink a deduction, called out where the
          number is, not buried in a tab. */}
      {c.in_service_basis_cents < c.depreciable_basis_cents && (
        <p className="mt-4 rounded-md bg-warn-500/10 px-3 py-2 text-xs text-warn-700">
          {fmtMoney(c.depreciable_basis_cents - c.in_service_basis_cents)} of basis is not yet
          placed in service and is deducting nothing.
        </p>
      )}
      {c.personal_use_count > 0 && (
        <p className="mt-2 rounded-md bg-warn-500/10 px-3 py-2 text-xs text-warn-700">
          {c.personal_use_count} unit{c.personal_use_count === 1 ? " is" : "s are"} recorded as
          personal use and excluded from the depreciable basis.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Proposals                                                                   */
/* -------------------------------------------------------------------------- */

function ProposalsTab({
  detail,
  defaults,
  aiEnabled,
  onChanged,
  onError,
  upsert,
}: {
  detail: ClientDetail;
  defaults: ProposalDefaults;
  aiEnabled: boolean;
  onChanged: (rows: CrmProposal[]) => void;
  onError: (message: string) => void;
  upsert: <T extends { id: string }>(rows: T[], row: T) => T[];
}) {
  const [open, openGenerator, closeGenerator] = useDialog();

  async function setStatus(proposal: CrmProposal, status: string) {
    try {
      const saved = await apiPatch<CrmProposal>(`/api/crm/proposals/${proposal.id}`, { status });
      onChanged(upsert(detail.proposals, saved));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update the proposal.");
    }
  }

  return (
    <>
      <SectionHeading
        title="Proposals"
        count={detail.proposals.length}
        action={
          <button
            type="button"
            className="sf-btn-brand"
            onClick={openGenerator}
            disabled={!aiEnabled}
            title={aiEnabled ? undefined : "OPENAI_API_KEY is not set on the web service."}
          >
            Draft a proposal
          </button>
        }
      />

      {detail.proposals.length === 0 ? (
        <EmptyState>
          No proposals yet. Drafting one computes the investment, deduction and payback from the
          client&apos;s tax profile, then writes the document around those figures.
        </EmptyState>
      ) : (
        <div className="sf-card">
          <Table
            head={["Proposal", "Status", "Investment", "First-year deduction", "Tax benefit", "Created"]}
          >
            {detail.proposals.map((row) => (
              <tr key={row.id} className="transition hover:bg-card-2">
                <Td>
                  <Link
                    href={`/crm/proposals/${row.id}`}
                    className="font-medium text-ink-900 hover:text-accent-600"
                  >
                    {row.title}
                  </Link>
                  <span className="mt-0.5 block text-xs text-ink-500">
                    {row.unit_count} unit{row.unit_count === 1 ? "" : "s"}
                  </span>
                </Td>
                <Td>
                  <Dropdown
                    value={row.status}
                    onChange={(v) => void setStatus(row, v)}
                    aria-label="Proposal status"
                    className="w-40"
                    options={PROPOSAL_STATUSES.map((s) => ({
                      value: s,
                      label: LABELS.proposalStatus[s],
                    }))}
                  />
                </Td>
                <Td className="whitespace-nowrap">{fmtMoney(row.total_investment_cents)}</Td>
                <Td className="whitespace-nowrap">{fmtMoney(row.year_one_deduction_cents)}</Td>
                <Td className="whitespace-nowrap font-medium text-ink-900">
                  {fmtMoney(row.year_one_tax_savings_cents)}
                </Td>
                <Td className="whitespace-nowrap text-ink-600">{fmtAgo(row.created_at)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      <ProposalGenerator
        client={detail.client}
        defaults={defaults}
        open={open}
        onClose={closeGenerator}
        onCreated={(proposal) => onChanged([proposal, ...detail.proposals])}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Generic collection tab (contracts, land, units, transactions)               */
/* -------------------------------------------------------------------------- */

function CollectionTab({
  spec,
  clientId,
  rows,
  onChanged,
  head,
  render,
  empty,
  fixed,
  choices,
  title,
}: {
  spec: RecordSpec;
  clientId: string;
  rows: Row[];
  onChanged: (rows: Row[]) => void;
  head: string[];
  render: (row: Row) => React.ReactNode[];
  empty: string;
  fixed?: Record<string, string>;
  choices?: Choices;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | undefined>();

  return (
    <>
      <SectionHeading
        title={title ?? `${spec.title}s`}
        count={rows.length}
        action={
          <button
            type="button"
            className="sf-btn-neutral"
            onClick={() => {
              setEditing(undefined);
              setOpen(true);
            }}
          >
            Add {spec.title.toLowerCase()}
          </button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <div className="sf-card">
          <Table head={head}>
            {rows.map((row) => (
              <tr
                key={String(row.id)}
                className="cursor-pointer transition hover:bg-card-2"
                onClick={() => {
                  setEditing(row);
                  setOpen(true);
                }}
              >
                {render(row).map((cell, i) => (
                  <Td key={i} className={i === 0 ? "" : "whitespace-nowrap"}>
                    {cell}
                  </Td>
                ))}
              </tr>
            ))}
          </Table>
        </div>
      )}

      <RecordDialog
        spec={spec}
        open={open}
        onClose={() => setOpen(false)}
        row={editing}
        fixed={{ client_id: clientId, ...fixed }}
        choices={choices}
        onSaved={(saved) =>
          onChanged(
            rows.some((r) => r.id === saved.id)
              ? rows.map((r) => (r.id === saved.id ? saved : r))
              : [saved, ...rows],
          )
        }
        onDeleted={() => onChanged(rows.filter((r) => r.id !== editing?.id))}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Holdings                                                                    */
/* -------------------------------------------------------------------------- */

function HoldingsTab({
  detail,
  patchDetail,
}: {
  detail: ClientDetail;
  patchDetail: <K extends keyof ClientDetail>(key: K, value: ClientDetail[K]) => void;
}) {
  const propertyById = new Map(detail.properties.map((p) => [p.id, p]));
  const landChoices = {
    properties: detail.properties.map((p) => ({ value: p.id, label: p.label })),
  };

  return (
    <div className="space-y-12">
      {/* Where this client's homes actually sit. BTB owns the land, so this is
          the client's footprint ON OUR PARKS — not something they own. It comes
          first because under the current model it is the normal case, and the
          "Land" collection below is the exception. */}
      <div>
        <h3 className="text-base font-semibold text-ink-900">Sited on our land</h3>
        <p className="mb-4 mt-1 text-sm text-ink-600">
          BTB owns the park; this client owns the home standing on the pad. The
          land cost is one section&rsquo;s share of what the park cost us &mdash;{" "}
          <strong>internal only</strong>, never quoted to the client.
        </p>
        {detail.footprint.length === 0 ? (
          <EmptyState>
            None of this client&rsquo;s homes has been assigned a pad yet. Assign one from{" "}
            <a href="/crm/land" className="link-underline">
              Our land
            </a>
            .
          </EmptyState>
        ) : (
          <div className="sf-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-100 text-left text-xs uppercase tracking-wide text-ink-600">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Home</th>
                  <th className="px-4 py-2.5 font-semibold">Park</th>
                  <th className="px-4 py-2.5 font-semibold">Pad</th>
                  <th className="px-4 py-2.5 font-semibold">Footprint</th>
                  <th className="px-4 py-2.5 font-semibold">Share of park</th>
                  {/* Internal cost, not a charge. The client buys the home and
                      never the ground; this is our cost of carrying them. */}
                  <th className="px-4 py-2.5 font-semibold">
                    Land cost <span className="font-normal normal-case text-ink-500">(internal)</span>
                  </th>
                  <th className="px-4 py-2.5 font-semibold">Nightly</th>
                </tr>
              </thead>
              <tbody>
                {detail.footprint.map((f) => (
                  <tr key={f.unit_id} className="border-t border-ink-200">
                    <td className="px-4 py-2.5 font-medium text-ink-900">{f.unit_label}</td>
                    <td className="px-4 py-2.5">
                      {f.park_id ? (
                        <a href={`/crm/land/${f.park_id}`} className="link-underline">
                          {f.park_name}
                        </a>
                      ) : (
                        <span className="text-ink-500">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{f.pad_label ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {f.pad_sqft ? `${f.pad_sqft.toLocaleString("en-US")} sq ft` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {f.share_of_park_bps === null ? "—" : fmtPct(f.share_of_park_bps, { digits: 2 })}
                    </td>
                    <td className="px-4 py-2.5 text-ink-700">
                      {f.land_share_cents === null ? "—" : fmtMoney(f.land_share_cents)}
                    </td>
                    <td className="px-4 py-2.5">{fmtMoney(f.nightly_rate_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CollectionTab
        spec={PROPERTY_SPEC}
        title="Land the client owns"
        clientId={detail.client.id}
        rows={detail.properties as unknown as Row[]}
        onChanged={(rows) => patchDetail("properties", rows as unknown as ClientDetail["properties"])}
        head={["Parcel", "Status", "Where", "Lot size", "Land price", "All-in", "Purchased"]}
        render={(row) => [
          <span key="l" className="font-medium text-ink-900">{String(row.label)}</span>,
          <Badge key="s" tone={statusTone(String(row.status))}>
            {LABELS.propertyStatus[row.status as keyof typeof LABELS.propertyStatus]}
          </Badge>,
          <span key="w" className="text-ink-700">
            {[row.address, row.city, row.state].filter(Boolean).join(", ") || "—"}
          </span>,
          fmtAcres(row.acres as number | null),
          fmtMoney(row.purchase_price_cents as number | null),
          <span key="a" className="font-medium text-ink-900">
            {fmtMoney(
              ((row.purchase_price_cents as number) ?? 0) +
                ((row.closing_costs_cents as number) ?? 0) +
                ((row.improvements_cents as number) ?? 0),
            )}
          </span>,
          fmtDate(row.purchase_date as string | null),
        ]}
        empty="No land recorded. Shortlist parcels on the Land search tab and promote one here when it goes under contract."
      />

      <CollectionTab
        spec={UNIT_SPEC}
        title="Tiny homes"
        clientId={detail.client.id}
        rows={detail.units as unknown as Row[]}
        onChanged={(rows) => patchDetail("units", rows as unknown as ClientDetail["units"])}
        choices={landChoices}
        head={["Unit", "Status", "Use", "Sited on", "Unit cost", "All-in", "Placed in service", "Rent"]}
        render={(row) => [
          <span key="l" className="font-medium text-ink-900">{String(row.label)}</span>,
          <Badge key="s" tone={statusTone(String(row.status))}>
            {LABELS.unitStatus[row.status as keyof typeof LABELS.unitStatus]}
          </Badge>,
          LABELS.unitUse[row.unit_use as keyof typeof LABELS.unitUse],
          row.property_id ? (propertyById.get(String(row.property_id))?.label ?? "—") : "—",
          fmtMoney(row.purchase_price_cents as number | null),
          // Unit + site work + soft costs — the number that actually enters the
          // depreciable basis, which the unit price alone understates.
          <span key="a" className="font-medium text-ink-900">
            {fmtMoney(
              ((row.purchase_price_cents as number) ?? 0) +
                ((row.site_work_cents as number) ?? 0) +
                ((row.soft_costs_cents as number) ?? 0),
            )}
          </span>,
          row.placed_in_service_on ? (
            fmtDate(row.placed_in_service_on as string)
          ) : (
            <span key="p" className="text-warn-700">Not yet</span>
          ),
          fmtMoney(row.monthly_rent_cents as number | null),
        ]}
        empty="No units yet. A unit only produces a deduction once it is placed in service, so record that date when it happens."
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Financials                                                                  */
/* -------------------------------------------------------------------------- */

function FinancialsTab({
  detail,
  onChanged,
}: {
  detail: ClientDetail;
  onChanged: (rows: Row[]) => void;
}) {
  const { finance } = detail;
  return (
    <div className="space-y-10">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Received" value={fmtMoney(finance.income_cents)} hint="Paid income" />
        <StatTile label="Spent" value={fmtMoney(finance.expense_cents)} hint="Paid expenses" />
        <StatTile label="Net" value={fmtMoney(finance.net_cents)} tone="gold" />
        <StatTile
          label="Outstanding"
          value={fmtMoney(finance.outstanding_cents)}
          hint="Invoiced, not collected"
        />
      </div>

      <CollectionTab
        spec={TRANSACTION_SPEC}
        title="Transactions"
        clientId={detail.client.id}
        rows={detail.transactions as unknown as Row[]}
        onChanged={onChanged}
        choices={{
          properties: detail.properties.map((p) => ({ value: p.id, label: p.label })),
          units: detail.units.map((u) => ({ value: u.id, label: u.label })),
        }}
        head={["Description", "Category", "Direction", "Amount", "Date", "Status"]}
        render={(row) => [
          <span key="d" className="font-medium text-ink-900">{String(row.description)}</span>,
          LABELS.txCategory[row.category as keyof typeof LABELS.txCategory],
          LABELS.txKind[row.kind as keyof typeof LABELS.txKind],
          <span key="a" className={row.kind === "expense" ? "text-err-700" : "text-ok-700"}>
            {row.kind === "expense" ? "−" : "+"}
            {fmtMoney(row.amount_cents as number)}
          </span>,
          fmtDate(row.occurred_on as string),
          <Badge key="s" tone={statusTone(String(row.status))}>
            {LABELS.txStatus[row.status as keyof typeof LABELS.txStatus]}
          </Badge>,
        ]}
        empty="No transactions recorded for this client yet."
      />
    </div>
  );
}
