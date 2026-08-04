#!/usr/bin/env bash
set -euo pipefail
#
# Ship the CRM app, and record what went out.
#
# Replaces the hand-typed tar/cp/ssm sequence in docs/AWS-MIGRATION.md. The
# reason it is a script rather than three commands is the release manifest: the
# "what shipped" digest has to know which commits reached production, and only
# this machine knows that, because:
#
#   - The deploy tarball EXCLUDES .git, so the server has no commit history.
#   - Pushing to GitHub is not deploying. A commit that has not been through
#     here is not shipped, and must not be announced. That distinction has
#     already caused an hour of "why can't I see my change".
#
# So on each ship this writes releases/<sha>.json to S3 with the commits since
# the previous ship, and etl/digest.mjs reads those.
#
# Usage:  ./scripts/ship-app.sh            ship and deploy
#         ./scripts/ship-app.sh --dry-run  show what would be recorded

INSTANCE="i-03cf7050d5d33c713"
BUCKET="btb-crm-deploy-761540266321"
PROFILE="${AWS_PROFILE:-ziora}"
REGION="us-east-1"
DRY="${1:-}"

cd "$(dirname "$0")/.."

SHA=$(git rev-parse HEAD)
SHORT=$(git rev-parse --short HEAD)

if [ -n "$(git status --porcelain)" ]; then
  echo "[ship] WARNING: working tree is dirty. The tarball is built from the"
  echo "[ship]          WORKING TREE, so uncommitted work WILL ship — but the"
  echo "[ship]          release manifest can only describe commits, so it will"
  echo "[ship]          not be announced. Commit first if it should be."
  git status --short | sed 's/^/[ship]          /'
fi

# The previous shipped SHA, so the manifest covers exactly what is new. Kept in
# S3 rather than a local file: it is a property of what production is running,
# not of any one laptop.
PREV=$(aws s3 cp "s3://$BUCKET/releases/_last" - --region "$REGION" 2>/dev/null | tr -d '[:space:]' || true)

if [ -n "$PREV" ] && git cat-file -e "$PREV^{commit}" 2>/dev/null; then
  RANGE="$PREV..HEAD"
else
  # First ship, or the recorded SHA is not in this clone's history (a rebase, or
  # a fresh clone). Fall back to the last few commits rather than the entire
  # history, which would produce a manifest nobody wants to read.
  echo "[ship] no usable previous SHA — recording the last 10 commits only"
  RANGE="HEAD~10..HEAD"
fi

COMMITS=$(git log "$RANGE" --no-merges --format=%H | wc -l | tr -d ' ')
# Truncate first, default second. Bash has no combined "substring with a
# default" form: ${PREV:0:7:-none} is a syntax error, and it printed one on
# every ship because the echo still ran.
SINCE="${PREV:0:7}"
echo "[ship] $SHORT — $COMMITS commit(s) since ${SINCE:-none}"

python3 - "$SHA" "$RANGE" > /tmp/release.json <<'PY'
import json, subprocess, sys, datetime
sha, rng = sys.argv[1], sys.argv[2]
# %x1f / %x1e are unit and record separators: commit bodies contain newlines,
# blank lines and every kind of punctuation, so anything printable would
# eventually be ambiguous.
out = subprocess.run(
    ["git", "log", rng, "--no-merges", f"--format=%H%x1f%s%x1f%b%x1e"],
    capture_output=True, text=True, check=True).stdout
commits = []
for rec in out.split("\x1e"):
    rec = rec.strip("\n")
    if not rec.strip():
        continue
    h, subject, body = (rec.split("\x1f") + ["", ""])[:3]
    commits.append({"sha": h, "subject": subject, "body": body.strip()})
json.dump({
    "sha": sha,
    "shipped_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "commits": commits,
}, sys.stdout, indent=1)
PY

echo "[ship] manifest:"
python3 -c "
import json;d=json.load(open('/tmp/release.json'))
for c in d['commits'][:20]: print('   -', c['subject'][:78])
print(f\"   ({len(d['commits'])} total)\")"

if [ "$DRY" = "--dry-run" ]; then
  echo "[ship] dry run — nothing uploaded, nothing deployed"
  exit 0
fi

# --exclude=./etl keeps the importer out of the app image: it ships on its own
# path and never runs in this container. --exclude=./docs is not tidiness -
# that directory holds client legal and tax material.
# COPYFILE_DISABLE=1 stops macOS writing an AppleDouble `._name` beside every
# file; `._SKILL.md` ends in .md and was once concatenated into every AI prompt.
echo "[ship] packaging"
COPYFILE_DISABLE=1 tar --exclude=./.git --exclude=./node_modules --exclude=./.next \
    --exclude=./docs --exclude=./etl --exclude=./tsconfig.tsbuildinfo --exclude='._*' \
    -czf /tmp/app.tar.gz -C . .

aws s3 cp /tmp/app.tar.gz "s3://$BUCKET/source/app.tar.gz" --profile "$PROFILE" --region "$REGION"
aws s3 cp /tmp/release.json "s3://$BUCKET/releases/$SHA.json" --profile "$PROFILE" --region "$REGION"
rm -f /tmp/app.tar.gz

echo "[ship] deploying"
CID=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters commands=/opt/btb/deploy.sh --timeout-seconds 1800 \
  --profile "$PROFILE" --region "$REGION" --query 'Command.CommandId' --output text)
while [ "$(aws ssm get-command-invocation --command-id "$CID" --instance-id "$INSTANCE" \
    --profile "$PROFILE" --region "$REGION" --query 'Status' --output text 2>/dev/null)" = "InProgress" ]; do
  sleep 15
done
STATUS=$(aws ssm get-command-invocation --command-id "$CID" --instance-id "$INSTANCE" \
  --profile "$PROFILE" --region "$REGION" --query 'Status' --output text)
echo "[ship] deploy: $STATUS"
[ "$STATUS" = "Success" ] || { echo "[ship] deploy failed — NOT recording this as shipped" >&2; exit 1; }

# Only after a successful deploy. If the deploy failed, the next ship should
# still cover these commits.
printf '%s' "$SHA" > /tmp/_last
aws s3 cp /tmp/_last "s3://$BUCKET/releases/_last" --profile "$PROFILE" --region "$REGION" >/dev/null
rm -f /tmp/_last /tmp/release.json
echo "[ship] done — $SHORT is live. The digest job will announce anything user-visible."
