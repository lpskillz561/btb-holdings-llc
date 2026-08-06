"use client";

// Read and edit one proposal.
//
// Two things are deliberately separate on screen, because they are separate in
// the database: the FIGURES, rendered from the frozen columns, and the PROSE,
// which is the only part anyone can edit. There is no way to type a different
// number into a proposal — to quote something else you generate a new one, and
// the old one stays a truthful record of what was offered.

import Link from "next/link";
import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { fmtDate, fmtMoney, fmtPct } from "@/lib/crm/format";
import { LABELS, PROPOSAL_STATUSES, type CrmProposal } from "@/lib/crm/types";
import { apiPatch } from "./api";
import { statusTone } from "@/lib/crm/tone";
import { Badge, ErrorNote } from "./ui";
import { Dropdown } from "./Dropdown";

export function ProposalView({
  proposal: initial,
  clientName,
}: {
  proposal: CrmProposal;
  clientName: string;
}) {
  const [proposal, setProposal] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial.body_md);
  const [title, setTitle] = useState(initial.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError("");
    try {
      setProposal(await apiPatch<CrmProposal>(`/api/crm/proposals/${proposal.id}`, body));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const figures: [string, string][] = [
    ["Units", String(proposal.unit_count)],
    ["Cost per unit", fmtMoney(proposal.unit_cost_cents)],
    ["Site work", fmtMoney(proposal.site_work_cents)],
    ["Soft costs", fmtMoney(proposal.soft_costs_cents)],
    ["Land (not depreciable)", fmtMoney(proposal.land_cost_cents)],
    ["Total investment", fmtMoney(proposal.total_investment_cents)],
    ["Depreciable basis", fmtMoney(proposal.depreciable_basis_cents)],
    ["Bonus depreciation assumed", fmtPct(proposal.bonus_rate_bps, { digits: 0 })],
    ["Recovery period", `${proposal.useful_life_years} yrs`],
    ["First-year deduction", fmtMoney(proposal.year_one_deduction_cents)],
    ["Marginal rate assumed", fmtPct(proposal.marginal_rate_bps)],
    ["Est. first-year tax benefit (gross)", fmtMoney(proposal.year_one_tax_savings_cents)],
    ["Net first-year outlay (gross basis)", fmtMoney(proposal.net_year_one_outlay_cents)],
    ["Projected NOI", `${fmtMoney(proposal.annual_noi_cents)} / yr`],
    ["Cash-on-cash", fmtPct(proposal.cash_on_cash_bps)],
    [
      "Payback",
      proposal.payback_years === null ? "—" : `${proposal.payback_years} yrs`,
    ],
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0">
        <div className="sf-card p-7">
          {editing ? (
            <div className="space-y-4">
              <label className="block">
                <span className="field-label">Title</span>
                <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="block">
                <span className="field-label">Body (Markdown)</span>
                <textarea
                  className="field font-mono text-xs"
                  rows={28}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </label>
              <ErrorNote>{error}</ErrorNote>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  className="sf-btn-neutral"
                  disabled={saving}
                  onClick={() => {
                    setDraft(proposal.body_md);
                    setTitle(proposal.title);
                    setEditing(false);
                  }}
                >
                  Discard changes
                </button>
                <button
                  type="button"
                  className="sf-btn-brand"
                  disabled={saving}
                  onClick={async () => {
                    if (await patch({ title, body_md: draft })) setEditing(false);
                  }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <article className="text-ink-900/85">
              <Markdown>{proposal.body_md}</Markdown>
            </article>
          )}
        </div>
      </div>

      <aside className="space-y-6 no-print">
        <div className="sf-card p-6">
          <div className="flex items-center justify-between">
            <Badge tone={statusTone(proposal.status)}>
              {LABELS.proposalStatus[proposal.status]}
            </Badge>
            <Link
              href={`/crm/proposals/${proposal.id}/print`}
              className="text-sm font-semibold text-sf-600 hover:text-accent-600"
            >
              Print / PDF
            </Link>
          </div>

          {/* A div, not a wrapping <label>: Dropdown is a <button>, and
              interactive content inside a label makes clicking the word
              "Status" open the menu. `aria-label` carries the name instead. */}
          <div className="mt-5 block">
            <span className="field-label">Status</span>
            <Dropdown
              aria-label="Proposal status"
              value={proposal.status}
              disabled={saving}
              onChange={(v) => void patch({ status: v })}
              options={PROPOSAL_STATUSES.map((status) => ({
                value: status,
                label: LABELS.proposalStatus[status],
              }))}
            />
          </div>

          <label className="mt-4 block">
            <span className="field-label">Valid until</span>
            <input
              type="date"
              className="field"
              defaultValue={proposal.valid_until ?? ""}
              disabled={saving}
              onChange={(e) => void patch({ valid_until: e.target.value })}
            />
          </label>

          {proposal.sent_at && (
            <p className="mt-4 text-xs text-ink-600">Sent {fmtDate(proposal.sent_at)}</p>
          )}

          <button
            type="button"
            className="sf-btn-neutral mt-5 w-full"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Stop editing" : "Edit prose"}
          </button>
          <ErrorNote>{error}</ErrorNote>
        </div>

        <div className="sf-card p-6">
          <h3 className="mb-1 text-base font-semibold text-ink-900">The frozen figures</h3>
          <p className="mb-4 text-xs text-ink-600">
            Calculated when this was drafted and stored on the record. Editing the prose cannot
            change them; to quote differently, draft a new proposal for {clientName}.
          </p>
          <dl className="space-y-2 text-sm">
            {figures.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-ink-600">{label}</dt>
                <dd className="text-right font-medium text-ink-900">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}
