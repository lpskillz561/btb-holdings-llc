"use client";

// "Generate the execution set" — from a proposal, never from thin air.
//
// Contract generation had no UI at all: it was reachable only by POSTing to the
// API, which meant in practice it was not reachable. This is the button, and it
// always sends `proposal_id`, so the documents inherit the figures frozen on
// the proposal the client was actually shown. There is deliberately NO price or
// deposit field here — if those are typeable they will eventually be typed
// differently, and a contract that quietly disagrees with its proposal is the
// one failure this whole path exists to prevent.
//
// Everything this DOES ask for is per-delivery and cannot come from a proposal:
// the VIN a manufacturer issues, where the unit will stand, and the dates.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "./api";
import { Dialog, ErrorNote, Field, TextInput } from "./ui";
import { fmtMoney } from "@/lib/crm/format";
import type { CrmContract } from "@/lib/crm/types";

interface GeneratedSet {
  deal_group_id: string;
  contracts: CrmContract[];
  warnings: string[];
}

export function GenerateContracts({
  clientId,
  proposalId,
  investmentCents,
  depositCents,
  existingCount = 0,
}: {
  clientId: string;
  proposalId: string;
  investmentCents: number | null;
  depositCents: number | null;
  existingCount?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GeneratedSet | null>(null);
  const [form, setForm] = useState({
    buyer_legal_name: "",
    trust_name: "",
    unit_vin: "",
    collateral_location: "",
    wire_due_date: "",
    funding_date: "",
    first_payment_date: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.currentTarget.value }));

  async function generate() {
    setBusy(true);
    setError("");
    try {
      // Only proposal_id and the per-delivery fields. No figures.
      const body: Record<string, string> = { client_id: clientId, proposal_id: proposalId };
      for (const [k, v] of Object.entries(form)) if (v.trim()) body[k] = v.trim();
      const created = await apiPost<GeneratedSet>("/api/crm/contracts/generate", body);
      setResult(created);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the contracts.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="sf-btn-brand" onClick={() => setOpen(true)}>
        {existingCount > 0 ? "Generate another set" : "Generate contracts"}
      </button>

      {open && (
        <Dialog
          open
          wide
          onClose={() => {
            setOpen(false);
            setResult(null);
            setError("");
          }}
          title="Generate the execution set"
        >
          {result ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-800">
                Three documents generated and linked to this proposal.
              </p>
              <ul className="space-y-2">
                {result.contracts.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded border border-ink-200 px-3 py-2"
                  >
                    <a href={`/crm/contracts/${c.id}`} className="text-sm text-sf-600 hover:underline">
                      {c.title}
                    </a>
                    <span className="sf-meta">{fmtMoney(c.value_cents)}</span>
                  </li>
                ))}
              </ul>
              {result.warnings.length > 0 && (
                <div className="rounded border-l-4 border-warn-500 bg-warn-100 px-3 py-2">
                  <p className="text-xs font-semibold text-warn-700">
                    Fill these in before anyone signs
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-800">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              <a
                href={`/crm/contracts/${result.contracts[0].id}/print`}
                className="sf-btn-brand inline-block"
              >
                Open the packet
              </a>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Shown, not editable. The point is that these came from the
                  proposal; making them typeable is how they drift. */}
              <div className="rounded border border-ink-200 bg-ink-100/60 p-4">
                <p className="sf-meta mb-2">Taken from this proposal — not editable here</p>
                <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                  <span>
                    <span className="text-ink-600">Purchase price</span>{" "}
                    <strong className="text-ink-900">{fmtMoney(investmentCents)}</strong>
                  </span>
                  <span>
                    <span className="text-ink-600">Deposit</span>{" "}
                    <strong className="text-ink-900">{fmtMoney(depositCents)}</strong>
                  </span>
                  <span>
                    <span className="text-ink-600">Financed</span>{" "}
                    <strong className="text-ink-900">
                      {fmtMoney(
                        investmentCents !== null && depositCents !== null
                          ? investmentCents - depositCents
                          : null,
                      )}
                    </strong>
                  </span>
                </div>
                <p className="sf-meta mt-2">
                  0% over 720 months and the 50/50 split are fixed by the tax opinion and are not
                  per-deal inputs.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Buyer legal name" hint="The Series that buys. Defaults to the client's legal name.">
                  <TextInput value={form.buyer_legal_name} onChange={set("buyer_legal_name")} />
                </Field>
                <Field label="Trust name">
                  <TextInput value={form.trust_name} onChange={set("trust_name")} />
                </Field>
                <Field label="Unit VIN" hint="What classifies the unit as 6-year property. Issued on delivery.">
                  <TextInput value={form.unit_vin} onChange={set("unit_vin")} />
                </Field>
                <Field label="Collateral location" hint="Where the unit will stand.">
                  <TextInput value={form.collateral_location} onChange={set("collateral_location")} />
                </Field>
                <Field label="Wire due" hint="YYYY-MM-DD">
                  <TextInput value={form.wire_due_date} onChange={set("wire_due_date")} placeholder="2026-09-01" />
                </Field>
                <Field label="Funding date" hint="YYYY-MM-DD">
                  <TextInput value={form.funding_date} onChange={set("funding_date")} placeholder="2026-09-15" />
                </Field>
                <Field label="First payment" hint="YYYY-MM-DD">
                  <TextInput value={form.first_payment_date} onChange={set("first_payment_date")} placeholder="2026-10-01" />
                </Field>
              </div>

              <p className="sf-meta">
                Anything left blank appears as a warning rather than a blank line in the document,
                so a set can be generated now and completed on delivery.
              </p>

              <ErrorNote>{error}</ErrorNote>

              <div className="flex items-center gap-2">
                <button type="button" className="sf-btn-brand" onClick={generate} disabled={busy}>
                  {busy ? "Generating…" : "Generate all three"}
                </button>
                <button type="button" className="sf-btn-neutral" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
