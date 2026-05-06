# CLAUDE.md — instructions for AI sessions

> Future Claude (or any AI agent), read this **first** when picking up the
> Stock Game project. The whole repo is designed to be self-documenting so
> you can hit the ground running without re-deriving context.

## Read order

1. **STATE.md** — the canonical technical snapshot. Identity, data model, all
   functions, all routes, all components, the pipeline, gotchas. This is the
   ground truth. If you only read one file, read this.
2. **OVERVIEW.md** — the human-narrative version. Helpful for matching the
   user's mental model of the project.
3. **README.md** — short public intro + Vercel deploy badge. Mostly cosmetic.
4. The actual code in `lib/`, `components/`, `app/`, and `scripts/`.

## Core invariant: keep STATE.md current

Whenever you change repo behavior in a way that touches:

- The data model (`lib/types.ts`, `public/data/prices.json` shape)
- A pipeline step (`scripts/fetch-prices.ts`, `scripts/cron-update.sh`,
  Vercel build behavior, cache headers in `next.config.ts`)
- Any component's external contract (props, what it renders, how it's used)
- The player roster (`lib/picks.ts`)
- The setup steps (`npm install` flags, brew/CLI requirements, env vars)
- Any new file that's worth knowing about

…**update `STATE.md` in the same commit as the code change.** Same for any
behavior the user-facing `OVERVIEW.md` describes. Drift between docs and
reality is the only failure mode that makes these files actively harmful, so
treat them like part of the public API of the repo.

When in doubt, update both. They're cheap to edit.

## Style conventions

- **Match existing patterns.** This repo leans heavily on a small set of
  conventions: `"use client"` only where needed, inline Tailwind, dark theme
  by default, formatters in `lib/portfolio.ts`, components colocated by
  feature. New code should look like the surrounding code.
- **No new dependencies without a reason.** Adding npm packages for
  one-liners is discouraged — there's a working stack and a `--legacy-peer-deps`
  install constraint to live within.
- **Don't add error handling for things that can't fail.** The data layer is
  trusted (we control the snapshot). Network calls in scripts can fail —
  there `try/catch` is fine.
- **Don't write comments that just describe the code.** Comments earn their
  keep by explaining *why* something is done a non-obvious way (the
  `touch-action: none` comment on the chart, the `legacy-peer-deps`
  rationale, the spin-off math, etc.).
- **Single-quote vs double-quote, semicolons, etc:** match Prettier defaults
  used in this repo. Don't reformat unrelated code.

## How to verify changes

This repo has no automated tests. To verify:

1. `npm run build` — must complete without errors. SSG covers all pages.
2. `npm run dev` then open `localhost:3000` in a browser sized to mobile —
   click through Compare → portfolio → stock → stocks. All tabs render.
3. If you changed the chart or a view: scrub the chart with the cursor;
   verify nothing throws and the header tracks. Toggle through ranges.
4. If you changed `prices.json` shape or `lib/portfolio.ts`: run
   `npm run fetch-prices -- --full` to regenerate the snapshot and confirm
   it parses cleanly into all the views.
5. If you changed the scheduler: `npm run stockgame` opens the tkinter UI;
   click "Run Now" and confirm the script completes.

For the deploy pipeline, `npm run refresh` does the full chain end-to-end
(~50s). It's safe to run any time — incremental fetch is idempotent if
nothing changed.

## Pushing changes

The repo's `main` branch deploys to Vercel automatically via the
GitHub-Vercel integration. So `git push origin main` is the deploy trigger.
The Vercel CLI deploy in `cron-update.sh` is a redundant path so the cron
keeps working even if the webhook is ever broken again.

Don't force-push to `main`. Don't merge unreviewed changes into `main` from
shared environments. The expected workflow is "implement → verify locally →
commit → push → confirm Vercel deploy succeeded."

## What you don't need to worry about

- **Authentication.** GitHub auth (gh keyring) and Vercel auth (CLI token)
  are persisted on the developer's Mac. New machines need a one-time
  `gh auth login` and `vercel login` + `vercel link`. There are no API keys
  in the codebase.
- **Secrets.** None. Yahoo Finance is unauthenticated. Vercel project
  doesn't need env vars. `.env*` is gitignored anyway.
- **Database.** None. The "database" is `public/data/prices.json` committed
  to the repo. Vercel rebuilds on each push.
- **CI.** None. The build itself is the CI; Vercel rejects the deploy if
  `next build` fails.

## Common tasks

| Want to… | Touch |
|---|---|
| Add a new player | `lib/picks.ts` (`USERS`, then add tickers to `TICKER_NAMES` if new). Run `npm run fetch-prices -- --full`. |
| Add a new ticker | `lib/picks.ts` (`USERS[playerId].tickers` + `TICKER_NAMES`). Re-fetch full. |
| Add a spin-off | `lib/events.ts` (push to `SPINOFFS`). Re-fetch full. |
| Change colors / branding | `lib/picks.ts` for player colors; `globals.css` for global CSS vars; regenerate icons via `scripts/make-icons.py` and OG via `scripts/make-og.py`. |
| Add a chart range | `lib/types.ts` (`Range`), `lib/portfolio.ts` (`RANGE_DAYS`, `filterRange`), `components/RangeTabs.tsx` (the array). |
| Tweak refresh cadence | The user does this in the scheduler UI. Don't hardcode. |
| Add a metric on the home page | `app/page.tsx` server component → compute server-side, pass as prop → render in `components/CompareView.tsx`. |

## Trust the user

The user knows what they want. Confirm before doing destructive things
(force-push, deleting branches, reverting commits, removing a player) but
otherwise lean toward acting on the request rather than over-clarifying.
This is a personal project; the user iterates fast.
