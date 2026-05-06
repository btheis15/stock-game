# Stock Game

A friendly portfolio showdown between **Brian, Kevin, Rick, and Lee**, tracked
since **Feb 5, 2026**. Each player starts with $100,000 split evenly across
their picks at that day's close (partial shares allowed). Mobile-first PWA,
installable to your iPhone home screen, with a Robinhood-style scrub chart.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbtheis15%2Fstock-game)

**Live:** https://stock-game-gamma.vercel.app

---

## Documentation

This repo carries its own complete context, designed to be readable cold by
either a human or an AI session:

| File | Audience | What it is |
|---|---|---|
| **[STATE.md](./STATE.md)** | AI / engineer | Dense canonical technical state — data model, every component contract, the pipeline, gotchas. Read this first if you're picking up the project. |
| **[OVERVIEW.md](./OVERVIEW.md)** | Human | Narrative walkthrough — what the app does, how players are scored, how updates flow, common tasks. |
| **[CLAUDE.md](./CLAUDE.md)** | AI agents | Conventions for Claude/AI sessions working on this repo: end-to-end traces, debugging playbook, change patterns, the contract to keep `STATE.md` in sync with code changes. |
| **[DESIGN.md](./DESIGN.md)** | Anyone reusing the look-and-feel | Portable design-system reference: visual language, layout patterns, component contracts, the GitHub→Vercel→PWA distribution architecture, formatter library. Lift it into any other project that wants the same feel. |

---

## Quick start (development)

```bash
npm install --legacy-peer-deps   # visx peer-dep workaround
npm run fetch-prices             # populate public/data/prices.json
npm run dev                      # http://localhost:3000
```

## Quick start (data refresh + deploy)

```bash
npm run refresh                  # fetch prices + commit + push + deploy
```

End-to-end ~50 seconds. Designed to be run by a cron / the scheduler app.

## Scheduler UI (Mac mini)

```bash
npm run stockgame                # native tkinter window
```

Pick an interval (5/10/15/30 min, 1–24 hr) and a time window, hit "Schedule
Run." The app stays open and fires `npm run refresh` on the timer; uses
`caffeinate` to keep the Mac awake.

---

## File map (very condensed)

```
app/                Next.js routes (Compare, /portfolio/[user], /stock/[ticker], /stocks)
components/         All UI — ScrubChart, CompareView, PortfolioView, StockView, etc.
lib/
  picks.ts          Players, tickers, colors (source of truth for the roster)
  portfolio.ts      All math, formatters, range filters
  events.ts         Spin-off events (empty until HON announces)
  types.ts          TS interfaces
  data.ts           Loads public/data/prices.json server-side
scripts/
  fetch-prices.ts   Yahoo Finance fetcher (incremental + intraday + dividends)
  cron-update.sh    Fetch + commit + push + Vercel deploy
  stockgame_schedule.py   tkinter scheduler UI for the Mac mini
  make-icons.py     Regenerate PWA icons
  make-og.py        Regenerate the OG card
public/
  data/prices.json  The committed snapshot (Vercel reads this at build)
  *.png             Icons, OG card
```

For everything else, **see [STATE.md](./STATE.md)**.
