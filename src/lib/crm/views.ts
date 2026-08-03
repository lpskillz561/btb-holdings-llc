// Cross-client reads for the global sections.
//
// These exist because a client card cannot answer them: which contracts are
// sitting unsigned across the whole book, which units are built but not yet
// placed in service (and so deducting nothing), which accounts are actually
// profitable. Same records as the per-client tabs, different question.

import { query } from "./db";
import type {
  CrmContract,
  CrmProperty,
  CrmTransaction,
  CrmUnit,
} from "./types";

type WithClient<T> = T & { client_name: string };

export async function listContractsWithClient(): Promise<WithClient<CrmContract>[]> {
  return query<WithClient<CrmContract>>(
    `SELECT k.*, c.name AS client_name
     FROM crm_contracts k JOIN crm_clients c ON c.id = k.client_id
     WHERE k.archived_at IS NULL
     ORDER BY k.created_at DESC LIMIT 300`,
  );
}

export async function listPropertiesWithClient(): Promise<WithClient<CrmProperty>[]> {
  return query<WithClient<CrmProperty>>(
    `SELECT p.*, c.name AS client_name
     FROM crm_properties p JOIN crm_clients c ON c.id = p.client_id
     ORDER BY p.created_at DESC LIMIT 300`,
  );
}

/** Units, with their client and the land they sit on. */
export async function listUnitsWithClient(): Promise<
  WithClient<CrmUnit & { property_label: string | null }>[]
> {
  return query<WithClient<CrmUnit & { property_label: string | null }>>(
    `SELECT u.*, c.name AS client_name, p.label AS property_label
     FROM crm_units u
     JOIN crm_clients c ON c.id = u.client_id
     LEFT JOIN crm_properties p ON p.id = u.property_id
     ORDER BY u.created_at DESC LIMIT 300`,
  );
}

export async function listTransactionsWithClient(limit = 200): Promise<
  WithClient<CrmTransaction>[]
> {
  return query<WithClient<CrmTransaction>>(
    `SELECT t.*, coalesce(c.name, '—') AS client_name
     FROM crm_transactions t LEFT JOIN crm_clients c ON c.id = t.client_id
     ORDER BY t.occurred_on DESC, t.created_at DESC LIMIT $1`,
    [Math.min(1000, Math.max(1, limit))],
  );
}

export interface ClientProfitability {
  client_id: string;
  client_name: string;
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  outstanding_cents: number;
}

/** Per-client P&L. Clients with no transactions are included, at zero. */
export async function profitabilityByClient(): Promise<ClientProfitability[]> {
  return query<ClientProfitability>(
    `SELECT c.id AS client_id,
            c.name AS client_name,
            -- ::bigint on every money aggregate: sum(bigint) is NUMERIC, which
            -- node-postgres returns as a string. See lib/crm/clients.ts.
            coalesce(sum(t.amount_cents) FILTER (WHERE t.kind = 'income'  AND t.status = 'paid'), 0)::bigint AS income_cents,
            coalesce(sum(t.amount_cents) FILTER (WHERE t.kind = 'expense' AND t.status = 'paid'), 0)::bigint AS expense_cents,
            (coalesce(sum(t.amount_cents) FILTER (WHERE t.kind = 'income'  AND t.status = 'paid'), 0)
              - coalesce(sum(t.amount_cents) FILTER (WHERE t.kind = 'expense' AND t.status = 'paid'), 0))::bigint AS net_cents,
            coalesce(sum(t.amount_cents) FILTER (WHERE t.kind = 'income'  AND t.status IN ('invoiced','overdue')), 0)::bigint AS outstanding_cents
     FROM crm_clients c
     LEFT JOIN crm_transactions t ON t.client_id = c.id
     GROUP BY c.id, c.name
     ORDER BY net_cents DESC`,
  );
}
