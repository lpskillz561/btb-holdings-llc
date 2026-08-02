// A small, declarative CRUD layer.
//
// Six of the CRM's entities are plain records: validate a handful of fields,
// insert or patch, log the change. Hand-writing that six times is where
// inconsistency creeps in — one resource forgets to log activity, another lets
// an unknown column through. So each is described once below and the engine
// gives it identical list/get/create/update/delete behaviour.
//
// Clients are NOT here: they carry rollups and cascade rules of their own and
// live in ./clients.

import {
  CrmError,
  buildInsert,
  buildUpdate,
  cents,
  date,
  logActivity,
  newId,
  nowIso,
  num,
  oneOf,
  query,
  queryOne,
  str,
} from "./db";
import {
  CONTACT_ROLES,
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  PROPERTY_STATUSES,
  SAVED_PARCEL_STATUSES,
  TX_CATEGORIES,
  TX_KINDS,
  TX_STATUSES,
  UNIT_STATUSES,
  UNIT_USES,
} from "./types";

type Row = Record<string, unknown>;
type Coerce = (v: unknown) => unknown;

export interface ResourceDef {
  /** Table name. Internal constant — never interpolated from a request. */
  table: string;
  /** Human name, used in errors and the activity feed. */
  entity: string;
  /** Column → coercer, applied on both create and patch. */
  fields: Record<string, Coerce>;
  /** Columns that must be present and non-null on create. */
  required?: string[];
  /** Applied on create when the request omits the column. */
  defaults?: Record<string, unknown>;
  /** Columns a caller may filter the list on (`?client_id=…`). */
  filters?: readonly string[];
  /** Fixed ORDER BY. Never taken from the request. */
  orderBy: string;
  /** One-line description of a row, for the activity feed. */
  describe: (row: Row) => string;
}

/* -------------------------------------------------------------------------- */
/* Coercers                                                                    */
/* -------------------------------------------------------------------------- */

/** A required enum column: unknown input falls back rather than failing the write. */
const enumOf = (values: readonly string[], fallback: string): Coerce =>
  (v) => oneOf(v, values as readonly string[], fallback);

const int: Coerce = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

/* -------------------------------------------------------------------------- */
/* Definitions                                                                 */
/* -------------------------------------------------------------------------- */

export const CONTACTS: ResourceDef = {
  table: "crm_contacts",
  entity: "Contact",
  fields: {
    client_id: str,
    name: str,
    role: enumOf(CONTACT_ROLES, "principal"),
    title: str,
    email: str,
    phone: str,
    notes: str,
  },
  required: ["client_id", "name"],
  defaults: { role: "principal" },
  filters: ["client_id", "role"],
  orderBy: "created_at ASC",
  describe: (r) => String(r.name ?? "contact"),
};

export const CONTRACTS: ResourceDef = {
  table: "crm_contracts",
  entity: "Contract",
  fields: {
    client_id: str,
    proposal_id: str,
    title: str,
    type: enumOf(CONTRACT_TYPES, "unit_purchase"),
    status: enumOf(CONTRACT_STATUSES, "draft"),
    value_cents: cents,
    counterparty: str,
    document_url: str,
    effective_date: date,
    end_date: date,
    signed_at: date,
    notes: str,
  },
  required: ["client_id", "title"],
  defaults: { type: "unit_purchase", status: "draft", value_cents: 0 },
  filters: ["client_id", "status", "type", "proposal_id"],
  orderBy: "created_at DESC",
  describe: (r) => String(r.title ?? "contract"),
};

export const PROPERTIES: ResourceDef = {
  table: "crm_properties",
  entity: "Land holding",
  fields: {
    client_id: str,
    label: str,
    status: enumOf(PROPERTY_STATUSES, "prospect"),
    parcel_key: str,
    address: str,
    city: str,
    postal_code: str,
    county: str,
    state: str,
    acres: num,
    purchase_price_cents: cents,
    closing_costs_cents: cents,
    improvements_cents: cents,
    purchase_date: date,
    assessed_value_cents: cents,
    annual_property_tax_cents: cents,
    notes: str,
  },
  required: ["client_id", "label"],
  defaults: { status: "prospect" },
  filters: ["client_id", "status", "state"],
  orderBy: "created_at DESC",
  describe: (r) => String(r.label ?? "land holding"),
};

export const UNITS: ResourceDef = {
  table: "crm_units",
  entity: "Tiny home",
  fields: {
    client_id: str,
    property_id: str,
    label: str,
    status: enumOf(UNIT_STATUSES, "planned"),
    unit_use: enumOf(UNIT_USES, "long_term_rental"),
    manufacturer: str,
    model: str,
    serial_number: str,
    sqft: int,
    bedrooms: int,
    purchase_price_cents: cents,
    site_work_cents: cents,
    soft_costs_cents: cents,
    delivered_on: date,
    placed_in_service_on: date,
    useful_life_years: num,
    bonus_claimed_cents: cents,
    sold_on: date,
    sale_price_cents: cents,
    monthly_rent_cents: cents,
    management_company: str,
    notes: str,
  },
  required: ["client_id", "label"],
  defaults: { status: "planned", unit_use: "long_term_rental" },
  filters: ["client_id", "status", "property_id"],
  orderBy: "created_at DESC",
  describe: (r) => String(r.label ?? "tiny home"),
};

export const TRANSACTIONS: ResourceDef = {
  table: "crm_transactions",
  entity: "Transaction",
  fields: {
    client_id: str,
    property_id: str,
    unit_id: str,
    kind: enumOf(TX_KINDS, "income"),
    category: enumOf(TX_CATEGORIES, "other"),
    description: str,
    amount_cents: cents,
    occurred_on: date,
    status: enumOf(TX_STATUSES, "paid"),
    invoice_number: str,
    notes: str,
  },
  required: ["description", "amount_cents", "occurred_on"],
  defaults: { kind: "income", category: "other", status: "paid" },
  filters: ["client_id", "kind", "category", "status", "property_id", "unit_id"],
  orderBy: "occurred_on DESC, created_at DESC",
  describe: (r) => String(r.description ?? "transaction"),
};

export const SAVED_PARCELS: ResourceDef = {
  table: "crm_saved_parcels",
  entity: "Saved parcel",
  fields: {
    client_id: str,
    parcel_key: str,
    status: enumOf(SAVED_PARCEL_STATUSES, "shortlisted"),
    one_line: str,
    owner_name: str,
    state: str,
    county: str,
    acres: num,
    assessed_value_cents: cents,
    land_value_cents: cents,
    notes: str,
    saved_by: str,
  },
  required: ["client_id", "parcel_key"],
  defaults: { status: "shortlisted" },
  filters: ["client_id", "status"],
  orderBy: "created_at DESC",
  describe: (r) => String(r.one_line ?? r.parcel_key ?? "parcel"),
};

/* -------------------------------------------------------------------------- */
/* Engine                                                                      */
/* -------------------------------------------------------------------------- */

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

export async function listRows<T extends Row>(
  def: ResourceDef,
  params: URLSearchParams,
): Promise<T[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  for (const column of def.filters ?? []) {
    const value = params.get(column);
    if (value === null || value === "") continue;
    binds.push(value);
    where.push(`${column} = $${binds.length}`);
  }

  const requested = Number(params.get("limit"));
  const limit = Number.isFinite(requested)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.round(requested)))
    : DEFAULT_LIMIT;

  return query<T>(
    `SELECT * FROM ${def.table}
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${def.orderBy}
     LIMIT ${limit}`,
    binds,
  );
}

export async function getRow<T extends Row>(def: ResourceDef, id: string): Promise<T> {
  const row = await queryOne<T>(`SELECT * FROM ${def.table} WHERE id = $1`, [id]);
  if (!row) throw new CrmError(`${def.entity} not found.`, 404);
  return row;
}

/** Apply each declared coercer to the keys the body actually supplied. */
function coerceBody(def: ResourceDef, body: Row): Row {
  const out: Row = {};
  for (const [column, coerce] of Object.entries(def.fields)) {
    if (column in body) out[column] = coerce(body[column]);
  }
  return out;
}

export async function createRow<T extends Row>(
  def: ResourceDef,
  body: Row,
  actor?: string | null,
): Promise<T> {
  const values: Row = { ...def.defaults, ...coerceBody(def, body) };

  for (const column of def.required ?? []) {
    if (values[column] === null || values[column] === undefined) {
      throw new CrmError(`${def.entity}: "${column.replace(/_/g, " ")}" is required.`, 400);
    }
  }

  values.id = newId();
  values.created_at = nowIso();
  values.updated_at = values.created_at;

  const { sql, params } = buildInsert(def.table, values);
  const row = (await query<T>(sql, params))[0];

  await logActivity({
    entity_type: def.table,
    entity_id: row.id as string,
    client_id: (row.client_id as string | null) ?? null,
    verb: "created",
    summary: `Added ${def.entity.toLowerCase()} "${def.describe(row)}"`,
    actor_email: actor,
  });
  return row;
}

export async function updateRow<T extends Row>(
  def: ResourceDef,
  id: string,
  body: Row,
  actor?: string | null,
): Promise<T> {
  // Confirm existence first so a no-op patch still 404s on a bad id.
  const existing = await getRow<T>(def, id);

  // The owning client is fixed at creation — moving a record between clients by
  // PATCH would silently rewrite one client's holdings into another's.
  const patch = coerceBody(def, body);
  delete patch.client_id;

  const update = buildUpdate(def.table, id, patch, Object.keys(def.fields));
  if (!update) return existing;

  const row = (await query<T>(update.sql, update.params))[0];
  await logActivity({
    entity_type: def.table,
    entity_id: id,
    client_id: (row.client_id as string | null) ?? null,
    verb: "updated",
    summary: `Updated ${def.entity.toLowerCase()} "${def.describe(row)}"`,
    actor_email: actor,
  });
  return row;
}

export async function deleteRow(
  def: ResourceDef,
  id: string,
  actor?: string | null,
): Promise<void> {
  const existing = await getRow(def, id);
  await query(`DELETE FROM ${def.table} WHERE id = $1`, [id]);
  await logActivity({
    entity_type: def.table,
    entity_id: id,
    client_id: (existing.client_id as string | null) ?? null,
    verb: "deleted",
    summary: `Deleted ${def.entity.toLowerCase()} "${def.describe(existing)}"`,
    actor_email: actor,
  });
}
