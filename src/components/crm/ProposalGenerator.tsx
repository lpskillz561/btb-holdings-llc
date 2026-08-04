"use client";

// Draft a proposal.
//
// The preview panel runs the SAME `computeEconomics` the server runs, so what
// the operator sees before pressing Draft is what gets frozen onto the row —
// there is no second implementation of the maths to drift. The server still
// recomputes from the submitted inputs and stores its own result; the client
// copy is a preview, never the source of truth.

import { useMemo, useState, type FormEvent } from "react";
import { computeEconomics } from "@/lib/crm/economics";
import { fmtMoney, fmtPct } from "@/lib/crm/format";
import { LABELS, UNIT_USES, type CrmClient, type CrmProposal, type UnitUse } from "@/lib/crm/types";
import { apiPost } from "./api";
import {
  Dialog,
  ErrorNote,
  Field,
  MoneyInput,
  PercentInput,
  Select,
  TextArea,
  TextInput,
} from "./ui";

export interface ProposalDefaults {
  /** Deposit as a share of the price, in bps. 1000 = 10%. */
  depositBps: number;
  marginalRateBps: number;
  bonusRateBps: number;
  usefulLifeYears: number;
  occupancyBps: number;
  opexBps: number;
}

/** Whole dollars typed by a human → cents, for the live preview only. */
const toCents = (v: string) => Math.round((Number(v.replace(/[$,\s]/g, "")) || 0) * 100);
/** Whole dollars typed by a human → a number, for re-deriving the deposit. */
const dollars = (v: string) => Number(v.replace(/[$,\s]/g, "")) || 0;
const toBps = (v: string) => Math.round((Number(v.replace(/[%\s]/g, "")) || 0) * 100);

export function ProposalGenerator({
  client,
  defaults,
  open,
  onClose,
  onCreated,
}: {
  client: CrmClient;
  defaults: ProposalDefaults;
  open: boolean;
  onClose: () => void;
  onCreated: (proposal: CrmProposal) => void;
}) {
  const [form, setForm] = useState({
    unit_count: "1",
    // The deal is SIZED FROM THE WRITE-OFF. A client says "I need to shelter
    // $1,000,000", so the unit is priced at $1,000,000 and the deduction is
    // taken on that basis — the price is the answer to their question, not a
    // separate input someone has to reverse-engineer.
    unit_cost: client.target_writeoff_cents
      ? String(Math.round(client.target_writeoff_cents / 100))
      : "",
    site_work: "",
    soft_costs: "",
    down_payment: client.target_writeoff_cents
      ? String(Math.round((client.target_writeoff_cents * defaults.depositBps) / 10_000 / 100))
      : "",
    monthly_rent: "",
    unit_use: "transient_rental" as UnitUse,
    marginal_rate: String(defaults.marginalRateBps / 100),
    bonus_rate: String(defaults.bonusRateBps / 100),
    useful_life_years: String(defaults.usefulLifeYears),
    occupancy: String(defaults.occupancyBps / 100),
    opex: String(defaults.opexBps / 100),
    title: "",
    valid_until: "",
    instructions: "",
  });
  /**
   * Whether someone has typed their own deposit.
   *
   * Until they do, the deposit TRACKS 10% of the investment. Freezing it at the
   * initial 10% is what made the numbers stop adding up: raise the price and the
   * deposit stayed put, so the 10:1 the whole pitch rests on quietly became
   * something else while the form still looked right.
   */
  const [depositEdited, setDepositEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    if (key === "down_payment") setDepositEdited(true);
    setForm((f) => {
      const next = { ...f, [key]: e.target.value };
      // Re-derive the deposit from whatever now drives the price, unless the
      // user has taken it over. Ten per cent of the investment keeps the 10:1
      // true no matter how the deal is re-sized.
      if (!depositEdited && key !== "down_payment") {
        const investment =
          (Number(next.unit_count.replace(/[,\s]/g, "")) || 0) * dollars(next.unit_cost) +
          dollars(next.site_work) +
          dollars(next.soft_costs);
        next.down_payment =
          investment > 0
            ? String(Math.round((investment * defaults.depositBps) / 10_000))
            : "";
      }
      return next;
    });
  };

  const preview = useMemo(
    () =>
      computeEconomics({
        unitCount: Number(form.unit_count) || 1,
        unitCostCents: toCents(form.unit_cost),
        siteWorkCents: toCents(form.site_work),
        softCostsCents: toCents(form.soft_costs),
        landCostCents: 0,
        downPaymentCents: toCents(form.down_payment),
        marginalRateBps: toBps(form.marginal_rate),
        bonusRateBps: toBps(form.bonus_rate),
        usefulLifeYears: Number(form.useful_life_years) || 0,
        monthlyRentCents: toCents(form.monthly_rent),
        occupancyBps: toBps(form.occupancy),
        opexBps: toBps(form.opex),
        unitUse: form.unit_use,
      }),
    [form],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const proposal = await apiPost<CrmProposal>("/api/crm/proposals/generate", {
        client_id: client.id,
        ...form,
      });
      onCreated(proposal);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not draft the proposal.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} wide title={`Draft a proposal for ${client.name}`}>
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Units">
            <TextInput value={form.unit_count} onChange={set("unit_count")} inputMode="numeric" />
          </Field>
          <Field label="Cost per unit" hint="Required — everything else is derived from it.">
            <MoneyInput value={form.unit_cost} onChange={set("unit_cost")} placeholder="95000" required />
          </Field>
          <Field label="Site work (total)" hint="Pad, utilities, septic, set. Depreciable.">
            <MoneyInput value={form.site_work} onChange={set("site_work")} placeholder="35000" />
          </Field>
          <Field label="Soft costs (total)" hint="Permits, engineering, transport. Depreciable.">
            <MoneyInput value={form.soft_costs} onChange={set("soft_costs")} placeholder="12000" />
          </Field>
          <Field
            label="Down payment (cash)"
            hint={`Tracks ${defaults.depositBps / 100}% of the investment. The balance is seller-financed at 0% over 720 months; clear it for an all-cash deal.`}
          >
            <MoneyInput value={form.down_payment} onChange={set("down_payment")} placeholder="155000" />
          </Field>
          <Field label="Monthly rent per unit">
            <MoneyInput value={form.monthly_rent} onChange={set("monthly_rent")} placeholder="1650" />
          </Field>
          <Field
            label="Use"
            span
            hint="Long-term rental is generally passive; short-term needs material participation to offset other income."
          >
            <Select
              value={form.unit_use}
              onChange={set("unit_use")}
              options={UNIT_USES}
              labels={LABELS.unitUse}
            />
          </Field>
        </div>

        <details className="rounded-lg border border-paper-200 bg-paper-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-navy-900">
            Tax and operating assumptions
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Marginal rate" hint="Combined federal + state.">
              <PercentInput value={form.marginal_rate} onChange={set("marginal_rate")} />
            </Field>
            <Field label="Bonus depreciation" hint="Rate for the placed-in-service year. Confirm before sending.">
              <PercentInput value={form.bonus_rate} onChange={set("bonus_rate")} />
            </Field>
            <Field label="Recovery period (years)" hint="5 for personal property; 27.5 as residential rental real property.">
              <TextInput value={form.useful_life_years} onChange={set("useful_life_years")} inputMode="decimal" />
            </Field>
            <Field label="Occupancy">
              <PercentInput value={form.occupancy} onChange={set("occupancy")} />
            </Field>
            <Field label="Operating expenses" hint="As a share of collected rent.">
              <PercentInput value={form.opex} onChange={set("opex")} />
            </Field>
          </div>
        </details>

        {/* Live preview of the exact figures that will be frozen onto the proposal. */}
        <div className="rounded-lg border border-gold-500/25 bg-gold-500/5 p-4">
          <h4 className="text-sm font-semibold text-navy-900">The figures this will quote</h4>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Line label="Total investment" value={fmtMoney(preview.totalInvestmentCents)} />
            <Line label="Depreciable basis" value={fmtMoney(preview.depreciableBasisCents)} />
            <Line label="First-year deduction" value={fmtMoney(preview.yearOneDeductionCents)} strong />
            <Line label="Est. first-year tax benefit" value={fmtMoney(preview.yearOneTaxSavingsCents)} strong />
            {preview.financedCents > 0 && (
              <>
                <Line label="Cash down" value={fmtMoney(preview.downPaymentCents)} />
                <Line label="Seller-financed" value={fmtMoney(preview.financedCents)} />
                <Line
                  label="Note payment"
                  value={`${fmtMoney(preview.monthlyNoteCents)} / mo \u00d7 720`}
                />
                <Line
                  label="Deduction per $1 of cash"
                  value={
                    preview.deductionLeverageBps === null
                      ? "\u2014"
                      : `${(preview.deductionLeverageBps / 10_000).toFixed(1)} : 1`
                  }
                  strong
                />
              </>
            )}
            {/* Negative means the tax benefit exceeded the cash in — the deck's
                "net tax savings". Say which it is rather than showing a minus. */}
            <Line
              label={
                preview.netYearOneOutlayCents < 0
                  ? "Net first-year gain"
                  : "Net first-year outlay"
              }
              value={fmtMoney(Math.abs(preview.netYearOneOutlayCents))}
              strong
            />
            <Line label="Projected NOI" value={`${fmtMoney(preview.annualNoiCents)} / yr`} />
            {preview.financedCents > 0 && (
              <Line
                label="After debt service"
                value={`${fmtMoney(preview.annualCashFlowCents)} / yr`}
              />
            )}
            <Line label="Cash-on-cash" value={fmtPct(preview.cashOnCashBps)} />
            <Line
              label="Payback"
              value={preview.paybackYears === null ? "—" : `${preview.paybackYears} yrs`}
            />
          </dl>
          {client.target_writeoff_cents ? (
            <p className="mt-3 text-xs text-navy-900/60">
              Their target deduction is {fmtMoney(client.target_writeoff_cents)} — this covers{" "}
              {fmtPct(
                Math.round(
                  (preview.yearOneDeductionCents / client.target_writeoff_cents) * 10_000,
                ),
                { digits: 0 },
              )}
              .
            </p>
          ) : null}
          <p className="mt-3 text-xs text-navy-900/50">
            Calculated here, not by the model. The AI writes the prose around these numbers and is
            forbidden from restating them.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" hint="Blank uses the client's name.">
            <TextInput value={form.title} onChange={set("title")} placeholder={`Tiny home programme — ${client.name}`} />
          </Field>
          <Field label="Valid until">
            <TextInput value={form.valid_until} onChange={set("valid_until")} type="date" />
          </Field>
          <Field label="Anything the draft should emphasise" span>
            <TextArea
              value={form.instructions}
              onChange={set("instructions")}
              rows={3}
              placeholder="They want this closed before year end and their CPA is sceptical about the classification."
            />
          </Field>
        </div>

        <ErrorNote>{error}</ErrorNote>

        <div className="flex justify-end gap-3">
          <button type="button" className="sf-btn-neutral" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="sf-btn-brand" disabled={saving}>
            {saving ? "Drafting…" : "Draft proposal"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-navy-900/60">{label}</dt>
      <dd className={strong ? "font-semibold text-navy-900" : "text-navy-900/85"}>{value}</dd>
    </div>
  );
}
