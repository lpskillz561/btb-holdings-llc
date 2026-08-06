"use client";

/**
 * The internal scenario tool for the amusement-equipment programme.
 *
 * This is the staff-facing sibling of the estimator on the deck. The deck slide
 * is deliberately three sliders and four figures — a prospect watching a screen
 * share cannot follow more — whereas this one exposes every input, the full
 * monthly breakdown, the amortisation schedule and a second scenario to compare
 * against. Someone is reading it on a call, not being presented to.
 *
 * Both compute through `lib/crm/equipment.ts` and neither does arithmetic of
 * its own, which is the point: the figure a presenter quotes off the slide and
 * the figure staff quote off this page are the same figure, and both are the
 * one a proposal would freeze.
 *
 * Lightning styling, not the navy brand — this is internal tooling. See the two
 * looks note in CLAUDE.md.
 */

import { Fragment, useId, useMemo, useState } from "react";
import { InfoTip } from "@/components/crm/InfoTip";
import type { GlossaryKey } from "@/lib/crm/equipment-glossary";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/crm/format";
import {
  amortize,
  computeEquipmentDeal,
  LISTED_PROPERTY_MIN_BUSINESS_USE_BPS,
  MARKET_MATERIAL_NOTES,
  type EquipmentConfig,
  type EquipmentDeal,
  type FilingStatus,
} from "@/lib/crm/equipment";

interface Scenario {
  units: number;
  priceCents: number;
  depositBps: number;
  termMonths: number;
  rateBps: number;
  grossCents: number;
  marginalRateBps: number;
  businessUseBps: number;
  filing: FilingStatus;
}

function initialScenario(config: EquipmentConfig, marginalRateBps: number): Scenario {
  return {
    units: 10,
    priceCents: config.unitPriceCents,
    depositBps: config.depositBps,
    termMonths: config.noteTermMonths,
    rateBps: config.noteRateBps,
    grossCents: config.optimisticMonthlyGrossCents,
    marginalRateBps,
    businessUseBps: 10_000,
    filing: "joint",
  };
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                                */
/* -------------------------------------------------------------------------- */

function Num({
  label,
  tip,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix,
  suffix,
}: {
  label: string;
  tip: GlossaryKey;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}) {
  const id = useId();
  return (
    // NOT a <label> wrapping the whole field any more. `InfoTip` renders a
    // <button>, and interactive content inside a label is both invalid and
    // actively wrong here — a click on the field name would activate the
    // labelled input instead of opening the explanation. `htmlFor` keeps the
    // association without the nesting.
    <div className="block">
      <span className="sf-label flex items-center">
        <label htmlFor={id}>{label}</label>
        <InfoTip term={tip} />
      </span>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          // Clamped on the way IN, not on blur: an out-of-range number typed
          // here would otherwise flow straight into the model and print a
          // figure nobody could reproduce. `computeEquipmentDeal` throws above
          // a 60% marginal rate for the same reason.
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
          className={`sf-input ${prefix ? "pl-7" : ""} ${suffix ? "pr-8" : ""}`}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Controls({
  scenario,
  set,
}: {
  scenario: Scenario;
  set: (patch: Partial<Scenario>) => void;
}) {
  const filingId = useId();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Num
        label="Units"
        tip="units"
        value={scenario.units}
        onChange={(units) => set({ units })}
        min={1}
        max={500}
      />
      <Num
        label="Price per unit"
        tip="pricePerUnit"
        value={scenario.priceCents / 100}
        onChange={(v) => set({ priceCents: Math.round(v * 100) })}
        min={0}
        max={1_000_000}
        step={1_000}
        prefix="$"
      />
      <Num
        label="Deposit"
        tip="deposit"
        value={scenario.depositBps / 100}
        onChange={(v) => set({ depositBps: Math.round(v * 100) })}
        min={0}
        max={100}
        step={0.5}
        suffix="%"
      />
      <Num
        label="Term"
        tip="term"
        value={scenario.termMonths}
        onChange={(termMonths) => set({ termMonths })}
        min={1}
        max={720}
        suffix="mo"
      />
      <Num
        label="Interest rate"
        tip="interestRate"
        value={scenario.rateBps / 100}
        onChange={(v) => set({ rateBps: Math.round(v * 100) })}
        min={0}
        max={30}
        step={0.25}
        suffix="%"
      />
      <Num
        label="Collections / unit / mo"
        tip="collections"
        value={scenario.grossCents / 100}
        onChange={(v) => set({ grossCents: Math.round(v * 100) })}
        min={0}
        max={100_000}
        step={100}
        prefix="$"
      />
      <Num
        label="Marginal rate"
        tip="marginalRate"
        value={scenario.marginalRateBps / 100}
        onChange={(v) => set({ marginalRateBps: Math.round(v * 100) })}
        // 60 is the ceiling `computeEquipmentDeal` throws above — clamping here
        // means the tool cannot be driven into that error at all.
        min={0}
        max={60}
        step={0.5}
        suffix="%"
      />
      <Num
        label="Qualified business use"
        tip="businessUse"
        value={scenario.businessUseBps / 100}
        onChange={(v) => set({ businessUseBps: Math.round(v * 100) })}
        min={0}
        max={100}
        step={1}
        suffix="%"
      />
      <div className="col-span-2 block">
        <span className="sf-label flex items-center">
          <label htmlFor={filingId}>Filing status</label>
          <InfoTip term="filingStatus" />
        </span>
        <select
          id={filingId}
          value={scenario.filing}
          onChange={(e) => set({ filing: e.target.value as FilingStatus })}
          className="sf-input"
        >
          <option value="joint">Married filing jointly</option>
          <option value="single">Single</option>
        </select>
      </div>
    </div>
  );
}

function Tile({
  label,
  tip,
  value,
  hint,
  tone = "navy",
}: {
  label: string;
  tip: GlossaryKey;
  value: string;
  hint?: string;
  tone?: "navy" | "good" | "warn";
}) {
  const colour =
    tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-ink-900";
  return (
    <div className="sf-card p-4">
      <p className="flex items-start text-xs uppercase tracking-wide text-ink-600">
        <span>{label}</span>
        <InfoTip term={tip} />
      </p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${colour}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs leading-snug text-ink-600">{hint}</p> : null}
    </div>
  );
}

function breakEvenLabel(deal: EquipmentDeal): string {
  if (deal.breakEvenMonthsWithTax === 0) return "Immediate";
  if (deal.breakEvenMonthsWithTax === null) return "Never";
  return `${deal.breakEvenMonthsWithTax} mo`;
}

/* -------------------------------------------------------------------------- */
/* The page body                                                               */
/* -------------------------------------------------------------------------- */

export function EquipmentWorkbench({
  config,
  marginalRateBps,
  bonusRateBps,
}: {
  config: EquipmentConfig;
  marginalRateBps: number;
  bonusRateBps: number;
}) {
  const [a, setA] = useState<Scenario>(() => initialScenario(config, marginalRateBps));
  const [b, setB] = useState<Scenario>(() => ({
    ...initialScenario(config, marginalRateBps),
    units: 5,
    grossCents: config.conservativeMonthlyGrossCents,
  }));
  const [compare, setCompare] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const run = (s: Scenario): EquipmentDeal =>
    computeEquipmentDeal({
      config,
      unitCount: s.units,
      unitPriceCents: s.priceCents,
      depositBps: s.depositBps,
      noteTermMonths: s.termMonths,
      noteRateBps: s.rateBps,
      monthlyGrossCents: s.grossCents,
      marginalRateBps: s.marginalRateBps,
      bonusRateBps,
      businessUseBps: s.businessUseBps,
      filingStatus: s.filing,
    });

  const dealA = useMemo(() => run(a), [a]); // eslint-disable-line react-hooks/exhaustive-deps
  const dealB = useMemo(() => run(b), [b]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = useMemo(
    () => amortize(dealA.financedCents, dealA.noteRateBps, dealA.noteTermMonths),
    [dealA.financedCents, dealA.noteRateBps, dealA.noteTermMonths],
  );

  // The whole schedule is thousands of rows on a 15-year note and nobody reads
  // the middle of one. First and last two years, with the elision made explicit
  // — a silently truncated table reads as a complete one.
  const scheduleRows =
    schedule.length <= 48
      ? schedule
      : [...schedule.slice(0, 24), ...schedule.slice(-24)];
  const elidedRows = schedule.length - scheduleRows.length;

  const monthly = dealA.fleetMonthly;
  const lines: {
    label: string;
    tip: GlossaryKey;
    note: string;
    monthly: number;
    annual: number;
  }[] = [
    {
      label: "Gross collections",
      tip: "grossCollections",
      note: `${dealA.unitCount} units × ${fmtMoney(a.grossCents)}`,
      monthly: monthly.grossCents,
      annual: monthly.grossCents * 12,
    },
    {
      label: "Player payout",
      tip: "playerPayout",
      note: `${fmtPct(config.customerPayoutBps, { digits: 0 })} of gross`,
      monthly: -monthly.customerPayoutCents,
      annual: -monthly.customerPayoutCents * 12,
    },
    {
      label: "Venue operator",
      tip: "venueOperator",
      note: `${fmtPct(config.venueOperatorBps, { digits: 0 })} of what remains after payout`,
      monthly: -monthly.venueOperatorCents,
      annual: -monthly.venueOperatorCents * 12,
    },
    {
      label: "Software, service & repairs",
      tip: "serviceCharge",
      note: `${fmtPct(config.serviceBps, { digits: 0 })} of what remains after payout`,
      monthly: -monthly.serviceCents,
      annual: -monthly.serviceCents * 12,
    },
    {
      label: "Debt service",
      tip: "debtService",
      note: `${dealA.noteTermMonths} months at ${fmtPct(dealA.noteRateBps, { digits: 2 })}`,
      monthly: -monthly.debtServiceCents,
      annual: -monthly.debtServiceCents * 12,
    },
  ];

  return (
    <div className="space-y-10">
      {/* Said once, at the top, rather than repeated beside thirty controls.
          The second sentence is the one that matters: these notes explain our
          own compliance burden to staff and are not client-facing text. */}
      <p className="-mb-4 max-w-3xl text-sm text-ink-600">
        Every field carries an{" "}
        <span className="inline-flex h-4 w-4 translate-y-[2px] items-center justify-center rounded-full border border-ink-200 bg-white text-[10px] font-semibold text-ink-600">
          i
        </span>{" "}
        with what it means and the rule behind it — hover, tab to it, or click to pin it open.
        These are working notes for BTB staff, not advice to a client: what goes to a taxpayer is
        the proposal text at the bottom of this page.
      </p>

      {/* ---- Inputs -------------------------------------------------------- */}
      <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
        <div className="sf-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="sf-h">{compare ? "Scenario A" : "Inputs"}</h2>
            <button
              type="button"
              onClick={() => setCompare((v) => !v)}
              className="sf-btn-neutral text-xs"
            >
              {compare ? "Single scenario" : "Compare two"}
            </button>
          </div>
          <Controls scenario={a} set={(patch) => setA((s) => ({ ...s, ...patch }))} />
        </div>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Tile
              label="Total purchase"
              tip="totalPurchase"
              value={fmtMoney(dealA.totalPurchaseCents)}
              hint={`${dealA.unitCount} × ${fmtMoney(dealA.unitPriceCents)}`}
            />
            <Tile
              label="Cash down"
              tip="cashDown"
              value={fmtMoney(dealA.downPaymentCents)}
              hint={`${fmtPct(dealA.depositBps, { digits: 1 })} deposit`}
            />
            <Tile
              label="Year-one benefit"
              tip="yearOneBenefit"
              value={fmtMoney(dealA.cappedTaxSavingsCents)}
              hint={`After §461(l), at ${fmtPct(a.marginalRateBps, { digits: 1 })}`}
              tone="good"
            />
            <Tile
              label="Net year-one position"
              tip="netYearOnePosition"
              value={fmtMoney(Math.abs(dealA.netYearOnePositionCents))}
              hint={
                dealA.netYearOnePositionCents <= 0
                  ? "Cash positive after the benefit"
                  : "Still out of pocket after the benefit"
              }
              tone={dealA.netYearOnePositionCents <= 0 ? "good" : "warn"}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Tile
              label="Financed"
              tip="financed"
              value={fmtMoney(dealA.financedCents)}
              hint={`${fmtPct(dealA.noteRateBps, { digits: 2 })} over ${dealA.noteTermMonths} mo`}
            />
            <Tile
              label="Monthly payment"
              tip="monthlyPayment"
              value={fmtMoney(dealA.monthlyPaymentCents, { cents: true })}
              hint={
                dealA.totalInterestCents > 0
                  ? `${fmtMoney(dealA.totalInterestCents)} total interest`
                  : "No interest"
              }
            />
            <Tile
              label="Net monthly"
              tip="netMonthly"
              value={fmtMoney(monthly.netCents, { cents: true })}
              hint="After every operating line and the note"
              tone={monthly.netCents >= 0 ? "good" : "warn"}
            />
            <Tile
              label="Deposit recovered"
              tip="depositRecovered"
              value={breakEvenLabel(dealA)}
              hint={
                dealA.breakEvenMonths === null
                  ? "Net cash flow is negative"
                  : `${dealA.breakEvenMonths} mo on cash flow alone`
              }
            />
          </div>

          {/* The §280F gate, stated loudly when it bites. A tool that silently
              swapped in ADS numbers would be the worst possible version of
              this: same layout, different regime, no notice. */}
          {!dealA.qualifiesForBonus ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <strong className="font-semibold">
                Business use does not exceed{" "}
                {fmtPct(LISTED_PROPERTY_MIN_BUSINESS_USE_BPS, { digits: 0 })}.
              </strong>{" "}
              This is listed property under §280F, so bonus depreciation is unavailable
              entirely and the figures above recover the basis straight-line under ADS. This is a
              different depreciation regime, not a reduced deduction.
            </div>
          ) : null}
        </div>
      </div>

      {/* ---- The deduction, in full ---------------------------------------- */}
      <div>
        <h2 className="sf-h mb-3">The deduction</h2>
        <div className="card overflow-x-auto">
          <table className="sf-table w-full">
            <tbody>
              {(
                [
                  {
                    label: "Depreciable basis",
                    tip: "depreciableBasis",
                    value: fmtMoney(dealA.depreciableBasisCents),
                    note: `${fmtPct(dealA.businessUseBps, { digits: 0 })} of ${fmtMoney(dealA.totalPurchaseCents)} — the personal share is never depreciable`,
                  },
                  {
                    label: "Bonus depreciation",
                    tip: "bonusDepreciation",
                    value: fmtMoney(dealA.bonusDeductionCents),
                    note: dealA.qualifiesForBonus
                      ? `${fmtPct(bonusRateBps, { digits: 0 })} under §168(k)`
                      : "Unavailable — §280F business use is not above 50%",
                  },
                  {
                    label: "First-year remainder",
                    tip: "firstYearRemainder",
                    value: fmtMoney(dealA.firstYearRemainderCents),
                    note: "Straight-line on whatever bonus did not absorb",
                  },
                  {
                    label: "Year-one deduction",
                    tip: "yearOneDeduction",
                    value: fmtMoney(dealA.yearOneDeductionCents),
                    note: "The figure before any limit applies",
                  },
                  {
                    label: "Less: this activity's own income",
                    tip: "activityOwnIncome",
                    value: fmtMoney(dealA.businessIncomeCents),
                    note: "The deduction offsets the equipment's own profit first",
                  },
                  {
                    label: "Net business loss",
                    tip: "netBusinessLoss",
                    value: fmtMoney(dealA.netBusinessLossCents),
                    note: "What §461(l) is actually tested against",
                  },
                  {
                    label: "§461(l) cap",
                    tip: "lossCap",
                    value: fmtMoney(dealA.lossLimitCents),
                    note: `${a.filing === "joint" ? "Married filing jointly" : "Single"}, current year`,
                  },
                  {
                    label: "Allowed against other income",
                    tip: "allowedOtherIncome",
                    value: fmtMoney(dealA.allowedAgainstOtherIncomeCents),
                    note: "The part that shelters wages, business or gains this year",
                  },
                  {
                    label: "Carried forward as NOL",
                    tip: "carryforward",
                    value: fmtMoney(dealA.carryforwardCents),
                    note: "Deferred, not lost",
                  },
                ] as { label: string; tip: GlossaryKey; value: string; note: string }[]
              ).map((row) => (
                <tr key={row.label}>
                  <td className="w-[22rem]">
                    <span className="flex items-start font-medium text-ink-900">
                      <span>{row.label}</span>
                      <InfoTip term={row.tip} />
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-600">{row.note}</span>
                  </td>
                  <td className="text-right font-semibold tabular-nums text-ink-900">
                    {row.value}
                  </td>
                </tr>
              ))}
              <tr className="bg-paper-50">
                <td>
                  <span className="flex items-start font-semibold text-ink-900">
                    <span>Year-one tax benefit, gross vs after the cap</span>
                    <InfoTip term="grossVsCapped" />
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-600">
                    Gross is the whole deduction at the marginal rate, which is what the
                    competing material in this market quotes. Never send it on its own.
                  </span>
                </td>
                <td className="text-right tabular-nums">
                  <span className="text-ink-600 line-through">
                    {fmtMoney(dealA.grossTaxSavingsCents)}
                  </span>
                  <span className="ml-3 font-semibold text-emerald-700">
                    {fmtMoney(dealA.cappedTaxSavingsCents)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- The month ----------------------------------------------------- */}
      <div>
        <h2 className="sf-h mb-3">The month, across {fmtNum(dealA.unitCount)} units</h2>
        <div className="card overflow-x-auto">
          <table className="sf-table w-full">
            <thead>
              <tr>
                <th>Line</th>
                <th className="text-right">Monthly</th>
                <th className="text-right">Annual</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.label}>
                  <td>
                    <span className="flex items-start font-medium text-ink-900">
                      <span>{line.label}</span>
                      <InfoTip term={line.tip} />
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-600">{line.note}</span>
                  </td>
                  <td className="text-right tabular-nums">
                    {fmtMoney(line.monthly, { cents: true })}
                  </td>
                  <td className="text-right tabular-nums">{fmtMoney(line.annual)}</td>
                </tr>
              ))}
              <tr className="bg-paper-50 font-semibold">
                <td>
                  <span className="flex items-start text-ink-900">
                    <span>Net to the owner</span>
                    <InfoTip term="netToOwner" />
                  </span>
                </td>
                <td className="text-right tabular-nums text-ink-900">
                  {fmtMoney(monthly.netCents, { cents: true })}
                </td>
                <td className="text-right tabular-nums text-ink-900">
                  {fmtMoney(dealA.annualNetCents)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-600">
          The venue and service shares are taken from what remains AFTER the player payout, not
          from gross. Read flat against gross they would be{" "}
          {fmtPct(config.venueOperatorBps, { digits: 0 })} and{" "}
          {fmtPct(config.serviceBps, { digits: 0 })} of the whole, and the owner&rsquo;s net would
          come out materially light.
        </p>
      </div>

      {/* ---- Compare ------------------------------------------------------- */}
      {compare ? (
        <div>
          <h2 className="sf-h mb-3">Scenario B</h2>
          <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
            <div className="sf-card p-5">
              <Controls scenario={b} set={(patch) => setB((s) => ({ ...s, ...patch }))} />
            </div>
            <div className="card overflow-x-auto">
              <table className="sf-table w-full">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th className="text-right">A</th>
                    <th className="text-right">B</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Total purchase", (d: EquipmentDeal) => fmtMoney(d.totalPurchaseCents)],
                      ["Cash down", (d: EquipmentDeal) => fmtMoney(d.downPaymentCents)],
                      ["Monthly payment", (d: EquipmentDeal) => fmtMoney(d.monthlyPaymentCents, { cents: true })],
                      ["Total interest", (d: EquipmentDeal) => fmtMoney(d.totalInterestCents)],
                      ["Year-one deduction", (d: EquipmentDeal) => fmtMoney(d.yearOneDeductionCents)],
                      ["Benefit after §461(l)", (d: EquipmentDeal) => fmtMoney(d.cappedTaxSavingsCents)],
                      ["NOL carried forward", (d: EquipmentDeal) => fmtMoney(d.carryforwardCents)],
                      ["Net monthly", (d: EquipmentDeal) => fmtMoney(d.fleetMonthly.netCents, { cents: true })],
                      ["Annual net", (d: EquipmentDeal) => fmtMoney(d.annualNetCents)],
                      ["Deposit recovered", breakEvenLabel],
                    ] as [string, (d: EquipmentDeal) => string][]
                  ).map(([label, read]) => (
                    <tr key={label}>
                      <td className="font-medium text-ink-900">{label}</td>
                      <td className="text-right tabular-nums">{read(dealA)}</td>
                      <td className="text-right tabular-nums">{read(dealB)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- Amortisation --------------------------------------------------- */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="sf-h flex items-center">
            <span>Amortisation — scenario A</span>
            <InfoTip term="amortisation" />
          </h2>
          <button
            type="button"
            onClick={() => setShowSchedule((v) => !v)}
            className="sf-btn-neutral text-xs"
          >
            {showSchedule ? "Hide schedule" : "Show schedule"}
          </button>
        </div>
        {showSchedule ? (
          <div className="card max-h-[32rem] overflow-auto">
            <table className="sf-table w-full">
              <thead>
                <tr>
                  <th>Mo</th>
                  <th className="text-right">Payment</th>
                  <th className="text-right">Principal</th>
                  <th className="text-right">Interest</th>
                  <th className="text-right">Balance</th>
                  <th className="text-right">Net cash</th>
                </tr>
              </thead>
              <tbody>
                {scheduleRows.map((row, i) => (
                  <Fragment key={row.month}>
                    {/* The elision is a ROW, not a silent gap. A schedule that
                        jumps from month 24 to month 157 with nothing between
                        reads as a complete table to whoever prints it. */}
                    {elidedRows > 0 && i === 24 ? (
                      <tr className="bg-paper-50">
                        <td colSpan={6} className="text-center text-xs italic text-ink-600">
                          {fmtNum(elidedRows)} months not shown
                        </td>
                      </tr>
                    ) : null}
                    <tr>
                      <td className="tabular-nums">{row.month}</td>
                      <td className="text-right tabular-nums">
                        {fmtMoney(row.paymentCents, { cents: true })}
                      </td>
                      <td className="text-right tabular-nums">
                        {fmtMoney(row.principalCents, { cents: true })}
                      </td>
                      <td className="text-right tabular-nums">
                        {fmtMoney(row.interestCents, { cents: true })}
                      </td>
                      <td className="text-right tabular-nums">{fmtMoney(row.balanceCents)}</td>
                      <td className="text-right tabular-nums">
                        {fmtMoney(monthly.noiBeforeDebtCents - row.paymentCents, { cents: true })}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* ---- Caveats -------------------------------------------------------- */}
      <div>
        <h2 className="sf-h mb-3">What goes in the proposal</h2>
        <ul className="card space-y-3 p-5 text-sm leading-relaxed text-ink-800">
          {dealA.caveats.map((caveat) => (
            <li key={caveat} className="border-l-2 border-ink-200 pl-3">
              {caveat}
            </li>
          ))}
        </ul>
      </div>

      {/* ---- The competing material ----------------------------------------- */}
      <div>
        <h2 className="sf-h mb-3">If a prospect shows you the arcade site</h2>
        <p className="mb-3 max-w-3xl text-sm text-ink-600">
          Where the published material in this market does not reconcile. Being able to name the
          line that does not add up is worth more than matching it — and none of these can leak
          into our figures, because every number on this page is derived.
        </p>
        <ul className="card space-y-3 p-5 text-sm leading-relaxed text-ink-800">
          {MARKET_MATERIAL_NOTES.map((note) => (
            <li key={note} className="border-l-2 border-gold-500/50 pl-3">
              {note}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
