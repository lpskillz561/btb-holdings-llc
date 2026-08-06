"use client";

/**
 * The estimator that runs ON A SLIDE, live, while the room watches.
 *
 * The one interactive thing in the deck, and it earns the exception: the
 * question that actually gets asked on these calls is "what would it look like
 * at my number", and answering it by promising to email a spreadsheet is how a
 * first call ends without a second one. Everything else in `slides.tsx` is
 * static SVG for good reasons — this is the case where the room's own input is
 * the point.
 *
 * Three rules, all inherited from the rest of the deck:
 *
 * 1. **It computes through `lib/crm/equipment.ts`**, the same module the
 *    internal workbench and any future proposal use. Nothing is calculated in
 *    this file. A slide cannot disagree with the document it becomes.
 * 2. **Config arrives as a PROP.** `computeEquipmentDeal` is pure, but
 *    `equipmentConfig()` reads `process.env`, which is not populated in a client
 *    bundle — resolved on the server, passed down, so the slide and the
 *    workbench cannot drift onto different defaults.
 * 3. **The §461(l)-capped saving is the headline and the gross figure is the
 *    small one.** The competing material in this market leads with the gross
 *    number and omits the cap entirely; showing the capped figure larger is a
 *    deliberate reversal, and it is the thing a CPA in the room will notice.
 *
 * Controls are RANGE INPUTS, not text fields. A presenter is talking while they
 * do this, and a slider cannot be left holding a half-typed number that renders
 * a nonsense figure on a shared screen.
 */

import { useMemo, useState } from "react";
import { fmtMoney, fmtMoneyShort, fmtPct } from "@/lib/crm/format";
import {
  computeEquipmentDeal,
  type EquipmentConfig,
  type FilingStatus,
} from "@/lib/crm/equipment";

const ACCENT = "#b08a2c";

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  minLabel,
  maxLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  display: string;
  minLabel: string;
  maxLabel: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[0.62em] uppercase tracking-[0.16em] text-paper-50/50">{label}</span>
        <span className="font-serif text-[0.95em] text-gold-400">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="deck-range mt-[0.8cqh] w-full"
        style={{ accentColor: ACCENT }}
      />
      <div className="flex justify-between text-[0.55em] text-paper-50/35">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function Readout({
  value,
  label,
  sub,
  muted,
}: {
  value: string;
  label: string;
  sub?: string;
  muted?: boolean;
}) {
  return (
    <div>
      <p
        className={`font-serif leading-none ${
          muted ? "text-[1.15em] text-paper-50/55" : "text-[1.75em] text-gold-400"
        }`}
      >
        {value}
      </p>
      <p className="mt-[1cqh] text-[0.72em] text-paper-50">{label}</p>
      {sub ? (
        <p className="mt-[0.5cqh] text-[0.6em] leading-snug text-paper-50/50">{sub}</p>
      ) : null}
    </div>
  );
}

export function EquipmentCalculator({
  config,
  marginalRateBps,
  bonusRateBps,
  initialUnits,
}: {
  config: EquipmentConfig;
  marginalRateBps: number;
  bonusRateBps: number;
  initialUnits: number;
}) {
  const [units, setUnits] = useState(initialUnits);
  const [priceCents, setPriceCents] = useState(config.unitPriceCents);
  const [grossCents, setGrossCents] = useState(config.optimisticMonthlyGrossCents);
  const [filing, setFiling] = useState<FilingStatus>("joint");

  const deal = useMemo(
    () =>
      computeEquipmentDeal({
        config,
        unitCount: units,
        unitPriceCents: priceCents,
        monthlyGrossCents: grossCents,
        marginalRateBps,
        bonusRateBps,
        // The slide assumes exclusive business use. Anything less is a §280F
        // problem before it is a maths problem, and it belongs on the limits
        // slide rather than as a dial a presenter can quietly turn down in
        // front of a prospect.
        businessUseBps: 10_000,
        filingStatus: filing,
      }),
    [config, units, priceCents, grossCents, marginalRateBps, bonusRateBps, filing],
  );

  return (
    <div className="grid grid-cols-[0.85fr_1.15fr] gap-[3cqw]">
      {/* ---- Inputs ------------------------------------------------------ */}
      <div className="space-y-[2.4cqh]">
        <Slider
          label="Units"
          value={units}
          min={1}
          max={20}
          step={1}
          onChange={setUnits}
          display={String(units)}
          minLabel="1"
          maxLabel="20"
        />
        <Slider
          label="Price per unit"
          value={priceCents}
          min={2_500_000}
          max={25_000_000}
          step={500_000}
          onChange={setPriceCents}
          display={fmtMoney(priceCents)}
          minLabel="$25k"
          maxLabel="$250k"
        />
        <Slider
          label="Collections per unit / month"
          value={grossCents}
          min={100_000}
          max={1_500_000}
          step={50_000}
          onChange={setGrossCents}
          display={fmtMoney(grossCents)}
          minLabel="$1k"
          maxLabel="$15k"
        />
        <div>
          <span className="text-[0.62em] uppercase tracking-[0.16em] text-paper-50/50">
            Filing status
          </span>
          <div className="mt-[0.8cqh] flex gap-[0.6cqw]">
            {(["joint", "single"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFiling(option)}
                aria-pressed={filing === option}
                className={`flex-1 rounded px-[1cqw] py-[0.9cqh] text-[0.68em] transition ${
                  filing === option
                    ? "bg-white/15 font-semibold text-paper-50"
                    : "bg-white/5 text-paper-50/55 hover:bg-white/10"
                }`}
              >
                {option === "joint" ? "Married, jointly" : "Single"}
              </button>
            ))}
          </div>
          {/* The cap is HALVED for a single filer, which is the input on this
              panel most likely to change the answer and least likely to be
              volunteered. It is a control rather than an assumption for that
              reason. */}
          <p className="mt-[0.8cqh] text-[0.58em] leading-snug text-paper-50/45">
            §461(l) admits {fmtMoney(deal.lossLimitCents)} of business loss against other
            income this year on this status.
          </p>
        </div>
      </div>

      {/* ---- Outputs ----------------------------------------------------- */}
      <div>
        <div className="grid grid-cols-3 gap-[2cqw]">
          <Readout
            value={fmtMoney(deal.totalPurchaseCents)}
            label="Total purchase"
            sub={`${deal.unitCount} × ${fmtMoney(deal.unitPriceCents)}`}
          />
          <Readout
            value={fmtMoney(deal.downPaymentCents)}
            label="Cash down"
            sub={`${fmtPct(deal.depositBps, { digits: 0 })} deposit`}
          />
          <Readout
            value={fmtMoney(deal.cappedTaxSavingsCents)}
            label="Year-one tax benefit"
            sub={`After the §461(l) cap, at ${fmtPct(marginalRateBps, { digits: 0 })}`}
          />
        </div>

        <div className="mt-[2.6cqh] grid grid-cols-3 gap-[2cqw] border-t border-white/12 pt-[2cqh]">
          <Readout
            value={fmtMoney(deal.fleetMonthly.netCents, { cents: true })}
            label="Net monthly"
            sub="After payout, venue, service and the note"
            muted
          />
          <Readout
            value={fmtMoney(deal.monthlyPaymentCents, { cents: true })}
            label="Note payment"
            sub={`${deal.noteTermMonths} months at ${fmtPct(deal.noteRateBps, { digits: 0 })}`}
            muted
          />
          <Readout
            value={
              deal.breakEvenMonthsWithTax === 0
                ? "Immediate"
                : deal.breakEvenMonthsWithTax === null
                  ? "—"
                  : `${deal.breakEvenMonthsWithTax} mo`
            }
            label="Deposit recovered"
            sub={
              deal.breakEvenMonths === null
                ? "Net cash flow is negative at this sizing"
                : `${deal.breakEvenMonths} months on cash flow alone`
            }
            muted
          />
        </div>

        {/* The honest footnote, and the reason this calculator exists rather
            than the competing one. Both numbers are shown; the capped one is
            the one printed large above. */}
        <p className="deck-note mt-[2.4cqh]">
          The deduction is {fmtMoney(deal.yearOneDeductionCents)}, which at{" "}
          {fmtPct(marginalRateBps, { digits: 0 })} is worth{" "}
          {fmtMoney(deal.grossTaxSavingsCents)} gross.
          {deal.carryforwardCents > 0 ? (
            <>
              {" "}
              §461(l) admits {fmtMoney(deal.allowedAgainstOtherIncomeCents)} of it against other
              income this year and carries {fmtMoneyShort(deal.carryforwardCents)} forward as an
              NOL — deferred, not lost. The figure above is the capped one.
            </>
          ) : (
            <>
              {" "}
              At this sizing the whole loss sits inside the §461(l) cap, so nothing carries
              forward.
            </>
          )}{" "}
          Assumes exclusive business use, and a rate applied flat rather than stacked through
          brackets. Collections are illustrative, not a projection.
        </p>
      </div>
    </div>
  );
}
