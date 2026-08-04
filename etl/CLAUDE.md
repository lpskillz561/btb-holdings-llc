# btb-etl — working notes

The parcel and auction importer for the BTB Holdings CRM. It lives in this repo,
under `etl/`, and **it deploys on its own path**: `./ship.sh` puts it in S3 and
the host re-pulls it on every run. It does NOT ride the app's `deploy.sh`, is
excluded from the app tarball, and never runs inside the app container.

Read `README.md` for what it does. This file is what is not obvious from the
code and has already cost time.

## Why it sits inside the app's repo

**There is exactly one importer feeding BTB and it is this one.** It has no
upstream and no sibling checkout. Do not add a submodule, a symlink or a shared
directory to another project.

It is a directory here rather than a repo of its own because the dependency runs
**both ways**: `lib/common.mjs` defines the `parcels` columns that
`src/lib/parcels.ts` in the app selects by name, and `zoning.mjs` reads
`crm_saved_parcels`, which the app owns. Split across two repos, a rename on
either side is a silent break discovered in production. In one tree it is one
search.

Sharing a repo is not sharing a deploy. See the header.

## How it runs

Nothing here runs on a laptop against production. The instance runs it:

| Unit | Schedule | Job |
|---|---|---|
| `btb-etl-parcels.timer` | monthly, 1st at 07:00 UTC | `btb-etl@ALL.service` |
| `btb-etl-auctions.timer` | nightly at 09:00 UTC | `btb-etl-auctions.service` |
| `btb-etl-zoning.timer` | nightly at 10:00 UTC | `btb-etl-zoning@orange-fl.service` |
| `btb-digest.timer` | daily at 13:00 UTC | `btb-digest.service` — the "what shipped" email |

Both are `Persistent=true`, so a run missed while the box was down fires at
boot. `deploy/` holds the units and `run-etl.sh`; `./ship.sh --units` installs
them. Everything is version-controlled here — before this repo existed they
lived only on the instance, unversioned, and a rebuild would have lost them.

`run-etl.sh` pulls `s3://btb-crm-deploy-761540266321/etl/etl.tar.gz` fresh on
every run, so shipping is an S3 write and the next run picks it up. There is no
"deploy the ETL" step beyond that.

## Gotchas that have already cost time

- **Only ONE parcel import may run at a time.** `import.mjs` loads into a single
  shared `parcels_staging` table and then swaps one state's rows out of it, so
  two states at once interleave and swap each other's data. `run-etl.sh` takes
  an `flock` on `/var/lock/btb-etl.lock`; a second state waits rather than
  corrupts, which also makes queueing the next state just a matter of starting
  it.
- **A wedged import looks exactly like a slow one.** MT once sat two hours
  having loaded nothing, holding an open `COPY parcels_staging` whose lock
  blocked two later imports and made the table unreadable — `systemctl` said
  `activating` throughout. Three faults had to line up and the middle one is the
  trap: `importState`'s `catch` opens with `ROLLBACK`, but the connection was
  still in COPY-in mode, where the server wants `CopyData`/`CopyFail` and will
  not answer a new query. **The error handler hung on its own first statement**,
  so the `ERROR:` line explaining any of it never printed. `lib/http.mjs` now
  puts a deadline on every request — armed over the *body*, because `fetch()`
  resolves at the headers and a timeout around the call alone still lets
  `res.json()` hang — the COPY is destroyed on failure so the lock goes
  immediately, and a stall watchdog aborts any load that goes 15 minutes without
  a row. **Diagnose from `pg_stat_activity`, not the unit state**: a `COPY`
  sitting in `Client/ClientRead` with a two-hour `xact_start` is the signature.
- **`systemctl is-active --quiet` is FALSE for a running oneshot.** A long
  `Type=oneshot` sits in `activating` for its whole life, and `--quiet` only
  succeeds on `active` — so a "wait for the import to finish" loop written that
  way fires immediately. This started a second import twice. Watch the process
  (`pgrep -f "node import.mjs"`), not the unit state.
- **The parcel timer runs `btb-etl@ALL.service`, not one state.** It used to
  name `btb-etl@MT.service`, so the monthly refresh silently covered Montana
  alone while Florida, North Carolina and Colorado would have gone stale
  forever — and the timer reported success throughout. A per-state unit that is
  *also* the scheduled unit is a trap: it looks fine and does a fraction of the
  work.
- **FDOR rotates the Florida roll folder, so it must not be pinned.** The portal
  keeps only the current roll under `.../NAL`; `2025F` is gone and `2026P` is
  there now. A pinned `ROLL_YEAR`/`ROLL_TYPE` is a bug with a one-year fuse and
  a quiet one — the SharePoint API still answers 200, the listing is just empty,
  discovery returns zero files and the import dies with "No rows loaded" that
  explains nothing. Unset, `discoverNalFiles` takes the newest populated roll and
  logs which one it used.
- **The county number in the FDOR filename is optional.** FDOR ships
  `Broward Preliminary NAL 2026.zip` with no number, and a regex requiring one
  silently dropped Florida's second-largest county — 754,549 parcels, 66 files
  of 67, no warning. It cannot corrupt anything, because a parcel's `co_no`
  comes from the CSV's own column, not the filename.
- **Check the source host before assuming the ETL is broken.**
  `gisservicemt.gov` in the MT adapter was NXDOMAIN from every resolver — a
  long-standing typo for `gisservice.mt.gov`, whose service has since moved to
  `msdi_cadastral_map_v1` with parcels on **layer 1** (layer 0 is conservation
  easements, layer 2 is public lands, so a careless port imports the wrong
  features rather than failing). `getent hosts` on the instance is the
  thirty-second check.
- **`app.env` is written for the CONTAINER.** The RDS CA bundle is bind-mounted
  at `/etc/ssl/rds-ca.pem` inside it and lives at `/opt/btb/rds-ca.pem` on the
  host. The ETL runs on the host, so `run-etl.sh` rewrites `sslrootcert` or
  every run dies with `ENOENT` on the certificate before opening a connection.
- **Deploying the CRM app stack can REBOOT the instance and kill a running
  ETL.** A `UserData` change was applied by stopping and starting the instance
  rather than replacing it: same instance id, but `/tmp` cleared, containerd
  restarted, and a parcel import 18 minutes in died silently. The SSM command
  that launched it still reported `InProgress` long after the process was gone,
  so *check the process, not the job status*. Run long imports through
  **systemd** (`systemctl start --no-block btb-etl@MT.service`), which survives
  an SSM session, and do not deploy either repo while one is in flight.
- **macOS `tar` writes AppleDouble `._name` files.** Eight of them were on the
  instance from a hand-rolled ship. Harmless here, because nothing loads `.mjs`
  by glob — but the CRM repo lost an afternoon to `._SKILL.md` being picked up
  by a loader that globbed `*.md`, so `ship.sh` sets `COPYFILE_DISABLE=1` and
  excludes them.

## The database it writes

Aurora PostgreSQL, shared with the CRM, reached with `sslmode=verify-full`.
`run-etl.sh` reads `DATABASE_URL` out of the app's own `/opt/btb/app.env` so the
ETL cannot end up writing somewhere the CRM is not reading.

`lib/common.mjs` owns the schema for `parcels` (`PARCEL_COLUMNS`, `LIVE_DDL`,
`STAGING_DDL`) and its indexes. **The CRM reads these columns** — `src/lib/
parcels.ts` in the app selects them by name — so removing or renaming one is a
breaking change to a separate repo. Add freely; rename with a search over there
first.

**Zoning is a SEPARATE TABLE and must stay one.** `parcels` is refreshed by
`DELETE FROM parcels WHERE state = $1` and a re-insert, so a zoning column on it
would be blanked by every monthly run with no error, the right row count, and a
quietly null column. It lives in `parcel_zoning` (`lib/zoning.mjs`), keyed on the
same `(state, co_no, parcel_id)` the CRM already joins on.

**Zoning is not `dor_uc`.** `dor_uc` is what the assessor records a parcel as
being USED as; zoning is what the jurisdiction PERMITS. Neither the NAL roll nor
FDOR's statewide cadastral carries zoning at all — it is published per county,
which is why it is a per-county adapter.

**The parcel-id encodings collide, and that is the real hazard.** Orange County
writes `SS-TT-RR-…`, the roll writes `TT-RR-SS-…`; `swapParcelId` converts and
is its own inverse. But `312428000000005` is a real parcel in BOTH datasets and
a different one in each, so an unswapped join does not fail — it silently
attaches a neighbour's zoning to a million-dollar decision. Every row is
address-checked before it is written. Do not relax that guard to raise the match
rate.

**The county service is slow and sits behind a WAF.** 10-20 seconds per request
whatever you ask, so the job is driven by our parcels rather than by crawling
theirs (thirteen hours). `ZONING_CODE <> ''` and `PARCEL > 'x'` both draw a
**403 with an HTML body** from the filter in front of it; `IN (...)`,
`IS NOT NULL`, `orderByFields` and `resultOffset` are fine.

## The "what shipped" email (`digest.mjs`)

Sends staff an email when a deploy contains something they would notice. Three
properties matter more than the code:

**Silence is the default.** No email unless a deploy happened AND it contained a
user-visible change. Most days that is nothing and nobody hears anything. A
digest that arrives daily saying "no changes" is the thing people filter, and
once filtered the one that matters is filtered too.

**Shipped means DEPLOYED, not committed.** The input is release manifests
written to `s3://…/releases/<sha>.json` by `scripts/ship-app.sh` in the app
repo, never `git log`. The app tarball excludes `.git`, so the server has no
commit history — and a commit that has not been deployed is not shipped. That
distinction cost an hour once already, when a rename was pushed and stayed
invisible.

**A feature is never announced twice**, guarded three ways because a repeat is
what makes people stop reading:

1. A release SHA is processed once — `crm_release_log`.
2. The model is shown everything announced in the last 120 days and told to skip
   it, including follow-up fixes to it.
3. Every item carries a stable `key` slug, and that key is the PRIMARY KEY of
   `crm_announcements`. If the model ignores rule 2 the insert conflicts and the
   item is dropped before sending. **This is the guard that does not depend on
   the model behaving**, and it is why the key must describe the FEATURE rather
   than the commit — never put a date or a SHA in it.

Announcements are recorded only **after** a successful send, so a send failure
leaves the feature unannounced and retryable rather than silently suppressed.

Recipients are people who can actually reach the CRM: `portal_users` that are
not blocked, plus the `AUTH_USERS` built-ins, intersected with `CRM_ADMINS` when
that is set. Someone awaiting access would get a 404 on everything described.

Mail goes out through SES from `notifications@btbholdingsllc.com` with Reply-To
`info@ziora.io`. See the app repo's `CLAUDE.md` for why it is not sent from
ziora.io — the short version is that ziora.io's DNS is on Cloudflare, not
Route53.

`DRY_RUN=1` renders and logs without sending.
