#!/usr/bin/env bash
# Cron-friendly update + deploy for Stock Game.
#
# What this does:
#   1. Refuses to run if not on main or if scripts/.pause exists
#   2. Rebases onto origin/main so laptop merges don't conflict with our push
#   3. Fetches latest closing prices into public/data/prices.json (incremental)
#   4. If anything changed: commits + pushes to GitHub
#   5. The GitHub→Vercel webhook auto-deploys on push to main
#
# Designed to be safe to run every 5 minutes / hourly / daily — exits cleanly
# if there's nothing new.
#
# Setup once on the Mac mini:
#   brew install node
#   npm install --legacy-peer-deps
#   git config core.hooksPath .githooks
#
# Then in crontab (or via scripts/stockgame_schedule.py):
#   30 16 * * 1-5 /path/to/stock-game/scripts/cron-update.sh >> /tmp/stock-game.log 2>&1
#
# To pause without closing the scheduler UI:  touch scripts/.pause
# To resume:                                   rm scripts/.pause

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

# Make sure brew/npm/git are findable when invoked from cron (PATH is minimal)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

# --- Cross-pipeline git lock --------------------------------------------
# cron-update.sh and digest-update.sh can be fired by the scheduler at the
# same minute (e.g. 7:00 AM is both a 15-min refresh tick and the default
# briefing time). Both scripts touch git, and concurrent git
# fetch/pull/commit/push on the same repo races on .git/index.lock and
# refs locks — under `set -e` the loser aborts the whole pipeline. macOS
# has no flock(1), so we use mkdir as the atomic primitive.
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

log "starting update in $REPO_DIR"

# Pause marker — `touch scripts/.pause` halts the schedule cleanly.
if [ -e "$SCRIPT_DIR/.pause" ]; then
  log "scripts/.pause exists — skipping run"
  exit 0
fi

# Branch guard — only run on main. Avoids polluting feature branches if a
# branch is accidentally checked out on the Mac mini.
current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo "")"
if [ "$current_branch" != "main" ]; then
  log "current branch is '$current_branch', not main — skipping run"
  exit 0
fi

# Sync with origin/main before doing work — handles laptop merges so our push
# always fast-forwards. --autostash protects against any accidental WIP.
#
# Post-pull recovery: if --autostash's stash-apply leaves unmerged paths
# (which is exactly what broke us on 2026-05-27 — a laptop session's
# uncommitted JSON refactor couldn't reapply on top of a parallel mobile
# edit), the working tree is left with `<<<<<<<` markers and every reader
# of those files crashes. The Mac mini is a runner, not an editor — its
# working tree should always equal origin/main — so we abort the rebase
# and hard-reset to origin/main. The lost stash is recoverable from the
# laptop (which is the only place that should have authored those edits).
log "rebasing onto origin/main"
acquire_git_lock || exit 1
pre_rebase_sha="$(git rev-parse HEAD)"
git fetch origin main
if ! git pull --rebase --autostash origin main; then
  log "post-pull: rebase failed — aborting and hard-resetting to origin/main"
  git rebase --abort 2>/dev/null || true
  git reset --hard origin/main
fi
if git ls-files -u | grep -q .; then
  log "post-pull: unmerged paths after autostash apply — hard-resetting to origin/main"
  git rebase --abort 2>/dev/null || true
  git reset --hard origin/main
  git stash drop 2>/dev/null || true
fi
post_rebase_sha="$(git rev-parse HEAD)"
release_git_lock

# If laptop changed dependencies (package-lock.json or package.json) or
# node_modules is missing, install before running the fetch script. This
# keeps the Mac mini's cached node_modules in sync with whatever the laptop
# pushed without any manual intervention.
needs_install=0
if [ ! -d node_modules ]; then
  needs_install=1
elif [ "$pre_rebase_sha" != "$post_rebase_sha" ]; then
  if git diff --name-only "$pre_rebase_sha" "$post_rebase_sha" | grep -qE '^(package-lock\.json|package\.json)$'; then
    needs_install=1
  fi
fi
if [ "$needs_install" -eq 1 ]; then
  log "dependencies changed (or node_modules missing) — running npm install"
  npm install --legacy-peer-deps --silent
fi

# 1) Fetch prices (incremental)
log "fetching prices"
npm run --silent fetch-prices

# 2) Fast-tier digest re-render — substitutes live pcts from the new prices.json
# into the templated game digests (1D / 1W / 1M). No RSS. Normally no AI —
# EXCEPT when the sign guard detects the morning narrative now contradicts the
# live numbers (its "biggest drag" rallied), in which case it may regenerate
# that one game window on PCC via the local fm serve, bounded to
# DIGEST_REGEN_MAX (default 2) per window per day; if fm serve is down or the
# cap is hit it rebuilds a neutral blurb deterministically instead. Skipped
# silently if digests.json doesn't exist yet (first run) or if no templates
# are present (pre-Phase-3 file). Failures here never block the price
# commit + push.
log "fast tier — re-rendering game digest templates"
if ! swift "$SCRIPT_DIR/digest.swift" --output "$REPO_DIR/public/digests.json" --scope fast; then
  log "fast tier exited non-zero; continuing with the price push"
fi

# 2b) Refuse to commit an unparseable snapshot. fetch-prices validates before
# writing, but this cheap gate also covers a partially-written file from any
# other writer (crash mid-write, disk full). Failing here keeps the last-good
# committed data serving.
if ! node -e "JSON.parse(require('fs').readFileSync('public/data/prices.json','utf8'))" 2>/dev/null; then
  log "prices.json is unparseable — refusing to commit; keeping last-good data"
  exit 1
fi

# 3) Commit prices + (potentially rendered) digests if anything changed. We
# stage the two paths explicitly so unrelated WIP never gets auto-committed.
status_lines="$(git status --porcelain public/data/prices.json public/digests.json)"
if [ -n "$status_lines" ]; then
  log "data and/or digests changed — committing"
  acquire_git_lock || exit 1
  git add public/data/prices.json public/digests.json
  git commit -m "data: $(ts)"
  release_git_lock
else
  log "no data change since last run"
fi

# 3) Push if local has any unpushed commits — either a fresh prices commit
# we just made OR a deferred digest commit from a concurrent digest run
# (digest-update.sh commits locally but never pushes, by design — see that
# script's comments). This is the only place in the pipeline that touches
# origin/main, which is what eliminates the push race entirely. A retry
# loop is kept in case a laptop merge lands on origin between our rebase
# and our push.
unpushed="$(git rev-list origin/main..HEAD --count 2>/dev/null || echo 0)"
if [ "$unpushed" -eq 0 ]; then
  log "nothing to push"
else
  log "pushing $unpushed commit(s) to origin/main"
  push_attempts=0
  acquire_git_lock || exit 1
  while ! git push 2>&1; do
    push_attempts=$((push_attempts + 1))
    if [ "$push_attempts" -ge 5 ]; then
      log "push failed after 5 retries — bailing"
      exit 1
    fi
    log "push rejected — rebase + retry ($push_attempts/5)"
    git fetch origin main
    git pull --rebase --autostash origin main
  done
  release_git_lock
fi

# Vercel auto-deploys from the GitHub webhook on push to main. If that
# webhook is ever disconnected, re-add `vercel deploy --prod --yes` here.

log "done"
