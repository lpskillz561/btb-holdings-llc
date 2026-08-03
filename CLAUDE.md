# btb-etl — working notes

The parcel and auction importer for the BTB Holdings CRM. **This repo owns
itself.** It ships to, and runs on, the CRM's EC2 instance, on its own schedule
and through its own `ship.sh`. It is not vendored into the app and does not ride
the app's deploy.

Read `README.md` for what it does. This file is what is not obvious from the
code and has already cost time.

## Where this came from, and what changed

It used to live inside `ziora-capital-holdings/etl/` and was shared by two
consumers: this production Aurora database, and a research tool on a Mac Mini
reading its own local Postgres. That coupling was invisible from both sides — a
commit in that repo silently changed what production ingested, with nothing in
either place to say so.

**That link is cut.** This is now the only copy that feeds BTB. If the Mini's
research tool still needs an importer it keeps its own; the two are free to
diverge, which is the point. Do not re-introduce a shared checkout, a submodule,
or a symlink.

## How it runs

Nothing here runs on a laptop against production. The instance runs it:

| Unit | Schedule | Job |
|---|---|---|
| `btb-etl-parcels.timer` | monthly, 1st at 07:00 UTC | `btb-etl@ALL.service` |
| `btb-etl-auctions.timer` | nightly at 09:00 UTC | `btb-etl-auctions.service` |

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

**There is no zoning column and never has been.** `dor_uc` is the Florida DOR
*use* code — what a parcel is used AS, per the assessor. Zoning is what a
jurisdiction PERMITS, is published per county and per municipality, and is in
neither the NAL roll nor FDOR's statewide cadastral. If zoning is added it is a
new source, not a new column on an existing one.
