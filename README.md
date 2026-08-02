# BTB Holdings CRM

The book of business for a tiny-home programme: high-income clients acquire
tiny homes, place them in service as rental assets, and take the depreciation
that follows. This app tracks the relationship, the document, the asset and the
money — and sources the land for it from a 19.5M-row county parcel database.

Extracted from the Ziora Capital Holdings portal, where it was built and run in
production. Target home is AWS: Aurora PostgreSQL, EC2 behind an ALB, at
**btbholdingsllc.com**. See [`docs/AWS-MIGRATION.md`](docs/AWS-MIGRATION.md) for
where that stands.

---

## What it does

| Section | Route | What it answers |
|---|---|---|
| **Overview** | `/crm` | Pipeline by stage, open vs. contracted value, units in service, the client list |
| **Client card** | `/crm/clients/[id]` | Everything about one account, across seven tabs |
| **Proposals** | `/crm/proposals` | Every proposal, its frozen figures, and where it stands |
| **Contracts** | `/crm/contracts` | What is committed, and what is still waiting on a signature |
| **Holdings** | `/crm/holdings` | All land and every unit — and which units are *not yet in service* |
| **Financials** | `/crm/financials` | Cash in and out, per-client profitability, recent transactions |

Each client card carries **Overview** (record, people, tax profile, land
criteria, cost position, activity), **Proposals**, **Contracts**, **Holdings**,
**Financials**, **Land search**, and an **AI advisor**.

Both views are load-bearing. The client card answers *"where does this account
stand"* — the question you have with someone on the phone. The global sections
answer what no single record can: what the pipeline is worth, which contracts
are unsigned, which units are built but deducting nothing. **If you add a
client-scoped feature, add its global list in the same commit** — otherwise it
is unreachable from an empty install.

### Land search, inside the client card

The reason the CRM and the parcel database live in one app. A client's **Land
search** tab runs the parcel engine (`src/lib/parcels.ts`) pre-filtered to the
state, county, acreage and budget on their record, so the first search is
already the right one. From the results you can shortlist a parcel to that
client, ask the model whether it suits *their* tax position, and promote it to a
tracked holding when it goes under contract.

Shortlisted parcels **copy** the parcel's details onto the row rather than
joining at read time: the ETL re-imports the assessment roll wholesale, and a
shortlist that renders blank after a re-import is worse than one holding a
slightly stale snapshot. The parcel key is kept, so the live record is one
lookup away.

### Proposals: figures are computed, not claimed

Drafting a proposal produces two separate things, stored separately:

- **The economics** — computed in `src/lib/crm/economics.ts` in ordinary
  arithmetic and **frozen onto the row** at generation time.
- **The prose** — written by the model, which is handed those figures as given
  facts and is explicitly forbidden from calculating, restating or "checking"
  any of them.

That division is not negotiable. The audience is a high-income taxpayer and
their CPA, whose job is checking figures. The economics columns are therefore
**not patchable** — editing prose can never corrupt a number, and to quote
something different you generate a new proposal. The old one survives as a
truthful record of what was offered.

The model is honest about what breaks the case, because the code is: land is
excluded from the depreciable basis; a unit recorded as *personal use* deducts
nothing; and the passive-activity rules, the placed-in-service date, the
personal-property vs. 27.5-year classification and depreciation recapture are
appended to every proposal as conditions rather than assumed away.

Delivery is **print-to-PDF** at `/crm/proposals/[id]/print` — the document
alone, site chrome dropped by the `@media print` rules in `globals.css`.

> **Not tax advice.** Every figure is an estimate for discussion, and the
> generated document says so. The assumptions that drive it — bonus rate,
> recovery period, marginal rate — are environment configuration precisely
> because they change and must be confirmed per deal.

### AI

Three surfaces — proposal drafting, land-fit assessment, and a client advisor —
all routed through `buildSystemPrompt` in `src/lib/crm/ai.ts`, which loads the
client's marginal rate, entity type, write-off target, land criteria, holdings
and cost position into the prompt. That context is what makes the answer
specific rather than generic; route any new AI surface through it. Without
`OPENAI_API_KEY` these features are disabled with an explanatory notice, not an
error.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000 -> redirects to /crm
```

You need a PostgreSQL 14+ database reachable at `DATABASE_URL`. The app creates
its own tables on the first request — there is no migration step.

```bash
npx tsc --noEmit     # MUST pass
npm run build        # MUST pass; catches route-export and server/client errors
```

There is no test suite. Verify by exercising the running app — and note that
`curl` is not sufficient here, see [`CLAUDE.md`](CLAUDE.md).

### Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Signs session cookies. **Must be identical at build and runtime** — the Edge middleware freezes it at build. |
| `OPENAI_API_KEY` | for AI | Proposal drafting, land fit, advisor |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o` |
| `AUTH_USERS` | no | Built-in accounts, `email:password` comma-separated |
| `REGISTRATION_CODE` | no | Invite code for `/register`. Blank closes registration. |
| `CRM_ADMINS` | no | Comma-separated emails. **Unset means every signed-in user has access.** |
| `CRM_BONUS_DEPRECIATION_RATE_BPS` | no | Default `10000` (100%). Confirm per deal. |
| `CRM_DEFAULT_MARGINAL_RATE_BPS` | no | Default `3700` |
| `CRM_DEFAULT_USEFUL_LIFE_YEARS` | no | Default `5` |
| `CRM_DEFAULT_OCCUPANCY_BPS` / `CRM_DEFAULT_OPEX_BPS` | no | `8500` / `3500` |

---

## Data

One PostgreSQL database holds both halves:

| Tables | Rows | Owner |
|---|---|---|
| `crm_*`, `portal_users`, `contact_submissions` | small | this app |
| `parcels`, `auctions` | **19.5M / 12 GB** | the ETL |

`src/lib/crm/schema.ts` is the single source of truth for this app's tables and
brings them up to date itself on first use, three re-runnable ways: `CREATE
TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` per column, and a
drop-and-recreate of each named `CHECK` generated from the enum arrays in
`src/lib/crm/types.ts`. Widening an enum there widens the SQL on the next boot,
so the two cannot drift.

**A new column added there must be nullable or have a default**, or the `ALTER`
fails on a populated table.

The parcel tables are **not** created by this app. They come from the ETL in the
Ziora Capital repo (`etl/import.mjs`, `etl/auctions.mjs`), which is scheduled by
n8n. Without them the CRM works fine; land search returns nothing.

### Invariants

- **Money is `BIGINT` cents.** Never floats, never dollars in the database.
  Rates are basis points (`3700` = 37%). `src/lib/crm/format.ts` is the only
  place that divides by 100.
- **`sum(bigint)` returns `NUMERIC`**, which node-postgres hands back as a
  **string**. Every money aggregate needs an explicit `::bigint`.
- **PATCH semantics.** Absent key leaves the column alone; explicit `null`
  clears it. A record's owning `client_id` is fixed at creation.
- **Cost basis and cash are never added together.** `CostBasis` is what the
  assets cost; `FinanceSummary` is what cash moved. Summing them double-counts.
- **Auth is enforced per route under `/api`**, which sits outside the middleware
  matcher. `withCrm`/`withCrmParams` in `src/lib/crm/rest.ts` is the only gate
  those endpoints get.

---

## Deployment

`infra/aws/btb-crm-core.yaml` provisions the VPC, subnets, security groups and
Aurora PostgreSQL cluster:

```bash
aws cloudformation deploy --stack-name btb-crm-core \
  --template-file infra/aws/btb-crm-core.yaml --profile ziora
```

Aurora carries `DeletionPolicy: Snapshot` on purpose — this database holds
client tax profiles and contracts, and losing them to a `delete-stack` typo is
not an acceptable failure mode. The master password is generated straight into
Secrets Manager and never appears in a parameter, a log, or this repo.

The app stack (EC2, ALB, listeners, DNS) is **not built yet**. See
[`docs/AWS-MIGRATION.md`](docs/AWS-MIGRATION.md).
