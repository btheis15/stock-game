#!/usr/bin/env bash
#
# check-theme-coverage.sh — guard against light/twilight contrast regressions.
#
# WHY THIS EXISTS
# ---------------
# The theme system (see CLAUDE.md §5.6) flips the app between dark (default),
# light, and twilight by *overriding a fixed set of zinc/black/white Tailwind
# utility classes* under `:root[data-theme="light"]` / `[twilight]` in
# app/globals.css. A component only theme-flips if every dark-surface utility
# it uses has a matching override.
#
# The recurring failure mode: a new feature uses a utility — or, more subtly,
# an OPACITY VARIANT of one (`bg-zinc-900/60` when only `/50` and `/70` are
# overridden) — that has no override. It looks fine in dark mode (the default)
# and ships, then renders as dark-grey-on-light in light mode. The "What's
# new" button shipped exactly this bug (bg-zinc-900/60 + border-zinc-700, both
# un-overridden). This script catches that class of bug before it ships.
#
# WHAT IT DOES
# ------------
# 1. Collects every BASE (non-variant) dark-surface utility used in
#    components/ and app/ *.tsx. Variant-prefixed tokens (hover:/active:/
#    focus:/sm:/group-*:) are intentionally skipped — Tailwind emits those as
#    separate `.hover\:bg-*:hover` classes the override selectors don't match,
#    and they're transient desktop-only interaction states, not the always-on
#    surface colors that cause the visible bug.
# 2. Collects every class overridden under BOTH the light AND twilight themes
#    in globals.css. A class needs both, or it's broken in whichever theme
#    lacks it.
# 3. Anything used but not covered (and not in the ALLOWLIST of intentionally
#    theme-independent classes) is reported, and the script exits non-zero.
#
# Run via `npm run check-theme`. Wired into CI (.github/workflows/build.yml).

set -euo pipefail
cd "$(dirname "$0")/.."

CSS="app/globals.css"
SRC_DIRS=(components app)

# Utilities that are theme-independent BY DESIGN and must NOT be flipped.
# Each entry needs a one-line justification — if you add one, explain why the
# class reads correctly (or is intentionally identical) in all three themes.
ALLOWLIST=$(cat <<'EOF'
bg-white
text-black
bg-zinc-100
bg-zinc-200
text-zinc-900
text-zinc-500
bg-black/60
EOF
)
# bg-white / text-black        — inverted high-contrast pills (Add Fund, active
#                                filter chip, selected RangeTab). White-on-page
#                                is the intended "selected" affordance in light.
# bg-zinc-100 / text-zinc-900  — the LIGHT half of inverted toggles; renders
#                                light in dark mode on purpose.
# bg-zinc-200                  — active-press tint under the white CTA pill.
# text-zinc-500                — mid-gray; reads on every theme (CSS comment in
#                                globals.css notes it's deliberately un-flipped).
# bg-black/60                  — modal scrim. Intentionally dim in all themes so
#                                the dialog reads above the dimmed page.

# 1. Base dark-surface utilities used in markup (variant-prefixed excluded via
#    the (?<![\w:/-]) lookbehind — a leading ':' means it's hover:/active:/etc).
used=$(grep -rhoP --include="*.tsx" \
  '(?<![\w:/-])(bg|text|border|divide)-(black|white|zinc-[0-9]+)(/[0-9]+)?(?![\w/-])' \
  "${SRC_DIRS[@]}" | sort -u)

# 2. Classes overridden per theme (unescape Tailwind's `\/` opacity escape).
covered_for() {
  grep -oP ":root\[data-theme=\"$1\"\] \.\K[\w\\\\/-]+" "$CSS" \
    | sed 's/\\//g' | sort -u
}
light=$(covered_for light)
twilight=$(covered_for twilight)
# A class is covered only if BOTH themes override it.
covered=$(comm -12 <(printf '%s\n' "$light") <(printf '%s\n' "$twilight"))

safe=$(printf '%s\n%s\n' "$covered" "$ALLOWLIST" | sort -u)

# 3. Report anything used but not safe.
missing=$(comm -23 <(printf '%s\n' "$used") <(printf '%s\n' "$safe"))

if [[ -n "$missing" ]]; then
  echo "✗ Theme coverage gap — these utilities are used in markup but have no"
  echo "  light+twilight override in app/globals.css (they'll render dark in"
  echo "  light mode). Either add an override under BOTH :root[data-theme=...]"
  echo "  blocks, switch to an already-covered utility, or — if the class is"
  echo "  intentionally theme-independent — add it to ALLOWLIST in this script"
  echo "  with a justification. See CLAUDE.md §5.6."
  echo
  while IFS= read -r cls; do
    [[ -z "$cls" ]] && continue
    echo "  • $cls"
    grep -rln --include="*.tsx" -F "$cls" "${SRC_DIRS[@]}" | sed 's/^/      /'
  done <<< "$missing"
  echo
  exit 1
fi

echo "✓ Theme coverage OK — every dark-surface utility flips in light + twilight."
