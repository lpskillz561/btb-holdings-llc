# Pointing the Mini's n8n at Aurora

The parcel ETL lives in `ziora-capital-holdings/etl/` and used to write to the
Mini's local Postgres. It now writes to Aurora — but **not from the Mini**.

## Why it runs on EC2 rather than here

Aurora sits in private subnets, is not publicly accessible, and accepts
connections only from the app instance's security group. Reaching it from the
Mini would mean either exposing the database to the internet or holding a tunnel
open for hours while 19.5M rows cross a home uplink.

So n8n keeps doing what it already does — run on a schedule and execute a
command over SSH to the Mini — and that command now *dispatches* the ETL to the
app instance instead of running it locally. The data never leaves AWS.

```
n8n (Mini)  ──ssh──▶  run-etl-on-ec2.sh (Mini)  ──ssm──▶  EC2  ──▶  Aurora
   schedule              dispatch + wait             /opt/btb/run-etl.sh
```

## What already exists in AWS

| Thing | What it is |
|---|---|
| `BtbRunEtl` | SSM document. **Only** invokes `/opt/btb/run-etl.sh`, with `job` from a fixed list and `state` matched against a strict pattern. |
| `/opt/btb/run-etl.sh` | On the instance. Pulls `s3://btb-crm-deploy-761540266321/etl/etl.tar.gz`, installs, and runs the job against the app's own `DATABASE_URL`. |
| `btb-n8n-mini` | IAM user. May send **only** the `BtbRunEtl` document to **only** the app instance, and read the result. Nothing else. |

The narrow document is the point. The Mini holds a long-lived access key; if it
leaks, the blast radius is "someone can run the parcel importer", not "someone
has a root shell on the app server". `AWS-RunShellScript` would have given away
the latter.

## Setting up the Mini

1. **Install the AWS CLI** (v2) if it isn't there.

2. **Add the credentials** issued for `btb-n8n-mini`:

   ```bash
   aws configure --profile btb-n8n
   # access key / secret as supplied, region us-east-1, output json
   ```

3. **Copy the dispatcher** and make it executable:

   ```bash
   install -m 755 run-etl-on-ec2.sh /usr/local/bin/run-etl-on-ec2.sh
   ```

4. **Confirm it works** before touching n8n:

   ```bash
   AWS_PROFILE=btb-n8n BTB_INSTANCE_ID=i-03cf7050d5d33c713 \
     run-etl-on-ec2.sh reindex
   ```

   It should print the index report and exit 0.

## Changing the workflows

Only the SSH node's **command** changes. The schedule, the exit-code check and
the failure alert all stay as they are.

| Workflow | Old command | New command |
|---|---|---|
| `n8n-fl-parcel-refresh` | `cd … && STATE=ALL docker compose run --rm etl` | `AWS_PROFILE=btb-n8n BTB_INSTANCE_ID=i-03cf7050d5d33c713 /usr/local/bin/run-etl-on-ec2.sh parcels ALL` |
| `n8n-auction-sync` | `cd … && AUCTION_STATE=ALL docker compose run --rm auctions` | `… run-etl-on-ec2.sh auctions ALL` |
| `n8n-parcel-trigger` | conditional on `$json.state` | `… run-etl-on-ec2.sh parcels {{ $json.state }}` |

The dispatcher **waits for completion and exits non-zero on failure**, which is
what keeps the existing "fail on non-zero exit" branch meaningful. A plain
`aws ssm send-command` returns the moment the job is queued, so every run would
have looked successful — including the broken ones.

## Shipping a new ETL

The ETL is not vendored into this repo; it ships as its own artifact so the two
copies cannot drift.

```bash
cd ~/Documents/Ziora/ziora-capital-holdings/etl
tar --exclude=./node_modules --exclude='./n8n-*.json' -czf /tmp/etl.tar.gz -C . .
aws s3 cp /tmp/etl.tar.gz s3://btb-crm-deploy-761540266321/etl/etl.tar.gz --profile ziora
```

`run-etl.sh` re-downloads on every run, so the next scheduled job picks it up.

## Known state

`reindex` has been run end to end against Aurora and connects cleanly. It
reports `relation "parcels" does not exist`, which is correct — **no parcel data
has been loaded yet**. The first real job is a full `parcels` import:

```bash
AWS_PROFILE=btb-n8n BTB_INSTANCE_ID=i-03cf7050d5d33c713 \
  run-etl-on-ec2.sh parcels FL
```

Expect it to run for a long time and to re-hit the county sources, since this is
a fresh scrape rather than a copy of the Mini's database.

### The gotcha this cost

`/opt/btb/app.env` is written for the **container**, where the RDS CA bundle is
bind-mounted at `/etc/ssl/rds-ca.pem`. The ETL runs on the **host**, where that
path does not exist. `run-etl.sh` rewrites `sslrootcert` to `/opt/btb/rds-ca.pem`
before running; without it every job dies with `ENOENT` on the certificate
before opening a single connection.
