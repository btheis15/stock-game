#!/usr/bin/env bash
#
# check-theme-coverage.sh — guard the semantic-token theme system.
#
# WHY THIS EXISTS
# ---------------
# The theme system (see CLAUDE.md §5.6) flips the app between dark (default),
# light, and twilight by reassigning semantic CSS variables
# (--surface-*/--ink-*/--border-*) per theme in app/globals.css; components
# reference them via @theme utilities (bg-card, text-ink-muted,
# border-hairline, …). A component themes correctly if and only if it uses
# those semantic utilities.
#
# This script therefore fails on the two ways to break theming:
#
#   1. RAW DARK-SURFACE UTILITIES in markup (bg-zinc-900/60, text-white,
#      border-zinc-800, …). These render dark in every theme — the historical
#      "looks fine in dark, muddy in light" bug. Use the semantic utility
#      instead (see the token table in app/globals.css / CLAUDE.md §5.6).
#      A small ALLOWLIST covers classes that are theme-independent BY DESIGN.
#
#   2. OPACITY MODIFIERS ON SEMANTIC TOKENS (bg-card/50, text-ink/80). Each
#      translucency must be its own token, assigned in all three theme blocks
#      — a slash modifier silently recreates the per-alpha coverage gap the
#      tokens were introduced to kill. Mint a token instead.
#
# Run via `npm run check-theme`. Wired into CI (.github/workflows/build.yml)
# and the pre-push hook.

set -euo pipefail
cd "$(dirname "$0")/.."

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
bg-black/60
EOF
)
# bg-white / text-black        — inverted high-contrast pills (Add Fund, active
#                                filter chip, selected RangeTab). White-on-page
#                                is the intended "selected" affordance in light.
# bg-zinc-100 / text-zinc-900  — the LIGHT half of inverted toggles; renders
#                                light in dark mode on purpose.
# bg-zinc-200                  — active-press tint under the white CTA pill.
# bg-black/60                  — modal scrim. Intentionally dim in all themes so
#                                the dialog reads above the dimmed page.

fail=0

# 1. Raw dark-surface utilities in markup (any variant prefix counts — a
#    hover:bg-zinc-800 is just as un-themed as a bare one now that the
#    semantic utilities theme interaction states too). Uses perl for PCRE
#    (macOS grep lacks -P; see git history).
used=$(find "${SRC_DIRS[@]}" -type f -name '*.tsx' -print0 \
  | xargs -0 perl -ne \
    'print "$&\n" while /(?<![\w\/-])(?:bg|text|border|divide|decoration|ring|placeholder)-(?:black|white|zinc-[0-9]+)(?:\/[0-9]+)?(?![\w\/-])/g' \
  | sort -u)

raw=$(comm -23 <(printf '%s\n' "$used") <(printf '%s\n' "$ALLOWLIST" | sort -u))

if [[ -n "$raw" ]]; then
  echo "✗ Raw dark-surface utilities in markup — these don't theme-flip. Use the"
  echo "  semantic token utilities instead (bg-card, bg-raised, text-ink-muted,"
  echo "  border-hairline, … — table in app/globals.css / CLAUDE.md §5.6), or,"
  echo "  if the class is intentionally theme-independent, add it to ALLOWLIST"
  echo "  in this script with a justification."
  echo
  while IFS= read -r cls; do
    [[ -z "$cls" ]] && continue
    echo "  • $cls"
    grep -rln --include="*.tsx" -F "$cls" "${SRC_DIRS[@]}" | sed 's/^/      /'
  done <<< "$raw"
  echo
  fail=1
fi

# 2. Opacity modifiers on semantic token utilities.
SEMANTIC='(?:page|solid|chrome|chrome-soft|card|card-solid|card-95|card-60|card-50|card-40|raised|raised-80|raised-70|pressed|pressed-40|strong|ghost|ink|ink-2|ink-3|ink-muted|ink-faint|ink-ghost|ink-ghost-2|hairline|hairline-70|hairline-deep|edge-strong|edge-strong-60|edge-ghost)'
modified=$(find "${SRC_DIRS[@]}" -type f -name '*.tsx' -print0 \
  | xargs -0 perl -ne \
    'print "$&\n" while /(?<![\w\/-])(?:bg|text|border|divide|decoration)-'"$SEMANTIC"'\/[0-9]+(?![\w\/-])/g' \
  | sort -u)

if [[ -n "$modified" ]]; then
  echo "✗ Opacity modifiers on semantic tokens — each translucency must be its"
  echo "  own token assigned in all three theme blocks of app/globals.css"
  echo "  (a /N modifier recreates the per-alpha coverage gap). Mint a token."
  echo
  while IFS= read -r cls; do
    [[ -z "$cls" ]] && continue
    echo "  • $cls"
    grep -rln --include="*.tsx" -F "$cls" "${SRC_DIRS[@]}" | sed 's/^/      /'
  done <<< "$modified"
  echo
  fail=1
fi

[[ "$fail" -ne 0 ]] && exit 1

echo "✓ Theme coverage OK — markup uses semantic token utilities only."
