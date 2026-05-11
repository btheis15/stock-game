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
log "rebasing onto origin/main"
pre_rebase_sha="$(git rev-parse HEAD)"
git fetch origin main
git pull --rebase --autostash origin main
post_rebase_sha="$(git rev-parse HEAD)"

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

# 2) Commit + push if data changed. Stage only prices.json so unrelated WIP
# never gets auto-committed. Push retries on rejection — the digest pipeline
# (digest-update.sh) is allowed to run concurrently and may push to main
# during our window; rebasing our single prices commit on top is conflict
# free since the two pipelines touch different files.
if [ -n "$(git status --porcelain public/data/prices.json)" ]; then
  log "data changed — committing"
  git add public/data/prices.json
  git commit -m "data: $(ts)"

  push_attempts=0
  while ! git push 2>&1; do
    push_attempts=$((push_attempts + 1))
    if [ "$push_attempts" -ge 5 ]; then
      log "push failed after 5 retries — bailing"
      exit 1
    fi
    log "push rejected (likely concurrent digest push) — rebase + retry ($push_attempts/5)"
    git fetch origin main
    git pull --rebase --autostash origin main
  done
else
  log "no data change since last run"
fi

# Vercel auto-deploys from the GitHub webhook on push to main. If that
# webhook is ever disconnected, re-add `vercel deploy --prod --yes` here.

log "done"
