# BTB Holdings CRM — working notes

Read `README.md` for the feature map and `docs/AWS-MIGRATION.md` before starting
anything on the AWS build. This file is what is not obvious from the code and
has already cost time.

## Where this came from

This CRM was extracted from an earlier in-house portal and is now a standalone
app. **It shares nothing with anything else.** The last shared component was the
parcel importer, and it is now `etl/` in this repo — see the AWS section.

Two consequences worth stating plainly, because both have caught people out:

- Some code predates the current business model and is more generic than the
  deal actually sold. Where this file and the code disagree, this file is the
  newer fact — see "Who owns what" below.
- Nothing outside this repo and `btb-etl` can change this app's behaviour. If a
  bug looks like it came from somewhere else, it didn't.

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

**`unit_use` is `transient_rental`, and there is no `short_term_rental`.** The
value was renamed and the default moved off `long_term_rental`, because that
default was the single answer that breaks the lodging exception — every unit or
proposal recorded without a deliberate choice argued against its own tax
position, and the model dutifully flagged the contradiction on every draft. Two
values named for two different day-counts is an invitation to pick the wrong
one, so there is one and it is the accurate one. Existing rows are migrated by
an `alters` entry on `crm_units` — and that entry **drops the CHECK first**,
because `alters` run before the constraint is re-derived but the OLD constraint
is still live, so the UPDATE would otherwise fail `23514`, `ensureAppSchema`
would throw, and the app would answer 500 to everything.

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
  with it. Everything is `CRM_SELLER_*` / `CRM_WIRE_*` configuration.

  **THERE IS NO BANK ACCOUNT YET, so generation no longer refuses — it marks.**
  It used to throw while the wire block was unset, which was right when the only
  reason to generate was to send, and wrong when the workflow needs exercising
  before a bank exists. A set generated without it carries
  `not_for_execution = true`, `config_issues` naming what was missing, a leading
  warning, and a red **NOT FOR EXECUTION** banner on the contract page and — the
  one that matters — **inside the printed packet**, because the PDF is what
  reaches a counterparty and a warning that vanished on paper would be useless.

  What makes that safe is that the hazard was never a *missing* wire block, it
  was a *plausible* one. `missing()` renders unset fields as
  `[[ SET CRM_WIRE_ACCOUNT_NUMBER ]]` — nobody types that into a bank. A blank
  line or a zero would be the dangerous version, so do not "tidy" it.

  **The flag is stored, not recomputed.** Configuring the environment later does
  not make an already-generated document safe: the copy someone downloaded still
  carries the marker. Set the values, then generate a fresh set.

  **TODO once the bank account exists:** set `CRM_SELLER_ADDRESS1/CITY/STATE/
  POSTAL`, `CRM_SELLER_SIGNATORY`, and `CRM_WIRE_BANK_NAME/BANK_ADDRESS/
  ACCOUNT_NUMBER/ROUTING_NUMBER` in SSM under `/btb-crm/`, redeploy, and
  regenerate any set that is still `not_for_execution`.
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
- **There are TWO decks and ONE set of slides.** `lib/crm/decks.ts` holds the
  catalogue; a *track* is nothing but an ordering of slide ids over the single
  array in `slides.tsx`. **Never add a second slide module** — two files quoting
  the same money drift the first time a figure changes, which is the same rule
  that put every figure in `presentation.ts` to begin with. A track naming a
  slide that does not exist **throws** in `buildSlides` rather than silently
  rendering 7 of 8.
  - `full` — all 17 slides. The follow-up call, and the call the CPA joins.
  - `first-call` — 8 slides, and it **reorders**: the leverage slide moves ahead
    of the structure and the authorities. On the full deck the room sits through
    six slides of doctrine before a single number, which is the pacing complaint
    that produced the track. The limits slide is **trimmed, not cut** — three of
    its six items (§461(l), recapture, placed-in-service) survive. A short deck
    that drops its own caveats is a worse deck, not a shorter one.
  - The `"terms|sizes"` position resolves to the terms slide when the deck is
    sized to a client and the tier table otherwise, so the short deck always has
    one money slide and never shows the executed sample as if it were theirs.
- **A bare `/crm/present` still means the FULL deck** (`DEFAULT_TRACK`). Every
  button in the UI names `?track=` explicitly, and the buttons people press —
  Overview and the client card — open `first-call`. The default is left alone
  because that URL is in calendar invites and bookmarks, and a link that quietly
  starts showing a different deck is how a presenter gets surprised on a shared
  screen. An unrecognised `?track=` falls back rather than 404s.
- **The track switch is on the START GATE only**, passed in as `Deck`'s
  `startAside` — `Deck` itself knows nothing about tracks. Once the presenter has
  begun, the tab is being screen-shared, and a control listing our other decks is
  our tooling in front of a prospect.
- **`/crm/presentations` is the internal library** — the decks, what each is for,
  its slide list, and a per-client "present" row. Slide titles there are read
  from `buildSlides`, not re-listed, so the contents shown cannot drift from the
  deck that opens. Every link out of it is `target="_blank"`: the presenter
  shares that one tab and keeps the book behind it.
- **`lib/crm/presentation.ts` computes every figure** through `deal.ts` and
  `economics.ts`. No money is typed into a slide, so a slide cannot disagree with
  the contract it becomes.
- **The tier deposit schedule is a partner decision (August 2026): 13% / 12% /
  10%, stepping down with size.** `TIER_DEPOSIT_BPS` in `presentation.ts`,
  overridable via `CRM_TIER_DEPOSIT_BPS_FRACTIONAL/SINGLE/MULTI`. It supersedes
  both a flat 10% and the deck's published downs (12% / 10.8% / 11%, not
  monotonic, FULL column doesn't reconcile). The premium on smaller entries
  covers setup and management overhead; multi sits at the standing 10% so bulk
  is always cheaper in cash — `multiUnitCashSavedCents` computes that saving
  ($100,000 at defaults) and the slide shows it only while it is positive. Only
  the rate is input; loan balance and note payment are derived, so every row
  reconciles. `depositBpsForPrice()` bands a sized-to-target presentation into
  the same schedule, so the terms and leverage slides quote the rate the Sizes
  slide implies for a deal that big. **There is no management fee line item**:
  no document in `docs/`
  names one — the Management Agreement's whole compensation is the 50/50 split
  and clause 4(c) bars charging the Owner anything else, so the overhead is
  priced inside the down payment and must never be shown as a fee. Note the
  tier rates are **presentation pricing only** — a generated proposal still
  defaults to `CRM_DEFAULT_DEPOSIT_BPS` at any size, so a tier-sized proposal
  must have its deposit typed to match the slide. Nor does it repeat the FAQ's claim that there is "no
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

  **It matches `/crm/present/` WITH THE TRAILING SLASH, and that is load-bearing
  now that `/crm/presentations` exists.** The obvious simplification —
  `startsWith("/crm/present")` — also swallows the library page, stripping the
  nav off an internal screen and leaving whoever opened it with no way back. Do
  not tidy it.
- **Chart colour was validated, not chosen.** The accent `#b08a2c` and the
  neutral ramp in `components/present/Charts.tsx` were run against the navy
  surface — the brand's `gold-500` fails the lightness band there and reads
  washed out when projected, which is why marks use a different gold from the
  rules and eyebrows.
- **The canvas is fixed at 16:9 and scaled, never reflowed** (`.deck-canvas`,
  `cqw` units). A deck that reflows shows the presenter and the room different
  line breaks.

## The second product — amusement equipment, and why it is its own module

**BTB now sells TWO §168(k) assets.** The Park Models are §§1–5 of `SKILL.md`;
commercial amusement equipment is §6. They share the statute and almost nothing
else, and conflating them is the same failure mode as the 7-day/30-day mix-up:
fluent, confident, and describing a deal we do not sell.

- **Asset Class 79.0 "Recreation", 7-year GDS** (Rev. Proc. 87-56) — not 00.27
  at six years. Both clear the 20-year §168(k) ceiling; they are different
  tables and are not interchangeable.
- **There is no trust.** The buyer's own existing trade or business owns the
  equipment outright, so **§469 material participation is the BUYER's** to
  establish. The *Aragona* / *Carter* / PLR reasoning is about a **trust's**
  participation and does not carry across. Nor does the Finance Agreement's
  **forbearance** clause — that term belongs to the tiny-home note, and saying
  the lender forbears on an equipment note describes a different deal.
- **It is LISTED PROPERTY under §280F**, which the homes are not, and that is the
  defining constraint rather than a footnote. Business use must **exceed** 50%
  every year — at or below it the asset leaves MACRS for 10-year ADS, bonus is
  **unavailable outright** (not reduced), and prior depreciation is recaptured
  under §280F(b)(2). `computeEquipmentDeal` enforces this: below the threshold it
  reports zero bonus and recovers over ADS rather than printing a deduction the
  taxpayer is barred from claiming. §274(d) also demands contemporaneous logs,
  every year. The deck gives it a slide **before any money**, deliberately.
- **`lib/crm/equipment.ts` is a SEPARATE module from `economics.ts`**, and that
  is the point. Folding it in would mean a `unitUse` value carrying a completely
  different caveat set — and the caveats are the product. Two products, two
  modules, one statute quoted in both.
- **`LOSS_LIMITATION` moved to `economics.ts`.** §461(l) applies to both
  programmes, and it had been stated twice — as constants in `presentation.ts`
  and as literal dollars inside an economics caveat string. `presentation.ts`
  re-exports it so the deck's imports are unchanged.
- **`equipment.ts` reads NO environment and touches NO Node API**, because the
  browser-side calculator imports it. `equipmentConfig()` is the server-only
  half; call it in a page and pass the result down. `process.env` in a client
  bundle is silently `undefined`, so a component that resolved its own config
  would quietly run on the built-in defaults while the deck ran on SSM's.
- **Rate and term are INPUTS here, unlike the homes.** 0% over 720 months is
  fixed for the Park Models because the memorandum's economic-substance
  reasoning is built on that shape. There is no memorandum behind the equipment,
  so a buyer financing at 7% over 84 months is a normal outcome — `amortize()`
  is a real interest-bearing schedule when the rate is above zero.
- **The revenue split is TWO-STAGE.** Player payout is 30% of **gross**; the
  venue's 15% and the 30% service charge come off **what remains**. Read flat
  against gross, the owner's net comes out about $1,350 a month light per unit.
- **We quote the §461(l)-CAPPED benefit, not the gross one.** The competing
  public material takes $1.5m of income to $0 of federal tax and never mentions
  the cap; repeating that would contradict our own limits slide two positions
  later. Both figures exist on the internal workbench, with the gross one struck
  through. `MARKET_MATERIAL_NOTES` records where that material fails to
  reconcile — its $140,000 financed against a $150,000 unit at 10% down, and its
  "5,435% ROI", which is fifteen years of undiscounted cash flow over the
  deposit and is not a return under any convention.
- **Payout machines are state-regulated and prohibited in places.** Never opine
  that a given machine is lawful in a given state.

**Nothing is stored.** There is no equipment proposal type, contract template or
unit row — the tooling is a calculator and a deck. Config is all SSM under
`/btb-crm/`: `CRM_EQUIPMENT_UNIT_PRICE_CENTS`, `_DEPOSIT_BPS`, `_TERM_MONTHS`,
`_RATE_BPS`, `_FLEET_UNITS`, `_GROSS_LOW_CENTS`, `_GROSS_HIGH_CENTS`,
`_PAYOUT_BPS`, `_VENUE_BPS`, `_SERVICE_BPS`.

**Surfaces.** A third deck track (`equipment`, ten slides) with a live estimator
slide; a `programmes` comparison slide appended to the **end** of the full
tiny-home deck — the end, because a prospect holding one deal in their head
stops following both if a second asset class arrives mid-pitch. The first-call
deck is untouched: it is eight slides and tightly paced by design. The internal
workbench is `/crm/equipment`, which keeps the Lightning chrome because it shows
the gross-versus-capped comparison and the competitor notes, neither of which
belongs on a shared screen.

**Every field on the workbench carries an `InfoTip`, and the text is in
`lib/crm/equipment-glossary.ts` — one home, never inline.** Two facets per
entry on purpose: *usage* (what the number is, what moving it does) and
*legality* (the provision it answers to, and how it breaks). A field can be
trivial to use and ruinous to get wrong — "qualified business use" is a
percentage box and also the §280F cliff — and a single blended hint compresses
the second half into something that reads like form microcopy.

- **The glossary states the same doctrine as `SKILL.md` §6, so it is a second
  copy that can disagree.** It is deliberately NOT loaded into the AI (it is
  microcopy, not prompt text, and the deck must never render it). The mitigation
  is the `cites` array: keep the statutory anchors identical in both places so a
  search for `§280F` finds every copy. **Change a rule in both.**
- **The panel is `position: fixed`, placed from the trigger's rect.** The
  obvious absolutely-positioned version is clipped to nothing — the deduction
  and month tables are `overflow-x-auto` and the schedule is `max-h …
  overflow-auto`. The cost is that scrolling must CLOSE it, since a fixed panel
  cannot follow the trigger; the scroll listener uses `capture` because
  scrolling inside those tables does not bubble to window.
- **`Num` no longer wraps its field in a `<label>`.** `InfoTip` is a `<button>`,
  interactive content inside a label is invalid, and clicking the field *name*
  would have activated the input instead of opening the explanation. It is
  `htmlFor` + a `useId` now.
- **Escape needs `suppressFocusOpen`.** Escape closes the panel and returns
  focus to the trigger — which fires `onFocus`, which reopens it. Without the
  one-tick guard, Escape is a no-op that looks like a hang. Dropping the
  `.focus()` instead would strand keyboard focus on a dismissed popover.
- The panel keeps live pointer events so citations can be selected, so the
  outside-click handler must exclude the panel as well as the trigger.

**`EquipmentCalculator` is the ONLY interactive thing in the deck**, and the
exception is earned: "what would it look like at my number" is the question
these calls actually turn on. Controls are range inputs, not text fields — a
presenter is talking while they drag, and a half-typed number renders a nonsense
figure on a screen share. Business use is **not** a dial on the slide: turning it
below 50% in front of a prospect is a §280F conversation, not a slider.

### `/crm/clients` and the Overview render the SAME board

`ClientsBoard` is mounted twice — on the dashboard and on its own section — and
that is one component, not a copy. The two answer different questions ("how does
the book look today" against "find me this account"), and a second list would be
two places to add a column and one place to forget it. Clients had been reachable
only through the dashboard, so opening an account meant scrolling past eight
figures, the pipeline, the board and the activity feed; every other record type
already had its own section.

Consequences worth knowing: the nav item lights up on `/crm/clients/[id]` too
(`isCurrent` matches the prefix), the client card's breadcrumb points at the
section rather than back at the dashboard, and the rail's own "Users" item is
account administration — it was given a distinct glyph so the allow-list and the
book of business do not sit under one symbol.

### Team chat — `/crm/chat`, and why it is not WhatsApp

The office's room, in the app. August 2026.

**It exists because WhatsApp was ruled out, and the reason is worth keeping.**
Meta's Business Messaging Policy has banned **general-purpose AI chatbots**
since 15 January 2026 — LLM-powered, open-domain, "ask it anything", where the
AI is the product rather than a supporting feature. That is a word-for-word
description of putting `AskAi` on a business number, there is **no internal-use
carve-out**, and the penalty is losing the number. Separately: Cloud API groups
must be **created by the business** (your existing group cannot be adopted),
need an **Official Business Account**, cap at **8 participants** — and Cloud API
messages are **decrypted on Meta's servers**, with every answer landing
permanently in each member's phone backup. That last point is the one that
settles it on our own precedent: `CRM_STORE_TRANSCRIPTS` is off by default
because a transcript is a named taxpayer discussing their income.

- **`lib/crm/chat.ts` is the room; `chat-bus.ts` is the live fan-out;
  `chat-ai.ts` is the assistant.** Messages are Markdown, so `@mentions`, links
  and pasted images all work through machinery that already existed.
- **Channels are a concept from day one, and one row is seeded.** A chat that
  starts as a single room and later needs one per client is a migration plus a
  rewrite of every query. `crm_chat_channels.client_id` is there, nullable, and
  nothing writes it yet — per-client rooms are a row and one line in
  `chat-ai.ts`.
- **No per-channel membership and no DMs, deliberately.** Reaching `/crm` is the
  permission, exactly as it is for the board.
- **The AI answers only when `@ai`-ed.** A model reading every line is a bill on
  idle chat and a participant nobody invited. It posts as an ordinary message
  with `kind = 'ai'`, so scrolling back next month shows the answer where it was
  given, and it carries the violet AI badge — in this app violet means AI and
  nothing else.
- **Who said it is prefixed into the text sent to the model.** A room is
  many-to-one and the roles are two; without the prefix the model reads five
  people as one person changing their mind.
- **SSE, not WebSockets or polling.** Route handlers cannot host a WS server,
  and polling is a query per person per second forever. Three things make the
  stream survive this deployment: **heartbeats every 25s** (the ALB closes an
  idle connection at 60 and a quiet room is idle by definition),
  **`X-Accel-Buffering: no`** (a buffering proxy turns a live stream into a late
  batch), and **unsubscribe on abort** (every deploy drops every connection, and
  without teardown each leaks a listener on a process-lifetime emitter).
- **`chat-bus.ts` is in-process, and that is the one thing a second instance
  breaks.** Each instance would fan out only to its own connections and half the
  office would silently stop seeing the other half. Worth it today for a
  five-person team; it needs a broker the day there are two instances.
- **Times are formatted in the OFFICE zone, threaded down as a prop.**
  Reader-local formatting is a hydration mismatch by construction — the
  container is UTC and nobody who works here is — and "Yesterday" has to mean
  the same day to everyone in the room. Same rule and same file as the meetings
  calendar (`lib/crm/tz.ts`).
- **Enter sends here; ⌘↵ posts a card comment.** Deliberately opposite: chat is
  one line at a time and every chat app these people use sends on Enter, while a
  comment is usually a paragraph and losing it to a stray Return is unforgivable.
- **The emoji picker is hand-listed, not installed** — a full set is a ~100 KB
  dependency for glyphs nobody uses. Note this does NOT contradict the board's
  rule that replaced `≡ ☑ 💬` with drawn SVG: that rule is about UI **chrome**,
  which must look the same on every machine. Emoji people type at each other are
  **content**, and the reader's own system font is exactly right for them.

**Link previews — `lib/crm/unfurl.ts`, and the SSRF guard is the point.**

**This module makes the server fetch a URL a user typed, and the IMDS hop limit
was raised to 2 for image uploads.** A naive unfurler would therefore let anyone
who can type in chat reach `169.254.169.254` and walk out with the instance
role. Three non-obvious defences, none of which may be "simplified":

1. **DNS is resolved here and the RESOLVED IP is checked** — every answer, not
   just the first. Checking the hostname is useless; `evil.com` can have an A
   record of `127.0.0.1`, and does. This is the whole attack.
2. **Redirects are followed by hand, one hop at a time, re-checking each.**
   `fetch`'s own following would land on a private address after a public first
   hop.
3. **The check and the connection still race** (DNS rebinding). Accepted and
   narrowed rather than solved: no credentials are ever attached, the response
   is capped, and nothing is returned but title/description/image. Someone who
   wins the race gets a page title.

`isPrivateAddress` is exported and was verified against a table of 21 addresses
— IMDS, ECS task metadata, loopback, our own VPC, CGNAT, multicast, IPv6
link-local and unique-local, IPv4-mapped IPv6 — **including two that must be
ALLOWED** (`172.32.0.1`, `100.128.0.1`), which are what catch a filter written
one bit too wide. Re-run that table if you touch it.

- **A preview never renders a remote image.** The `og:image` is copied into our
  own attachment bucket, so reading a message cannot tell a third party who is
  reading it and when. This is the one path that could otherwise smuggle a
  remote URL past `Markdown.tsx`'s rule.
- **crexi.com answers 403 to a plain server fetch**, which is why there is a
  browser User-Agent — not evasion, we obey the status we get, but many sites
  serve OpenGraph only to something that looks like a browser. Sites that still
  refuse get the fallback card showing the domain and the tidied path, which for
  a listing URL is genuinely useful. Failures are cached as `blocked` so one 403
  is not one per render forever.
- **Instagram needs no app any more.** Meta reversed the token requirement on
  15 June 2026: `instagram_oembed` is callable with no access token and no App
  Review. Lower rate limits than the token route, which is why it is cached.

### The board — `/crm/todos`, and it works like Jira now

Ticket keys, tags, subtasks and a rebuilt comment thread, August 2026.

**One sequence, `crm_ticket_seq`, shared by cards AND subtasks.** A subtask
carries a real key of its own — BTB-58 under BTB-42, not BTB-42.1 — which is the
whole reason it has one: a subtask you can assign but cannot name is not a thing
anyone can ask about. Two sequences would mean two tickets called BTB-58.

- **`lib/crm/ticket.ts` is PURE and the prefix is a CONSTANT.** It is imported
  by client components, and `process.env` in a client bundle is silently
  `undefined` — so a component resolving its own prefix would render every key
  as `undefined-42`. Same rule as `equipment.ts`. Changing `BTB` is a one-line
  code change; note that old keys do not move, since `ticket_number` is the
  stored fact and the prefix is presentation.
- **`parseTicket` accepts "BTB-42", "btb 42", "#42" and a bare "42"**, and the
  board's search treats a key as a JUMP rather than as text. Substring matching
  would return BTB-42, BTB-142 and BTB-420 together.
- **Numbers are never reused.** A deleted card's key stays dead, so BTB-42 in a
  chat message six months on either finds the thing it named or finds nothing.
- **`schema.ts` gained a `pre` hook** — statements that run before CREATE TABLE.
  It exists for exactly one thing: a sequence that a column DEFAULT names.
  `columns` and `alters` both run too late.
- **The backfill numbers the oldest card 1**, offset by the current max so it is
  correct in a mixed state and not only in the all-NULL one. It is idempotent
  (nothing is NULL after the first run) and was verified by reproducing the real
  pre-migration state — dropping the column, inserting cards out of
  chronological order, and restarting.
- **The `setval` lives on `crm_todo_subtasks`, not `crm_todos`.** It needs the
  high-water mark of BOTH tables, and TABLES is applied in order inside one
  transaction, so on a fresh install the subtask table does not exist yet when
  the card table's `alters` run. It uses `GREATEST(..., last_value)` so it can
  only ever move the sequence FORWARD — winding it back would re-issue a live
  number and the unique index would then reject every new card.

**Tags are a registry, not a text array on the card.** A tag carries a colour
and a colour has to be stable; the same label rendered amber on one card and
teal on another is worse than no colour. `crm_tags` + `crm_todo_tags`, unique on
`lower(label)` so "Urgent" and "urgent" cannot both exist, and POST is an upsert
so "add a tag" needs no find-or-create in the caller.

- **`TagChip.tsx` is the one place that does NOT use the CSS-variable tokens.**
  Eight hues would mean sixteen more ramps counting dark values, for something
  decorative, so it uses Tailwind's palette with an explicit `dark:` per tone.
  That is safe *only* because Tailwind's default `darkMode` is `media`, the same
  `prefers-color-scheme` the token layer keys off. **Do not set `darkMode:
  "class"` without revisiting that file** — the chips would stay light while
  everything around them went dark.
- New tags get a colour hashed from the label, so the same word always lands on
  the same hue and re-creating a deleted tag brings its colour back.

**PROSE BATCHES; EVERYTHING ELSE APPLIES AT ONCE.** That one line governs the
whole card dialog. Title and description are held locally and saved on submit —
they are the two fields people type paragraphs into, and a PATCH per keystroke
would hammer the API and let two people editing the same card overwrite each
other mid-sentence. Status, assignee, tags and subtask ticks all write on the
click, because each is one action with an obvious result and holding one behind
a Save button is how a change gets lost by pressing Close. **Assignee moved
across that line** (August 2026) and its "Save to apply" note went with it.

The subtask optimistic update has to TRANSLATE `done` (a boolean on the wire)
into `done_at`/`done_by` (what the row and the checkbox actually hold) —
spreading the request body onto the row sets a property nothing reads and leaves
the tick frozen until the server answers. Both shapes typecheck; only driving
the real board catches it.

**The card is a NEUTRAL surface with a coloured spine; the dialog is an issue
view.** August 2026, and both are deliberate reversals.

- Cards were a full pastel wash per status plus a heavy left border. Legible
  from across a room, and also three tinted fills stacked in three columns —
  nothing like the rest of the app, which is white cards on a recessed page. A
  card is now `bg-card` with a layered shadow and a 3px status spine down its
  left edge (the Calendar/Reminders idiom: the object is the material, the
  colour is a marker on it). The status is still stated four times — spine,
  column dot, column heading, count pill. **The column is the recessed tray**
  (`bg-ink-200/40`, a step darker than the page in light and lighter in dark)
  and the cards are the objects on it.
- **Two `bg-*` utilities on one element is a coin toss.** The drop-target state
  REPLACES the column's fill rather than being appended to it: which of two
  background utilities wins is decided by the order Tailwind emitted them, not
  by the order they appear in the class string.
- **The card avatar is the shared hashed one**, not a status-coloured chip. One
  person is one colour everywhere, which is the only thing that makes an avatar
  worth reading; the card's status is already said by its spine.
- **Footer glyphs are drawn, not typed.** They were `≡`, `☑` and `💬`. An emoji
  is rendered by the OS in full colour at whatever weight it likes, which on a
  row of 11px grey metadata is the loudest thing on the board and looks
  different on every machine in the office. The dashboard's `TodoSummary` says
  "3 comments" in words for the same reason.
- **The move arrows stay visible.** Reveal-on-hover would be tidier and would
  make the board read-only on a phone: HTML5 drag does not fire on touch at all.
  Same reason they exist at all.
- **The dialog carries a status LOZENGE in its header, and it writes.** Until
  now `?card=` could land you on a card you then could not move without closing
  the dialog and finding it on the board behind. It uses `Dropdown`'s
  `triggerClassName`, which is the one escape hatch from `.sf-input` and exists
  for exactly this: a coloured pill that is not a form field. The popup is
  untouched — every dropdown in the app opens the same menu.
- **`Dialog`'s `wide` boolean became `size: "md" | "lg" | "xl"`.** Every former
  `wide` is `size="lg"` and unchanged at `max-w-3xl`; the card dialog is `xl`.
  `titleContent` replaces the heading text with arbitrary chrome, and `title` is
  still required and still what `aria-label` uses — a decorated header cannot
  leave the modal unnamed.

**Comments render Markdown and resolve @mentions**, with an avatar rail whose
colour is hashed from the address so one person is one colour everywhere.
Consecutive remarks by the same person drop the repeated header. **Mentions do
not notify anyone** — nothing in this app sends mail yet, and a mention that
looks like a notification and is not is worse than one that plainly is not.
⌘↵ posts; plain Enter is a newline, unlike the AI panel, because a comment is
usually more than one line.

### Image attachments — `lib/crm/uploads.ts` is the only file that knows S3

Paste, drop or pick an image into a card description, a card comment or the AI
chat. August 2026.

**The bytes are in S3; the database holds a pointer.** `crm_attachments` is
metadata plus `storage_key`. The bucket is **`btb-crm-uploads-761540266321`**,
deliberately NOT the deploy bucket: that one is on the deploy path and the
instance can read everything under `source/` and `etl/`, and uploads are
client-adjacent material with a different blast radius. Private on all four
public-access settings, no bucket policy, AES256, versioned; an anonymous GET
returns 403, verified. The role is scoped to the **`uploads/` prefix and has no
`ListBucket`** — the app resolves a key from a row and never enumerates.

- **`attachments.ts` is PURE and `uploads.ts` is server-only.** Same split, same
  reason, as `equipment.ts` against `equipmentConfig()` and `ticket.ts`: the
  browser imports the first for paste validation and the Markdown guard, and
  `process.env` in a client bundle is silently `undefined`.
- **The size limit is a CONSTANT, not SSM config.** It is enforced on the server
  and pre-checked in the browser, and those two may only disagree in one
  direction. An env-tuned limit raised without a rebuild would leave the browser
  refusing files the server would take — which reads as a broken button.
- **`image/svg+xml` is excluded and must stay excluded.** An SVG is a document,
  not a picture: it can carry `<script>`, and served from our own origin it runs
  with our cookies. The allow-list is raster formats only.
- **Reads are PROXIED, never presigned.** `GET /api/crm/attachments/[id]` sits
  behind `withCrm` like everything else, and that is the whole access-control
  story. A presigned URL was rejected twice over: embedded in a comment it
  expires and rots the history, and one handed to a browser is a bearer token
  for that object outliving the session that earned it.
- **Markdown renders ONLY our own images.** `![](…)` is ordinary Markdown, so
  the moment comments render it, anyone who can write one can make every
  reader's browser fetch an arbitrary URL — a tracking pixel saying who opened
  the card and when. `Markdown.tsx` re-derives the `src` from a validated id and
  renders anything else as a plain link. Not a substitute for the renderer's own
  safety (no `rehype-raw`, so `<img onerror>` was never reachable); it closes
  the other half of the same door.
- **`next/image` is not used for these and must not be.** The optimizer fetches
  the URL server-side, without the reader's cookie, and gets a 401.
- **The card description is RENDERED now, not just edited.** It has always been
  Markdown and was only ever shown inside a textarea — survivable for prose,
  useless the moment an image is in it. Preview is the default when there is
  anything to read; clicking the body opens the field.
- **An upload in flight blocks Save, Comment and Enter.** The image's Markdown
  is not in the field yet, so posting now sends the message without the thing it
  is about — and paste-then-immediately-Enter is the normal rhythm, not a corner.
- **Nothing garbage-collects.** An image lives in the body of whatever text
  points at it, the same image is routinely pasted into two places, and there is
  no owning foreign key for that reason. `deleteAttachment` exists and nothing
  calls it. A sweep over unreferenced attachments is the right shape for that
  job; orphans cost storage and nothing else meanwhile.

**The AI reads them.** `gpt-5.6-terra` accepts `image_url` parts — probed
against the live key before any of this was built, per the rule about verifying
a model. `toModelMessages` in `advisor.ts` turns the attachment ids in a
message's Markdown into real vision parts.

- **They are sent as base64 DATA URLS, and that is forced**: our serve route is
  auth-gated, so OpenAI fetching it would get a 401. Which means every image in
  scope is re-uploaded inline on **every** turn — so `MAX_VISION_IMAGES` is a
  real budget (4; at the 5 MB ceiling that is a ~27 MB request each time).
  Newest-turn-first, the same thing `HISTORY_LIMIT` does for text.
- **An unreadable image is dropped, not fatal.** The person asked a question;
  answering it without one image beats refusing. It is logged, and
  `describeAttachments` leaves an `[attached image: …]` note either way, so the
  model is never told an image is present when it is not.
- **The AI panel draws user images itself.** A user's message bubble shows their
  text verbatim rather than as Markdown, so without `UserMessage` a screenshot
  appeared there as literal `![](…)` — the model looking at a picture the
  transcript did not show.

**Two AWS traps this uncovered, both invisible to `tsc` and `next build`:**

- **IMDS hop limit.** It was **1**, and the app runs in a container on the
  default docker bridge, so a packet to `169.254.169.254` has already spent a
  hop and the IMDSv2 token request is dropped on TTL. The SDK could not resolve
  the instance role at all. Nothing needed it before: the container's other AWS
  access (SSM, the DB secret) is read by `deploy.sh` **on the host** and handed
  in through `app.env`; uploads are the first time the app itself talks to AWS.
  Raised to **2** in place and declared in the template so a replaced instance
  does not come back quietly broken.
- **`btb-crm-app` CANNOT BE UPDATED WITHOUT REPLACING THE WEB SERVER — this is
  now fixed, and the lesson stands.** `LatestAmiId` was
  `AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>` on the AL2023 alias, which
  re-resolves on every update. Amazon republished it, so `ImageId` became a
  permanent diff — and `ImageId` is `RequiresRecreation: **Always**`. Any change
  at all, however unrelated, would have destroyed and recreated the instance.
  Caught by a change set before executing one. **Always `create-change-set` and
  read the Replacement column on this stack before `deploy`.** Now pinned to
  `ami-04fc404d256fd34a2`, the AMI actually running, so ordinary updates pass.
- The uploads IAM statement is in the template AND was applied with
  `put-role-policy`, because the stack could not be updated safely at the time.
  That is the OPPOSITE of the `BtbSendNotifications` drift: the template already
  carries it, so a stack rebuild reconciles rather than drops it.

**Config:** `CRM_UPLOADS_BUCKET` and `AWS_REGION` in SSM under `/btb-crm/`.
Unset means uploading throws a 503 naming the parameter — it does not fall back
to a default bucket name, because a plausible-but-wrong bucket is how uploads
end up somewhere nobody is looking.

### Dropdowns — `components/crm/Dropdown.tsx`

**A native `<select>`'s popup is drawn by the OS and cannot be themed.** It is
the one control CSS does not reach, and on a form of ten fields it is the one
people notice — a grey macOS menu in the middle of an indigo app, in the light
appearance even when everything around it is dark.

**The native `<select>` is still in the DOM.** Visually hidden and pointer-inert,
but real and named, which is what keeps `new FormData(form)`,
`form.elements.namedItem()` and the AI assist "Use" path working with no call
site changed. Its `onChange` is how an external write (the AI panel) updates the
visible label. A hidden `<input>` plus a button would have broken all three; a
from-scratch listbox would have broken those *and* the accessibility tree.

- It is `sr-only`-style positioning, NOT `display:none` and NOT `hidden` — a
  hidden select is excluded from form submission by the spec, which would
  silently drop the field.
- The popup is portalled and positioned from the trigger's rect, like `InfoTip`
  and for the same reason: an absolutely-positioned menu is clipped to nothing
  inside the `overflow-auto` containers these sit in. The cost is that scrolling
  must close it; the listener uses `capture` because scrolling inside those
  containers does not bubble.
- **`Field` in `ui.tsx` no longer wraps its control in a `<label>`.** `Dropdown`
  is a `<button>`, interactive content inside a label is invalid, and clicking
  the field's NAME would open the menu. It is `htmlFor` + `useId` now, with the
  id passed down through `FieldIdContext` — context rather than `cloneElement`
  because a Field's children are not always one control (the Notes field holds a
  `TextArea` and an `AiText`). Exactly the lesson `Num` learned from `InfoTip`.

### Meetings and call summaries — `/crm/meetings`

Calls with clients, on a month calendar and on a **Meetings** tab on the client
card. Phase 1 of the notetaker work: the table and the surfaces exist and are
**source-agnostic**, so a call typed in by hand and one delivered later by a
meeting-bot webhook are the same row. There is no bot integration yet, and
nothing here knows about a vendor.

- **`crm_meetings.client_id` is NULLABLE, and that is the feature.** A notetaker
  webhook knows attendee email addresses, not our id for the account, and a
  first call is often with someone who is not a row yet. Unmatched calls land in
  a visible **"Not filed under a client"** queue on `/crm/meetings` and are
  attached by hand. Nothing guesses: filing a stranger's call under a real
  client is worse than filing it nowhere, and an unfiled call is also absent
  from that client's AI context, which is the loud version of the failure.
- **Attaching has its own endpoint** (`POST /api/crm/meetings/[id]/attach`)
  because the generic PATCH path strips `client_id` from *every* resource — that
  rule is right for a proposal, whose reassignment would rewrite one client's
  holdings into another's, and wrong for a meeting, where assignment is the
  whole operation. One deliberate logged door beats a hole in the rule.
- **The summary is written here, not taken from a vendor.** `summarizeMeeting`
  in `lib/crm/meetings.ts` runs the transcript through the ordinary scoped prompt
  — `BASE_PROMPT` + `SKILL.md` + the client's record — which is the entire reason
  to do it in-house. The fixed third heading is **"Points to check"**, and it is
  what earns the feature: it flags the 7-day test described where the 30-day one
  applies, a non-recourse characterisation of the note, a first-year figure
  quoted without §461(l), a deposit that disagrees with the frozen proposal. A
  generic notetaker cannot do that because it has never read `docs/`.
- **`summary_md` / `summary_model` / `summarized_at` are NOT in the PATCH
  allow-list**, on the same principle as `crm_parks.area_analysis`: a
  hand-editable AI artifact stops being a record of what the model said, and the
  stamp beside it becomes a lie. `OPENAI_MODEL` is an SSM value that changes
  without a rebuild, so the stamp is how an old summary can be judged at all.
  Human corrections go in `notes`, which sits beside it and is plainly a
  person's. `transcript` *is* writable — it is the input, and pasting one in is a
  deliberate act by someone looking at what they are pasting.
- **`CRM_STORE_TRANSCRIPTS` is OFF by default.** A transcript of one of these
  calls is a named taxpayer discussing their income, in a database with **no
  automated backup** — the largest open risk in the system, listed below. The
  summary carries nearly all the working value at a fraction of that exposure.
  The AI client context takes **summaries only**, never transcripts, even when
  this is on: `buildClientContext` does not select the column at all, so a long
  call cannot silently blow out the prompt.
- **`CRM_TIMEZONE` (default `America/New_York`) is what the calendar buckets
  by**, not the container's zone and not the reader's. `occurred_at` is a UTC
  instant, and a call at 01:00 UTC is the previous evening on the east coast —
  so a server-side grid and a browser-side label would put one call on two
  different days. `lib/crm/tz.ts` is the single rule; it also removes the
  hydration mismatch that reader-local formatting would cause. The zone is
  threaded to `ClientCard` as a **prop**, because `process.env` is unreadable in
  a client component.

### The notetaker — Recall.ai, and `lib/crm/recall.ts` is the only file that knows

**Recall.ai is the bot layer, and it is bought rather than built.** Google sells
no bot API at all — Gemini's notetaker is a Workspace feature you cannot name,
control or get audio out of — and OpenAI sells only the transcription layer
underneath. The intelligence is ours (`SKILL.md`); only the "join the call and
give me audio" part is a purchase.

**`lib/crm/recall.ts` is the ONLY file that knows a vendor exists.** Everything
else deals in `crm_meetings` rows. That was the point of building Phase 1
source-agnostic: a second vendor, or a swap, is this file plus a `source` value.

- **`RECALL_REGION` must match the workspace the key was issued in.** The API is
  region-scoped (`us-east-1`, `us-west-2`, `eu-central-1`, `ap-northeast-1`) and
  a key against the wrong host returns **401 — indistinguishable from a bad
  key**, which is how someone spends an afternoon rotating a good one. An
  unrecognised value throws with the list rather than defaulting quietly.
- **Dispatch is a BUTTON, not a calendar sync.** "Send notetaker" on the client
  card. Auto-dispatching to every event with a Meet link would put a bot into
  internal calls and calls with counsel; and because the button lives on a
  client's card, `client_id` is known at dispatch, so the call files itself and
  the unassigned queue stays for exceptions.
- **`/api/crm/meetings/ingest` is the one route in the CRM with no session
  behind it.** `/api` is outside the middleware matcher and `withCrm` cannot help
  — a webhook has no user. `verifyWebhook` is the entire gate and **fails
  closed**: no `RECALL_WEBHOOK_SECRET` means nothing is accepted, not everything.
  It supports Svix (`whsec_` secret, `svix-id`/`svix-timestamp`/`svix-signature`,
  HMAC over `{id}.{timestamp}.{body}`, five-minute replay window) or a static
  bearer token — **whichever is configured is the only one accepted**, or the
  weaker would always be available. The body is read as **text before parsing**,
  because the signature covers the exact bytes and a re-serialised body never
  verifies. Never add a path that skips this.
- **Everything in the webhook is idempotent.** Recall retries for 24 hours and
  does not guarantee ordering. Terminal statuses are sticky in `setMeetingStatus`
  (a `bot.in_call_recording` retry landing after `bot.done` would otherwise flip
  a finished call back to "in progress" hours later), and a `transcript.done`
  redelivery returns early when `summary_md` is already set rather than
  re-billing the model over a summary someone has read.
- **The summary is written from the text IN HAND, not from the column.** This is
  the ordering the retention flag forces: with `CRM_STORE_TRANSCRIPTS` off the
  transcript is never stored, so reading it back to summarise would summarise
  NULL — on the default configuration. Hence `summarizeFromText`. The flag is
  applied at the point of **storage**, not display, so a row written while it was
  on keeps its transcript afterwards.
- The presigned download URL is **fetched once**; the text and the attendee list
  both come out of that one payload.

**Config, all under `/btb-crm/` (SSM write + redeploy, no rebuild):**
`RECALL_API_KEY` (SecureString), `RECALL_REGION`, `RECALL_WEBHOOK_SECRET`,
`RECALL_BOT_NAME` (default `AI Notetaker` — the client sees it in the participant
list), plus `CRM_STORE_TRANSCRIPTS` and `CRM_TIMEZONE` from Phase 1.

**Not built: live coaching.** Phase 3 is the same vendor — swap the
`recallai_async` transcript provider for a streaming one and add a
`realtime_endpoints` webhook to the same create-bot call. That is why the
integration was worth doing before the live panel rather than after. The design
constraint on it stands: suggestions must be **quoted from the knowledge base and
attributed**, never freely composed. An AI inventing a supporting authority in
front of a taxpayer's CPA is worse than no panel.

## Two looks, on purpose

**The internal app follows the reader's OS appearance. Client documents never
do.** The Salesforce Lightning look is gone — August 2026, because the people
using this are not software people and the blandness was pushing them away.

- The CRM staff work in — every `/crm` page, `components/crm/ui.tsx`, the rail —
  is an indigo→violet, rounded, layered, translucent "Mac-like" look, and it has
  a **dark mode that follows `prefers-color-scheme` automatically**. There is no
  toggle.
- **Proposals, contracts, every `/print` route and the `/crm/present` deck keep
  the navy/gold serif brand, frozen.** They go to a taxpayer and their CPA, where
  "private bank" is worth more than "familiar software" — and a document whose
  colour depends on the reader's system settings is not a document anyone
  approved.

### How the split is enforced, which is the part to not break

**Two palettes in `tailwind.config.ts`, and only one of them moves.**

- `navy` / `steel` / `gold` / `paper` are **literal hex** and must stay that way.
  The documents and the deck are painted entirely out of them.
- `sf` / `ink` / `ok` / `warn` / `err` / `card` / `accent` all resolve to **CSS
  variables** declared in `globals.css`. That indirection is what bought dark
  mode across 48 files without editing any of them.

**The ramps INVERT in dark mode, they are not replaced.** `ink-100` is always
"the page" and `ink-900` is always "body text"; `sf-500` is the vivid primary in
both, everything below it is a tint and everything above it is a text shade. So
`text-sf-600`, `bg-sf-100 text-sf-700` and `bg-sf-50` row hovers all keep meaning
what they meant. Match that convention or a new token will read backwards.

**No file under `components/present/`, and neither print page, references a
single variable-backed token.** That was verified, not assumed, and it is what
makes the deck physically immune. Keep it that way — if a client-facing surface
seems to need one, it is the wrong token.

- **`.theme-light` pins the light values back**, and both print pages carry it.
  They are nested inside `app/crm/layout.tsx` and therefore inside `.sf-page`,
  so without it a contract packet goes dark on a reader's Mac. `@media print`
  forcing white is the paper half of the same guarantee; this is the screen half.
- **`.card` is the document surface and now has no call sites.** Every use of it
  was on an internal screen, where its hard-coded white fill became a white
  rectangle in dark mode; those are all `.sf-card` now. Kept for documents. If
  you put a surface on a print page, it is `.card`, never `.sf-card`.
- **The rail and the sign-in backdrop stay dark in both appearances.**
  `BtbMark`'s disc is a solid navy, so a surface that inverted would need both
  mark variants rendered and toggled. One mark, one reversed treatment.
- **The violet gradient means AI and nothing else.** Primary actions are indigo
  (`.sf-btn-brand`); every AI control is violet→fuchsia (`.sf-btn-ai`). "The
  machine suggested this" must never be one glance from "this is the button that
  saves".
- **`.sf-num` is `tabular-nums` in the SANS face, not the mono stack.** Mono was
  tried and reads as code at the stat tiles' display size.
- The `sf-` prefix is a **fossil** — it used to mean Salesforce and now just
  means the primary ramp. It is ~180 references across 48 files; renaming it is
  diff noise for no behaviour change.

One trap that survives from the old arrangement:

- **Headings default to SANS.** The base layer used to force `font-serif` on
  every `h1`-`h4`; a descendant rule like `.sf-page h1 { font-sans }` would then
  have beaten an explicit `font-serif` utility on the element, which is a
  specificity argument you cannot win. So the default flipped and the documents
  opt back in with `font-serif`. If a document heading comes out sans, it is
  missing that class.

## Inline AI — `lib/crm/assist.ts`, and it never writes

`AskAi` answers questions. This answers a different one — "help me fill this in"
— and it is on the client form, the record dialogs, every notes field, the kanban
board and the client list.

- **Nothing in that module writes.** Every function returns a suggestion and
  stops; `POST /api/crm/assist` has no branch that reaches an UPDATE. Applying
  one is the browser calling the ordinary POST/PATCH endpoints, so a suggestion
  passes every coercer and every allow-list a typed value passes. Propose-then-
  confirm is a property of the system, not a convention.
- **`NEVER_SUGGEST` is the money guardrail**, and it is applied server-side
  *after* generation rather than only asked for in the prompt. It strips the
  frozen proposal economics, the `deal.ts` note terms, and the
  provenance-stamped AI artifacts (`summary_md` and friends). A model that
  ignores the instruction still cannot put a computed figure on screen.
- **Every call goes through `buildScopedPrompt`**, so it inherits `BASE_PROMPT` +
  `SKILL.md` + record context. A suggestion written without `SKILL.md` describes
  the generic tiny-home strategy — the 7-day test, a non-recourse note, land the
  client owns — which is a deal BTB does not sell. Never call the model directly
  from here.
- **Nothing fires on mount.** Every control is behind a press. `ClientsBoard` is
  mounted twice (Overview and `/crm/clients`), so an on-mount triage would bill
  twice for one view of the dashboard, and the board is the screen the team opens
  every morning.
- **Enum and id validity are checked server-side.** A suggested `select` value
  outside its options is dropped rather than shown — it would fail the CHECK at
  save time as a 400 that reads like a bug in the form.
- The `check` action on `AiText` is the one that earns the feature: it does not
  rewrite, it reads what is written against the knowledge base and reports what
  contradicts it. Same idea as "Points to check" on a meeting summary.
- `crm_todos` has **no `client_id`** — the board is the team's shared list — so a
  suggested card names the account in its title instead.

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

**The importer is `etl/` IN THIS REPO, and it deploys separately.** One repo,
two deploy paths — those are different things and the split is deliberate:

- `etl/ship.sh` uploads the importer to S3; `run-etl.sh` on the host re-pulls it
  on every run. Seconds, no image build, no restart.
- `deploy.sh` rebuilds the container for the app. Minutes, and it restarts the
  site.

So an ETL fix never requires shipping whatever is half-finished in the app, and
an app deploy never ships a half-finished adapter. `--exclude=./etl` in the app
tarball and `etl` in `.dockerignore` are what keep them apart.

It is in this repo rather than its own because **the dependency runs both
ways**: `etl/lib/common.mjs` defines the `parcels` columns that
`src/lib/parcels.ts` selects by name, and `etl/zoning.mjs` reads
`crm_saved_parcels`, which this app owns. Two repos with a mutual schema
dependency is the same invisible coupling that made the previous arrangement a
hazard — a rename that is one search here would have been a silent break there.
Read `etl/CLAUDE.md` before changing anything under it.

**There is exactly one importer feeding this Aurora and it is that repo.** Do
not re-introduce a shared checkout, a submodule or a symlink to any other
project, and do not vendor it here.

**The one contract that remains is the `parcels` table.** `lib/common.mjs` in
`btb-etl` defines the columns; `src/lib/parcels.ts` here selects them by name.
Adding a column is safe. Renaming or dropping one is a breaking change to this
app, so search this tree first. Note there is **no zoning column and never has
been** — `dor_uc` is the assessor's *use* code, which is a different thing from
what a jurisdiction permits.

`etl/import.mjs` in the notes below means `btb-etl/import.mjs`. The traps
themselves now live in that repo's `CLAUDE.md`; what is kept below is only what
this app's operators still need to know.

**EC2 schedules it itself.** Two systemd timers do the whole job, with no
second machine in the path and no long-lived access key: `btb-etl-parcels.timer` (monthly, matching how assessment rolls are
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

## Email — SES, and why NOT from ziora.io

Outbound notification mail sends from **`notifications@btbholdingsllc.com`** via
SES in `us-east-1`, with **Reply-To `info@ziora.io`** so replies still land in
the Google Workspace inbox. Inbound and outbound are independent; nothing about
this touches the Workspace mailbox.

**SES is already out of the sandbox** on this account — production access, 50,000
a day, 14/sec, enforcement HEALTHY. That is normally the long pole (a support
ticket) and it is already done.

**Sending from `info@ziora.io` is NOT possible from here, and the reason is not
obvious.** There is a Route53 hosted zone for `ziora.io` in this account, but it
is **not authoritative** — the domain delegates to Cloudflare
(`faye.ns.cloudflare.com`). Records written to that Route53 zone resolve when you
query Route53 directly and are invisible to the internet, which looks exactly
like DNS that has not propagated. The three SES DKIM CNAMEs for `ziora.io` are
sitting in that dead zone now; to actually use that domain they must be added in
**Cloudflare**.

`btbholdingsllc.com` *is* authoritative in Route53 (`Z04363912WJVD2S7E35SL`),
which is why it is the sending domain. Published there:

- three `<token>._domainkey` CNAMEs — SES DKIM, verified
- `v=spf1 include:amazonses.com ~all`
- `_dmarc` at `p=none` with `rua=mailto:info@ziora.io`

DMARC starts at `p=none` deliberately: it reports without quarantining, so a
misconfiguration cannot silently bin real mail. Tighten it once the reports are
clean.

**`ziora.io`'s own SPF is broken, and this predates any of the above.** The TXT
record reads `include:sender.zohoinvoice.com ~all` with **no `v=spf1` prefix**,
so it is not an SPF record at all and resolvers ignore it. With `_dmarc.ziora.io`
at `p=quarantine`, everything sending as ziora.io rides on Google's DKIM alone —
Workspace mail passes, and Zoho Invoice almost certainly does not. Fixing it is a
Cloudflare edit, not an AWS one.

**Permission is scoped by From address.** The instance role carries an inline
policy `BtbSendNotifications` allowing `ses:SendEmail` only when
`ses:FromAddress` is `notifications@btbholdingsllc.com`. It was attached with
`put-role-policy`, so it is **drift** against `infra/aws/btb-crm-app.yaml` until
that template carries it — a stack rebuild would drop it.

## Open items

- **Aurora has no automated backup job.** The S3 bucket, the lifecycle rule and
  the instance permission all exist; the nightly `pg_dump` cron does not. This
  database holds client tax profiles, so that gap is the largest open risk in
  the system. (A separate legacy Postgres on the office Mac Mini, unrelated to
  this app, is also unbacked-up — that is the other team's to solve now.)
- `parcels` is loaded and land search works: **11,974,053 rows** — Florida
  11,090,226 (all 67 counties, roll 2026P) and Montana 883,827 (all 56),
  scraped fresh from the source rolls. `auctions` has not been built yet, and NC
  and CO have never been imported.
- The AI surfaces are **live**. `OPENAI_API_KEY` is in SSM as a SecureString and
  `OPENAI_MODEL` is `gpt-5.6-terra`; the advisor was exercised end to end against
  a real client record. Both are runtime-only, so changing either is an SSM
  write plus a redeploy, not a rebuild. **Verify a new model before setting it**
  — `GET /v1/models/<id>` with the key, then one `json_schema` completion. A
  wrong name is accepted by SSM and by the deploy, and only fails at request
  time, on all three surfaces at once.
- No test suite. The closest thing is the browser pass described above, which
  currently lives outside the repo.
