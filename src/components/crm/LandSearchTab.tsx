"use client";

// Land search, inside the client card.
//
// This is the point of putting the CRM and the parcel database in the same app:
// with a client on the phone you search THEIR criteria, shortlist candidates
// against their record, and ask the model whether a given parcel actually suits
// their tax position — without leaving the card or re-typing the brief.
//
// The search itself is the portal's existing engine (lib/parcels.ts) via
// /api/crm/land/search, which fills in every unset filter from the client.

import { useCallback, useEffect, useState } from "react";
import type { AreaRow, AreaSearchResult } from "@/lib/parcels";
import { fmtAcres, fmtDate, fmtMoney } from "@/lib/crm/format";
import { LABELS, SAVED_PARCEL_STATUSES, type CrmClient, type CrmSavedParcel } from "@/lib/crm/types";
import type { ParcelFit } from "@/lib/crm/land";
import { Markdown } from "@/components/Markdown";
import { apiDelete, apiGet, apiPatch, apiPost, qs } from "./api";
import { statusTone } from "@/lib/crm/tone";
import { Badge, EmptyState, ErrorNote, SectionHeading, Table, Td } from "./ui";

/** Assessed values arrive from the parcel DB in dollars; the CRM stores cents. */
const dollarsToCents = (v: number | undefined) => (v === undefined ? null : Math.round(v * 100));

export function LandSearchTab({
  client,
  saved,
  onSavedChange,
}: {
  client: CrmClient;
  saved: CrmSavedParcel[];
  onSavedChange: (rows: CrmSavedParcel[]) => void;
}) {
  const [area, setArea] = useState(client.target_county ?? client.target_state ?? "");
  const [minAcres, setMinAcres] = useState(client.target_min_acres?.toString() ?? "");
  const [maxAcres, setMaxAcres] = useState(client.target_max_acres?.toString() ?? "");
  const [maxPrice, setMaxPrice] = useState(
    client.target_max_price_cents != null ? String(client.target_max_price_cents / 100) : "",
  );
  const [landOnly, setLandOnly] = useState(true);
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<AreaSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [fits, setFits] = useState<Record<string, ParcelFit>>({});
  const [openFit, setOpenFit] = useState<string | null>(null);

  const savedByKey = new Map(saved.map((row) => [row.parcel_key, row]));

  const search = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      setError("");
      try {
        const data = await apiGet<AreaSearchResult>(
          `/api/crm/land/search${qs({
            client_id: client.id,
            area,
            page: nextPage,
            land: landOnly ? "1" : "0",
            minac: minAcres,
            maxac: maxAcres,
            max: maxPrice,
            // Carried forward so paging skips the expensive COUNT(*).
            total: nextPage > 1 ? result?.total : undefined,
          })}`,
        );
        setResult(data);
        setPage(nextPage);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        setLoading(false);
      }
    },
    [client.id, area, landOnly, minAcres, maxAcres, maxPrice, result?.total],
  );

  // Seed the cached AI reads so a shortlist opened fresh shows what was already
  // paid for, rather than an empty state that invites regenerating it.
  useEffect(() => {
    const cached: Record<string, ParcelFit> = {};
    for (const row of saved) {
      if (!row.fit_json) continue;
      try {
        cached[row.parcel_key] = JSON.parse(row.fit_json) as ParcelFit;
      } catch {
        // Ignore a corrupt cache; the row can be re-assessed.
      }
    }
    setFits((current) => ({ ...cached, ...current }));
  }, [saved]);

  async function saveParcel(row: AreaRow) {
    if (!row.parcelId) return;
    setBusyKey(row.parcelId);
    setError("");
    try {
      const savedRow = await apiPost<CrmSavedParcel>("/api/crm/land/save", {
        client_id: client.id,
        parcel_key: row.parcelId,
      });
      onSavedChange([savedRow, ...saved.filter((s) => s.parcel_key !== savedRow.parcel_key)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the parcel.");
    } finally {
      setBusyKey(null);
    }
  }

  async function assess(parcelKey: string, force = false) {
    setBusyKey(parcelKey);
    setError("");
    try {
      const fit = await apiPost<ParcelFit>("/api/crm/land/fit", {
        client_id: client.id,
        parcel_key: parcelKey,
        force,
      });
      setFits((current) => ({ ...current, [parcelKey]: fit }));
      setOpenFit(parcelKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assessment failed.");
    } finally {
      setBusyKey(null);
    }
  }

  async function setStatus(row: CrmSavedParcel, status: string) {
    const updated = await apiPatch<CrmSavedParcel>(`/api/crm/saved-parcels/${row.id}`, { status });
    onSavedChange(saved.map((s) => (s.id === row.id ? updated : s)));
  }

  async function remove(row: CrmSavedParcel) {
    if (!confirm("Remove this parcel from the shortlist?")) return;
    await apiDelete(`/api/crm/saved-parcels/${row.id}`);
    onSavedChange(saved.filter((s) => s.id !== row.id));
  }

  async function promote(row: CrmSavedParcel) {
    setBusyKey(row.parcel_key);
    setError("");
    try {
      await apiPost("/api/crm/land/promote", { saved_parcel_id: row.id });
      onSavedChange(
        saved.map((s) => (s.id === row.id ? { ...s, status: "under_contract" as const } : s)),
      );
      // The Holdings tab reads from the server render, so a reload is the honest
      // way to show the new land record rather than faking one here.
      location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not promote the parcel.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-10">
      {/* ---------------- Shortlist ---------------- */}
      <div>
        <SectionHeading title="Shortlist" count={saved.length} />
        {saved.length === 0 ? (
          <EmptyState>
            Nothing shortlisted yet. Search below and save the parcels worth pursuing for{" "}
            {client.name}.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {saved.map((row) => {
              const fit = fits[row.parcel_key];
              return (
                <div key={row.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-navy-900">
                        {row.one_line ?? row.parcel_key}
                      </p>
                      <p className="mt-0.5 text-sm text-navy-900/55">
                        {[
                          row.county && `${row.county} County`,
                          row.state,
                          fmtAcres(row.acres),
                          row.assessed_value_cents != null &&
                            `assessed ${fmtMoney(row.assessed_value_cents)}`,
                          row.owner_name && `owner ${row.owner_name}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={row.status}
                        onChange={(e) => void setStatus(row, e.target.value)}
                        aria-label="Shortlist status"
                        className="field w-auto py-1.5 text-xs"
                      >
                        {SAVED_PARCEL_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {LABELS.savedParcelStatus[s]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="sf-btn-neutral px-3 py-1.5 text-xs"
                        disabled={busyKey === row.parcel_key}
                        onClick={() =>
                          fit ? setOpenFit(openFit === row.parcel_key ? null : row.parcel_key) : void assess(row.parcel_key)
                        }
                      >
                        {busyKey === row.parcel_key
                          ? "Assessing…"
                          : fit
                            ? openFit === row.parcel_key
                              ? "Hide fit"
                              : `Fit: ${fit.verdict}`
                            : "Assess fit"}
                      </button>
                      <button
                        type="button"
                        className="sf-btn-neutral px-3 py-1.5 text-xs"
                        disabled={busyKey === row.parcel_key}
                        onClick={() => void promote(row)}
                        title="Create a land holding from this parcel"
                      >
                        Add as holding
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(row)}
                        aria-label="Remove from shortlist"
                        className="rounded p-1.5 text-navy-900/35 transition hover:bg-paper-100 hover:text-red-700"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {fit && openFit === row.parcel_key && <FitPanel fit={fit} onRefresh={() => void assess(row.parcel_key, true)} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------- Search ---------------- */}
      <div>
        <SectionHeading title="Find land" />
        <div className="card p-5">
          <p className="mb-4 text-sm text-navy-900/60">
            Pre-filled from {client.name}&apos;s land criteria. Anything left blank falls back to
            their record.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search(1);
            }}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <label className="block">
              <span className="field-label">Area</span>
              <input
                className="field"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="FL, 34470, or Ocala"
              />
            </label>
            <label className="block">
              <span className="field-label">Min acres</span>
              <input className="field" inputMode="decimal" value={minAcres} onChange={(e) => setMinAcres(e.target.value)} />
            </label>
            <label className="block">
              <span className="field-label">Max acres</span>
              <input className="field" inputMode="decimal" value={maxAcres} onChange={(e) => setMaxAcres(e.target.value)} />
            </label>
            <label className="block">
              <span className="field-label">Max assessed value</span>
              <input className="field" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="150000" />
            </label>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-navy-900/80">
              <input type="checkbox" checked={landOnly} onChange={(e) => setLandOnly(e.target.checked)} className="h-4 w-4" />
              Vacant land only
            </label>
            <div className="self-end">
              <button type="submit" className="sf-btn-brand w-full" disabled={loading}>
                {loading ? "Searching…" : "Search parcels"}
              </button>
            </div>
          </form>
        </div>

        <ErrorNote>{error}</ErrorNote>

        {result && (
          <div className={`mt-5 ${loading ? "opacity-60 transition-opacity" : ""}`}>
            <p className="mb-3 text-sm text-navy-900/60">
              {result.total.toLocaleString()} parcel{result.total === 1 ? "" : "s"} in {result.area}
              {result.rows.length > 0 && ` · showing ${result.rows.length}`}
            </p>
            {result.notes.map((note, i) => (
              <p key={i} className="mb-2 text-xs text-navy-900/50">
                {note}
              </p>
            ))}

            {result.rows.length === 0 ? (
              <EmptyState>No parcels match. Widen the acreage or value range.</EmptyState>
            ) : (
              <div className="card">
                <Table head={["Parcel", "Lot size", "Assessed", "Land value", "Last sale", ""]}>
                  {result.rows.map((row) => {
                    const key = row.parcelId ?? "";
                    const already = savedByKey.get(key);
                    return (
                      <tr key={key} className="transition hover:bg-paper-50">
                        <Td>
                          <span className="font-medium text-navy-900">{row.oneLine ?? key}</span>
                          <span className="mt-0.5 block text-xs text-navy-900/45">
                            {[row.owner, row.propType].filter(Boolean).join(" · ")}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap">{fmtAcres(row.acres)}</Td>
                        <Td className="whitespace-nowrap">
                          {fmtMoney(dollarsToCents(row.assessedTotal))}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {fmtMoney(dollarsToCents(row.landValue))}
                        </Td>
                        <Td className="whitespace-nowrap text-navy-900/60">
                          {row.lastDeedDate ? fmtDate(row.lastDeedDate) : "—"}
                          {row.lastDeedAmount ? ` · ${fmtMoney(dollarsToCents(row.lastDeedAmount))}` : ""}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {already ? (
                            <Badge tone={statusTone(already.status)}>
                              {LABELS.savedParcelStatus[already.status]}
                            </Badge>
                          ) : (
                            <button
                              type="button"
                              className="sf-btn-neutral px-3 py-1.5 text-xs"
                              disabled={busyKey === key}
                              onClick={() => void saveParcel(row)}
                            >
                              {busyKey === key ? "Saving…" : "Shortlist"}
                            </button>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                className="sf-btn-neutral"
                disabled={page <= 1 || loading}
                onClick={() => void search(page - 1)}
              >
                Previous
              </button>
              <span className="text-sm text-navy-900/50">Page {page}</span>
              <button
                type="button"
                className="sf-btn-neutral"
                disabled={!result.hasNext || loading}
                onClick={() => void search(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FitPanel({ fit, onRefresh }: { fit: ParcelFit; onRefresh: () => void }) {
  const tone = fit.verdict === "Strong fit" ? "green" : fit.verdict === "Poor fit" ? "red" : "amber";
  return (
    <div className="mt-4 border-t border-paper-200 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tone}>{fit.verdict}</Badge>
        <span className="text-xs uppercase tracking-wide text-navy-900/45">
          {fit.confidence} confidence
        </span>
        <button type="button" onClick={onRefresh} className="ml-auto text-xs font-semibold text-navy-700 hover:text-gold-600">
          Re-assess
        </button>
      </div>
      <p className="mt-2 font-medium text-navy-900">{fit.headline}</p>
      <div className="mt-2 text-sm text-navy-900/75">
        <Markdown>{fit.rationale}</Markdown>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FitList title="Strengths" items={fit.strengths} />
        <FitList title="Concerns" items={fit.concerns} />
        <FitList title="Next steps" items={fit.nextSteps} />
        <FitList title="What we can't see" items={fit.dataGaps} />
      </div>
    </div>
  );
}

function FitList({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h5 className="text-xs font-semibold uppercase tracking-wide text-navy-800/50">{title}</h5>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-navy-900/75">
        {items.map((item, i) => (
          <li key={i}>
            <Markdown inline>{item}</Markdown>
          </li>
        ))}
      </ul>
    </div>
  );
}
