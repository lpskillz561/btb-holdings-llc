# Moving the CRM to AWS

Status: **in progress.** Infrastructure has started; the app has not been
extracted yet. This document is the brief for whoever picks it up, including a
fresh chat.

## Decisions taken (2026-08-02)

| | |
|---|---|
| AWS account / region | `761540266321` / `us-east-1` |
| Scope | **CRM only**, as a new standalone app. Marketing site and `/app` stay on the Mini. |
| Hostname | **`btbholdingsllc.com`** (+ `www`), registered via Amazon Registrar 2026-08-02, Route53 zone `Z04363912WJVD2S7E35SL` |
| Database | Aurora PostgreSQL **17.10** Serverless v2, 0.5-4 ACU, private subnets |
| Ingress | ALB + ACM, TLS at the load balancer. The portal login is the gate; `CRM_ADMINS` narrows it. |
| Networking | EC2 in a **public** subnet, no NAT Gateway (saves ~$32/mo). Inbound only from the ALB SG; shell via SSM Session Manager, no port 22, no key pair. |
| IaC | CloudFormation in `infra/aws/`. Two stacks so an app failure cannot roll Aurora back out. |

### Provisioned so far

- `btb-crm-core` stack: VPC `10.20.0.0/16`, 2 public + 2 private subnets, IGW,
  three security groups, Aurora Serverless v2 cluster + writer.
- ACM certificate for `btbholdingsllc.com` and `www`, DNS validation records
  already written into Route53.

### Blocked on

- **DNS propagation.** The domain was registered minutes before provisioning and
  did not yet resolve (`dig NS` empty), so the ACM certificate sits in
  `PENDING_VALIDATION`. It should validate on its own once the registrar's
  nameservers publish. Re-check with
  `aws acm describe-certificate --certificate-arn ... --query Certificate.Status`.
  Nothing else depends on it until the HTTPS listener is created.

### Next

1. Extract the CRM into a standalone Next.js app (see "What moves" below).
2. `btb-crm-app` stack: IAM instance role, EC2, ALB, target group, listeners,
   Route53 alias records.
3. `pg_dump` the Mini's parcels + auctions into Aurora.
4. n8n on the same instance, running the existing `etl/*.mjs` on a schedule.

## Goal

Extract the tiny-home CRM from this repo into its own site on AWS, backed by
Aurora PostgreSQL, hosted on EC2, with the land-data scrapers running on a
schedule under n8n. Once it is verified in AWS, the Mac Mini deployment is
decommissioned.

## Why this fits better than the Cloudflare route

The Cloudflare plan stalled on one fact: `parcels` is **12 GB / 19.5M rows**,
which exceeds D1's per-database ceiling, blows its CPU limit on a full scan, and
is billed on *rows scanned* — a single Florida `COUNT(*)` reads ~11M rows.

Aurora PostgreSQL removes that problem entirely, and removes a rewrite with it:

- The whole data layer is `pg` against Postgres. **Against Aurora it ports
  unchanged** — no SQLite dialect work, no rewriting `::bigint`, `to_char`,
  `FILTER (WHERE …)`, `ON CONFLICT … RETURNING`, or the LATERAL joins in
  `parcels.ts`.
- `lib/crm/schema.ts` self-migrates on first query, so there is no migration
  step to port either.
- Land search keeps working exactly as it does today.

## Target architecture

```
Route53 + ACM
   └── ALB (or Caddy on the instance — see cost note)
         └── EC2 (private subnet, ARM t4g) : docker compose
               ├── web        Next.js standalone (marketing + portal + CRM)
               └── n8n        schedules etl/import.mjs + etl/auctions.mjs
         └── Aurora PostgreSQL (private subnets, 2 AZ)
   S3: pg_dump backups, proposal PDFs, documents
   Secrets Manager / SSM: OPENAI_API_KEY, AUTH_SECRET, DB password
   CloudWatch: logs + alarms
```

## What moves, and how

| Piece | Action |
|---|---|
| `web/` app | Lift as-is. It already builds a standalone container. |
| CRM + portal tables | `ensureAppSchema` creates them on first request. Nothing to migrate if starting clean. |
| `parcels` + `auctions` (12 GB) | **`pg_dump` → `pg_restore`, do not re-scrape.** Faster, exact, and avoids re-hitting county sources. |
| ETL | `etl/*.mjs` unchanged; point `DATABASE_URL` at Aurora. |
| n8n | `etl/n8n-auction-sync.json`, `n8n-fl-parcel-refresh.json`, `n8n-parcel-trigger.json` already exist — import them and repoint the DB creds. |
| Cloudflare Access | Replaced by the portal login, or put an ALB + Cognito/OIDC in front. Decide before cutover. |
| `/app` platform zone | **Out of scope.** Either leave it on the Mini and proxy, or drop the `/app` rewrite from the CRM site. |

## Cost — read before committing

The Mini is effectively free; this is not. Rough us-east-1 monthly:

| Item | ~Cost |
|---|---|
| Aurora PostgreSQL Serverless v2 (0.5 ACU floor) | ~$45 |
| — or RDS PostgreSQL `db.t4g.medium` | ~$50 on-demand, ~$30 reserved |
| EC2 `t4g.medium` | ~$24 |
| EBS 40 GB gp3 | ~$3 |
| ALB (skippable) | ~$16 |
| S3 + CloudWatch + transfer | a few $ |
| **Total** | **~$80–150/month** |

Two things worth checking before you pick Aurora:

1. **Aurora vs plain RDS.** At 12 GB and this traffic, Aurora's advantages
   (storage autoscaling, fast failover, read replicas) do not obviously pay for
   themselves. RDS PostgreSQL is cheaper and functionally identical here. Aurora
   is a fine choice — just make it deliberately.
2. **Bulk-load I/O.** Standard Aurora bills per I/O. Restoring 19.5M rows is a
   large one-time I/O charge. Consider Aurora **I/O-Optimized** during the load,
   or use RDS where I/O is not metered separately. Check whether Serverless v2
   scale-to-zero is available in your region if the DB will idle.

## Plan

1. **Access + baseline** — CLI profile, confirm account, pick region, decide new
   VPC vs existing.
2. **Network** — VPC, 2 public + 2 private subnets, IGW, NAT (or VPC endpoints
   to avoid NAT cost), security groups (Aurora reachable only from the app SG).
3. **Aurora** — cluster in private subnets, password in Secrets Manager,
   automated backups + PITR on from day one.
4. **Data** — `pg_dump` from the Mini, restore into Aurora, verify row counts
   (`parcels` 19,495,298 / `auctions` 4,111 as of 2026-08-02) and re-run
   `etl/reindex.mjs`.
5. **App host** — EC2 in a private subnet, Docker, compose file with `web` and
   `n8n`, secrets from SSM at boot.
6. **Ingress** — ALB + ACM, or Caddy on the instance with Let's Encrypt.
   Route53 record for the CRM hostname.
7. **Backups** — nightly `pg_dump` to S3 with lifecycle expiry. **This is
   currently missing entirely and must not be missing again.**
8. **Verify** — full pass: schema bootstrap, login, client CRUD, cost rollup,
   proposal generation, land search, print page. Use a real browser, not curl
   (see `CLAUDE.md`).
9. **Cut over** — DNS, monitor, then decommission.

## What is needed to start

- AWS CLI configured locally as a named profile — **not keys pasted into a
  chat.** `aws configure --profile ziora`, then
  `aws sts get-caller-identity --profile ziora` to confirm.
- Permissions: EC2, VPC, RDS, S3, IAM (role creation), Secrets Manager/SSM,
  CloudWatch, and Route53 + ACM if DNS is in the same account.
- Decisions: region; new VPC or existing; Aurora or RDS; ALB or Caddy; the
  hostname; and what replaces Cloudflare Access.

## Decommission checklist — do not skip

Only after the AWS build has run in production for a sensible period:

- [ ] Verified `pg_dump` restore in AWS matches Mini row counts
- [ ] A restore from the S3 backup has actually been **tested**, not just taken
- [ ] n8n schedules confirmed running against Aurora
- [ ] DNS moved and propagated; Cloudflare Access policy retired or replaced
- [ ] Portal accounts confirmed present in the new `portal_users` table
- [ ] Final Mini `pg_dump` archived off-box
- [ ] Then, and only then, stop the Mini containers
