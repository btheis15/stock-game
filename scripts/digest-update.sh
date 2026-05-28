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

# --- Cross-pipeline git lock --------------------------------------------
# cron-update.sh and digest-update.sh can be fired by the scheduler at the
# same minute (e.g. 7:00 AM is both a 15-min refresh tick and the default
# briefing time). Both scripts touch git, and concurrent git
# fetch/pull/commit on the same repo races on .git/index.lock and refs
# locks — under `set -e` the loser aborts the whole pipeline. macOS has
# no flock(1), so we use mkdir as the atomic primitive.
GIT_LOCK_DIR="/tmp/stock-game-git.lock"
acquire_git_lock() {
  local timeout=300 elapsed=0
  while ! mkdir "$GIT_LOCK_DIR" 2>/dev/null; do
    if [ "$elapsed" -ge "$timeout" ]; then
      log "git lock held for >${timeout}s by another pipeline — aborting"
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
}
release_git_lock() { rmdir "$GIT_LOCK_DIR" 2>/dev/null || true; }
trap release_git_lock EXIT

DIGEST_MODE="${DIGEST_MODE:-full}"
DIGEST_SCOPE="${DIGEST_SCOPE:-daily}"

case "$DIGEST_SCOPE" in
  daily|weekly|game|finalize) ;;
  fast)
    log "scope=fast belongs in cron-update.sh, not this script — skipping"
    exit 0
    ;;
  *)
    log "unknown DIGEST_SCOPE='$DIGEST_SCOPE' (expected daily|weekly|game|finalize|fast)"
    exit 2
    ;;
esac

# DIGEST_CHUNK = "N/M" (0-indexed). When set, digest.swift slices DEFAULT_TICKERS
# into M groups and runs only the Nth. The scheduler's chunked-morning mode
# uses this to spread the daily run across hourly passes.
DIGEST_CHUNK="${DIGEST_CHUNK:-}"

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
acquire_git_lock || exit 1
git fetch origin main
git pull --rebase --autostash origin main
release_git_lock

# Fundamentals refresh — daily, chunk 0 only. Pulls company profile + key
# statistics + financial statements + earnings history into
# public/data/fundamentals.json for the About / Financials / Earnings sections
# on /stock/[ticker]. Fast (~30s for 45 tickers); failures don't block the
# digest pipeline. Skipped on the weekly tier (data only changes after
# earnings releases — Saturday morning would catch nothing new the prior
# weekday didn't), and skipped on later chunks within a chunked morning so
# the fundamentals fetch only runs once per day.
if [ "$DIGEST_SCOPE" = "daily" ] && { [ -z "$DIGEST_CHUNK" ] || [[ "$DIGEST_CHUNK" == 0/* ]]; }; then
  log "refreshing fundamentals"
  if ! (cd "$REPO_DIR" && npm run --silent fetch-fundamentals); then
    log "fundamentals refresh failed — continuing with digest pipeline"
  fi
fi

# Apple Intelligence availability is checked inside digest.swift — if
# unavailable, the script exits 0 silently and yesterday's digests.json keeps
# serving. So we don't need a guard here.
swift_args=(
  "$SCRIPT_DIR/digest.swift"
  "--output" "$REPO_DIR/public/digests.json"
  "--scope"  "$DIGEST_SCOPE"
)
if [ -n "$DIGEST_CHUNK" ]; then
  swift_args+=("--chunk" "$DIGEST_CHUNK")
fi
chunk_label="${DIGEST_CHUNK:+, chunk=$DIGEST_CHUNK}"
if [ "$DIGEST_MODE" = "digests-only" ] || [ "$DIGEST_SCOPE" = "weekly" ] || [ "$DIGEST_SCOPE" = "game" ] || [ "$DIGEST_SCOPE" = "finalize" ]; then
  swift_args+=("--digests-only")
  log "running digest pipeline — scope=$DIGEST_SCOPE$chunk_label, digests-only (no RSS fetch)"
else
  log "running digest pipeline — scope=$DIGEST_SCOPE$chunk_label, full (RSS fetch + scoring)"
fi
swift "${swift_args[@]}"

# Stage digests.json + fundamentals.json — both files are managed by this
# pipeline. Other WIP stays unstaged so unrelated dev work doesn't get
# auto-committed.
if [ -z "$(git status --porcelain public/digests.json public/data/fundamentals.json)" ]; then
  log "no digest or fundamentals changes since last run"
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
log "digests/fundamentals changed — committing locally (push deferred to next price refresh)"
acquire_git_lock || exit 1
git add public/digests.json public/data/fundamentals.json
git commit -m "digests: $(ts)"
release_git_lock

log "digest update done"
