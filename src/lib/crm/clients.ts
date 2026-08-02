// Clients — the record everything else hangs off, plus the rollups the list and
// dashboard render.
//
// Clients don't use the generic engine in ./resource because they need those
// rollups and because deleting one cascades across six tables (enforced by the
// FKs in ./schema, not by application loops).

import {
  CrmError,
  buildInsert,
  buildUpdate,
  bps,
  cents,
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
  CLIENT_STATUSES,
  ENTITY_TYPES,
  HEALTHS,
  LEAD_SOURCES,
  type ClientStatus,
  type CrmActivity,
  type CrmClient,
  type CrmContact,
  type CrmContract,
  type CrmProperty,
  type CrmProposal,
  type CrmSavedParcel,
  type CrmTransaction,
  type CrmUnit,
} from "./types";

/** A client row plus the counts and totals the list view shows. */
export interface ClientListRow extends CrmClient {
  proposal_count: number;
  contract_count: number;
  unit_count: number;
  property_count: number;
  /** Cash actually received from this client (paid income only). */
  invested_cents: number;
  /** Sum of year-one deductions across their accepted proposals. */
  modelled_writeoff_cents: number;
}

const FIELDS = {
  name: str,
  legal_name: str,
  status: (v: unknown) => oneOf(v, CLIENT_STATUSES, "prospect"),
  health: (v: unknown) => oneOf(v, HEALTHS, "green"),
  source: (v: unknown) => oneOf(v, LEAD_SOURCES, "referral"),
  entity_type: (v: unknown) => oneOf(v, ENTITY_TYPES, "individual"),
  email: str,
  phone: str,
  city: str,
  state: str,
  tax_state: str,
  marginal_rate_bps: bps,
  est_annual_income_cents: cents,
  target_writeoff_cents: cents,
  investment_capacity_cents: cents,
  cpa_name: str,
  cpa_email: str,
  target_state: str,
  target_county: str,
  target_min_acres: num,
  target_max_acres: num,
  target_max_price_cents: cents,
  owner_email: str,
  notes: str,
} as const;

const COLUMNS = Object.keys(FIELDS);

function coerce(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, fn] of Object.entries(FIELDS)) {
    if (column in body) out[column] = fn(body[column]);
  }
  return out;
}

/**
 * Clients with their rollups.
 *
 * The aggregates are correlated subqueries rather than joins on purpose: five
 * LEFT JOINs onto one-to-many tables multiply each other's rows and quietly
 * inflate every SUM. At this cardinality (hundreds of clients) the subqueries
 * are the cheaper mistake to avoid making.
 */
export async function listClients(params: URLSearchParams = new URLSearchParams()): Promise<ClientListRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];

  const status = params.get("status");
  if (status && (CLIENT_STATUSES as readonly string[]).includes(status)) {
    binds.push(status);
    where.push(`c.status = $${binds.length}`);
  }
  const search = params.get("q")?.trim();
  if (search) {
    binds.push(`%${search.toLowerCase()}%`);
    where.push(
      `(lower(c.name) LIKE $${binds.length} OR lower(coalesce(c.email, '')) LIKE $${binds.length}` +
        ` OR lower(coalesce(c.legal_name, '')) LIKE $${binds.length})`,
    );
  }

  return query<ClientListRow>(
    `SELECT c.*,
            (SELECT count(*)::int FROM crm_proposals p WHERE p.client_id = c.id)  AS proposal_count,
            (SELECT count(*)::int FROM crm_contracts k WHERE k.client_id = c.id)  AS contract_count,
            (SELECT count(*)::int FROM crm_units u WHERE u.client_id = c.id)      AS unit_count,
            (SELECT count(*)::int FROM crm_properties r WHERE r.client_id = c.id) AS property_count,
            -- Every money aggregate is cast back to bigint. sum(bigint) returns
            -- NUMERIC in Postgres, and node-postgres hands NUMERIC back as a
            -- STRING — which then sails through as "0" and renders as "—".
            -- The ::bigint puts it back in range of the INT8 parser in lib/db.ts.
            (SELECT coalesce(sum(t.amount_cents), 0)::bigint FROM crm_transactions t
              WHERE t.client_id = c.id AND t.kind = 'income' AND t.status = 'paid') AS invested_cents,
            (SELECT coalesce(sum(p.year_one_deduction_cents), 0)::bigint FROM crm_proposals p
              WHERE p.client_id = c.id AND p.status = 'accepted')                 AS modelled_writeoff_cents
     FROM crm_clients c
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY c.updated_at DESC
     LIMIT 500`,
    binds,
  );
}

export async function getClient(id: string): Promise<CrmClient> {
  const row = await queryOne<CrmClient>(`SELECT * FROM crm_clients WHERE id = $1`, [id]);
  if (!row) throw new CrmError("Client not found.", 404);
  return row;
}

export async function createClient(
  body: Record<string, unknown>,
  actor?: string | null,
): Promise<CrmClient> {
  const values = coerce(body);
  if (!values.name) throw new CrmError("A client name is required.", 400);

  values.status ??= "prospect";
  values.health ??= "green";
  values.source ??= "referral";
  values.entity_type ??= "individual";
  values.owner_email ??= actor ?? null;
  values.id = newId();
  values.created_at = nowIso();
  values.updated_at = values.created_at;

  const { sql, params } = buildInsert("crm_clients", values);
  const row = (await query<CrmClient>(sql, params))[0];

  await logActivity({
    entity_type: "crm_clients",
    entity_id: row.id,
    client_id: row.id,
    verb: "created",
    summary: `Added client ${row.name}`,
    actor_email: actor,
  });
  return row;
}

export async function updateClient(
  id: string,
  body: Record<string, unknown>,
  actor?: string | null,
): Promise<CrmClient> {
  const existing = await getClient(id);
  const patch = coerce(body);
  if ("name" in patch && !patch.name) {
    throw new CrmError("A client name is required.", 400);
  }

  const update = buildUpdate("crm_clients", id, patch, COLUMNS);
  if (!update) return existing;

  const row = (await query<CrmClient>(update.sql, update.params))[0];

  // A stage change is the event anyone reviewing the feed is looking for, so
  // name it rather than burying it in a generic "updated".
  const movedStage = patch.status && patch.status !== existing.status;
  await logActivity({
    entity_type: "crm_clients",
    entity_id: id,
    client_id: id,
    verb: movedStage ? "stage_changed" : "updated",
    summary: movedStage
      ? `${row.name}: ${existing.status.replace(/_/g, " ")} → ${row.status.replace(/_/g, " ")}`
      : `Updated ${row.name}`,
    actor_email: actor,
  });
  return row;
}

/** Deletes the client and, by FK cascade, everything owned by them. */
export async function deleteClient(id: string, actor?: string | null): Promise<void> {
  const existing = await getClient(id);
  await query(`DELETE FROM crm_clients WHERE id = $1`, [id]);
  await logActivity({
    entity_type: "crm_clients",
    entity_id: id,
    client_id: null,
    verb: "deleted",
    summary: `Deleted client ${existing.name} and all of their records`,
    actor_email: actor,
  });
}

/* -------------------------------------------------------------------------- */
/* Client detail                                                               */
/* -------------------------------------------------------------------------- */

export interface FinanceSummary {
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  /** Invoiced or overdue, i.e. billed and not yet collected. */
  outstanding_cents: number;
  annual_rent_run_rate_cents: number;
}

/**
 * What this client's programme has actually cost, assembled from the assets
 * they own rather than from any proposal.
 *
 * This is deliberately NOT the same thing as `FinanceSummary`, and the two must
 * never be added together. Finance answers "what cash has moved"; this answers
 * "what did the assets cost". A unit bought on terms shows its full cost here
 * and only the paid instalments there — both are true, and conflating them
 * would double-count the deal.
 *
 * The depreciable/non-depreciable split follows the same rule as ./economics:
 * land and its closing costs are not depreciable; units, their site work and
 * soft costs, and land improvements are.
 */
export interface CostBasis {
  land_cents: number;
  land_closing_cents: number;
  land_improvements_cents: number;
  annual_property_tax_cents: number;
  unit_cents: number;
  unit_site_work_cents: number;
  unit_soft_costs_cents: number;

  /** Everything above except the recurring property tax. The all-in number. */
  total_capital_cents: number;
  /** Land + closing costs. Recoverable only on sale, never by depreciation. */
  land_basis_cents: number;
  /** Business-use units and improvements. What could support a deduction. */
  depreciable_basis_cents: number;
  /** The part of that basis on units actually placed in service. */
  in_service_basis_cents: number;
  /** Bonus depreciation recorded as claimed against these units. */
  bonus_claimed_cents: number;

  property_count: number;
  unit_count: number;
  in_service_count: number;
  /** Units excluded from the depreciable basis because they are personal use. */
  personal_use_count: number;
}

export interface ClientDetail {
  client: CrmClient;
  contacts: CrmContact[];
  proposals: CrmProposal[];
  contracts: CrmContract[];
  properties: CrmProperty[];
  units: CrmUnit[];
  transactions: CrmTransaction[];
  savedParcels: CrmSavedParcel[];
  activity: CrmActivity[];
  finance: FinanceSummary;
  cost: CostBasis;
}

/**
 * Roll up what the client's land and units cost.
 *
 * Two aggregates rather than one join: `crm_properties` and `crm_units` are both
 * one-to-many off the client, so joining them would multiply each other's rows
 * and inflate every SUM — the same trap avoided in `listClients`.
 */
export async function clientCostBasis(clientId: string): Promise<CostBasis> {
  const [land, units] = await Promise.all([
    query<{
      land_cents: number;
      land_closing_cents: number;
      land_improvements_cents: number;
      annual_property_tax_cents: number;
      property_count: number;
    }>(
      `SELECT coalesce(sum(purchase_price_cents), 0)::bigint      AS land_cents,
              coalesce(sum(closing_costs_cents), 0)::bigint       AS land_closing_cents,
              coalesce(sum(improvements_cents), 0)::bigint        AS land_improvements_cents,
              coalesce(sum(annual_property_tax_cents), 0)::bigint AS annual_property_tax_cents,
              count(*)::int                                       AS property_count
       FROM crm_properties WHERE client_id = $1 AND status <> 'sold'`,
      [clientId],
    ),
    query<{
      unit_cents: number;
      unit_site_work_cents: number;
      unit_soft_costs_cents: number;
      business_basis_cents: number;
      in_service_basis_cents: number;
      bonus_claimed_cents: number;
      unit_count: number;
      in_service_count: number;
      personal_use_count: number;
    }>(
      `SELECT coalesce(sum(purchase_price_cents), 0)::bigint AS unit_cents,
              coalesce(sum(site_work_cents), 0)::bigint      AS unit_site_work_cents,
              coalesce(sum(soft_costs_cents), 0)::bigint     AS unit_soft_costs_cents,
              -- Personal use supports no deduction, so it is excluded from the
              -- depreciable basis here exactly as it is in ./economics.
              coalesce(sum(
                coalesce(purchase_price_cents, 0) + coalesce(site_work_cents, 0) + coalesce(soft_costs_cents, 0)
              ) FILTER (WHERE unit_use <> 'personal'), 0)::bigint AS business_basis_cents,
              coalesce(sum(
                coalesce(purchase_price_cents, 0) + coalesce(site_work_cents, 0) + coalesce(soft_costs_cents, 0)
              ) FILTER (WHERE unit_use <> 'personal' AND placed_in_service_on IS NOT NULL), 0)::bigint
                AS in_service_basis_cents,
              coalesce(sum(bonus_claimed_cents), 0)::bigint  AS bonus_claimed_cents,
              count(*)::int                                        AS unit_count,
              count(*) FILTER (WHERE placed_in_service_on IS NOT NULL)::int AS in_service_count,
              count(*) FILTER (WHERE unit_use = 'personal')::int           AS personal_use_count
       FROM crm_units WHERE client_id = $1 AND status <> 'sold'`,
      [clientId],
    ),
  ]);

  const l = land[0];
  const u = units[0];

  return {
    land_cents: l.land_cents,
    land_closing_cents: l.land_closing_cents,
    land_improvements_cents: l.land_improvements_cents,
    annual_property_tax_cents: l.annual_property_tax_cents,
    unit_cents: u.unit_cents,
    unit_site_work_cents: u.unit_site_work_cents,
    unit_soft_costs_cents: u.unit_soft_costs_cents,
    total_capital_cents:
      l.land_cents +
      l.land_closing_cents +
      l.land_improvements_cents +
      u.unit_cents +
      u.unit_site_work_cents +
      u.unit_soft_costs_cents,
    land_basis_cents: l.land_cents + l.land_closing_cents,
    depreciable_basis_cents: u.business_basis_cents + l.land_improvements_cents,
    in_service_basis_cents: u.in_service_basis_cents,
    bonus_claimed_cents: u.bonus_claimed_cents,
    property_count: l.property_count,
    unit_count: u.unit_count,
    in_service_count: u.in_service_count,
    personal_use_count: u.personal_use_count,
  };
}

/** Everything the client card renders, in one round of parallel queries. */
export async function getClientDetail(id: string): Promise<ClientDetail> {
  const client = await getClient(id);

  const [contacts, proposals, contracts, properties, units, transactions, savedParcels, activity, finance, cost] =
    await Promise.all([
      query<CrmContact>(`SELECT * FROM crm_contacts WHERE client_id = $1 ORDER BY created_at`, [id]),
      query<CrmProposal>(
        `SELECT * FROM crm_proposals WHERE client_id = $1 ORDER BY created_at DESC`,
        [id],
      ),
      query<CrmContract>(
        `SELECT * FROM crm_contracts WHERE client_id = $1 ORDER BY created_at DESC`,
        [id],
      ),
      query<CrmProperty>(
        `SELECT * FROM crm_properties WHERE client_id = $1 ORDER BY created_at DESC`,
        [id],
      ),
      query<CrmUnit>(`SELECT * FROM crm_units WHERE client_id = $1 ORDER BY created_at DESC`, [id]),
      query<CrmTransaction>(
        `SELECT * FROM crm_transactions WHERE client_id = $1 ORDER BY occurred_on DESC, created_at DESC LIMIT 300`,
        [id],
      ),
      query<CrmSavedParcel>(
        `SELECT * FROM crm_saved_parcels WHERE client_id = $1 ORDER BY created_at DESC`,
        [id],
      ),
      query<CrmActivity>(
        `SELECT * FROM crm_activity WHERE client_id = $1 ORDER BY created_at DESC LIMIT 40`,
        [id],
      ),
      clientFinance(id),
      clientCostBasis(id),
    ]);

  return {
    client,
    contacts,
    proposals,
    contracts,
    properties,
    units,
    transactions,
    savedParcels,
    activity,
    finance,
    cost,
  };
}

/** Money in, money out, and what's still owed — for one client, or all of them. */
export async function clientFinance(clientId?: string | null): Promise<FinanceSummary> {
  const scoped = Boolean(clientId);
  const binds = scoped ? [clientId] : [];
  const clause = scoped ? "WHERE client_id = $1" : "";

  const [totals] = await query<{
    income_cents: number;
    expense_cents: number;
    outstanding_cents: number;
  }>(
    `SELECT
       coalesce(sum(amount_cents) FILTER (WHERE kind = 'income'  AND status = 'paid'), 0)::bigint AS income_cents,
       coalesce(sum(amount_cents) FILTER (WHERE kind = 'expense' AND status = 'paid'), 0)::bigint AS expense_cents,
       coalesce(sum(amount_cents) FILTER (WHERE kind = 'income'  AND status IN ('invoiced','overdue')), 0)::bigint AS outstanding_cents
     FROM crm_transactions ${clause}`,
    binds,
  );

  // Run rate comes from the units themselves, not from booked rent: it answers
  // "what does this portfolio earn at full occupancy", which is a forward figure.
  const [rent] = await query<{ annual_rent_run_rate_cents: number }>(
    `SELECT (coalesce(sum(monthly_rent_cents), 0) * 12)::bigint AS annual_rent_run_rate_cents
     FROM crm_units
     ${scoped ? "WHERE client_id = $1 AND" : "WHERE"} status = 'in_service'`,
    binds,
  );

  return {
    income_cents: totals?.income_cents ?? 0,
    expense_cents: totals?.expense_cents ?? 0,
    net_cents: (totals?.income_cents ?? 0) - (totals?.expense_cents ?? 0),
    outstanding_cents: totals?.outstanding_cents ?? 0,
    annual_rent_run_rate_cents: rent?.annual_rent_run_rate_cents ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export interface CrmSummary {
  clients_total: number;
  by_status: Record<ClientStatus, number>;
  open_proposal_value_cents: number;
  accepted_proposal_value_cents: number;
  active_contract_value_cents: number;
  units_in_service: number;
  units_total: number;
  acres_owned: number;
  writeoff_delivered_cents: number;
  finance: FinanceSummary;
  activity: CrmActivity[];
}

export async function getCrmSummary(): Promise<CrmSummary> {
  const [statusRows, proposalRows, contractRow, unitRow, acreRow, finance, activity] =
    await Promise.all([
      query<{ status: ClientStatus; n: number }>(
        `SELECT status, count(*)::int AS n FROM crm_clients GROUP BY status`,
      ),
      query<{ status: string; total: number; deduction: number }>(
        `SELECT status,
                coalesce(sum(total_investment_cents), 0)::bigint  AS total,
                coalesce(sum(year_one_deduction_cents), 0)::bigint AS deduction
         FROM crm_proposals GROUP BY status`,
      ),
      query<{ total: number }>(
        `SELECT coalesce(sum(value_cents), 0)::bigint AS total FROM crm_contracts
         WHERE status IN ('signed','active')`,
      ),
      query<{ in_service: number; total: number }>(
        `SELECT count(*) FILTER (WHERE status = 'in_service')::int AS in_service,
                count(*)::int AS total
         FROM crm_units`,
      ),
      query<{ acres: number }>(
        `SELECT coalesce(sum(acres), 0) AS acres FROM crm_properties WHERE status = 'owned'`,
      ),
      clientFinance(null),
      query<CrmActivity>(`SELECT * FROM crm_activity ORDER BY created_at DESC LIMIT 25`),
    ]);

  const by_status = Object.fromEntries(
    CLIENT_STATUSES.map((s) => [s, 0]),
  ) as Record<ClientStatus, number>;
  let clients_total = 0;
  for (const row of statusRows) {
    by_status[row.status] = row.n;
    clients_total += row.n;
  }

  const proposalsBy = new Map(proposalRows.map((r) => [r.status, r]));
  const draftOrSent =
    (proposalsBy.get("draft")?.total ?? 0) + (proposalsBy.get("sent")?.total ?? 0);

  return {
    clients_total,
    by_status,
    open_proposal_value_cents: draftOrSent,
    accepted_proposal_value_cents: proposalsBy.get("accepted")?.total ?? 0,
    active_contract_value_cents: contractRow[0]?.total ?? 0,
    units_in_service: unitRow[0]?.in_service ?? 0,
    units_total: unitRow[0]?.total ?? 0,
    acres_owned: Number(acreRow[0]?.acres ?? 0),
    writeoff_delivered_cents: proposalsBy.get("accepted")?.deduction ?? 0,
    finance,
    activity,
  };
}
