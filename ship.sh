#!/usr/bin/env bash
set -euo pipefail
#
# Ship this ETL to the EC2 instance that runs it.
#
# This repo owns its own deployment. It does NOT ride along with the CRM's
# deploy: an ETL change and an app change are different risks on different
# cadences, and coupling them means you cannot fix a broken adapter without
# also shipping whatever is currently uncommitted in the app.
#
# Two artifacts go up:
#   1. the ETL source itself, which run-etl.sh pulls fresh on every run
#   2. deploy/ - run-etl.sh and the systemd units, installed on the instance
#
# Usage:
#   ./ship.sh            source only (the common case)
#   ./ship.sh --units    source + reinstall run-etl.sh and the systemd units
#
# NEVER ship while an import is running. run-etl.sh re-extracts /opt/btb/etl on
# every run, so replacing the tarball mid-run is safe for the CURRENT process
# (it already read its files) but the next one gets the new code; the real
# hazard is --units, which rewrites the script that is executing.

INSTANCE="i-03cf7050d5d33c713"
BUCKET="btb-crm-deploy-761540266321"
PROFILE="${AWS_PROFILE:-ziora}"
REGION="us-east-1"

cd "$(dirname "$0")"

echo "[ship] checking no import is in flight"
RUNNING=$(aws ssm send-command --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["pgrep -f \"node (import|auctions).mjs\" >/dev/null && echo BUSY || echo IDLE"]' \
  --profile "$PROFILE" --region "$REGION" --query 'Command.CommandId' --output text)
while [ "$(aws ssm get-command-invocation --command-id "$RUNNING" --instance-id "$INSTANCE" \
    --profile "$PROFILE" --region "$REGION" --query 'Status' --output text 2>/dev/null)" = "InProgress" ]; do
  sleep 3
done
STATE=$(aws ssm get-command-invocation --command-id "$RUNNING" --instance-id "$INSTANCE" \
  --profile "$PROFILE" --region "$REGION" --query 'StandardOutputContent' --output text | tr -d '[:space:]')
if [ "$STATE" = "BUSY" ]; then
  echo "[ship] REFUSING: an ETL job is running. Wait for it, or stop it deliberately." >&2
  exit 1
fi

# COPYFILE_DISABLE=1 is not tidiness. macOS tar writes an AppleDouble `._name`
# beside every file to carry extended attributes; a previous hand-rolled ship
# put eight of them on the instance. Harmless for .mjs, which nothing loads by
# glob - but the CRM repo lost an afternoon to `._SKILL.md` being picked up by a
# loader that globbed *.md, so they do not ship from here either.
echo "[ship] packaging source"
COPYFILE_DISABLE=1 tar \
  --exclude=./.git --exclude=./node_modules --exclude='._*' --exclude=./deploy \
  -czf /tmp/etl.tar.gz -C . .

aws s3 cp /tmp/etl.tar.gz "s3://$BUCKET/etl/etl.tar.gz" --profile "$PROFILE" --region "$REGION"
rm -f /tmp/etl.tar.gz
echo "[ship] source uploaded"

if [ "${1:-}" = "--units" ]; then
  echo "[ship] installing run-etl.sh and systemd units"
  # Base64 through SSM rather than S3: the instance role can READ the deploy
  # bucket but deliberately cannot write it, and these are small.
  PAYLOAD=$(COPYFILE_DISABLE=1 tar --exclude='._*' -czf - -C deploy . | base64 | tr -d '\n')
  CMD=$(python3 - "$PAYLOAD" <<'PY'
import json, sys
b64 = sys.argv[1]
script = (
  f'echo {b64} | base64 -d > /tmp/units.tgz && mkdir -p /tmp/units && '
  'tar -xzf /tmp/units.tgz -C /tmp/units && '
  'install -m 0755 /tmp/units/run-etl.sh /opt/btb/run-etl.sh && '
  'install -m 0644 /tmp/units/*.service /tmp/units/*.timer /etc/systemd/system/ && '
  'systemctl daemon-reload && '
  # Enable EVERY timer just installed, derived from the files themselves. This
  # list used to be hardcoded, so adding btb-etl-zoning.timer installed the unit
  # and left it disabled - a timer that exists, fires never and reports nothing,
  # the same failure shape as the parcel timer that once ran a single state.
  'for t in /tmp/units/*.timer; do systemctl enable --now "$(basename "$t")"; done && '
  'rm -rf /tmp/units /tmp/units.tgz && '
  'systemctl list-timers "btb-*" --all --no-pager'
)
json.dump({"commands": [script]}, sys.stdout)
PY
)
  echo "$CMD" > /tmp/ship-units.json
  CID=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
    --parameters file:///tmp/ship-units.json --profile "$PROFILE" --region "$REGION" \
    --query 'Command.CommandId' --output text)
  while [ "$(aws ssm get-command-invocation --command-id "$CID" --instance-id "$INSTANCE" \
      --profile "$PROFILE" --region "$REGION" --query 'Status' --output text 2>/dev/null)" = "InProgress" ]; do
    sleep 3
  done
  aws ssm get-command-invocation --command-id "$CID" --instance-id "$INSTANCE" \
    --profile "$PROFILE" --region "$REGION" --query 'StandardOutputContent' --output text
  rm -f /tmp/ship-units.json
fi

echo "[ship] done. Next scheduled run picks this up; to run now:"
echo "  aws ssm send-command --instance-ids $INSTANCE --document-name AWS-RunShellScript \\"
echo "    --parameters 'commands=[\"systemctl start --no-block btb-etl@FL.service\"]' --profile $PROFILE"
