"use client";

// A form driven by a field spec.
//
// Contacts, contracts, land, units and transactions are all "a handful of typed
// fields, POST or PATCH, close the dialog". Writing five near-identical forms is
// how one of them ends up missing a field or converting money differently, so
// each is described as data below and rendered by one component.
//
// Units follow the same rule as ClientForm: the form holds whole dollars and
// whole percents under the API's own column names, and lib/crm/db.ts converts.

import { useState, type FormEvent } from "react";
import { bpsToInput, centsToInput } from "@/lib/crm/format";
import {
  CONTACT_ROLES,
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  LABELS,
  PROPERTY_STATUSES,
  TX_CATEGORIES,
  TX_KINDS,
  TX_STATUSES,
  UNIT_STATUSES,
  UNIT_USES,
} from "@/lib/crm/types";
import { apiPatch, apiPost } from "./api";
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

export interface FieldSpec {
  name: string;
  label: string;
  type:
    | "text"
    | "email"
    | "money"
    | "percent"
    | "number"
    | "date"
    | "select"
    | "textarea"
    /** A dropdown of other records — options come from `choices[choiceKey]`. */
    | "choice";
  options?: readonly string[];
  labels?: Record<string, string>;
  /** For "choice": which list in the dialog's `choices` prop to render. */
  choiceKey?: string;
  hint?: string;
  required?: boolean;
  span?: boolean;
  placeholder?: string;
}

/** Options for the "choice" fields, keyed by `choiceKey`. */
export type Choices = Record<string, { value: string; label: string }[]>;

export interface RecordSpec {
  /** Collection endpoint; the item endpoint is `${endpoint}/${id}`. */
  endpoint: string;
  title: string;
  fields: FieldSpec[];
}

/* -------------------------------------------------------------------------- */
/* Specs                                                                       */
/* -------------------------------------------------------------------------- */

export const CONTACT_SPEC: RecordSpec = {
  endpoint: "/api/crm/contacts",
  title: "Contact",
  fields: [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "role", label: "Role", type: "select", options: CONTACT_ROLES, labels: LABELS.contactRole },
    { name: "title", label: "Title", type: "text" },
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone", type: "text" },
    { name: "notes", label: "Notes", type: "textarea", span: true },
  ],
};

export const CONTRACT_SPEC: RecordSpec = {
  endpoint: "/api/crm/contracts",
  title: "Contract",
  fields: [
    { name: "title", label: "Title", type: "text", required: true, placeholder: "Unit purchase — 2 units" },
    { name: "type", label: "Type", type: "select", options: CONTRACT_TYPES, labels: LABELS.contractType },
    { name: "status", label: "Status", type: "select", options: CONTRACT_STATUSES, labels: LABELS.contractStatus },
    { name: "value_cents", label: "Contract value", type: "money" },
    { name: "counterparty", label: "Counterparty", type: "text", hint: "Seller, manufacturer or management company." },
    { name: "effective_date", label: "Effective date", type: "date" },
    { name: "end_date", label: "End date", type: "date" },
    { name: "signed_at", label: "Signed on", type: "date" },
    { name: "document_url", label: "Document link", type: "text", span: true, hint: "Where the executed copy lives." },
    { name: "notes", label: "Notes", type: "textarea", span: true },
  ],
};

export const PROPERTY_SPEC: RecordSpec = {
  endpoint: "/api/crm/properties",
  title: "Land holding",
  fields: [
    { name: "label", label: "Label", type: "text", required: true, placeholder: "12 ac — Marion County" },
    { name: "status", label: "Status", type: "select", options: PROPERTY_STATUSES, labels: LABELS.propertyStatus },
    { name: "address", label: "Street address", type: "text", span: true },
    { name: "city", label: "City", type: "text" },
    { name: "postal_code", label: "ZIP", type: "text" },
    { name: "county", label: "County", type: "text" },
    { name: "state", label: "State", type: "text" },
    { name: "acres", label: "Acres", type: "number" },
    { name: "purchase_price_cents", label: "Land purchase price", type: "money" },
    {
      name: "closing_costs_cents",
      label: "Closing costs",
      type: "money",
      hint: "Title, recording, survey. Adds to land basis — not depreciable.",
    },
    {
      name: "improvements_cents",
      label: "Land improvements",
      type: "money",
      hint: "Access, well, septic, clearing. Depreciable, unlike the land itself.",
    },
    { name: "purchase_date", label: "Purchase date", type: "date" },
    { name: "assessed_value_cents", label: "Assessed value", type: "money" },
    { name: "annual_property_tax_cents", label: "Annual property tax", type: "money" },
    { name: "parcel_key", label: "Parcel id", type: "text", hint: "From the parcel database, e.g. FL:12:1234-567-890." },
    { name: "notes", label: "Notes", type: "textarea", span: true },
  ],
};

export const UNIT_SPEC: RecordSpec = {
  endpoint: "/api/crm/units",
  title: "Tiny home",
  fields: [
    { name: "label", label: "Label", type: "text", required: true, placeholder: "Unit A — 399 sq ft" },
    { name: "status", label: "Status", type: "select", options: UNIT_STATUSES, labels: LABELS.unitStatus },
    {
      name: "unit_use",
      label: "Use",
      type: "select",
      options: UNIT_USES,
      labels: LABELS.unitUse,
      hint: "Drives the tax case. Personal use supports no deduction.",
      span: true,
    },
    {
      name: "property_id",
      label: "Sited on",
      type: "choice",
      choiceKey: "properties",
      hint: "The land holding this unit sits on, once one is recorded.",
      span: true,
    },
    { name: "manufacturer", label: "Manufacturer", type: "text" },
    { name: "model", label: "Model", type: "text" },
    { name: "serial_number", label: "Serial number", type: "text" },
    { name: "sqft", label: "Square feet", type: "number" },
    { name: "bedrooms", label: "Bedrooms", type: "number" },
    { name: "purchase_price_cents", label: "Unit cost", type: "money" },
    { name: "site_work_cents", label: "Site work", type: "money", hint: "Pad, tie-down, hookups for this unit." },
    { name: "soft_costs_cents", label: "Soft costs", type: "money", hint: "Permits, engineering, transport & set." },
    { name: "delivered_on", label: "Delivered", type: "date" },
    {
      name: "placed_in_service_on",
      label: "Placed in service",
      type: "date",
      hint: "The date the deduction turns on — not the order date.",
    },
    { name: "useful_life_years", label: "Recovery period (years)", type: "number", hint: "5 for personal property; 27.5 if treated as residential rental real property." },
    { name: "bonus_claimed_cents", label: "Bonus depreciation claimed", type: "money" },
    { name: "monthly_rent_cents", label: "Monthly rent", type: "money" },
    { name: "management_company", label: "Management company", type: "text" },
    {
      name: "sold_on",
      label: "Sold on",
      type: "date",
      hint: "Selling early can trigger depreciation recapture as ordinary income.",
    },
    { name: "sale_price_cents", label: "Sale price", type: "money" },
    { name: "notes", label: "Notes", type: "textarea", span: true },
  ],
};

export const TRANSACTION_SPEC: RecordSpec = {
  endpoint: "/api/crm/transactions",
  title: "Transaction",
  fields: [
    { name: "description", label: "Description", type: "text", required: true, span: true },
    { name: "kind", label: "Direction", type: "select", options: TX_KINDS, labels: LABELS.txKind },
    { name: "category", label: "Category", type: "select", options: TX_CATEGORIES, labels: LABELS.txCategory },
    { name: "amount_cents", label: "Amount", type: "money", required: true },
    { name: "occurred_on", label: "Date", type: "date", required: true },
    { name: "status", label: "Status", type: "select", options: TX_STATUSES, labels: LABELS.txStatus },
    { name: "invoice_number", label: "Invoice number", type: "text" },
    // Attributing money to an asset is what makes per-unit and per-parcel
    // profitability possible later; both are optional.
    { name: "property_id", label: "Against land", type: "choice", choiceKey: "properties" },
    { name: "unit_id", label: "Against unit", type: "choice", choiceKey: "units" },
    { name: "notes", label: "Notes", type: "textarea", span: true },
  ],
};

/* -------------------------------------------------------------------------- */
/* Renderer                                                                    */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

/** The string a control should start with, given the stored value. */
function initialValue(spec: FieldSpec, row: Row | undefined): string {
  if (!row) return "";
  const raw = row[spec.name];
  if (raw === null || raw === undefined) return "";
  if (spec.type === "money") return centsToInput(Number(raw));
  if (spec.type === "percent") return bpsToInput(Number(raw));
  return String(raw);
}

function Control({ spec, row, choices }: { spec: FieldSpec; row?: Row; choices?: Choices }) {
  const value = initialValue(spec, row);
  const shared = {
    name: spec.name,
    required: spec.required,
    defaultValue: value,
    placeholder: spec.placeholder,
  };

  switch (spec.type) {
    case "money":
      return <MoneyInput {...shared} />;
    case "percent":
      return <PercentInput {...shared} />;
    case "number":
      return <TextInput {...shared} inputMode="decimal" />;
    case "date":
      return <TextInput {...shared} type="date" />;
    case "email":
      return <TextInput {...shared} type="email" />;
    case "textarea":
      return <TextArea {...shared} rows={3} />;
    case "select":
      return (
        <Select
          name={spec.name}
          options={spec.options ?? []}
          labels={spec.labels}
          defaultValue={value || spec.options?.[0]}
        />
      );
    case "choice": {
      const list = choices?.[spec.choiceKey ?? ""] ?? [];
      return (
        <select name={spec.name} defaultValue={value} className="field">
          <option value="">{list.length ? "— none —" : "— none recorded yet —"}</option>
          {list.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    default:
      return <TextInput {...shared} />;
  }
}

/**
 * Create or edit one record in a modal.
 *
 * `fixed` carries the parent keys (client_id, and property_id when adding a unit
 * to a specific site). They're sent on create only — the API refuses to move a
 * record between clients on PATCH, so sending them on edit would be a lie.
 */
export function RecordDialog({
  spec,
  open,
  onClose,
  row,
  fixed,
  choices,
  onSaved,
  onDeleted,
}: {
  spec: RecordSpec;
  open: boolean;
  onClose: () => void;
  row?: Row;
  fixed?: Record<string, string>;
  choices?: Choices;
  onSaved: (row: Row) => void;
  onDeleted?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(row?.id);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const body: Row = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (!editing) Object.assign(body, fixed ?? {});

    try {
      const saved = editing
        ? await apiPatch<Row>(`${spec.endpoint}/${row!.id}`, body)
        : await apiPost<Row>(spec.endpoint, body);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!row?.id || !onDeleted) return;
    if (!confirm(`Delete this ${spec.title.toLowerCase()}? This cannot be undone.`)) return;
    setSaving(true);
    setError("");
    try {
      const { apiDelete } = await import("./api");
      await apiDelete(`${spec.endpoint}/${row.id}`);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={`${editing ? "Edit" : "Add"} ${spec.title.toLowerCase()}`}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {spec.fields.map((field) => (
            <Field key={field.name} label={field.label} hint={field.hint} span={field.span}>
              <Control spec={field} row={row} choices={choices} />
            </Field>
          ))}
        </div>

        <ErrorNote>{error}</ErrorNote>

        <div className="flex items-center justify-end gap-3">
          {editing && onDeleted && (
            <button
              type="button"
              onClick={onDelete}
              disabled={saving}
              className="mr-auto text-sm font-semibold text-red-700 hover:underline disabled:opacity-50"
            >
              Delete
            </button>
          )}
          <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-gold" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : `Add ${spec.title.toLowerCase()}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
