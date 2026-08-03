# BTB Holdings CRM

The book of business for a tiny-home programme: high-income clients acquire
tiny homes, place them in service as rental assets, and take the depreciation
that follows. This app tracks the relationship, the document, the asset and the
money — and sources the land for it from a 19.5M-row county parcel database.

**BTB owns the land; the client owns only the home.** A client's home stands on
a pad in a BTB park, so `crm_parks` / `crm_pads` are BTB's inventory and carry no
`client_id`. A home with no client is one BTB owns and rents on its own book.

A standalone app, sharing nothing with any other project. It runs on AWS —
Aurora PostgreSQL, EC2 behind an ALB — at **btbholdingsllc.com**. The parcel
importer that feeds it is its own repo, `btb-etl`. See
[`docs/AWS-MIGRATION.md`](docs/AWS-MIGRATION.md) for the deployment.

---

## What it does

| Section | Route | What it answers |
|---|---|---|
| **Overview** | `/crm` | Pipeline by stage, open vs. contracted value, units in service, the client list |
| **Client card** | `/crm/clients/[id]` | Everything about one account, across seven tabs |
| **Proposals** | `/crm/proposals` | Every proposal, its frozen figures, and where it stands |
| **Contracts** | `/crm/contracts` | What is committed, and what is still waiting on a signature |
| **Our land** | `/crm/land` | The parks **BTB** owns, the pads on them, and how much capacity is earning |
| **Holdings** | `/crm/holdings` | Every home across every client — and which are *not yet in service* |
| **Financials** | `/crm/financials` | Cash in and out, per-client profitability, recent transactions |
| **Archive** | `/crm/archive` | Proposals and contracts withdrawn from the board, and the only way to restore them |

The **shared kanban board** at `/crm/todos` is one list the whole office works
from: cards anyone can add, assign, annotate and drag between To do, In progress
and Done, each with a comment thread stamped with who said what and when. The
Overview carries a read-only summary of what is still open, linking straight to
the card you click.

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

### Contracts: written from the client, not by a model

`POST /api/crm/contracts/generate` produces the **three execution documents** in
one transaction, sharing a `deal_group_id`: the Equipment Purchase Agreement,
the Equipment Finance Agreement with its Schedule A, and the Management and
Revenue Share Agreement. They are never generated singly — the note is Exhibit A
to the purchase, and the management agreement produces the income that services
the note, so any one alone describes a deal that cannot be executed.

The legal text is a **template** transcribed from the executed samples in
`docs/`. No language model touches it. A model that rephrases an arbitration
clause or a security interest has altered a binding obligation while producing
something that still reads fluently, which is a strictly worse failure than an
inaccurate estimate.

**The structure is fixed and the price varies.** 0% interest, 720 monthly
payments and the 50/50 revenue split are constants in `src/lib/crm/deal.ts`,
because the tax opinion's economic-substance reasoning is built on that exact
shape. Only the purchase price and deposit are per-deal inputs; the monthly
payment is derived, so Schedule A cannot disagree with the note.

Deal terms are **frozen onto every row** and are absent from the PATCH
allow-list, exactly like proposal economics. Delivery is print-to-PDF at
`/crm/contracts/[id]/print`, which prints the whole packet.

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

**The deal is sized from the write-off and it is financed.** A client says they
need to shelter $1,000,000, so the unit is priced at $1,000,000, the deposit
defaults to `CRM_DEFAULT_DEPOSIT_BPS` (10%) of the investment, and the balance
is a 0% note over 720 months on the same terms `src/lib/crm/deal.ts` writes into
the contract — imported, not restated, so a proposal and the note it becomes
cannot disagree. The deduction is taken on the full basis while only the deposit
is cash, which is the 10:1 the strategy leads with. The deposit tracks the price
until someone types their own; freezing it is how the ratio silently drifts.

**Land is never quoted to a client.** BTB owns the ground and the client buys
only the home standing on a pad, so the proposal has no land input at all. What
the land cost *us* is split across the sections a park was stated to carry and
shown on the park page and the client card, marked internal — see
`src/lib/crm/portfolio.ts`.

The model is honest about what breaks the case, because the code is: land is
excluded from the depreciable basis; a unit recorded as *personal use* deducts
nothing; a deduction many times the cash depends on the note being **recourse**,
because §465 would otherwise limit it to the deposit; §461(l) caps how much
business loss can offset other income in one year (~$313k/$626k for 2025, rising
in 2026) with the excess carried forward; and the passive-activity rules, the
placed-in-service date, the personal-property vs. 27.5-year classification and
depreciation recapture are appended to every proposal as conditions rather than
assumed away.

**Mistakes are archived, not deleted.** A proposal or contract entered against
the wrong client can be withdrawn from `/crm/proposals` or `/crm/contracts`; it
leaves every list *and* every total, and comes back from `/crm/archive`.
`archived_at` is deliberately not a status value, so a withdrawn proposal still
remembers it had been accepted.

Delivery is **print-to-PDF** at `/crm/proposals/[id]/print` — the document
alone, site chrome dropped by the `@media print` rules in `globals.css`.

> **Not tax advice.** Every figure is an estimate for discussion, and the
> generated document says so. The assumptions that drive it — bonus rate,
> recovery period, marginal rate — are environment configuration precisely
> because they change and must be confirmed per deal.

### User administration

`/crm/admin` lists registered accounts with last sign-in, and blocks, unblocks,
resets passwords and removes them. Gated by `getSuperUser()`, which **fails
closed**.

Two things it is careful about. Accounts from `AUTH_USERS` are checked by the
login route *before* the database and are not rows, so the page marks them
**built-in** and refuses to act on them rather than appearing to succeed. And it
will not let you block or remove your own account, or the last one able to sign
in — counting both registered rows and built-in accounts.

A password reset generates a temporary password, shows it **once**, and stores
only its hash.

### The client presentation

A full-screen pitch deck at `/crm/present`, built to be screen-shared. "Show
presentation" on the Overview opens it generically; "Present to this client" on a
client card opens it sized to that client's write-off target with their name on
the title slide.

Seventeen slides drawn from `docs/` — who it is for, the asset, the ownership
chain as a diagram, the tax case with its authorities, the terms, the leverage,
the monthly pro forma, the sizes, and the limits a CPA will raise. Arrow keys or
space to move, `F` for fullscreen, `O` for the slide list.

Every figure comes from `src/lib/crm/presentation.ts`, which computes it through
`deal.ts` and `economics.ts` — nothing is typed into a slide. It is navy/gold
brand, not Lightning, and `CrmChrome` and the Ask AI button both render nothing
there.

### AI

Four surfaces — proposal drafting, land-fit assessment, the client advisor, and
an **Ask AI** panel that rides on every `/crm` page — all routed through
`buildScopedPrompt` in `src/lib/crm/ai.ts`. Every prompt is three layers:

1. `BASE_PROMPT` — who the model is and how it writes. Short.
2. **`src/lib/crm/knowledge/SKILL.md`** — the house knowledge base: the trust /
   series-LLC structure, the authorities behind the tax position, the deal
   terms, the risks, and the hard rules. Transcribed from `docs/`, which is the
   source of truth and is deliberately not in git.
3. Record context — the client, proposal, contract or whole workspace the person
   is actually looking at, rendered as already-formatted facts.

The doctrine lives in exactly one place. Add to `SKILL.md`, never to a prompt
string, and add any file to `src/lib/crm/knowledge/*.md` to extend it — they are
concatenated in filename order. **A missing knowledge base is a hard failure by
design** (`src/lib/crm/skill.ts`): the risk it guards against is not downtime, it
is the model answering fluently from its own priors about "tiny home tax
strategies" and describing a deal BTB does not sell.

The Ask AI panel is mounted from `app/crm/layout.tsx`, so it survives navigation,
and it scopes itself from the URL — a client card asks about that client, a
proposal about that proposal, a list page about the whole book. It never renders
on a `/print` route.

Without `OPENAI_API_KEY` these features are disabled with an explanatory notice,
not an error.

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
| `CRM_ADMINS` | no | Comma-separated emails. **Unset means every signed-in user has access.** Registration does *not* grant it: a new account lands on `/welcome` until its email is added here and the app is redeployed. |
| `CRM_SUPERUSERS` | no | Who may administer accounts at `/crm/admin`. Falls back to `CRM_ADMINS`; **unset on both means nobody** — this gate fails closed. |
| `CRM_SELLER_*` | for contracts | The party named as Seller, Creditor and Agent. Generation refuses until the address is set. |
| `CRM_WIRE_*` | for contracts | Where the buyer wires the deposit. Generation refuses until set. |
| `CRM_BONUS_DEPRECIATION_RATE_BPS` | no | Default `10000` (100%). Confirm per deal. |
| `CRM_DEFAULT_MARGINAL_RATE_BPS` | no | Default `3700` |
| `CRM_DEFAULT_USEFUL_LIFE_YEARS` | no | Default `5` |
| `CRM_DEFAULT_OCCUPANCY_BPS` / `CRM_DEFAULT_OPEX_BPS` | no | `7000` / `3500` |
| `CRM_DEFAULT_DEPOSIT_BPS` | no | Default `1000` (10%). The deposit that produces 10:1. The strategy deck says 13% and the executed agreements are 12.4% — reconcile there, change it here. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | for AI | SecureString in SSM. Model defaults to `gpt-4o`; production runs `gpt-5.6-luna`. **Verify a model id before setting it** — a wrong one is accepted by SSM and by the deploy, and fails at request time on all three AI surfaces. |

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

The parcel tables are **not** created by this app. They come from `btb-etl`
(`import.mjs`, `auctions.mjs`), which is its own repo and runs itself on two
systemd timers on the same instance. Without them the CRM works fine; land
search returns nothing.

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

Live at **https://btbholdingsllc.com**, in two CloudFormation stacks:

```bash
aws cloudformation deploy --stack-name btb-crm-core \
  --template-file infra/aws/btb-crm-core.yaml --profile ziora

aws cloudformation deploy --stack-name btb-crm-app \
  --template-file infra/aws/btb-crm-app.yaml \
  --capabilities CAPABILITY_IAM --profile ziora
```

They are split so that a failure in the app tier cannot roll the database back
out with it. `btb-crm-core` is the VPC, subnets, security groups and Aurora;
`btb-crm-app` is the instance role, EC2, ALB, TLS listener and DNS.

Aurora carries `DeletionPolicy: Snapshot` on purpose — this database holds
client tax profiles and contracts, and losing them to a `delete-stack` typo is
not an acceptable failure mode. The master password is generated straight into
Secrets Manager and never appears in a parameter, a log, or this repo.

There is no ECR repo and no registry push: the instance pulls a source tarball
from S3 and **builds the image itself**, which keeps one ARM container off a
cross-architecture toolchain. Shipping a new build is an upload plus a re-run of
`/opt/btb/deploy.sh` over SSM — the instance is not replaced. Runtime
configuration lives in SSM Parameter Store under `/btb-crm/`, SecureString for
the secrets, read by the instance role at deploy time.

**Parcel data is loaded**: 11,974,053 rows — Florida 11,090,226 across all 67
counties and Montana 883,827 across all 56, scraped fresh from the source rolls.
Two systemd timers on the instance keep it current (`btb-etl-parcels.timer`
monthly for every state, `btb-etl-auctions.timer` nightly). No second machine is
in that path and no long-lived access key exists for it.

**The ETL is not in this repo.** It is its own repo, `btb-etl`, which ships and
schedules itself onto the same EC2 instance. Nothing is shared between the two
beyond the `parcels` table it writes and this app reads. See
[`infra/etl/README.md`](infra/etl/README.md).

Still to do: the nightly `pg_dump` backup, and North Carolina and Colorado have
never been imported. See [`docs/AWS-MIGRATION.md`](docs/AWS-MIGRATION.md) for
the commands and the current state.
