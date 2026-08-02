#!/usr/bin/env bash
# Run the parcel ETL on the AWS app instance, from the Mac Mini.
#
# This is what the n8n SSH node should call INSTEAD of the old
# `docker compose run --rm etl`. The workflow keeps its shape — schedule, run a
# command over SSH to the Mini, check the exit code — and only the command
# changes.
#
# Why not run the ETL on the Mini against Aurora? Because Aurora sits in private
# subnets and accepts connections only from the app instance's security group.
# Reaching it from here would mean either exposing the database or holding a
# tunnel open for hours while 19.5M rows cross a home uplink. Running the work
# where the data already lives avoids both.
#
# `aws ssm send-command` returns immediately, so this polls to completion and
# exits non-zero if the ETL failed — otherwise n8n's "fail on non-zero exit"
# branch could never fire and a broken import would look like a successful one.
#
#   Usage:  run-etl-on-ec2.sh parcels [STATE]
#           run-etl-on-ec2.sh auctions [STATE]
set -euo pipefail

JOB="${1:-parcels}"
STATE="${2:-ALL}"

: "${BTB_INSTANCE_ID:?set BTB_INSTANCE_ID (the app instance)}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE_ARG=""
[ -n "${AWS_PROFILE:-}" ] && AWS_PROFILE_ARG="--profile $AWS_PROFILE"

case "$JOB" in
  parcels|auctions|reindex) ;;
  *) echo "unknown job '$JOB' (expected: parcels | auctions | reindex)" >&2; exit 2 ;;
esac

echo "[etl] dispatching $JOB ($STATE) to $BTB_INSTANCE_ID"

# BtbRunEtl, not AWS-RunShellScript. The document can only invoke
# /opt/btb/run-etl.sh, with `job` from a fixed list and `state` matched against a
# strict pattern, and the IAM user attached to these credentials may use no other
# document. The Mini holds a long-lived access key; if it ever leaks, the blast
# radius is "runs the ETL", not "root shell on the app server".
CMD_ID="$(aws ssm send-command $AWS_PROFILE_ARG --region "$AWS_REGION" \
  --instance-ids "$BTB_INSTANCE_ID" \
  --document-name BtbRunEtl \
  --comment "n8n: $JOB $STATE" \
  --parameters "job=$JOB,state=$STATE" \
  --query Command.CommandId --output text)"

echo "[etl] command id $CMD_ID"

# A full state import runs for a long time; poll patiently rather than guessing
# a duration. 4h ceiling so a wedged job cannot hold the n8n execution forever.
DEADLINE=$(( $(date +%s) + 14400 ))
while :; do
  STATUS="$(aws ssm get-command-invocation $AWS_PROFILE_ARG --region "$AWS_REGION" \
    --command-id "$CMD_ID" --instance-id "$BTB_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in
    Success) break ;;
    Failed|Cancelled|TimedOut|Undeliverable|Terminated)
      echo "[etl] FAILED with status $STATUS" >&2
      aws ssm get-command-invocation $AWS_PROFILE_ARG --region "$AWS_REGION" \
        --command-id "$CMD_ID" --instance-id "$BTB_INSTANCE_ID" \
        --query 'StandardErrorContent' --output text >&2 || true
      exit 1 ;;
  esac
  [ "$(date +%s)" -gt "$DEADLINE" ] && { echo "[etl] gave up waiting after 4h" >&2; exit 1; }
  sleep 30
done

aws ssm get-command-invocation $AWS_PROFILE_ARG --region "$AWS_REGION" \
  --command-id "$CMD_ID" --instance-id "$BTB_INSTANCE_ID" \
  --query 'StandardOutputContent' --output text
echo "[etl] done"
