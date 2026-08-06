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
  MEETING_PLATFORMS,
  MEETING_SOURCES,
  MEETING_STATUSES,
  PAD_STATUSES,
  PARK_STATUSES,
  PROPERTY_STATUSES,
  PROPOSAL_STATUSES,
  SAVED_PARCEL_STATUSES,
  TAG_COLORS,
  TODO_STATUSES,
  TX_CATEGORIES,
  TX_KINDS,
  TX_STATUSES,
  UNIT_STATUSES,
  UNIT_USES,
} from "./types";

interface TableDef {
  name: string;
  /**
   * Statements run BEFORE the CREATE TABLE.
   *
   * Exists for exactly one thing the other hooks cannot express: a sequence a
   * column's DEFAULT refers to. `columns` are emitted as part of CREATE TABLE
   * and as `ADD COLUMN IF NOT EXISTS`, both of which fail if the sequence the
   * default names does not exist yet, and `alters` run too late to help.
   *
   * Same contract as everything else here: safe to re-run on every boot.
   */
  pre?: string[];
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
      // Seller financing. Defaulted to zero so every proposal frozen before
      // financing existed keeps reading as the all-cash deal it was.
      ["down_payment_cents", "BIGINT NOT NULL DEFAULT 0"],
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
      ["financed_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["monthly_note_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["annual_debt_service_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["cash_invested_cents", "BIGINT NOT NULL DEFAULT 0"],
      // Deduction per dollar of cash: 100000 bps is the "10 to 1".
      ["deduction_leverage_bps", "INTEGER"],
      ["annual_noi_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["annual_cash_flow_cents", "BIGINT NOT NULL DEFAULT 0"],
      ["cash_on_cash_bps", "INTEGER"],
      ["payback_years", "DOUBLE PRECISION"],
      // Archive, not delete. A proposal or contract entered against the wrong
      // client is a mistake to withdraw, not history to destroy - the row may
      // already be referenced by activity, and someone will ask what happened
      // to it. Kept OUT of the status enum on purpose: status says where the
      // document stands, and folding "archived" into it would erase the fact
      // that a withdrawn proposal had been accepted.
      ["archived_at", "TEXT"],
      ["archived_by", "TEXT"],
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
      // Archive, not delete — same reasoning as crm_proposals above, and for the
      // same reason kept out of the status enum.
      ["archived_at", "TEXT"],
      ["archived_by", "TEXT"],

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
      /**
       * Generated while the seller or wire block was still unconfigured.
       *
       * Such a document is complete and correct in every respect EXCEPT that
       * its wire instructions read `[[ SET CRM_WIRE_ACCOUNT_NUMBER ]]` rather
       * than an account. It exists so the workflow can be exercised end to end
       * before a bank account does; it must never be sent. Stored rather than
       * recomputed because the environment can be configured later, and a
       * document generated before that happened does NOT retroactively become
       * safe - the copy someone already downloaded still has the marker.
       */
      ["not_for_execution", "BOOLEAN NOT NULL DEFAULT false"],
      ["config_issues", "TEXT"],
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
      // Transient is the default because it is the only use the deal is sold on.
      // It defaulted to long_term_rental, which is the one answer that breaks
      // the lodging exception — so every unit recorded without a deliberate
      // choice silently contradicted the tax position.
      ["unit_use", "TEXT NOT NULL DEFAULT 'transient_rental'"],
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
    alters: [
      "ALTER TABLE crm_units ALTER COLUMN client_id DROP NOT NULL",
      // short_term_rental -> transient_rental.
      //
      // THE DROP IS NOT OPTIONAL AND MUST COME FIRST. `alters` run before the
      // CHECKs are re-derived, but "before" means before the DROP as well as
      // the ADD — so the OLD constraint is still live here and rejects the new
      // value. Without this line the UPDATE fails 23514, ensureAppSchema
      // throws, and because it runs on first query the whole app answers 500
      // to everything. Caught by migrating a fixture rather than by reading.
      //
      // Both statements are safe to re-run: IF EXISTS covers the dropped
      // constraint, the generated DROP/ADD below restores it with the new
      // values, and once converged the UPDATE matches no rows.
      "ALTER TABLE crm_units DROP CONSTRAINT IF EXISTS crm_units_unit_use_chk",
      "UPDATE crm_units SET unit_use = 'transient_rental' WHERE unit_use = 'short_term_rental'",
      // And the column DEFAULT, which the column list cannot change: ADD COLUMN
      // IF NOT EXISTS is a no-op once the column exists, so editing the type
      // string beside it moves nothing on an install that already ran. Without
      // this the database still defaults to long_term_rental and any INSERT
      // that omits unit_use — a hand-written one, a future code path — gets the
      // use that breaks the lodging exception.
      "ALTER TABLE crm_units ALTER COLUMN unit_use SET DEFAULT 'transient_rental'",
    ],
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
  // Calls with clients, and what was said on them.
  //
  // `client_id` is NULLABLE and that is deliberate — see the note on CrmMeeting
  // in ./types. A notetaker webhook knows attendee email addresses, not our id
  // for the account, so an unmatched call lands unassigned and is attached by
  // hand. Filing a stranger's call under a real client is worse than filing it
  // nowhere.
  //
  // The cascade IS right here, unlike on crm_activity, which deliberately has no
  // foreign key so the audit trail outlives the record. A meeting is not audit:
  // it is a verbatim record of a private conversation about someone's tax
  // position, and when the client goes it should go with them.
  {
    name: "crm_meetings",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      ["client_id", "TEXT REFERENCES crm_clients(id) ON DELETE CASCADE"],
      ["title", "TEXT NOT NULL"],
      ["status", "TEXT NOT NULL DEFAULT 'scheduled'"],
      ["platform", "TEXT NOT NULL DEFAULT 'google_meet'"],
      ["source", "TEXT NOT NULL DEFAULT 'manual'"],
      // The vendor's id for the recording. Paired with `source` in the unique
      // index below, because two vendors could plausibly mint the same string.
      ["external_id", "TEXT"],
      ["meeting_url", "TEXT"],
      ["recording_url", "TEXT"],
      // TEXT ISO, like every other timestamp here — see the note on crm_todos.
      // NOT NULL with a default so the calendar can always place a row: a
      // meeting with no time cannot be drawn, and silently dropping it from the
      // grid is how a call goes missing.
      ["occurred_at", TS_DEFAULT],
      ["ended_at", "TEXT"],
      ["duration_minutes", "INTEGER"],
      ["attendees_json", "TEXT"],
      // Written by the model, stamped with which one and when. Not patchable —
      // see PATCH allow-list in ./resource.
      ["summary_md", "TEXT"],
      ["summary_model", "TEXT"],
      ["summarized_at", "TEXT"],
      // NULL unless CRM_STORE_TRANSCRIPTS is on; see ./meetings.
      ["transcript", "TEXT"],
      ["transcript_url", "TEXT"],
      ["notes", "TEXT"],
      ["created_by", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [
      { column: "status", values: MEETING_STATUSES },
      { column: "platform", values: MEETING_PLATFORMS },
      { column: "source", values: MEETING_SOURCES },
    ],
    indexes: [
      // Matches the client card's ORDER BY: one account, newest call first.
      "CREATE INDEX IF NOT EXISTS crm_meetings_client_idx ON crm_meetings (client_id, occurred_at DESC)",
      // The calendar's range scan, and the unassigned queue's ordering.
      "CREATE INDEX IF NOT EXISTS crm_meetings_occurred_idx ON crm_meetings (occurred_at DESC)",
      // Webhooks retry, and a retried delivery must update the row rather than
      // add a second copy of the same call. Partial, because `external_id` is
      // NULL for every hand-entered meeting and NULLs are not distinct enough
      // here to be relied on — two manual rows would collide on (source, NULL)
      // under some Postgres configurations, and this states the intent outright.
      `CREATE UNIQUE INDEX IF NOT EXISTS crm_meetings_external_idx
         ON crm_meetings (source, external_id) WHERE external_id IS NOT NULL`,
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
    pre: [
      // ONE sequence for cards AND subtasks, because a subtask carries a real
      // ticket key of its own (BTB-58 under BTB-42) rather than a suffix of its
      // parent's. Two sequences would mean two tickets called BTB-58.
      //
      // A sequence rather than max()+1: the latter needs a lock to be safe under
      // concurrent inserts, and without one two people adding a card at the same
      // moment get the same number and the second insert dies on the unique
      // index. nextval() is atomic and never hands the same value out twice.
      //
      // Numbers are NOT reused when a card is deleted. That is the point of a
      // ticket key — BTB-42 in a chat message six months from now should either
      // find the thing it named or find nothing, never something else.
      "CREATE SEQUENCE IF NOT EXISTS crm_ticket_seq AS BIGINT START 1",
    ],
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      // The human-readable key, rendered BTB-<n> — see lib/crm/ticket.ts.
      // Nullable in the column definition and backfilled in `alters` below,
      // because ADD COLUMN with a volatile DEFAULT on an existing table is a
      // full table rewrite whose ordering is not guaranteed to follow
      // created_at. An explicit backfill numbers the oldest card 1.
      ["ticket_number", "BIGINT"],
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
      // Two cards called BTB-42 would make the key worthless. This is also what
      // turns a concurrent-insert race into a clean error rather than a
      // duplicate that nobody notices until someone quotes the wrong ticket.
      "CREATE UNIQUE INDEX IF NOT EXISTS crm_todos_ticket_idx ON crm_todos (ticket_number)",
    ],
    alters: [
      // Converges any card written by the pre-kanban build, where "done" was
      // carried only by done_at. Safe to re-run: once the code sets both
      // together, no row can be in the state this looks for.
      "UPDATE crm_todos SET status = 'done' WHERE done_at IS NOT NULL AND status = 'todo'",

      // Backfill the cards that predate ticket numbers, oldest first, so the
      // board reads as a history rather than as an arbitrary shuffle.
      //
      // Offset by the current maximum rather than starting at 1, which makes it
      // correct in the mixed state as well as the all-NULL one — the only state
      // that occurs in practice is all-NULL on the first boot after deploy, but
      // a statement that is only correct in the expected state is the kind that
      // silently collides later. `created_at, id` because created_at is a TEXT
      // timestamp with millisecond resolution and two cards added in the same
      // millisecond must still get a deterministic order.
      //
      // Idempotent: after the first run nothing is NULL, so the subquery is
      // empty and the UPDATE touches no rows.
      `UPDATE crm_todos t
         SET ticket_number = s.rn + COALESCE((SELECT max(ticket_number) FROM crm_todos), 0)
         FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
                 FROM crm_todos WHERE ticket_number IS NULL) s
        WHERE t.id = s.id`,
      // NOTE: the sequence is re-parked in crm_todo_subtasks' `alters`, not
      // here. It has to consider the high-water mark of BOTH tables, and on a
      // fresh install the subtask table does not exist yet at this point —
      // TABLES is applied in order, inside one transaction.
    ],
  },
  // Subtasks. A real row rather than a checklist inside `notes`, because they
  // are ASSIGNABLE — "who is doing this piece" is a fact two people need to
  // agree on, and a line of markdown cannot hold it.
  //
  // Each carries its own ticket_number off the SAME sequence as the parent, so a
  // subtask is a ticket you can name out loud. That is deliberate: a subtask
  // with an assignee and no key is a thing you can give someone but cannot then
  // refer to.
  {
    name: "crm_todo_subtasks",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      // DEFAULT, unlike the parent's: this table is new, so there are no
      // pre-existing rows for a volatile default to fill badly. Every insert
      // gets its number without the writer having to remember to ask.
      ["ticket_number", "BIGINT NOT NULL DEFAULT nextval('crm_ticket_seq')"],
      // Cascade: a subtask has no meaning without its parent card.
      ["todo_id", "TEXT NOT NULL REFERENCES crm_todos(id) ON DELETE CASCADE"],
      ["title", "TEXT NOT NULL"],
      // Same design as the card: one nullable timestamp rather than a boolean
      // plus a timestamp that can disagree with it. NULL means open.
      ["done_at", "TEXT"],
      ["done_by", "TEXT"],
      // Unassigned is a real state on a shared board, not a missing value.
      ["assignee", "TEXT"],
      // Hand-ordering within a card. Subtasks are a sequence of steps far more
      // often than cards are, so unlike the board this list IS orderable.
      ["position", "INTEGER NOT NULL DEFAULT 0"],
      ["created_by", "TEXT"],
      ...TIMESTAMPS,
    ],
    indexes: [
      "CREATE INDEX IF NOT EXISTS crm_todo_subtasks_card_idx ON crm_todo_subtasks (todo_id, position, created_at)",
      "CREATE UNIQUE INDEX IF NOT EXISTS crm_todo_subtasks_ticket_idx ON crm_todo_subtasks (ticket_number)",
      // Drives the "assigned to me" filter across both tables.
      "CREATE INDEX IF NOT EXISTS crm_todo_subtasks_assignee_idx ON crm_todo_subtasks (assignee)",
    ],
    alters: [
      // Re-park the shared sequence past the high-water mark of BOTH tables.
      // It lives here rather than on crm_todos because this is the first point
      // in the run where both tables are guaranteed to exist.
      //
      // GREATEST includes the sequence's own last_value so this can only move it
      // FORWARD. Winding it back would re-issue a number a live row already
      // holds, and the unique indexes would then reject the next insert — an
      // outage that would look like "the board stopped accepting cards".
      `SELECT setval('crm_ticket_seq', GREATEST(
         (SELECT COALESCE(max(ticket_number), 0) FROM crm_todos),
         (SELECT COALESCE(max(ticket_number), 0) FROM crm_todo_subtasks),
         (SELECT last_value FROM crm_ticket_seq)
       ))`,
    ],
  },
  // The tag vocabulary. A registry rather than a free text[] on the card,
  // because a tag carries a COLOUR and a colour has to be stable: the same
  // label rendered amber on one card and teal on another is worse than no
  // colour at all. One row per label means one answer.
  {
    name: "crm_tags",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      // Display form, as first typed. Uniqueness is enforced case-insensitively
      // by the index below, so "Urgent" and "urgent" cannot both exist.
      ["label", "TEXT NOT NULL"],
      ["color", "TEXT NOT NULL DEFAULT 'grey'"],
      ["created_by", "TEXT"],
      ...TIMESTAMPS,
    ],
    checks: [{ column: "color", values: TAG_COLORS }],
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS crm_tags_label_idx ON crm_tags (lower(label))",
    ],
  },
  // Which tags are on which card.
  {
    name: "crm_todo_tags",
    columns: [
      ["todo_id", "TEXT NOT NULL REFERENCES crm_todos(id) ON DELETE CASCADE"],
      ["tag_id", "TEXT NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE"],
      ...TIMESTAMPS,
    ],
    indexes: [
      // The composite key. Declared as a unique index rather than a PRIMARY KEY
      // because statementsFor() skips PRIMARY KEY columns when bringing an older
      // install forward, and a two-column key cannot be expressed in the
      // [column, type] shape anyway.
      "CREATE UNIQUE INDEX IF NOT EXISTS crm_todo_tags_pk ON crm_todo_tags (todo_id, tag_id)",
      // Drives "show me everything tagged X".
      "CREATE INDEX IF NOT EXISTS crm_todo_tags_tag_idx ON crm_todo_tags (tag_id)",
    ],
  },
  // The discussion on a card. A table rather than appending to `notes` for the
  // same reason park comments are: `notes` is one shared field, so the last
  // person to type wins and the argument that got you there is gone. A comment
  // is an event — who said it, when — and that is the whole point of having it.
  {
    name: "crm_todo_comments",
    columns: [
      ["id", "TEXT PRIMARY KEY"],
      // Cascade is right here: a comment has no meaning without its card, and
      // deleting a card should not strand its discussion.
      ["todo_id", "TEXT NOT NULL REFERENCES crm_todos(id) ON DELETE CASCADE"],
      // Stamped from the session, never the request body — same rule as
      // `created_by` on the card itself.
      ["author_email", "TEXT NOT NULL"],
      ["body", "TEXT NOT NULL"],
      ...TIMESTAMPS,
    ],
    indexes: [
      // Matches the thread's ORDER BY: one card, oldest first.
      "CREATE INDEX IF NOT EXISTS crm_todo_comments_card_idx ON crm_todo_comments (todo_id, created_at)",
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

  // Before the table, because a column DEFAULT may name a sequence created here.
  sql.push(...(table.pre ?? []));

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
