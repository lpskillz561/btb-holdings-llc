# BTB Holdings CRM — working notes

Read `README.md` for the feature map and `docs/AWS-MIGRATION.md` before starting
anything on the AWS build. This file is what is not obvious from the code and
has already cost time.

## Where this came from

Built and run in production inside the Ziora Capital portal, then extracted here
as a standalone app. That original still runs on a Mac Mini and still serves the
marketing site and the `/app` platform; only the CRM moved.

**This repo shares nothing with it.** The last connection was the parcel
importer, which is now its own repo (`btb-etl`) — see the AWS section. If a
piece of history looks odd the original may have context, but nothing here
depends on it, and nothing there should be edited to change this app.

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

**Read `docs/` before writing anything client-facing.** Eight documents define
the business; the code predates them and is more generic than they are. Where the
two disagree, **the documents win**.

**They are NOT in git** — `.gitignore` excludes `docs/*.pdf` and `docs/*.docx`
because they are client legal and tax material, and the deploy tarball excludes
`docs/` for the same reason. A fresh clone will not have them. The table below is
the index of what should be there.

**Restore them from S3:**

```bash
aws s3 cp s3://btb-docs-761540266321/docs/ ./docs/ --recursive --profile ziora
```

That bucket exists only to hold these, and is deliberately separate from
`btb-crm-deploy-761540266321`: the EC2 instance role can read the deploy bucket,
and there is no reason for the web server to be able to read the client's legal
file. Public access is blocked on all four settings, versioning is on, AES256 at
rest, and no bucket policy. Verified: an anonymous GET returns 403.

**Do NOT put them in `ziora-assets`.** That bucket is world-readable by design —
public access block off on all four settings and a policy granting `s3:GetObject`
to `Principal: "*"` — because it serves the marketing site. It is one plausible
`aws s3 cp` away from publishing the memorandum and the executed agreements.

| Document | What it fixes |
|---|---|
| `Memorandum of Law.pdf` | The legal opinion the entire structure rests on. Authorities, tests, and the limits of the position. |
| `Equipment Purchase Agreement 155k.docx` | Sale of the Park Model. Price, deposit, title, arbitration. |
| `Equipment Finance Agreement_155K.docx` | The seller-financed note + Schedule A. Security interest, assignment of rents. |
| `MgmtAgmt_SAMPLE DRAFT.docx` | Management and revenue share. The 50/50 split and the 30-day cap. |
| `PRO FORMA FOR RV300.pdf` | The monthly income model actually shown to buyers. |
| `Frank Aragona Trust…pdf` | The case the material-participation leg depends on. |
| `TC_Memo_2004-188.pdf` | *Shirley* — the transient-lodging case. Adopts Reg. 1.48-1(h)(2)(ii)'s "normally less than 30 days", and *Moore* for "predominant portion" meaning the proportion of **accommodations**, not of renters. Taxpayer won. |
| `Tiny Home Tax Strategy.pdf` | The T3 sales deck. Qualification criteria, the three purchase tiers, and the §461(l) cap. **Sales material, not authority** — and its FULL PURCHASE column is arithmetically wrong ($415k − $135k is $280k, not the $275k shown; its note payment is $1,548.61, not $1,541). The other two tiers are exact. |

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
`economics.ts` caveat and `MAX_AVERAGE_RENTAL_DAYS` in `deal.ts` both say 30 now,
and `BASE_PROMPT` in `ai.ts` spells the two tests out — it used to teach the
7-day one, so every generated proposal described a deal we do not sell.

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

### The house knowledge base — `src/lib/crm/knowledge/SKILL.md`

**Everything above is in the prompt now, and it is in exactly one file.** Every
AI surface — proposal drafting, land fit, the client advisor and the Ask AI panel
on every `/crm` page — is assembled by `buildScopedPrompt` in `ai.ts` as
`BASE_PROMPT` + `SKILL.md` + record context. `BASE_PROMPT` is now only role and
register; the doctrine moved out of it.

That split is the point. The tax case used to be stated twice — once in
`BASE_PROMPT` and once in `docs/` — and the copy in the code taught the **7-day**
§469 test, so every generated proposal described a deal we do not sell. Two
copies that can disagree is the bug. **Add to `SKILL.md`, never to a prompt
string.** Any `.md` in that directory is loaded, in filename order.

- **`docs/` is not deployed, and `SKILL.md` is the substitute.** The PDFs and
  DOCX are excluded from git and from the tarball, so the server has never seen
  them. `SKILL.md` carries what they say. When the two disagree, `docs/` wins and
  `SKILL.md` is wrong — fix it there.
- **`loadSkill()` THROWS when the knowledge is missing**, deliberately. The
  failure it guards is not an outage; it is the model answering confidently from
  its own priors about "tiny home tax strategies" — a 7-day deal, a non-recourse
  note, land the client owns — in prose that goes to a taxpayer and their CPA.
- **`next.config.ts` must keep `outputFileTracingIncludes`.** Nothing imports the
  `.md`, so Next's tracer cannot see it and a standalone build would ship without
  it. Verify after a build: `find .next/standalone -path "*knowledge*" -name "*.md"`.
- `SKILL.md` also records where the source documents contradict *themselves* —
  the pro forma's 70% / 20 nights, its $1,562 against Schedule A's $1,520.83, the
  deck's FULL PURCHASE column, the Management Agreement's "12 months … 2025 to
  2030". The model is told to name those rather than launder them.
- **A conversation is scoped on the row** (`crm_conversations.scope_type` /
  `scope_id`: global, client, proposal, contract) and the prompt is rebuilt from
  the *thread's* scope every turn, not the caller's — reopening a client thread
  from a list page must still answer about that client. There is no `CHECK` on
  that column, so widening `AI_SCOPES` is a code change only.
- There is **no `/crm/contracts/[id]` page**, only `/print`, so the contract
  scope is wired but unreachable from a URL today. Contracts are still fully
  answerable: they are in both the client and the workspace context.

### The client presentation — `/crm/present`

A full-screen deck built to be screen-shared on a call. "Show presentation" on
the Overview opens it; "Present to this client" on a client card opens it with
`?client=` so the title slide carries their name and the terms are sized to the
write-off on their record.

- **It is under `/crm` because that is what gates it.** The middleware matcher is
  `/crm/:path*`. A top-level `/present` would be **public** — the deck names our
  terms, our deposit and our authorities.
- **`lib/crm/presentation.ts` computes every figure** through `deal.ts` and
  `economics.ts`. No money is typed into a slide, so a slide cannot disagree with
  the contract it becomes.
- **It does NOT reproduce the strategy deck's arithmetic.** The tiers are
  computed at `CRM_DEFAULT_DEPOSIT_BPS`, because the deck's own FULL PURCHASE
  column does not reconcile ($1,250,000 − $135,000 is $1,115,000, not the
  $1,110,000 it prints). Nor does it repeat the FAQ's claim that there is "no
  depreciation recapture to plan for" — recapture on an actual sale or conversion
  is on the limits slide.
- **The pro forma is transcribed, not derived.** `PRO_FORMA` in that module is
  the document buyers are actually shown. It bills 20 nights while its heading
  says 70% (20 of 30 is 66.7%), so the slide says "20 billed nights" and does not
  assert an occupancy figure that fails to reconcile.
- **`isClientFacingRoute()` in `lib/crm/routes.ts`** is what keeps `CrmChrome` and
  `AskAi` off this route and off `/print`. It replaced two copies of
  `endsWith("/print")`; the cost of missing one is our internal tooling appearing
  in a prospect's screen share.
- **Chart colour was validated, not chosen.** The accent `#b08a2c` and the
  neutral ramp in `components/present/Charts.tsx` were run against the navy
  surface — the brand's `gold-500` fails the lightness band there and reads
  washed out when projected, which is why marks use a different gold from the
  rules and eyebrows.
- **The canvas is fixed at 16:9 and scaled, never reflowed** (`.deck-canvas`,
  `cqw` units). A deck that reflows shows the presenter and the room different
  line breaks.

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

**A gated page now returns a real 404 — this changed.** It used to answer 200
while the not-found UI streamed in, because `loading.tsx` put a Suspense
boundary above the page and the headers were flushed before `notFound()` was
reached. Deleting that boundary (see the `next/link` note below) removed the
early flush, so the status is set properly. Measured against production with a
forged session for an address not in `CRM_ADMINS`: `/crm`, `/crm/proposals`,
`/crm/contracts`, `/crm/land` and `/crm/admin` all answer **404**, and a
CRM user who is not a superuser gets 200 on the first four and 404 on
`/crm/admin`.

Still **assert on the rendered body as well**. The status is now meaningful, but
the page `<title>` is emitted even on the not-found page — an assertion that
greps for "Client CRM" passes against a *blocked* response and reads as a
security hole that isn't there. Match on body copy that only the real page has.

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

**Every timestamp column is `TEXT`, not `TIMESTAMPTZ`** — an ISO string, per
`TS_DEFAULT`. This is not cosmetic. Declaring one new column `TIMESTAMPTZ` while
`updated_at` beside it is `TEXT` makes Postgres refuse any statement that binds
one parameter to both: `inconsistent types deduced for parameter $2`, a 500 at
request time that `tsc` and `next build` cannot see. Match the convention.

**Constraint violations are translated to 4xx** in `lib/crm/rest.ts`. A
duplicate pad label used to surface as a 500 "Something went wrong", which is
indistinguishable from an outage and useless to someone who typed "A-01" twice.
`23505` → 409, `23514`/`23503`/`23502` → 400.

**The deal is sized from the write-off, and it is FINANCED.** A client says they
need to shelter $1m, so the unit is priced at $1m, the deposit is
`CRM_DEFAULT_DEPOSIT_BPS` (10%) of the investment and the balance is a 0% note
over 720 months — imported from `deal.ts`, never restated, so a proposal and the
note it becomes cannot disagree. The deduction is on the full basis while only
the deposit is cash: that is the 10:1. **The deposit tracks the price** until
someone types their own; freezing it is exactly how the ratio drifts while the
form still looks right. **Zero deposit means UNFINANCED, not 100% financed** —
getting that backwards quoted "cash down $0, seller-financed $102,000".

**The sources disagree on the deposit, and 10% is a business decision.** The
strategy deck says "13% Down" and "~9 plus X" leverage; its own three tiers are
10.8%, 12% and 11%; the executed agreements in `docs/` are $155,000 on
$1,250,000 = 12.4% and 8.06:1. The business has settled on **10%**. It is
configuration, not a constant, so reconciling it later is an SSM write.

**LAND NEVER REACHES A CLIENT.** BTB owns the ground; the client buys only the
home on a pad. The proposal generator has no land input at all — it was never
depreciable, so carrying it only inflated the investment against an unchanged
deduction. What the land cost *us* is split across the sections a park was
stated to carry (`planned_pad_count`) and shown on the park page and client card
marked internal. **Divide by the STATED capacity, not the pads that exist**, or
every client's share lurches as pads are built.

**Two caveats are load-bearing and must not be dropped.** A deduction many times
the cash only works because the note is **recourse** — §465 would otherwise limit
it to the deposit and the leverage collapses. And **§461(l)** caps business loss
against other income (~$313k/$626k for 2025, ~$325k/$650k for 2026), with the
excess carried forward; the deck names this itself, so a first-year benefit
quoted without it is a figure the deck already qualifies. The lender **forbears**
when rent misses the note — the owner does *not* fund the gap; saying otherwise
describes a different deal.

**Archive, never delete, for proposals and contracts.** `archived_at` /
`archived_by`, deliberately NOT a status value: status says where a document
stands, and folding "archived" in would erase that a withdrawn proposal had been
*accepted*. Archived rows leave every list **and every total** — and filtering
only the page queries is not enough, because the REST collections are the same
data by another door (`listProposals`, and `archivable` in `resource.ts`).

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
route and a 403 from the API — **registration does not grant CRM access.**

**Signing in and CRM access are different gates, and the sign-in flow must not
pretend otherwise.** `safeNext()` in both `login/page.tsx` and
`register/page.tsx` used to default to `/crm`, so someone who had just
registered — with a valid `REGISTRATION_CODE`, i.e. an invited person — finished
the form and was shown a **404**. That reads as a broken site, and it is how the
problem was reported.

They now default to **`/welcome`**, which self-gates (it is outside the
middleware matcher): no session → `/login`; access → `/crm`; otherwise an
"access is enabled separately" page. So an admitted user pays one redirect and
nobody in the normal flow meets a bare 404. A **deep link** (`?next=/crm/...`)
is still honoured verbatim, because there the 404 is exactly the point.

**The 404 itself did not change and must not.** An account without access should
not learn what lives at `/crm`. `/welcome` names no part of the CRM.

**There is no in-app way to grant access.** `/crm/admin` can block, unblock,
reset and remove, but the allow-list is an env var — admitting someone is a
write to `/btb-crm/CRM_ADMINS` **plus a redeploy**. The admin screen now says so,
and shows an "Awaiting access" badge and count (`emailHasCrmAccess` in
`access.ts`), because previously nothing on that screen distinguished a working
account from one that 404s everywhere, and the only way to find out was for the
user to complain.

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

**`ziora` is an ALIAS of `default` on this machine**, not a separate identity:
both sections hold the same long-lived key for IAM user `jarrett`. It exists
because every command in this file, `README.md`, `docs/AWS-MIGRATION.md` and
`infra/etl/README.md` is written `--profile ziora`, and only `default` was
configured — so all nine of them failed with "config profile could not be
found". `source_profile = default` does **not** work for this: without a
`role_arn` there is nothing to assume, and the CLI reports `NoCredentials`
rather than falling back.

The cost is that the key is in **two places**. Rotating it means writing both
`[default]` and `[ziora]`, and missing the second is silent until the next
deploy fails to authenticate.

Live at **https://btbholdingsllc.com**. `btb-crm-core` (VPC, subnets, security
groups, Aurora 17.10 Serverless v2) and `btb-crm-app` (instance role, EC2 ARM,
ALB, listeners, Route53) are both up; the ACM cert is issued. See
`docs/AWS-MIGRATION.md` for how to ship a build and where to find logs.

Not built yet: the parcel data itself, and the nightly backup.

**The importer is its OWN REPO: `btb-etl`** (`~/Documents/Ziora/btb-etl`). It
owns its source, its `run-etl.sh`, its four systemd units and its own
`ship.sh`, and it deploys itself to the same EC2 instance on its own cadence —
it does not ride this app's deploy. Its `CLAUDE.md` carries the ETL traps.

It used to live in `ziora-capital-holdings/etl/`, shared with a research tool on
the Mac Mini, and **that link is cut**. The coupling was invisible from both
ends: a commit over there silently changed what this production database
ingests, with nothing in either repo to say so. There is now exactly one
importer feeding this Aurora. Do not re-introduce a shared checkout, a submodule
or a symlink, and do not vendor it here.

**The one contract that remains is the `parcels` table.** `lib/common.mjs` in
`btb-etl` defines the columns; `src/lib/parcels.ts` here selects them by name.
Adding a column is safe. Renaming or dropping one is a breaking change to this
app, so search this tree first. Note there is **no zoning column and never has
been** — `dor_uc` is the assessor's *use* code, which is a different thing from
what a jurisdiction permits.

`etl/import.mjs` in the notes below means `btb-etl/import.mjs`. The traps
themselves now live in that repo's `CLAUDE.md`; what is kept below is only what
this app's operators still need to know.

**EC2 schedules it itself, and the Mini is OUT of this path entirely.** Two
systemd timers do the whole job with no second machine and no long-lived access
key: `btb-etl-parcels.timer` (monthly, matching how assessment rolls are
republished) and `btb-etl-auctions.timer` (nightly, since auctions move daily).
The n8n dispatch path is gone — the workflows, `run-etl-on-ec2.sh` and the
`btb-n8n-mini` IAM user with its access key are all deleted. The key had never
been used. `BtbRunEtl` is kept as a narrow manual-dispatch primitive; with no
principal holding a key to it, an unused document is not a standing risk. The
Mini still serves the marketing site, `/app` and the research tool, which is why
the ETL is still shared — see `infra/etl/README.md`.

**The parcel timer runs `btb-etl@ALL.service`, not one state.** It used to name
`btb-etl@MT.service`, so the monthly refresh silently covered Montana alone —
Florida, North Carolina and Colorado would have gone stale forever while the
timer reported success. A per-state unit that is *also* the scheduled unit is a
trap: it looks fine and does a fraction of the work.

**FDOR rotates the Florida roll folder, so it must not be pinned.** The portal
keeps only the current roll under `.../NAL`; `2025F` is gone and `2026P` is
there now. A pinned `ROLL_YEAR`/`ROLL_TYPE` is a bug with a one-year fuse and a
quiet one — the SharePoint API still answers 200, the listing is just empty,
discovery returns zero files and the import dies with "No rows loaded" that
explains nothing. Unset, `discoverNalFiles` now takes the newest populated roll
and logs which one it used. **Also: the county number in the filename is
optional.** FDOR ships `Broward Preliminary NAL 2026.zip` with no number, and a
regex requiring one silently dropped Florida's second-largest county — 754,549
parcels, 66 files of 67, no warning. It cannot corrupt anything, because a
parcel's `co_no` comes from the CSV's own column, not the filename.

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
- `parcels` is loaded and land search works: **11,974,053 rows** — Florida
  11,090,226 (all 67 counties, roll 2026P) and Montana 883,827 (all 56). Scraped
  fresh by the ETL rather than dumped from the Mini. `auctions` has not been
  built yet, and NC and CO have never been imported.
- The AI surfaces are **live**. `OPENAI_API_KEY` is in SSM as a SecureString and
  `OPENAI_MODEL` is `gpt-5.6-luna`; the advisor was exercised end to end against
  a real client record. Both are runtime-only, so changing either is an SSM
  write plus a redeploy, not a rebuild. **Verify a new model before setting it**
  — `GET /v1/models/<id>` with the key, then one `json_schema` completion. A
  wrong name is accepted by SSM and by the deploy, and only fails at request
  time, on all three surfaces at once.
- No test suite. The closest thing is the browser pass described above, which
  currently lives outside the repo.
