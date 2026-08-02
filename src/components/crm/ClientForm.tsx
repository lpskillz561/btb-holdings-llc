"use client";

// Create / edit a client.
//
// A note on units, because it's the one thing that surprises people here: the
// form works in the units a human types — whole dollars and whole percents —
// under the same field names the API uses (`*_cents`, `*_bps`). The API's
// coercers do the conversion (`cents()`, `bps()` in lib/crm/db.ts). Nothing in
// the browser ever multiplies by 100, so there is exactly one place that can
// get it wrong.

import { useState, type FormEvent } from "react";
import { bpsToInput, centsToInput } from "@/lib/crm/format";
import {
  CLIENT_STATUSES,
  ENTITY_TYPES,
  HEALTHS,
  LABELS,
  LEAD_SOURCES,
  type CrmClient,
} from "@/lib/crm/types";
import { apiPatch, apiPost } from "./api";
import { ErrorNote, Field, MoneyInput, PercentInput, Select, TextArea, TextInput } from "./ui";

export interface StateOption {
  code: string;
  name: string;
}

export function ClientForm({
  client,
  states,
  onSaved,
  onCancel,
}: {
  /** Absent ⇒ create. Present ⇒ edit that client. */
  client?: CrmClient;
  states: StateOption[];
  onSaved: (client: CrmClient) => void;
  onCancel?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());

    try {
      const saved = client
        ? await apiPatch<CrmClient>(`/api/crm/clients/${client.id}`, body)
        : await apiPost<CrmClient>("/api/crm/clients", body);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the client.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <TextInput name="name" required defaultValue={client?.name ?? ""} placeholder="Jane Whitfield" />
        </Field>
        <Field label="Legal / entity name" hint="The entity that will hold title, if not the individual.">
          <TextInput name="legal_name" defaultValue={client?.legal_name ?? ""} placeholder="Whitfield Holdings LLC" />
        </Field>
        <Field label="Stage">
          <Select name="status" options={CLIENT_STATUSES} labels={LABELS.clientStatus} defaultValue={client?.status ?? "prospect"} />
        </Field>
        <Field label="Health">
          <Select name="health" options={HEALTHS} labels={LABELS.health} defaultValue={client?.health ?? "green"} />
        </Field>
        <Field label="Source">
          <Select name="source" options={LEAD_SOURCES} labels={LABELS.source} defaultValue={client?.source ?? "referral"} />
        </Field>
        <Field label="Filing entity">
          <Select name="entity_type" options={ENTITY_TYPES} labels={LABELS.entityType} defaultValue={client?.entity_type ?? "individual"} />
        </Field>
        <Field label="Email">
          <TextInput name="email" type="email" defaultValue={client?.email ?? ""} />
        </Field>
        <Field label="Phone">
          <TextInput name="phone" defaultValue={client?.phone ?? ""} />
        </Field>
        <Field label="City">
          <TextInput name="city" defaultValue={client?.city ?? ""} />
        </Field>
        <Field label="State">
          <TextInput name="state" maxLength={2} defaultValue={client?.state ?? ""} placeholder="TX" />
        </Field>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-navy-900">Tax profile</h3>
        <p className="mb-4 text-xs text-navy-900/50">
          Drives every figure in a generated proposal. Estimates are fine — the client&apos;s CPA
          confirms the real numbers.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Files in (state)">
            <TextInput name="tax_state" maxLength={2} defaultValue={client?.tax_state ?? ""} placeholder="TX" />
          </Field>
          <Field label="Combined marginal rate" hint="Federal + state, as a percent.">
            <PercentInput name="marginal_rate_bps" defaultValue={bpsToInput(client?.marginal_rate_bps)} placeholder="37" />
          </Field>
          <Field label="Estimated annual income">
            <MoneyInput name="est_annual_income_cents" defaultValue={centsToInput(client?.est_annual_income_cents)} placeholder="2500000" />
          </Field>
          <Field label="Deduction they're targeting">
            <MoneyInput name="target_writeoff_cents" defaultValue={centsToInput(client?.target_writeoff_cents)} placeholder="500000" />
          </Field>
          <Field label="Capital available">
            <MoneyInput name="investment_capacity_cents" defaultValue={centsToInput(client?.investment_capacity_cents)} placeholder="750000" />
          </Field>
          <div />
          <Field label="CPA name">
            <TextInput name="cpa_name" defaultValue={client?.cpa_name ?? ""} />
          </Field>
          <Field label="CPA email">
            <TextInput name="cpa_email" type="email" defaultValue={client?.cpa_email ?? ""} />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-navy-900">Land criteria</h3>
        <p className="mb-4 text-xs text-navy-900/50">
          Pre-fills the parcel search on this client&apos;s Land tab, so the first search is
          already the right one.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target state" hint={states.length ? `Loaded: ${states.map((s) => s.code).join(", ")}` : undefined}>
            <TextInput
              name="target_state"
              list="crm-loaded-states"
              maxLength={2}
              defaultValue={client?.target_state ?? ""}
              placeholder="FL"
            />
            <datalist id="crm-loaded-states">
              {states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label="Target county or city" hint="Searched instead of the whole state when set.">
            <TextInput name="target_county" defaultValue={client?.target_county ?? ""} placeholder="Marion" />
          </Field>
          <Field label="Min lot size (acres)">
            <TextInput name="target_min_acres" inputMode="decimal" defaultValue={client?.target_min_acres ?? ""} placeholder="1" />
          </Field>
          <Field label="Max lot size (acres)">
            <TextInput name="target_max_acres" inputMode="decimal" defaultValue={client?.target_max_acres ?? ""} placeholder="20" />
          </Field>
          <Field label="Land budget" span>
            <MoneyInput name="target_max_price_cents" defaultValue={centsToInput(client?.target_max_price_cents)} placeholder="150000" />
          </Field>
        </div>
      </div>

      <Field label="Notes">
        <TextArea name="notes" rows={4} defaultValue={client?.notes ?? ""} placeholder="What they're solving for, who introduced them, anything the AI advisor should know." />
      </Field>

      <ErrorNote>{error}</ErrorNote>

      <div className="flex justify-end gap-3">
        {onCancel && (
          <button type="button" className="btn-outline" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-gold" disabled={saving}>
          {saving ? "Saving…" : client ? "Save changes" : "Add client"}
        </button>
      </div>
    </form>
  );
}
