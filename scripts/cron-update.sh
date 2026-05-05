#!/usr/bin/env bash
# Cron-friendly update + deploy for Stock Game.
#
# What this does:
#   1. Fetches latest closing prices into public/data/prices.json (incremental)
#   2. If anything changed: commits + pushes to GitHub (so the source of truth stays in sync)
#   3. Deploys to Vercel production via the Vercel CLI (so the live site updates
#      regardless of whether the GitHub→Vercel webhook is wired up)
#
# Designed to be safe to run every 5 minutes / hourly / daily — exits cleanly
# if there's nothing new.
#
# Setup once on the Mac mini:
#   npm install -g vercel
#   vercel login        # authenticate (only needed once, persists)
#   vercel link         # link this directory to the stock-game project
#
# Then in crontab:
#   30 16 * * 1-5 /path/to/stock-game/scripts/cron-update.sh >> /tmp/stock-game.log 2>&1

set -euo pipefail

# Resolve repo root from this script's location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

# Make sure brew/npm/git/vercel are findable when invoked from cron (PATH is minimal)
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$PATH"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

log "starting update in $REPO_DIR"

# 1) Fetch prices (incremental)
log "fetching prices"
npm run --silent fetch-prices

# 2) Commit + push if data changed
if [ -n "$(git status --porcelain public/data/prices.json)" ]; then
  log "data changed — committing and pushing"
  git add public/data/prices.json
  git commit -m "data: $(ts)"
  git push
else
  log "no data change since last run"
fi

# 3) Deploy to Vercel (always, in case code changed too — Vercel skips builds
#    when nothing changed at the file level, so this is cheap)
log "deploying to Vercel"
vercel deploy --prod --yes

log "done"
