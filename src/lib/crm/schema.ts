// CRM schema, applied lazily and idempotently against the same Postgres that
// holds the parcel data (`db` in docker-compose).
//
// There is no migration tool in `web/` — the app owns its own tables and brings
// them up to date on first use. The definitions below are the single source of
// truth and are applied three ways, all of which are safe to re-run:
//
//   1. CREATE TABLE IF NOT EXISTS   — new installs
//   2. ADD COLUMN IF NOT EXISTS     — a column added here later appears on an
//                                     existing install without a manual step.
//                                     NEW COLUMNS MUST BE NULLABLE OR HAVE A
//                                     DEFAULT, or the ALTER fails on a table
//                                     that already has rows.
//   3. DROP + ADD named CHECK       — the enum CHECKs are generated from the
//                                     arrays in ./types, so adding a value
//                                     there widens the constraint on the next
//                                     boot. This is why the two can't drift.
//
// Everything is prefixed `crm_` so it can never collide with `parcels` /
// `auctions`, which are owned by the ETL and dropped/recreated on re-import.

import { getPool } from "@/lib/db";
import {
  CLIENT_STATUSES,
  CONTACT_ROLES,
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  ENTITY_TYPES,
  HEALTHS,
  BUILD_METHODS,
  LEAD_SOURCES,
  PAD_STATUSES,
  PARK_STATUSES,
  PROPERTY_STATUSES,
  PROPOSAL_STATUSES,
  SAVED_PARCEL_STATUSES,
  TODO_STATUSES,
  TX_CATEGORIES,
  TX_KINDS,
  TX_STATUSES,
  UNIT_STATUSES,
  UNIT_USES,
} from "./types";

interface TableDef {
  name: string;
  /** [column, type + inline constraints]. Order is the CREATE TABLE order. */
  columns: [string, string][];
  /** Generated from ./types so SQL and TypeScript cannot disagree. */
  checks?: { column: string; values: readonly string[] }[];
  indexes?: string[];
  /**
   * Re-runnable ALTERs for changes the three mechanisms above cannot express —
   * in practice, relaxing a constraint on a column that already exists.
   * `ADD COLUMN IF NOT EXISTS` is a no-op once the column is there, so it can
   * never drop a NOT NULL that a previous install created.
   *
   * Every statement here must be safe to run on every boot. Keep the list
   * short: it is an escape hatch, not a migration history.
   */
  alters?: string[];
}

/**
 * Default for the TEXT timestamp columns.
 *
 * Every write supplies its own `nowIso()` value, so this only fires for a row
 * inserted by hand. It still has to match that format exactly: these columns are
 * sorted and compared as TEXT, and Postgres's own `::text` cast renders a space
 * between the date and the time, which sorts *before* the "T" in an ISO string
 * and would silently misorder the activity feed.
 */
const TS_DEFAULT =
  `TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Columns every table carries. */
const TIMESTAMPS: [string, string][] = [
  ["created_at", TS_DEFAULT],
  ["updated_at", TS_DEFAULT],
];

const TABLES: TableDef[] = [
  // ---------------------------------------------------------------------------
  // Portal tables. Not CRM records, but they live here because this is the app's
  // only auto-migration mechanism, and because both replaced files on a Docker
  // volume — which a Workers deployment cannot have, and which nothing was
  // backing up.
  // ---------------------------------------------------------------------------
  {
    name: "portal_users",
    columns: [
      // Email is the identity, so it is the key. Stored lower-cased.
      ["email", "TEXT PRIMARY KEY"],
      ["name", "TEXT"],
      // "<scheme>:<salt>:<hash>" — see lib/portalUsers.ts.
      ["password_hash", "TEXT NOT NULL"],
      ["last_login_at", "TEXT"],
      // Blocking is a timestamp rather than a boolean so the record says *when*,
      // which is what anyone asking "why can't this person sign in" needs.
      // Enforced in verifyPortalUser — a column nothing checks is decoration.
      ["blocked_at", "TEXT"],
      ["blocked_reason", "TEXT"],
      /** Last administrative password reset, for the same audit reason. */
      ["password_changed_at", "TEXT"],
      ...TIMESTAMPS,
    ],
  },
  {
    name: "contact_submissions",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["name", "TEXT NOT NULL"],
      ["email", "TEXT NOT NULL"],
      ["company", "TEXT"],
      ["phone", "TEXT"],
      ["interest", "TEXT"],
      ["message", "TEXT NOT NULL"],
      ["created_at", TS_DEFAULT],
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS contact_submissions_created_idx ON contact_submissions (created_at DESC)",
    ],
  },
  {
    name: "crm_clients",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["name", "TEXT NOT NULL"],
      ["legal_name", "TEXT"],
      ["status", "TEXT NOT NULL DEFAULT 'prospect'"],
      ["health", "TEXT NOT NULL DEFAULT 'green'"],
      ["source", "TEXT NOT NULL DEFAULT 'referral'"],
      ["entity_type", "TEXT NOT NULL DEFAULT 'individual'"],
      ["email", "TEXT"],
      ["phone", "TEXT"],
      ["city", "TEXT"],
      ["state", "TEXT"],
      ["tax_state", "TEXT"],
      ["marginal_rate_bps", "INTEGER"],
      ["est_annual_income_cents", "BIGINT"],
      ["target_writeoff_cents", "BIGINT"],
      ["investment_capacity_cents", "BIGINT"],
      ["cpa_name", "TEXT"],
      ["cpa_email", "TEXT"],
      ["target_state", "TEXT"],
      ["target_county", "TEXT"],
      ["target_min_acres", "DOUBLE PRECISION"],
      ["target_max_acres", "DOUBLE PRECISION"],
      ["target_max_price_cents", "BIGINT"],
      ["owner_email", "TEXT"],
      ["notes", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [
      { column: "status", values: CLIENT_STATUSES },
      { column: "health", values: HEALTHS },
      { column: "source", values: LEAD_SOURCES },
      { column: "entity_type", values: ENTITY_TYPES },
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_clients_status_idx ON crm_clients (status)",
      "CREATE INDEX IF NOT EXISTS crm_clients_name_idx ON crm_clients (lower(name))",
    ],
  },
  {
    name: "crm_contacts",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["client_id", "TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE"],
      ["name", "TEXT NOT NULL"],
      ["role", "TEXT NOT NULL DEFAULT 'principal'"],
      ["title", "TEXT"],
      ["email", "TEXT"],
      ["phone", "TEXT"],
      ["notes", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [{ column: "role", values: CONTACT_ROLES }],
    indexes: ["CREATE INDEX IF NOT EXISTS crm_contacts_client_idx ON crm_contacts (client_id)"],
  },
  {
    name: "crm_proposals",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["client_id", "TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE"],
      ["title", "TEXT NOT NULL"],
      ["status", "TEXT NOT NULL DEFAULT 'draft'"],
      // Frozen inputs.
      ["unit_count", "INTEGER NOT NULL DEFAULT 1"],
      ["unit_cost_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["site_work_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["soft_costs_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["land_cost_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["marginal_rate_bps", "INTEGER NOT NULL DEFAULT 3700"],
      ["bonus_rate_bps", "INTEGER NOT NULL DEFAULT 10000"],
      // Fractional on purpose: residential rental real property is 27.5 years.
      ["useful_life_years", "DOUBLE PRECISION NOT NULL DEFAULT 5"],
      ["monthly_rent_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["occupancy_bps", "INTEGER NOT NULL DEFAULT 8500"],
      ["opex_bps", "INTEGER NOT NULL DEFAULT 3500"],
      // Frozen outputs.
      ["total_investment_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["depreciable_basis_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["year_one_deduction_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["year_one_tax_savings_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["net_year_one_outlay_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["annual_noi_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["cash_on_cash_bps", "INTEGER"],
      ["payback_years", "DOUBLE PRECISION"],
      ["body_md", "TEXT NOT NULL DEFAULT ''"],
      ["valid_until", "TEXT"],
      ["created_by", "TEXT"],
      ["sent_at", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [{ column: "status", values: PROPOSAL_STATUSES }],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_proposals_client_idx ON crm_proposals (client_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS crm_proposals_status_idx ON crm_proposals (status)",
    ],
  },
  {
    name: "crm_contracts",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["client_id", "TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE"],
      ["proposal_id", "TEXT REFERENCES crm_proposals(id) ON DELETE SET NULL"],
      ["title", "TEXT NOT NULL"],
      ["type", "TEXT NOT NULL DEFAULT 'unit_purchase'"],
      ["status", "TEXT NOT NULL DEFAULT 'draft'"],
      ["value_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["counterparty", "TEXT"],
      ["document_url", "TEXT"],
      ["effective_date", "TEXT"],
      ["end_date", "TEXT"],
      ["signed_at", "TEXT"],
      ["notes", "TEXT"],

      // --- generated execution set -------------------------------------
      // Null on hand-recorded contracts; set on the three documents produced
      // together by lib/crm/contracts-gen.ts. Every column here is nullable
      // because this table is already populated (see CLAUDE.md).
      //
      // The deal terms are duplicated onto all three rows on purpose. They are
      // FROZEN, exactly as proposal economics are: the document a client signed
      // must keep saying what it said, whatever the client record does later. It
      // also means any one document is independently auditable without a join.
      ["deal_group_id", "TEXT"],
      ["purchase_price_cents", "BIGINT"],
      ["down_payment_cents", "BIGINT"],
      ["financed_cents", "BIGINT"],
      ["note_rate_bps", "INTEGER"],
      ["note_term_months", "INTEGER"],
      ["monthly_payment_cents", "BIGINT"],
      ["revenue_split_bps", "INTEGER"],
      ["buyer_legal_name", "TEXT"],
      ["trust_name", "TEXT"],
      ["unit_vin", "TEXT"],
      ["collateral_location", "TEXT"],
      /** The rendered document. Never model-written - see contract-templates.ts. */
      ["body_md", "TEXT"],
      ["generated_at", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [
      { column: "type", values: CONTRACT_TYPES },
      { column: "status", values: CONTRACT_STATUSES },
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_contracts_client_idx ON crm_contracts (client_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS crm_contracts_status_idx ON crm_contracts (status)",
      "CREATE INDEX IF NOT EXISTS crm_contracts_deal_idx ON crm_contracts (deal_group_id)",
    ],
  },
  {
    name: "crm_properties",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["client_id", "TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE"],
      ["label", "TEXT NOT NULL"],
      ["status", "TEXT NOT NULL DEFAULT 'prospect'"],
      ["parcel_key", "TEXT"],
      ["address", "TEXT"],
      ["city", "TEXT"],
      ["postal_code", "TEXT"],
      ["county", "TEXT"],
      ["state", "TEXT"],
      ["acres", "DOUBLE PRECISION"],
      ["purchase_price_cents", "BIGINT"],
      // Adds to land basis (not depreciable).
      ["closing_costs_cents", "BIGINT"],
      // Land-level site prep: access, well, septic, clearing. Depreciable.
      ["improvements_cents", "BIGINT"],
      ["purchase_date", "TEXT"],
      ["assessed_value_cents", "BIGINT"],
      ["annual_property_tax_cents", "BIGINT"],
      ["notes", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [{ column: "status", values: PROPERTY_STATUSES }],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_properties_client_idx ON crm_properties (client_id)",
      "CREATE INDEX IF NOT EXISTS crm_properties_parcel_idx ON crm_properties (parcel_key)",
    ],
  },
  // --------------------------------------------------------- BTB's own land --
  // Deliberately NOT crm_properties. That table hangs off a client with ON
  // DELETE CASCADE, which is right for a client's own holding and catastrophic
  // for BTB inventory: deleting a client would delete the land underneath every
  // other client's home. A park has no client_id at all.
  {
    name: "crm_parks",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["name", "TEXT NOT NULL"],
      ["status", "TEXT NOT NULL DEFAULT 'prospect'"],
      ["parcel_key", "TEXT"],
      ["address", "TEXT"],
      ["city", "TEXT"],
      ["postal_code", "TEXT"],
      ["county", "TEXT"],
      ["state", "TEXT"],
      ["acres", "DOUBLE PRECISION"],
      ["purchase_price_cents", "BIGINT"],
      ["closing_costs_cents", "BIGINT"],
      ["improvements_cents", "BIGINT"],
      ["purchase_date", "TEXT"],
      ["assessed_value_cents", "BIGINT"],
      ["annual_property_tax_cents", "BIGINT"],
      ["planned_pad_count", "INTEGER"],
      // A Zillow (or any) listing for land we are considering. A park with
      // status 'prospect' and a listing_url IS the saved link — no separate
      // table, so promoting a prospect to owned land is a status change rather
      // than a migration between two places.
      ["listing_url", "TEXT"],
      ["asking_price_cents", "BIGINT"],
      /** Model-written assessment of the AREA. Prose only — never figures. */
      ["area_analysis", "TEXT"],
      ["area_analysis_at", "TEXT"],
      ["notes", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [{ column: "status", values: PARK_STATUSES }],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_parks_status_idx ON crm_parks (status)",
      "CREATE INDEX IF NOT EXISTS crm_parks_parcel_idx ON crm_parks (parcel_key)",
    ],
  },
  // Discussion against a piece of land we are considering. Deliberately a table
  // rather than a notes column: several people weigh in on whether a parcel is
  // worth buying, and a single field means the last person to type wins.
  {
    name: "crm_park_comments",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["park_id", "TEXT NOT NULL REFERENCES crm_parks(id) ON DELETE CASCADE"],
      ["author_email", "TEXT NOT NULL"],
      ["body", "TEXT NOT NULL"],
      ...TIMESTAMPS,
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_park_comments_park_idx ON crm_park_comments (park_id, created_at)",
    ],
  },
  {
    name: "crm_pads",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      // Cascade is correct here: a pad has no meaning without its park.
      ["park_id", "TEXT NOT NULL REFERENCES crm_parks(id) ON DELETE CASCADE"],
      ["label", "TEXT NOT NULL"],
      ["status", "TEXT NOT NULL DEFAULT 'planned'"],
      ["pad_sqft", "INTEGER"],
      ["site_work_cents", "BIGINT"],
      ["has_water", "BOOLEAN"],
      ["has_sewer", "BOOLEAN"],
      ["has_power", "BOOLEAN"],
      ["nightly_rate_cents", "BIGINT"],
      ["notes", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [{ column: "status", values: PAD_STATUSES }],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_pads_park_idx ON crm_pads (park_id)",
      "CREATE INDEX IF NOT EXISTS crm_pads_status_idx ON crm_pads (status)",
      // One "A-12" per park. Capacity counting depends on pads being distinct.
      "CREATE UNIQUE INDEX IF NOT EXISTS crm_pads_park_label_idx ON crm_pads (park_id, label)",
    ],
  },
  {
    name: "crm_units",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      // Nullable since the model changed: NULL means BTB owns this home and
      // rents it on its own book. See the `alters` below, which is what
      // actually relaxes this on an install created before the change.
      ["client_id", "TEXT REFERENCES crm_clients(id) ON DELETE CASCADE"],
      ["property_id", "TEXT REFERENCES crm_properties(id) ON DELETE SET NULL"],
      // Where the home actually sits. SET NULL rather than CASCADE: retiring a
      // pad must not delete the asset standing on it.
      ["pad_id", "TEXT REFERENCES crm_pads(id) ON DELETE SET NULL"],
      ["build_method", "TEXT"],
      ["label", "TEXT NOT NULL"],
      ["status", "TEXT NOT NULL DEFAULT 'planned'"],
      ["unit_use", "TEXT NOT NULL DEFAULT 'long_term_rental'"],
      ["manufacturer", "TEXT"],
      ["model", "TEXT"],
      ["serial_number", "TEXT"],
      ["sqft", "INTEGER"],
      ["bedrooms", "INTEGER"],
      ["purchase_price_cents", "BIGINT"],
      ["site_work_cents", "BIGINT"],
      ["soft_costs_cents", "BIGINT"],
      ["delivered_on", "TEXT"],
      ["placed_in_service_on", "TEXT"],
      ["useful_life_years", "DOUBLE PRECISION"],
      ["bonus_claimed_cents", "BIGINT"],
      ["sold_on", "TEXT"],
      ["sale_price_cents", "BIGINT"],
      ["monthly_rent_cents", "BIGINT"],
      ["management_company", "TEXT"],
      ["notes", "TEXT"],
      ...TIMESTAMPS,
    ],
    // The one thing ADD COLUMN IF NOT EXISTS cannot do: an install created
    // before BTB started holding its own homes already has client_id NOT NULL,
    // and the ADD COLUMN above is a no-op on an existing column.
    alters: ["ALTER TABLE crm_units ALTER COLUMN client_id DROP NOT NULL"],
    checks: [
      { column: "status", values: UNIT_STATUSES },
      { column: "unit_use", values: UNIT_USES },
      // A CHECK evaluates to NULL, not false, when the column is NULL, and
      // Postgres accepts that — so this constrains the value on rows that have
      // one without forcing a build method onto rows that don't.
      { column: "build_method", values: BUILD_METHODS },
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_units_client_idx ON crm_units (client_id)",
      "CREATE INDEX IF NOT EXISTS crm_units_property_idx ON crm_units (property_id)",
      "CREATE INDEX IF NOT EXISTS crm_units_pad_idx ON crm_units (pad_id)",
    ],
  },
  {
    name: "crm_transactions",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["client_id", "TEXT REFERENCES crm_clients(id) ON DELETE CASCADE"],
      ["property_id", "TEXT REFERENCES crm_properties(id) ON DELETE SET NULL"],
      ["unit_id", "TEXT REFERENCES crm_units(id) ON DELETE SET NULL"],
      ["kind", "TEXT NOT NULL DEFAULT 'income'"],
      ["category", "TEXT NOT NULL DEFAULT 'other'"],
      ["description", "TEXT NOT NULL"],
      ["amount_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["occurred_on", "TEXT NOT NULL"],
      ["status", "TEXT NOT NULL DEFAULT 'paid'"],
      ["invoice_number", "TEXT"],
      ["notes", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [
      { column: "kind", values: TX_KINDS },
      { column: "category", values: TX_CATEGORIES },
      { column: "status", values: TX_STATUSES },
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_tx_client_idx ON crm_transactions (client_id, occurred_on DESC)",
      "CREATE INDEX IF NOT EXISTS crm_tx_occurred_idx ON crm_transactions (occurred_on DESC)",
      "CREATE INDEX IF NOT EXISTS crm_tx_kind_idx ON crm_transactions (kind, occurred_on DESC)",
    ],
  },
  {
    name: "crm_saved_parcels",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["client_id", "TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE"],
      ["parcel_key", "TEXT NOT NULL"],
      ["status", "TEXT NOT NULL DEFAULT 'shortlisted'"],
      ["one_line", "TEXT"],
      ["owner_name", "TEXT"],
      ["state", "TEXT"],
      ["county", "TEXT"],
      ["acres", "DOUBLE PRECISION"],
      ["assessed_value_cents", "BIGINT"],
      ["land_value_cents", "BIGINT"],
      ["fit_json", "TEXT"],
      ["notes", "TEXT"],
      ["saved_by", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [{ column: "status", values: SAVED_PARCEL_STATUSES }],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_saved_parcels_client_idx ON crm_saved_parcels (client_id, created_at DESC)",
      // Saving the same parcel twice for one client is a duplicate, not a second
      // candidate — the save endpoint relies on this for its upsert.
      "CREATE UNIQUE INDEX IF NOT EXISTS crm_saved_parcels_uniq ON crm_saved_parcels (client_id, parcel_key)",
    ],
  },
  // The shared team to-do on the dashboard.
  //
  // Deliberately has NO client_id and no owner: it is one list the whole office
  // works from, which is the point of it. Anyone who can reach the CRM can add,
  // tick and delete — the same gate as every other route, no second permission
  // model for a checklist.
  //
  // `done_at` NULL means open. A boolean plus a timestamp would let the two
  // disagree; one nullable timestamp cannot, and it answers "when" for free.
  {
    name: "crm_todos",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["title", "TEXT NOT NULL"],
      // Which kanban column the card sits in.
      ["status", "TEXT NOT NULL DEFAULT 'todo'"],
      // Email of whoever owns the card. Nullable — unassigned is a real and
      // common state on a shared board, not a missing value to be defaulted.
      ["assignee", "TEXT"],
      // Free-text detail, shown when a card is opened.
      ["notes", "TEXT"],
      // TEXT, not TIMESTAMPTZ. Every timestamp in this schema is an ISO string
      // (see TS_DEFAULT), and mixing the two breaks queries rather than just
      // looking untidy: one bind parameter used for both `updated_at` (text)
      // and a timestamptz column makes Postgres refuse the statement outright
      // with "inconsistent types deduced for parameter $2".
      ["done_at", "TEXT"],
      // Who added it and who finished it. Stamped from the session, never the
      // request body — on a shared board "who did this" is the whole audit.
      ["created_by", "TEXT"],
      ["done_by", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [{ column: "status", values: TODO_STATUSES }],
    indexes: [
      // Matches the board's ORDER BY exactly: column, then newest first.
      "CREATE INDEX IF NOT EXISTS crm_todos_board_idx ON crm_todos (status, created_at DESC)",
    ],
    alters: [
      // Converges any card written by the pre-kanban build, where "done" was
      // carried only by done_at. Safe to re-run: once the code sets both
      // together, no row can be in the state this looks for.
      "UPDATE crm_todos SET status = 'done' WHERE done_at IS NOT NULL AND status = 'todo'",
    ],
  },
  {
    name: "crm_activity",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["entity_type", "TEXT NOT NULL"],
      ["entity_id", "TEXT"],
      // No FK: activity outlives the record it describes, and a cascade delete
      // would erase the audit trail exactly when it matters most.
      ["client_id", "TEXT"],
      ["verb", "TEXT NOT NULL"],
      ["summary", "TEXT NOT NULL"],
      ["actor_email", "TEXT"],
      ["created_at", TS_DEFAULT],
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_activity_created_idx ON crm_activity (created_at DESC)",
      "CREATE INDEX IF NOT EXISTS crm_activity_client_idx ON crm_activity (client_id, created_at DESC)",
    ],
  },
  {
    name: "crm_conversations",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["scope_type", "TEXT NOT NULL DEFAULT 'global'"],
      ["scope_id", "TEXT"],
      ["title", "TEXT NOT NULL DEFAULT 'New conversation'"],
      ...TIMESTAMPS,
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_conversations_scope_idx ON crm_conversations (scope_type, scope_id, updated_at DESC)",
    ],
  },
  {
    name: "crm_messages",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["conversation_id", "TEXT NOT NULL REFERENCES crm_conversations(id) ON DELETE CASCADE"],
      ["role", "TEXT NOT NULL"],
      ["content", "TEXT NOT NULL"],
      ["created_at", TS_DEFAULT],
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_messages_conversation_idx ON crm_messages (conversation_id, created_at)",
    ],
  },
];

/** `CHECK (col IN ('a','b'))` from a TypeScript enum array. */
function checkClause(column: string, values: readonly string[]): string {
  // Values are compile-time literals from ./types, never user input, but escape
  // quotes anyway so a future value with an apostrophe can't break the DDL.
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
  return `CHECK (${column} IN (${list}))`;
}

function statementsFor(table: TableDef): string[] {
  const sql: string[] = [];

  const cols = table.columns.map(([name, type]) => `  ${name} ${type}`).join(",\n");
  sql.push(`CREATE TABLE IF NOT EXISTS ${table.name} (\n${cols}\n)`);

  // Bring an older install forward. A PRIMARY KEY can't be added this way, so
  // skip the key column — it is present on every install by construction.
  for (const [name, type] of table.columns) {
    if (/PRIMARY KEY/i.test(type)) continue;
    sql.push(`ALTER TABLE ${table.name} ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }

  // Applied before the CHECKs so a column can be relaxed and re-constrained in
  // the same pass.
  sql.push(...(table.alters ?? []));

  // Re-derive every enum constraint from ./types on each boot, so widening an
  // enum there is all that's needed to widen it here.
  for (const { column, values } of table.checks ?? []) {
    const name = `${table.name}_${column}_chk`;
    sql.push(`ALTER TABLE ${table.name} DROP CONSTRAINT IF EXISTS ${name}`);
    sql.push(`ALTER TABLE ${table.name} ADD CONSTRAINT ${name} ${checkClause(column, values)}`);
  }

  sql.push(...(table.indexes ?? []));
  return sql;
}

let ready: Promise<void> | null = null;

/**
 * Create/refresh the CRM tables. Cheap and idempotent, but only ever runs once
 * per process — the promise is memoised, so concurrent first requests share a
 * single migration rather than racing each other through the same DDL.
 *
 * A failure clears the memo so the next request retries: caching a rejection
 * would leave the CRM permanently broken after one transient DB blip at boot.
 */
export function ensureAppSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const table of TABLES) {
          for (const statement of statementsFor(table)) {
            await client.query(statement);
          }
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
