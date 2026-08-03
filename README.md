# btb-etl — parcel + auction importer

Loads property/parcel data into the BTB Holdings CRM's Aurora database. **This
repo owns itself**: it ships and runs on its own, via `./ship.sh` and the
systemd timers in `deploy/`. It is not vendored into the CRM app.

See `CLAUDE.md` for the traps. Two pipelines share this directory:

- **Parcel import** (`import.mjs`) — assessment rolls: Florida Department of
  Revenue (FDOR) **NAL** (all 67 counties, ~10.8M parcels) + NC OneMap (~100
  counties) + Colorado OIT (~2.6M) + Montana MSDI (~920k). Refreshed
  weekly/monthly.
- **Auction sync** (`auctions.mjs`) — upcoming **tax deed & foreclosure sales**
  into the `auctions` table, joinable to `parcels` by normalized parcel number.
  Refreshed nightly (the lists change daily). See "Auction sync" below.
- **Zoning sync** (`zoning.mjs`) — the zoning district a parcel sits in, from
  county GIS, into `parcel_zoning`. Refreshed nightly, but only for parcels that
  are missing it or stale. See "Zoning" below.

## What it does

1. Enumerates the current NAL roll folder on the FDOR data portal (SharePoint
   REST) — the source of truth for the 67 county file names.
2. Downloads each county zip, streams the CSV (latin-1) through our transform
   (`lib/transform.mjs` + `lib/useCodes.mjs`).
3. Bulk-loads via `COPY` into `parcels_staging`, builds indexes, then does an
   **atomic swap** into the live `parcels` table (zero downtime).

Classification uses the official **DOR use codes** (`lib/useCodes.mjs`), which is
far more precise than the old keyword matching (e.g. code `00` = Vacant
Residential, `50-69` = Agricultural, `99` = Acreage not zoned agricultural).

## Run it

Requires `DATABASE_URL`. All of Florida:

In production this is not run by hand — the timers do it (see Scheduling). To
run one state now, use systemd on the instance so it survives the SSM session:

```bash
aws ssm send-command --instance-ids i-03cf7050d5d33c713 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["systemctl start --no-block btb-etl@FL.service"]' \
  --profile ziora
```

Against a local database, for development only:

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/btbcrm node import.mjs
```

Multi-state (`STATE` selects the source; default `FL`):

```bash
node import.mjs                 # Florida (default)
STATE=NC node import.mjs        # North Carolina (NC OneMap)
STATE=CO node import.mjs        # Colorado (OIT statewide parcels)
STATE=MT node import.mjs        # Montana (MSDI cadastral)
STATE=ALL node import.mjs       # every registered state, in sequence
```

On the instance the same thing is `btb-etl@FL.service`, `btb-etl@ALL.service`
and so on — the unit is templated on the state.

Each state does an independent **partial refresh** (replaces only its own rows in
the shared `parcels` table) and records its own dashboard run, so states coexist
and one failure doesn't block the others.

Subset / different roll / testing:

```bash
ONLY_COUNTIES="Saint Lucie,Brevard" node import.mjs   # FL county names
STATE=NC ONLY_COUNTIES="Wake,Durham" node import.mjs  # NC county names
STATE=NC MAX_RECORDS=20000 node import.mjs            # cap rows (test)
ROLL_YEAR=2025 ROLL_TYPE=F node import.mjs            # FL roll (F=Final, P=Prelim)
```

> Adding a state = write an adapter in `etl/adapters/` and register it in the
> `LOADERS` map in `import.mjs`. Supported today:
>
> | State | Source | Adapter | Notes |
> |-------|--------|---------|-------|
> | **FL** | FDOR NAL files (all 67 counties) | `lib/fdor.mjs` + `lib/transform.mjs` | Official DOR use codes. |
> | **NC** | NC OneMap FeatureServer (100 counties) | `northCarolina.mjs` | No situs ZIP → searchable by city, not ZIP. |
> | **CO** | Colorado OIT statewide parcels FeatureServer (~2.6M) | `colorado.mjs` | **Covers ~44 of 64 counties** (all Front Range; ~20 small/rural absent, incl. Montrose/Delta/Fremont). No discrete land value (total appraised only). Values/sale fields are strings in source. ⚠️ Terms: *"resale of this data is strictly forbidden"* — internal use only. |
> | **MT** | MT MSDI cadastral MapServer (all 56 counties, ~920k) | `montana.mjs` | Situs city/zip parsed from a combined `CityStateZip` string; often absent on vacant land. `co_no` = MT DOR county number 1–56 (not FIPS). Land vs improved from the free-text `PropType`. |
>
> All three ArcGIS sources stream through the shared `loadObjectAdapter` in
> `import.mjs` (paginate → yield common records → COPY into staging → per-state
> swap). FDOR county spellings: **Saint Lucie**, **Saint Johns**, **Dade**
> (Miami-Dade).
>
> **Texas is not yet supported.** The only free *live-queryable* statewide source
> (TxGIO StratMap hosted FeatureServer, ~14.3M parcels) exposes only owner name +
> mailing address + rough acreage — **no valuation, no land-use/classification,
> no county, and a situs field that is just `"TX <zip>"`**. The full StratMap
> schema (values, land use, county, FIPS, parsed situs) is download-only (annual
> multi-GB file geodatabase from data.geographic.texas.gov; the government
> MapServer's `query` capability is disabled). Adding TX therefore means a bulk
> geodatabase ingestion path (GDAL/ogr2ogr), not the streaming-adapter pattern —
> see the open decision in the commit that added CO/MT.

## Scheduling

Two systemd timers on the CRM's EC2 instance do the whole job. There is no
second machine and no long-lived access key; the n8n dispatch path and the
`btb-n8n-mini` IAM user it needed are both gone.

| Unit | Schedule | Runs |
|---|---|---|
| `btb-etl-parcels.timer` | monthly, 1st at 07:00 UTC | `btb-etl@ALL.service` |
| `btb-etl-auctions.timer` | nightly at 09:00 UTC | `btb-etl-auctions.service` |
| `btb-etl-zoning.timer` | nightly at 10:00 UTC | `btb-etl-zoning@orange-fl.service` |

Monthly for parcels because that is roughly how often assessment rolls are
republished; nightly for auctions because those lists change daily. Both are
`Persistent=true`, so a run missed while the instance was down fires at boot.

The unit files and `run-etl.sh` are in `deploy/` and are installed with
`./ship.sh --units`. Check the schedule with:

```bash
aws ssm send-command --instance-ids i-03cf7050d5d33c713 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["systemctl list-timers btb-* --all --no-pager"]' \
  --profile ziora
```

Because the load is staged and swapped atomically, a failed run leaves the live
`parcels` table untouched.

## Shipping a change

```bash
./ship.sh           # source only — the next scheduled run picks it up
./ship.sh --units   # also reinstall run-etl.sh and the systemd units
```

`ship.sh` refuses to run while an import is in flight, and `run-etl.sh` re-pulls
the source on every run, so there is no separate "deploy" step.

## Schema (canonical, defined in `import.mjs`)

`parcels`: `co_no, county, parcel_id, dor_uc, use_label, use_category, is_land,
situs_addr, situs_city, situs_zip, one_line, owner_name, owner_addr, owner_city,
owner_state, owner_zip, absentee, legal, jv, lnd_val, lnd_sqft, acres, sale_prc,
sale_yr, sale_mo, sale_date, asmnt_yr`.

Indexed for the app's queries: `situs_zip`, `lower(situs_city)`, partial
`situs_zip WHERE is_land`, `use_category`, `co_no`, `(co_no, parcel_id)`, and a
trigram index on `owner_name`.

## Auction sync (`auctions.mjs`)

Pulls upcoming **tax deed sales and foreclosure auctions** into the `auctions`
table. The web app joins it to `parcels` by normalized parcel number
(`parcels_pid_norm_idx`) to power the Tax Deed / Foreclosure filters, the
auction block on parcel detail, and the /foreclosures statewide list; each run
reports to the dashboard Mongo (`auction_syncs` collection).

**Sources:**

- **FL — RealAuction county sites** (`adapters/realauctionFl.mjs`): ~19 large
  counties on `<county>.realtaxdeed.com` (tax deeds) and
  `<county>.realforeclose.com` (foreclosures); Brevard & Manatee run tax deeds
  on their realforeclose instance. Calendar → per-sale-day item lists (case #,
  certificate #, opening bid, final judgment, **parcel ID**, address). St.
  Lucie & Charlotte tax deeds use Grant Street ClerkAuction — not covered yet.
- **NC — Kania Law Firm listings** (`adapters/kaniaNc.mjs`): statewide JSON of
  tax-foreclosure cases for ~28 NC counties — pre-sale filings ("sale date not
  yet set"), scheduled sales, and the 10-day **upset-bid** window
  (`current_bid` / `close_date`), which is why nightly matters.

```bash
node auctions.mjs                          # FL + NC (default)
AUCTION_STATE=FL node auctions.mjs         # one state
ONLY_COUNTIES="Palm Beach" MAX_RECORDS=25 \
  AUCTION_STATE=FL node auctions.mjs       # subset (testing)
MONTHS_AHEAD=6 node auctions.mjs           # FL calendar horizon (default 4)
```

Same staging → per-state swap pattern as the parcel import. Statuses:
`pre-sale` (filed, no date), `upcoming`, `upset-period` (NC), `closed`.

Scheduling is no longer n8n's job. The BTB deployment runs this from a systemd
timer on its own instance (`btb-etl-auctions.timer`, nightly) with no second
machine and no long-lived AWS key; the three `n8n-*.json` exports that used to
drive it have been deleted.

> ⚠️ **RealAuction ToS**: browsing is public (no login), but RealAuction's user
> agreement contains an anti-robot/automation clause. The same sales are FL
> public record (clerk sites, FS 197.512 published notices,
> floridapublicnotices.com), and the scraper is deliberately throttled
> (~1.2s/request, sequential) — but get counsel's sign-off (or clerk/RealTDM
> alternatives) before relying on the nightly FL schedule commercially.
> The NC source (Kania) serves its listings via a public JSON endpoint.

## Known limitations (carried into the app)

- **Vacant land often has no situs street address.** `one_line` falls back to
  `<city> FL (Parcel <id>)`. This affects the Zillow deep-link and display.
- **No recorded-deed chain.** NAL has the *last sale* only. Distress coverage
  comes from the auction sync above — live upcoming sales, not historical
  foreclosure deeds; counties outside the covered sources are unflagged.
- **No live for-sale listings** (RentCast's old role). This dataset is
  off-market parcels by design.

## Zoning

`zoning.mjs` fills `parcel_zoning`, which the CRM joins to `parcels` at read
time.

**It is a separate table, not a column on `parcels`.** `import.mjs` refreshes a
state with `DELETE FROM parcels WHERE state = $1` followed by a re-insert, so a
zoning column there would be silently blanked every month — no error, right row
count, column quietly null again.

**Zoning is not `dor_uc`.** `dor_uc` is what the property appraiser records a
parcel as being *used* as. Zoning is what the jurisdiction *permits*. They
disagree constantly and only the second governs what may be built.

### What it does and does not answer

Orange County has **no RV district**. Of its 65 district codes none names RVs,
and the established RV parks sit in agricultural and commercial ones:

| Park | Zoning |
|---|---|
| WDW Fort Wilderness | `BAY-E` |
| Winter Garden RV Park | `WG-C-2` |
| Christmas RV Park | `ORG-A-2` |
| Lost Lake RV Park | `ORG-A-1` |

So zoning **narrows a search**; it does not establish that a use is permitted.
For the 2,204 `P-D` (Planned Development) parcels the permitted use is not in
the GIS attribute at all — it is in that PD's approved plan document. A written
zoning determination is still the answer.

### The parcel-id trap

The county and the FDOR roll encode the same parcel differently: the county
writes `SS-TT-RR-…`, the roll writes `TT-RR-SS-…`. Same fifteen digits, first
and third pairs exchanged, and the swap is its own inverse.

**The danger is not a miss, it is a hit.** The two encodings share an id space —
`312428000000005` is a real parcel in both datasets and a *different* one in
each. So joining without the swap does not fail loudly; it attaches a
neighbouring parcel's zoning to a land decision. Every row is therefore
address-checked (`addressesAgree`) before it is written, and a run that produces
more mismatches than matches says so.

### Selecting what to ask for

The county service answers in **10–20 seconds per request** at any offset or
page size, so crawling all 496,798 county records is ~2,500 requests and about
thirteen hours. The job is driven by *our* parcels instead: shortlisted ones
first, then land above `ZONING_MIN_ACRES` (default 2), skipping anything fetched
within `ZONING_MAX_AGE_DAYS` (default 90), capped at `LIMIT` (default 5,000).

```bash
DATABASE_URL=… node zoning.mjs                                  # the default sweep
DATABASE_URL=… ZONING_MIN_ACRES=5 LIMIT=500 node zoning.mjs     # narrower
DATABASE_URL=… ZONING_WHERE="p.dor_uc IN ('028','036')" node zoning.mjs
```

### The WAF

There is an IIS filter in front of the county service that returns **403 with an
HTML body** — not an ArcGIS error — for query shapes it dislikes. Confirmed by
bisecting: `ZONING_CODE <> ''` and `PARCEL > 'x'` are both refused, while
`1=1`, `IS NOT NULL`, `IN (…)`, `orderByFields` and `resultOffset` are fine.
That is why blank codes are filtered in code and why there is no keyset
pagination.

### Adding a county

`COUNTIES` in `zoning.mjs` maps a key to an adapter. A new one needs: the
service URL, the field carrying the code, and — the part that actually takes the
time — the id relationship between that county's parcel number and the roll's.
Prove it by looking one known address up in both before writing any rows.
