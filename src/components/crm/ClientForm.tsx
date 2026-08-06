"use client";

// Create / edit a client.
//
// A note on units, because it's the one thing that surprises people here: the
// form works in the units a human types — whole dollars and whole percents —
// under the same field names the API uses (`*_cents`, `*_bps`). The API's
// coercers do the conversion (`cents()`, `bps()` in lib/crm/db.ts). Nothing in
// the browser ever multiplies by 100, so there is exactly one place that can
// get it wrong.

import { useRef, useState, type FormEvent } from "react";
import { bpsToInput, centsToInput } from "@/lib/crm/format";
import {
  CLIENT_STATUSES,
  ENTITY_TYPES,
  HEALTHS,
  LABELS,
  LEAD_SOURCES,
  type CrmClient,
} from "@/lib/crm/types";
import { AiAssist, AiText, type AssistFieldSpec } from "./AiAssist";
import { apiPatch, apiPost } from "./api";
import { ErrorNote, Field, MoneyInput, PercentInput, Select, TextArea, TextInput } from "./ui";
import { Dropdown } from "./Dropdown";

/**
 * What the AI may propose on this form, described for the model.
 *
 * Kept as a list beside the JSX rather than derived from it, because the model
 * needs the *meaning* of a field, not its input type — "the deduction they are
 * trying to achieve, in whole dollars" is a far better brief than "money". The
 * two can drift, and the cost of drift is one field going unsuggested, which is
 * the harmless direction.
 *
 * Placement (`pad_id`, `unit_label`) is deliberately absent. Assigning a client
 * to a pad creates a home and takes that pad out of sellable capacity; that is
 * an operational decision about BTB's own land, not something to infer from a
 * call summary.
 */
const CLIENT_ASSIST_FIELDS: AssistFieldSpec[] = [
  { name: "name", label: "Name", type: "text" },
  { name: "legal_name", label: "Legal / entity name", type: "text", hint: "The entity that will hold title, if not the individual." },
  { name: "status", label: "Pipeline stage", type: "select", options: CLIENT_STATUSES },
  { name: "health", label: "Health", type: "select", options: HEALTHS },
  { name: "source", label: "Lead source", type: "select", options: LEAD_SOURCES },
  { name: "entity_type", label: "Filing entity", type: "select", options: ENTITY_TYPES },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone", type: "text" },
  { name: "city", label: "City", type: "text" },
  { name: "state", label: "State they live in", type: "text", hint: "Two-letter code." },
  { name: "tax_state", label: "State they file in", type: "text", hint: "Two-letter code." },
  { name: "marginal_rate_bps", label: "Marginal rate", type: "percent", hint: "Federal + state combined, as a whole percent, e.g. 37." },
  { name: "est_annual_income_cents", label: "Estimated annual income", type: "money", hint: "Whole dollars." },
  { name: "target_writeoff_cents", label: "Deduction they are targeting", type: "money", hint: "Whole dollars. This is what the deal is sized from." },
  { name: "investment_capacity_cents", label: "Capital available", type: "money", hint: "Whole dollars." },
  { name: "cpa_name", label: "CPA name", type: "text" },
  { name: "cpa_email", label: "CPA email", type: "email" },
  { name: "target_state", label: "Land: target state", type: "text" },
  { name: "target_county", label: "Land: target county or city", type: "text" },
  { name: "target_min_acres", label: "Land: minimum acres", type: "number" },
  { name: "target_max_acres", label: "Land: maximum acres", type: "number" },
  { name: "target_max_price_cents", label: "Land: budget", type: "money", hint: "Whole dollars." },
  { name: "notes", label: "Notes", type: "textarea", hint: "What they are solving for, who introduced them." },
];

/** An unoccupied pad, offered when taking a client on. */
export interface AvailablePad {
  id: string;
  label: string;
  park_id: string;
  park_name: string;
  land_capacity?: number | null;
  sections_remaining?: number | null;
  land_cost_per_section_cents?: number | null;
  pad_sqft: number | null;
}

export interface StateOption {
  code: string;
  name: string;
}

export function ClientForm({
  client,
  states,
  onSaved,
  pads = [],
  onCancel,
}: {
  /** Absent ⇒ create. Present ⇒ edit that client. */
  client?: CrmClient;
  states: StateOption[];
  onSaved: (client: CrmClient) => void;
  /** Pads with status 'available'. Empty hides the placement section entirely. */
  pads?: AvailablePad[];
  onCancel?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Handed to the AI controls so they can read what is typed and write a
  // suggestion into a named field. The form stays uncontrolled either way.
  const formRef = useRef<HTMLFormElement>(null);

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

      // Placement is a second call on purpose: it creates a home and flips a
      // pad, which is a different resource from the client record. A failure
      // here must not lose the client we just captured, so it is reported
      // rather than thrown.
      const padId = String(body.pad_id ?? "");
      if (padId) {
        try {
          await apiPost(`/api/crm/clients/${saved.id}/place`, {
            pad_id: padId,
            label: String(body.unit_label ?? ""),
          });
        } catch (err) {
          setError(
            `${saved.name} was saved, but placing them on that pad failed: ${
              err instanceof Error ? err.message : "unknown error"
            }`,
          );
        }
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the client.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-6">
      {/* Scoped to the client being EDITED so the model has their record,
          proposals, contracts and call summaries. On a create there is no
          record yet, so it falls back to the workspace and works from the
          notes the person pastes in — which is the realistic case anyway:
          you are looking at an email while you type. */}
      <AiAssist
        formRef={formRef}
        fields={CLIENT_ASSIST_FIELDS}
        formTitle="Client record"
        scopeType={client ? "client" : "global"}
        scopeId={client?.id ?? null}
        label={client ? "Fill gaps from the record" : "Fill this in from my notes"}
      />

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
        <h3 className="mb-1 text-sm font-semibold text-ink-900">Tax profile</h3>
        <p className="mb-4 text-xs text-ink-900/50">
          Drives every figure in a generated proposal. Estimates are fine — the client&apos;s CPA
          confirms the real numbers.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Files in (state)">
            <TextInput name="tax_state" maxLength={2} defaultValue={client?.tax_state ?? ""} placeholder="TX" />
          </Field>
          <Field
            label="Marginal rate"
            hint="Federal + state combined, as a percent. Left blank this assumes 37% — the top federal rate, with no state component. Add theirs if they file somewhere that taxes income."
          >
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
        <h3 className="mb-1 text-sm font-semibold text-ink-900">Land criteria</h3>
        <p className="mb-4 text-xs text-ink-900/50">
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

      {/* The half that was missing: a new client has to end up somewhere, and
          under the current model that somewhere is a pad BTB already owns. */}
      {pads.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-ink-900">Place on our land</h3>
          <p className="mb-4 text-xs text-ink-600">
            Optional. Assigns an available pad and creates the client&apos;s home on it. The pad
            becomes occupied, so it stops counting as capacity we can still sell.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Available pad">
              {/* Dropdown directly rather than ui.tsx's Select: that one renders
                  a fixed enum from ./types, and these options come from the
                  database. The capacity detail moves to `hint`, where it reads
                  as a second line instead of a long parenthetical. */}
              <Dropdown
                name="pad_id"
                defaultValue=""
                placeholder="Do not place yet"
                options={[
                  { value: "", label: "Do not place yet" },
                  ...pads.map((pad) => ({
                    value: pad.id,
                    label: `${pad.park_name} — ${pad.label}`,
                    hint:
                      [
                        pad.sections_remaining != null
                          ? `${pad.sections_remaining} of ${pad.land_capacity} sections left`
                          : null,
                        pad.pad_sqft ? `${pad.pad_sqft.toLocaleString("en-US")} sq ft` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined,
                  })),
                ]}
              />
            </Field>
            <Field label="Name this home" hint="Defaults to the park name.">
              <TextInput name="unit_label" placeholder="Cabin 1" />
            </Field>
          </div>
        </div>
      ) : null}

      <Field label="Notes">
        <TextArea name="notes" rows={4} defaultValue={client?.notes ?? ""} placeholder="What they're solving for, who introduced them, anything the AI advisor should know." />
        {/* "Check against the rules" is the one that earns this control: these
            notes are what the advisor and the proposal generator later read,
            so a 7-day test or a non-recourse note written here propagates. */}
        <AiText
          formRef={formRef}
          name="notes"
          label="Notes on the client"
          scopeType={client ? "client" : "global"}
          scopeId={client?.id ?? null}
        />
      </Field>

      <ErrorNote>{error}</ErrorNote>

      <div className="flex justify-end gap-3">
        {onCancel && (
          <button type="button" className="sf-btn-neutral" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="submit" className="sf-btn-brand" disabled={saving}>
          {saving ? "Saving…" : client ? "Save changes" : "Add client"}
        </button>
      </div>
    </form>
  );
}
