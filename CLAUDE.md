# BTB Holdings CRM — working notes

Read `README.md` for the feature map and `docs/AWS-MIGRATION.md` before starting
anything on the AWS build. This file is what is not obvious from the code and
has already cost time.

## Where this came from

Built and run in production inside `ziora-capital-holdings` (the Ziora Capital
portal, `web/`), then extracted here as a standalone app. That original still
runs on a Mac Mini and still serves the marketing site and the `/app` platform;
only the CRM moved.

If something looks odd, the original may have context: `~/Documents/Ziora/
ziora-capital-holdings`, and its `CLAUDE.md`.

## Testing — curl is not enough

Two bugs shipped green through `curl`, `tsc` and `next build`. Failures here
concentrate in the **server/client boundary** and in **perceived latency**, and
a status code shows neither.

- A dashboard card looked like a dead link. `curl` returned 200 because it does
  a **hard** navigation; the failure only existed in `next/link`'s client-side
  path, where `preventDefault()` suppresses the browser's loading indicator and
  a 3-second server render is indistinguishable from nothing happening.
- `statusTone()` was exported from a `"use client"` module and called by server
  components. Builds fine, 500s at request time on every page that does it.

Drive a real browser (Playwright, `chromium.launch({ channel: "chrome" })` —
Chrome is installed, no download needed), log in, click the thing, assert on the
resulting URL *and* the console. Wait **≥4s** before concluding a click did
nothing; 2.5s produced a false negative.

## Gotchas that have already cost time

- **A server component may not CALL a function exported from a `"use client"`
  module.** It may only render one. This is why `statusTone` lives in
  `lib/crm/tone.ts` and not beside `<Badge>` in `components/crm/ui.tsx`.
- **`sum(bigint)` returns `NUMERIC`**, and node-postgres returns `NUMERIC` as a
  **string**. Money aggregates need `::bigint` or they arrive as `"0"`, fail
  `Number.isFinite`, and render as `—`. The `INT8` parser in `lib/db.ts` only
  covers plain `BIGINT` columns.
- **Newer OpenAI models reject any non-default `temperature`** with a 400 that
  takes the whole request with it. Never send one.
- **`next/link` hides slow renders.** Any new `force-dynamic` route that can be
  slow needs a `loading.tsx` — see `app/crm/loading.tsx`.
- **EC2 rejects non-ASCII in security group descriptions.** An em dash in a
  CloudFormation `GroupDescription` rolled the whole stack back.
- **`AUTH_SECRET` is frozen into the Edge middleware at build time.** It must be
  identical as a build arg and at runtime, or every session silently fails to
  verify.

## Invariants — breaking these causes real bugs

**Money is `BIGINT` cents**, rates are basis points. `lib/crm/format.ts` is the
only place that divides by 100. Forms hold whole dollars/percents under the
API's own column names; the coercers in `lib/crm/db.ts` convert.

**`lib/crm/schema.ts` is the only migration mechanism.** It runs on first query
(`ensureAppSchema`). A new column must be nullable or have a default. Enum
`CHECK`s are generated from `lib/crm/types.ts`, so the two cannot drift.

**Proposal economics are computed in code and frozen on the row.** The model
gets them as given facts and never calculates. The economics columns are not
patchable. If you add a figure to a proposal, add it to `lib/crm/economics.ts`,
not to a prompt. The audience is a taxpayer and their CPA.

**Cost basis and cash are never added together.** `CostBasis` is asset cost;
`FinanceSummary` is cash movement. Summing them double-counts every deal.

**PATCH semantics.** Absent key → leave alone. Explicit `null` → clear. Owning
`client_id` is fixed at creation.

**Auth is enforced per route under `/api`** — it is outside the middleware
matcher, so `withCrm`/`withCrmParams` in `lib/crm/rest.ts` is the only gate.
`CRM_ADMINS` unset means every signed-in user has access.

**Legacy `scrypt:` password hashes** still verify and are upgraded to PBKDF2 in
place on the next successful sign-in. Do not remove that path until
`portal_users` has no `scrypt:` rows left.

## AWS

Account `761540266321`, region `us-east-1`, profile `ziora`. **Never accept
pasted access keys** — use the configured CLI profile.

Provisioned: `btb-crm-core` (VPC, subnets, security groups, Aurora PostgreSQL
17.10 Serverless v2), and an **issued** ACM certificate for
`btbholdingsllc.com` + `www`.

Not built yet: the app stack (IAM instance role, EC2, ALB, listeners, Route53
alias), the `pg_dump` of parcels into Aurora, and n8n.

## Open items

- The source Postgres on the Mini (12 GB, includes client tax profiles) **has no
  backup**. Whatever happens with AWS, that gap is real today.
- No test suite.
