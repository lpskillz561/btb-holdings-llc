# The parcel and auction ETL

The importer runs **entirely on the app instance, on its own schedule**. There is
no second machine in the loop, no SSH hop, and no long-lived AWS access key.

```
systemd timer (EC2)  ──▶  /opt/btb/run-etl.sh  ──▶  node import.mjs  ──▶  Aurora
```

## Where the code lives

**`etl/` in this repo.** It owns its source, its `run-etl.sh`, its five systemd
units and its own `ship.sh`. Read `etl/CLAUDE.md` before changing anything in it.

**It is in this repo, but it does NOT ride this app's deploy.** `etl/ship.sh`
puts the importer in S3 and `run-etl.sh` re-pulls it on every run — seconds, no
image build, no restart — while the app needs a container rebuild. Keeping those
separate is why `--exclude=./etl` is in the app tarball and `etl` is in
`.dockerignore`.

**Why one repo and not two.** The dependency runs both ways: `etl/lib/common.mjs`
defines the `parcels` columns `src/lib/parcels.ts` selects by name, and
`etl/zoning.mjs` reads `crm_saved_parcels`, which this app owns. Across a repo
boundary that is a silent break waiting to happen — the same invisible coupling
that made the old shared arrangement a hazard. In one tree a rename is one
search.

**There is exactly one importer feeding this Aurora.** Do not re-introduce a
shared checkout, a submodule or a symlink to any other project.

## The schedule

| Timer | When | Runs |
|---|---|---|
| `btb-etl-parcels.timer` | Monthly, 1st at 07:00 UTC | `btb-etl@ALL.service` — every registered state |
| `btb-etl-auctions.timer` | Nightly, 09:00 UTC | `btb-etl-auctions.service` — `auctions ALL` |
| `btb-etl-zoning.timer` | Nightly, 10:00 UTC | `btb-etl-zoning@orange-fl.service` — county zoning |
| `btb-digest.timer` | Daily, 13:00 UTC | `btb-digest.service` — the "what shipped" email |

Both are `Persistent=true`, so a missed run fires on the next boot rather than
being skipped.

**The parcel timer names `ALL`, and that matters.** It used to name a single
state (`btb-etl@MT.service`), which meant the monthly refresh quietly covered
Montana and nothing else while reporting success — Florida, North Carolina and
Colorado would have gone stale indefinitely. `import.mjs` loops the registered
states inside one process, which also keeps the one-import-at-a-time rule
without depending on the `flock`.

Run one state by hand:

```bash
aws ssm send-command --instance-ids i-03cf7050d5d33c713 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["systemctl start --no-block btb-etl@FL.service"]' \
  --profile ziora
```

Use **systemd**, not a bare `run-etl.sh`: a `systemctl start --no-block` survives
the SSM session ending, and a long import will outlive it.

## Watching a run

```bash
journalctl -u btb-etl@FL.service -f      # on the instance
pgrep -af "node import.mjs"              # the truth about whether it is alive
```

`systemctl is-active --quiet` is **false** for a running `oneshot` — a long
`Type=oneshot` sits in `activating` for its whole life. Watch the process, not
the unit state. If a run looks wedged, the signature is in `pg_stat_activity`:
a `COPY` sitting in `Client/ClientRead` with an hours-old `xact_start`.

## Shipping a new ETL

From `etl/`, and **not** with the app's `deploy.sh`. `run-etl.sh` re-downloads
the source on every run, so the next scheduled job picks it up and there is no
deploy step beyond the upload.

```bash
cd etl
./ship.sh           # source only — the common case
./ship.sh --units   # also reinstall run-etl.sh and the systemd units
```

`ship.sh` refuses to run while an import is in flight, and strips macOS
AppleDouble files. **Do not hand-roll the tarball** — the previous instructions
did, and left eight `._*` files on the instance.

`infra/aws/btb-crm-app.yaml` also writes `run-etl.sh` and the units, but that is
a **bootstrap copy only**, so a fresh instance has working timers before
`etl/ship.sh` has ever run against it. `ship.sh --units` overwrites the lot, and
UserData does not re-run on an existing instance. **`etl/deploy/` is the source
of truth.**

## What was removed, and why

The Mini used to hold the schedule: n8n ran on a cron, SSH'd into itself, and a
dispatcher script (`run-etl-on-ec2.sh`) called a narrow SSM document (`BtbRunEtl`)
to make EC2 do the actual work. That existed because Aurora is private and the
Mini could not reach it.

Two systemd timers on the instance do the same job with no second machine, so
the dispatch path is gone:

- `run-etl-on-ec2.sh` — deleted.
- The three `n8n-*.json` workflow exports — deleted.
- The `btb-n8n-mini` IAM user, its inline policy and its access key — **deleted
  from AWS**. It had never been used: `get-access-key-last-used` reported no
  `LastUsedDate` at all, so the credential was issued and never exercised.

`BtbRunEtl` is deliberately **kept**. It is a narrow dispatch primitive — it can
only invoke `/opt/btb/run-etl.sh` with a job from a fixed list — and with no
principal holding a key to it, an unused document carries no standing risk.

> If n8n on the Mini still has those three workflows **enabled**, disable them
> there. Deleting the exports from git does not touch a running n8n, and their
> AWS credential no longer exists, so they will now fail on every fire.
