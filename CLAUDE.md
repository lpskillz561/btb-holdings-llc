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

## Who owns what — this changed, and the code predates it

**BTB owns the land. The client buys only the home.** A client's home stands on
a *pad* in a BTB *park*; they never own ground. This matches the Management
Agreement in `docs/`, which places the unit "on vacant improved land" that the
Agent manages.

- `crm_parks` — land BTB owns. **No `client_id` at all.**
- `crm_pads` — numbered sites within a park. The unit of capacity: remaining
  capacity is available pads, and a client's footprint is their pad's square
  footage against the park's acreage.
- `crm_units.pad_id` — where a home actually stands. `crm_units.client_id` is
  now **nullable**, and NULL means *BTB owns this home* and rents it on its own
  book. The dashboard splits the two books on exactly that.

**`crm_properties` is legacy** — client-owned land, from the old model. It was
not reused for parks and must not be: its `client_id` carries `ON DELETE
CASCADE`, so putting BTB's land there would mean deleting a client deletes the
ground under every other client's home.

`lib/crm/portfolio.ts` owns these queries. Money aggregates there are cast
`::bigint` for the reason in the gotchas below.

**Occupancy is 70%** (`CRM_DEFAULT_OCCUPANCY_BPS=7000`), down from an 85%
default that nothing supported. Note the pro forma in `docs/` is internally
inconsistent — it is headed "70% occupancy" and then bills 20 nights, which is
66.7%. The model uses the stated rate and derives nights from it.

## The deal — `docs/` is the source of truth

**Read `docs/` before writing anything client-facing.** Six documents define the
business; the code predates them and is more generic than they are. Where the
two disagree, **the documents win**.

**They are NOT in git** — `.gitignore` excludes `docs/*.pdf` and `docs/*.docx`
because they are client legal and tax material, and the deploy tarball excludes
`docs/` for the same reason. A fresh clone will not have them; get them from the
owner. The table below is the index of what should be there.

| Document | What it fixes |
|---|---|
| `Memorandum of Law.pdf` | The legal opinion the entire structure rests on. Authorities, tests, and the limits of the position. |
| `Equipment Purchase Agreement 155k.docx` | Sale of the Park Model. Price, deposit, title, arbitration. |
| `Equipment Finance Agreement_155K.docx` | The seller-financed note + Schedule A. Security interest, assignment of rents. |
| `MgmtAgmt_SAMPLE DRAFT.docx` | Management and revenue share. The 50/50 split and the 30-day cap. |
| `PRO FORMA FOR RV300.pdf` | The monthly income model actually shown to buyers. |
| `Frank Aragona Trust…pdf` | The case the material-participation leg depends on. |

### The structure

Not "a client buys a tiny home." The chain is:

```
Buyer (high-income taxpayer)
  └── settles an irrevocable GRANTOR TRUST, funded with cash
        └── owns 100% of a SERIES of a Nevada series LLC (one Series per unit)
              └── owns the PARK MODEL
        trustee of the Trust = the MANAGEMENT SERIES (the master entity)
```

Every leg is load-bearing:

- **Grantor trust**, so deductions land on the buyer's own return.
- **One Series per Park Model**, so liability and basis stay per-unit.
- **The Note is guaranteed by and recourse to the Trust.** That is what creates
  at-risk basis under §752 and lets the loss actually be used. A non-recourse
  note breaks the deduction — this is not a formality.
- **The Management Series is the trustee**, which is how material participation
  is established. It is also the manager. That overlap is deliberate.

### The numbers, from the executed example

| | |
|---|---|
| Purchase price | **$1,250,000** |
| Down payment | **$155,000**, wired before delivery |
| Financed | **$1,095,000** |
| Interest | **0%** |
| Term | **720 monthly payments** of **$1,520.83** (60 years) |
| Revenue split | **50/50** to Agent and Owner, after operating expenses |
| Optional GAP | $2,000/year |
| Transport | Beyond 1,000 miles, $10/mile |

The pro forma quotes $300/night at 70% occupancy: $6,000 revenue, $1,562 debt
service, $2,219 operating, then the $2,219 remainder split 50/50 — **$1,109.50
to the owner**. Note the debt payment comes off the top, *before* the split.

### The tax case, and exactly what supports it

1. **Bonus depreciation.** A Park Model gets a state VIN as a trailer/RV, which
   makes it 6-year MACRS property (Rev. Proc. 87-56, Asset Class 00.27) and
   therefore §168(k) qualified property. OBBBA permanently restored 100% bonus
   for property placed in service on or after **20 January 2025**.
2. **The lodging exclusion, and its escape hatch.** §50(b)(2) bars property used
   predominantly to furnish lodging. §50(b)(2)(B) and Reg. 1.48-1(h)(2)(ii)
   except transient use — rentals **normally under 30 days**. *Moore* and
   *Shirley* are the cases.
3. **Not passive.** The trustee materially participates, and that status imputes
   to the Trust and through to the grantor. *Frank Aragona Trust* (142 T.C. 165)
   and *Mattie K. Carter*; PLRs 201317010 and 201029014.

**The two day-counts are different tests and must not be conflated.** The
**30-day** figure is the transient-lodging exception that makes the asset
*eligible* at all. The familiar **7-day** short-term-rental figure is the §469
material-participation route — which this structure does **not** rely on,
because it establishes participation through the *trustee* instead. The
`short_term_rental` caveat in `lib/crm/economics.ts` still says "seven days or
less"; against this structure that is the wrong test and should say 30.

### Rules that follow

- **Contract text is a template, never model-generated.** The same rule that
  governs proposal economics governs legal prose, and harder: a model that
  rephrases an arbitration clause or a security interest has changed the deal.
  The model may draft a cover letter. It may not draft a term.
- **The three execution documents are one set.** Purchase, Finance and
  Management are cross-referenced — the Finance Agreement is Exhibit A to the
  Purchase Agreement. Generating one alone produces an unexecutable deal.
- **`MH SERVICES LLC` is the counterparty named throughout** as Seller, Creditor
  and Agent. It is *not* BTB Holdings. Do not silently substitute one for the
  other; the party names belong in configuration.
- **Every figure that reaches a document comes from `lib/crm/economics.ts`**, and
  the price/deposit/note/term/split above are deal terms, not assumptions — they
  belong on the row, frozen, like proposal economics already are.

### How that is built

`POST /api/crm/contracts/generate` writes all three at once, sharing a
`deal_group_id`, printed together at `/crm/contracts/[id]/print`.

- `lib/crm/deal.ts` — the terms. **Structure fixed, price varies:** 0%, 720
  months and the 50/50 split are constants because the memorandum's
  economic-substance reasoning is built on that shape. The monthly payment is
  derived, so Schedule A cannot disagree with the note. It also reports the
  rounding drift — 720 × $1,520.83 is **$2.40 short** of $1,095,000, which the
  sample Schedule A does not mention and a CPA will find.
- `lib/crm/parties.ts` — who is named. **BTB Holdings stands where the samples
  said MH Services**, which moved the wire instructions and the trustee role
  with it. Everything is `CRM_SELLER_*` / `CRM_WIRE_*` configuration, and
  generation **refuses outright** while the wire block is unset rather than
  emitting a document with a placeholder account number.
- `lib/crm/contract-templates.ts` — the legal text, transcribed. Not generated,
  and the frozen columns are absent from the PATCH allow-list in `resource.ts`.
- Print with `<Markdown variant="document">`. The default components flatten
  `h1`/`h2`/`h3` to one weight, which suits the AI panels they were written for
  and makes a contract unnavigable.

## Two looks, on purpose

**Internal screens are Salesforce Lightning. Client documents are not.**

- The CRM staff work in — every `/crm` page, `components/crm/ui.tsx`, the nav —
  uses the `sf-*` / `ink-*` palette in `tailwind.config.ts` and the `.sf-*`
  classes in `globals.css`. Lightning blue `#0176d3`, grey page, white cards,
  compact tables. The grey is load-bearing: `.sf-card` has no shadow and gets
  its lift from the contrast.
- **Proposals, contracts and every `/print` route keep the navy/gold serif
  brand.** They go to a taxpayer and their CPA, where "private bank" is worth
  more than "familiar software". `ui.tsx` is imported by no print page, which is
  what makes the split cheap to maintain — restyle it freely.

Two traps this arrangement sets:

- **Headings default to SANS now.** The base layer used to force `font-serif` on
  every `h1`-`h4`; a descendant rule like `.sf-page h1 { font-sans }` would then
  have beaten an explicit `font-serif` utility on the element, which is a
  specificity argument you cannot win. So the default flipped and the documents
  opt back in with `font-serif`. If a document heading comes out sans, it is
  missing that class.
- **`/crm/*/print` is nested inside `app/crm/layout.tsx`** and therefore inside
  `.sf-page`, whose grey background would otherwise print. `@media print` forces
  it white — keep that rule if you touch the layout.

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

**A gated page returns HTTP 200, not 404.** `getCrmPageUser()` → `notFound()`
works — an unauthorised visitor sees the 404 page and no data reaches them — but
these routes are `force-dynamic`, so the response headers are flushed before
`notFound()` is reached and the status stays **200** while the not-found UI
streams in. Asserting on the status code alone concludes the page is wide open
when it is not. Assert on the rendered body.

**Do not use a fixed sleep after a deploy — wait on the destination.** The first
navigation against a freshly restarted container took **~9 seconds**, and a
4.5s sleep reported "login failed" three times running against an app that was
working perfectly. `await page.waitForURL("**/crm", { timeout: 30000 })` instead.
Note that `/api/health` will *not* warm it: that route deliberately never
touches the database, so the first real request still pays for the whole of
`ensureAppSchema`.

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
- **`next/link` hides slow renders**, because `preventDefault()` suppresses the
  browser's own loading indicator. The CRM answers that with
  `components/crm/NavProgress.tsx` and deliberately has **no `loading.tsx`**.
  Adding one back would undo it: a loading file is a Suspense fallback, so it
  throws the page you are reading away the moment you click, and on a slow
  dynamic render that *is* the blank screen. With no boundary the router keeps
  the current page up until the next one is ready.
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
`CHECK`s are generated from `lib/crm/types.ts`, so the two cannot drift. There
is also an `alters` escape hatch per table for the one thing the other three
mechanisms cannot express — relaxing a constraint on a column that already
exists, since `ADD COLUMN IF NOT EXISTS` is a no-op once the column is there.
Every statement in it must be safe to re-run on every boot.

**Constraint violations are translated to 4xx** in `lib/crm/rest.ts`. A
duplicate pad label used to surface as a 500 "Something went wrong", which is
indistinguishable from an outage and useless to someone who typed "A-01" twice.
`23505` → 409, `23514`/`23503`/`23502` → 400.

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
`CRM_ADMINS` unset means every signed-in user has access. With it set, a
newly-registered account can sign in to the portal but gets a 404 on every CRM
route and a 403 from the API — registration does not grant CRM access.

**Legacy `scrypt:` password hashes** still verify and are upgraded to PBKDF2 in
place on the next successful sign-in. Do not remove that path until
`portal_users` has no `scrypt:` rows left.

**There are two kinds of account, and the env kind wins.** The login route
checks `AUTH_USERS` (from the environment) *before* `portal_users`. So
`info@ziora.io` is **not a row** — blocking or deleting it in the database would
appear to work and change nothing, which is why `lib/crm/admin.ts` refuses those
operations outright and points at `/btb-crm/AUTH_USERS` instead. Anything
reasoning about "who can sign in" must count both sources; the lockout guard
initially counted only the table and refused to delete the last registered user
while a perfectly usable built-in account existed.

**`CRM_SUPERUSERS` fails closed** — unset means *nobody* administers accounts.
It falls back to `CRM_ADMINS`, but never to "everyone", unlike `CRM_ADMINS`
itself. A missing env var must not hand account control to whoever registers
next. `getSuperUser()` / `requireSuperUser()` in `lib/crm/access.ts`.

**Blocked accounts are rejected *after* the password check** in
`verifyPortalUser`, so a blocked account is indistinguishable from a wrong
password. Telling an attacker "that account exists but is suspended" is free
reconnaissance.

## AWS

Account `761540266321`, region `us-east-1`, profile `ziora`. **Never accept
pasted access keys** — use the configured CLI profile.

Live at **https://btbholdingsllc.com**. `btb-crm-core` (VPC, subnets, security
groups, Aurora 17.10 Serverless v2) and `btb-crm-app` (instance role, EC2 ARM,
ALB, listeners, Route53) are both up; the ACM cert is issued. See
`docs/AWS-MIGRATION.md` for how to ship a build and where to find logs.

Not built yet: the parcel data itself, and the nightly backup.

**The importer is a SCRIPT, and EC2 now schedules it itself.** `etl/import.mjs`
does the work; the three n8n workflows were only ever a scheduler that SSHes in,
runs one command and checks the exit code. Two systemd timers on the instance do
the same job with no second machine and no long-lived access key:
`btb-etl-parcels.timer` (monthly, matching how assessment rolls are republished)
and `btb-etl-auctions.timer` (nightly, since auctions move daily). The Mini is
now optional.

**The ETL can also be dispatched from the Mini's n8n over SSM.** Aurora is
private and the Mini cannot reach it, so n8n keeps the schedule and the app
instance does the work — see `infra/etl/README.md`. Dispatch uses a narrow
custom SSM document (`BtbRunEtl`) rather than `AWS-RunShellScript`, because the
Mini holds a long-lived access key and that key should buy "run the importer",
not "root shell on the app server".

Things about that deployment that are not visible from the code:

- **The ALB health check target is `/api/health`, and that route exists only for
  it.** Every other path in this app either redirects (`/` and `/crm`) or 401s,
  and no 200-matcher health check can pass a redirect. It is deliberately not
  wrapped in `withCrm` and deliberately does not touch the database: there is
  one instance behind that load balancer, so failing the check during a database
  blip takes the site down instead of shifting traffic anywhere.
- **The image is built on the instance**, from a tarball in S3 — there is no ECR
  repo. `/opt/btb/deploy.sh` is the whole deploy: re-run it over SSM, don't
  replace the instance.
- **Every SSM parameter under `/btb-crm/` becomes an env var of the same name.**
  Adding configuration is an SSM write plus a redeploy — no CloudFormation
  change. A value containing a newline is skipped with a warning rather than
  written, because `docker --env-file` reads to end of line and one newline
  would silently drop every variable after it.
- **Only ONE parcel import may run at a time.** `import.mjs` loads into a single
  shared `parcels_staging` table and then swaps one state's rows out of it, so
  two states at once interleave and swap each other's data. `run-etl.sh` takes an
  `flock` on `/var/lock/btb-etl.lock`; a second state waits rather than corrupts,
  which also makes queueing the next state just a matter of starting it.
- **A wedged import looks exactly like a slow one, and used to stay wedged for
  hours.** MT once sat two hours having loaded nothing, holding an open `COPY
  parcels_staging` whose lock blocked two later imports and made the table
  unreadable — `systemctl` said `activating` throughout. Three faults had to
  line up, and the middle one is the trap: `importState`'s `catch` opens with
  `ROLLBACK`, but the connection was still in COPY-in mode, where the server
  wants `CopyData`/`CopyFail` and will not answer a new query. **The error
  handler hung on its own first statement**, so the `ERROR:` line explaining any
  of it never printed. Fixed in the ETL repo: `lib/http.mjs` puts a deadline on
  every request (armed over the *body* — `fetch()` resolves at the headers, so a
  timeout around the call alone still lets `res.json()` hang), the COPY is
  destroyed on failure so the lock goes immediately, and a stall watchdog aborts
  any load that goes 15 minutes without a row. **Diagnose from
  `pg_stat_activity`, not the unit state**: a `COPY` sitting in
  `Client/ClientRead` with a two-hour `xact_start` is the signature.
- **Check the source host before assuming the ETL is broken.** `gisservicemt.gov`
  in the MT adapter was NXDOMAIN from every resolver — a long-standing typo for
  `gisservice.mt.gov`, whose service has since moved to `msdi_cadastral_map_v1`
  with parcels on **layer 1** (layer 0 is conservation easements, layer 2 is
  public lands, so a careless port imports the wrong features rather than
  failing). `getent hosts` on the instance is the thirty-second check.
- **`systemctl is-active --quiet` is FALSE for a running oneshot.** A long
  `Type=oneshot` sits in `activating` for its whole life, and `--quiet` only
  succeeds on `active` — so a "wait for the import to finish" loop written that
  way fires immediately. This started a second import twice. Watch the process
  (`pgrep -f "node import.mjs"`), not the unit state.
- **Deploying the app stack can REBOOT the instance and kill a running ETL.**
  A `UserData` change was applied by stopping and starting the instance rather
  than replacing it: same instance id, but `/tmp` cleared, containerd restarted
  and a parcel import that had been running for 18 minutes died silently. The
  SSM command that launched it still reported `InProgress` long after the
  process was gone, so *check the process, not the job status*. Run long imports
  through **systemd** (`systemctl start --no-block btb-etl@MT.service`), which
  survives an SSM session, and do not deploy while one is in flight.
- **Changing `UserData` does NOT re-run it on the existing instance.** This one
  cost time: CloudFormation reported `UPDATE_COMPLETE`, kept the same instance
  id, and cloud-init runs user-data only once per instance — so `deploy.sh` on
  the box stayed on the old version while the template said otherwise. To apply
  a UserData change in place:
  `bash /var/lib/cloud/instance/scripts/part-001` over SSM. It is idempotent.
- **`AUTH_SECRET` lives in SSM at `/btb-crm/AUTH_SECRET`** and `deploy.sh` passes
  it *both* as a Docker build arg and into the runtime env, because of the Edge
  middleware freeze above. Changing it in SSM requires a **rebuild**, not a
  restart — and the script refuses to build if it is empty, which is the only
  loud failure available for a secret whose mismatch is otherwise silent.
- **Aurora is reached with `sslmode=verify-full`**, and the RDS CA bundle is
  bind-mounted into the container at `/etc/ssl/rds-ca.pem`. Drop that `-v` from
  the `docker run` and every query fails certificate verification.
- **`app.env` is written for the CONTAINER.** The RDS CA bundle is bind-mounted
  at `/etc/ssl/rds-ca.pem` inside it and lives at `/opt/btb/rds-ca.pem` on the
  host. Anything running on the host with that `DATABASE_URL` — the ETL does —
  must rewrite the `sslrootcert` path or it dies with `ENOENT` on the
  certificate before opening a connection.
- **`next build` needs the swapfile** that the bootstrap adds. A `t4g.medium` has
  4 GB, and an OOM kill mid-build reads as a hung deploy, not an error.

## Open items

- The source Postgres on the Mini (12 GB, includes client tax profiles) **has no
  backup**. Whatever happens with AWS, that gap is real today. The S3 bucket,
  lifecycle rule and instance permission for it now exist; the cron job does not.
- Aurora holds only the CRM's own tables so far. `parcels` and `auctions` have
  not been dumped across, so land search returns nothing there.
- `OPENAI_API_KEY` is not set in SSM, so the three AI surfaces show their
  disabled notice. It is runtime-only — setting it needs a redeploy, not a
  rebuild.
- No test suite. The closest thing is the browser pass described above, which
  currently lives outside the repo.
