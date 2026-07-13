#!/usr/bin/env bash
# Vercel Ignored Build Step (vercel.json "ignoreCommand").
#
# Exit 0 = SKIP the build, exit 1 = BUILD. (Inverted from shell intuition —
# this is Vercel's contract.) The goal: the Mac mini's 15-min data commits
# stop triggering rebuilds (~40/day → ~0), because the app now reads
# prices/digests/fundamentals from origin/main at request time
# (lib/remote-json.ts). Any commit touching real code still builds.
#
# We diff against VERCEL_GIT_PREVIOUS_SHA (the last successfully deployed
# commit) rather than HEAD^, because one push can carry several commits and
# days of skipped data commits accumulate between real builds — the decision
# must be cumulative since the last deploy. That SHA usually falls outside
# Vercel's shallow clone, so it is fetched explicitly. Every uncertain path
# fails OPEN (build) — the failure mode is a redundant build, never a missed
# one.
#
# config/funds.json + config/thesis.json are excluded too (already runtime
# reads via the GitHub Contents API). config/roster.json is NOT excluded:
# lib/picks.ts imports it statically, so roster changes must rebuild.
set -u

BASE="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$BASE" ]; then
  git rev-parse --verify -q "$BASE^{commit}" >/dev/null 2>&1 \
    || git fetch --quiet --depth=1 origin "$BASE" >/dev/null 2>&1 \
    || true
fi
if [ -z "$BASE" ] || ! git rev-parse --verify -q "$BASE^{commit}" >/dev/null 2>&1; then
  BASE="HEAD^" # first deploy / force-push / fetch failure — best effort
  git rev-parse --verify -q "$BASE^{commit}" >/dev/null 2>&1 || exit 1
fi

if git diff --quiet "$BASE" HEAD -- \
  ':(exclude)public/data' \
  ':(exclude)public/digests.json' \
  ':(exclude)config/funds.json' \
  ':(exclude)config/thesis.json'; then
  echo "Only runtime-served data changed since $BASE — skipping build"
  exit 0
fi

echo "Code changed since $BASE — building"
exit 1
