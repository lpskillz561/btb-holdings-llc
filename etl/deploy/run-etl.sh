#!/bin/bash
set -euo pipefail
# Never `set -x`: DATABASE_URL carries the database password.

# Only one import at a time. import.mjs loads into a SINGLE shared
# `parcels_staging` table and then swaps one state's rows out of it, so two
# states running concurrently would interleave rows and swap each other's data.
# flock makes a second state WAIT rather than corrupt - which also means
# queueing the next state is just starting it.
exec 9>/var/lock/btb-etl.lock
flock 9

JOB="${1:-parcels}"
STATE="${2:-ALL}"
REGION="us-east-1"
BUCKET="btb-crm-deploy-761540266321"

# This ETL is its own repo (btb-etl) and ships as its own artifact. It is NOT
# vendored into the CRM repo: two copies of an importer that writes production
# data is two things to keep in step, and the one that drifts is the one nobody
# is looking at. The CRM ships from source/app.tar.gz; this ships from
# etl/etl.tar.gz in the same bucket, on its own cadence.
rm -rf /opt/btb/etl
mkdir -p /opt/btb/etl
aws s3 cp "s3://$BUCKET/etl/etl.tar.gz" /tmp/etl.tar.gz --region "$REGION"
tar -xzf /tmp/etl.tar.gz -C /opt/btb/etl
rm -f /tmp/etl.tar.gz

# Reuse the app's own DATABASE_URL, so the ETL writes to exactly
# the database the CRM reads. app.env is 0600 and root-owned.
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' /opt/btb/app.env | cut -d= -f2-)"
if [ -z "$DATABASE_URL" ]; then
  echo "[etl] FATAL: no DATABASE_URL in /opt/btb/app.env" >&2
  exit 1
fi

# app.env is written for the CONTAINER, where the RDS CA bundle is
# bind-mounted at /etc/ssl/rds-ca.pem. The ETL runs on the host,
# where that path does not exist and the bundle is at
# /opt/btb/rds-ca.pem. Without this rewrite every ETL run dies with
# ENOENT on the certificate before it opens a single connection.
DATABASE_URL="$(printf '%s' "$DATABASE_URL" \
  | sed 's#/etc/ssl/rds-ca.pem#/opt/btb/rds-ca.pem#')"

cd /opt/btb/etl
[ -f package.json ] && npm install --omit=dev --silent

echo "[etl] $JOB ($STATE) starting $(date -u)"
case "$JOB" in
  parcels)
    DATABASE_URL="$DATABASE_URL" STATE="$STATE" node import.mjs ;;
  auctions)
    DATABASE_URL="$DATABASE_URL" AUCTION_STATE="$STATE" node auctions.mjs ;;
  zoning)
    # STATE carries the county key here ("orange-fl"), not a state code - the
    # unit is templated on one argument and zoning is published per county.
    DATABASE_URL="$DATABASE_URL" ZONING_COUNTY="$STATE" node zoning.mjs ;;
  reindex)
    DATABASE_URL="$DATABASE_URL" node reindex.mjs ;;
  *)
    echo "[etl] unknown job '$JOB'" >&2; exit 2 ;;
esac
echo "[etl] $JOB complete $(date -u)"
