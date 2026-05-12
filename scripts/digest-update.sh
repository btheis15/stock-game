#!/usr/bin/env bash
# Daily digest pipeline + deploy for Stock Game.
#
# What this does:
#   1. Refuses to run if scripts/.pause exists or if not on main
#   2. Rebases onto origin/main so laptop merges don't conflict with our push
#   3. Runs scripts/digest.swift — Apple Intelligence on-device generates
#      per-ticker, per-portfolio, and game-wide news digests
#   4. If public/digests.json changed: commits locally
#   5. cron-update.sh's next push carries the digest commit along
#
# Two tier flags (passed via env):
#   DIGEST_SCOPE  = daily   (default) — morning briefing run
#                 = weekly            — slow windows (1M/3M/1Y/ALL) for
#                                       holdings + portfolios; no RSS fetch
#                 = fast              — game 1D/1W/1M template re-render only
#                                       (cron-update.sh invokes this directly,
#                                        not this script — see that one)
#   DIGEST_MODE   = full    (default) — RSS fetch + AI scoring
#                 = digests-only      — skip fetch, regenerate from archive

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

DIGEST_MODE="${DIGEST_MODE:-full}"
DIGEST_SCOPE="${DIGEST_SCOPE:-daily}"

case "$DIGEST_SCOPE" in
  daily|weekly) ;;
  fast)
    log "scope=fast belongs in cron-update.sh, not this script — skipping"
    exit 0
    ;;
  *)
    log "unknown DIGEST_SCOPE='$DIGEST_SCOPE' (expected daily|weekly|fast)"
    exit 2
    ;;
esac

log "digest update starting in $REPO_DIR (scope=$DIGEST_SCOPE mode=$DIGEST_MODE)"

if [ -e "$SCRIPT_DIR/.pause" ]; then
  log "scripts/.pause exists — skipping digest run"
  exit 0
fi

current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo "")"
if [ "$current_branch" != "main" ]; then
  log "current branch is '$current_branch', not main — skipping digest run"
  exit 0
fi

# Sync before generating so the digest commit always fast-forwards.
log "rebasing onto origin/main"
git fetch origin main
git pull --rebase --autostash origin main

# Apple Intelligence availability is checked inside digest.swift — if
# unavailable, the script exits 0 silently and yesterday's digests.json keeps
# serving. So we don't need a guard here.
swift_args=(
  "$SCRIPT_DIR/digest.swift"
  "--output" "$REPO_DIR/public/digests.json"
  "--scope"  "$DIGEST_SCOPE"
)
if [ "$DIGEST_MODE" = "digests-only" ] || [ "$DIGEST_SCOPE" = "weekly" ]; then
  swift_args+=("--digests-only")
  log "running digest pipeline — scope=$DIGEST_SCOPE, digests-only (no RSS fetch)"
else
  log "running digest pipeline — scope=$DIGEST_SCOPE, full (RSS fetch + scoring)"
fi
swift "${swift_args[@]}"

# Stage only digests.json — unrelated WIP never gets auto-committed.
if [ -z "$(git status --porcelain public/digests.json)" ]; then
  log "no digest changes since last run"
  log "digest update done"
  exit 0
fi

# Commit only — the digest pipeline never pushes. The next price refresh
# (cron-update.sh, fires every ~15 min) is the only publisher; it picks up
# any unpushed local commits along with its own data commit and pushes
# everything in one fast-forward. This eliminates the git-push race that
# would otherwise exist between the two concurrent pipelines: only one
# process touches origin/main, ever. Trade-off: a manual run on a day
# when the refresh isn't scheduled (weekend etc.) will sit unpushed until
# the next refresh fires. Run `git push` manually in that case.
log "digests changed — committing locally (push deferred to next price refresh)"
git add public/digests.json
git commit -m "digests: $(ts)"

log "digest update done"
