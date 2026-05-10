#!/usr/bin/env bash
# Daily digest pipeline + deploy for Stock Game.
#
# What this does:
#   1. Refuses to run if scripts/.pause exists or if not on main
#   2. Rebases onto origin/main so laptop merges don't conflict with our push
#   3. Runs scripts/digest.swift — Apple Intelligence on-device generates
#      per-ticker, per-portfolio, and game-wide news digests for all six
#      time windows (1D / 1W / 1M / 3M / 1Y / ALL)
#   4. If public/digests.json changed: commits + pushes
#   5. The GitHub→Vercel webhook auto-deploys on push to main
#
# Designed to run once per day before market open (~7 AM CT) via the
# tkinter scheduler in scripts/stockgame_schedule.py.
#
# Total runtime: ~10–15 min for all 29 tickers + 4 portfolios + 6 game windows.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

log "digest update starting in $REPO_DIR"

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
log "running digest pipeline (this takes ~10 min for the full roster)"
swift "$SCRIPT_DIR/digest.swift" --output "$REPO_DIR/public/digests.json"

# Stage only digests.json — unrelated WIP never gets auto-committed.
if [ -n "$(git status --porcelain public/digests.json)" ]; then
  log "digests changed — committing and pushing"
  git add public/digests.json
  git commit -m "digests: $(ts)"
  git push
else
  log "no digest changes since last run"
fi

log "digest update done"
