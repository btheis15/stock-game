# Stock Game — Overview

A friendly stock-picking competition between four people, tracked daily since
**February 5, 2026**. Each player gets a $100,000 paper portfolio, divided
evenly across their picks. The app is a mobile-first PWA that anyone can open
in Safari and add to their iPhone home screen — it looks and behaves like
Robinhood, except instead of one portfolio you see all four overlaid on the
same chart with a leaderboard underneath.

The point is twofold:
1. **Bragging rights.** The "loser pays for golf" sub-headline is real.
2. **Watch how different picking strategies play out** in a way that's actually
   pleasant to scroll through on your phone, day to day.

> **Companion docs:** if you want the dense technical state for handing off to
> another Claude session, see [STATE.md](./STATE.md). If you're an AI session
> picking this up cold, also read [CLAUDE.md](./CLAUDE.md) for how to keep
> these docs in sync.

---

## What does the app actually do?

Four things, on a phone screen:

1. **Compare** (home tab). Four colored lines on one chart: Brian green, Kevin
   blue, Rick orange, Lee purple. Drag your finger across the chart and the
   header above updates with the gap (in dollars and percent) at that exact
   moment. Below the chart is a 2×2 leaderboard showing 1st through 4th place
   with each player's current portfolio value. Below that, "What's driving
   it" — for each player, the top three holdings boosting them and the bottom
   three dragging them down. Each row shows the ticker, the stock's current
   share price, the % move for the range, and the per-share dollar move
   ("points up/down").

2. **Per-player drill-down.** Tap a leaderboard card — or the *name* in any
   "What's driving it" card — and you land on that player's portfolio. Same
   big chart, but only their line; below it, a list of every holding they
   have, sorted by performance for the active range.

3. **Per-stock detail.** Tap any holding row, or any individual stock inside
   a "What's driving it" card, and you see that stock's price chart plus —
   directly below the range tabs — a Robinhood-style **news digest** scoped
   to whichever range tab you're on. The digest shows three sentences of
   plain-English summary ("what happened today" for 1D, "the year's most
   important storyline" for 1Y, "the defining arc of the company since 2/5"
   for ALL), with a "Show more" tap target that reveals the full prose,
   the underlying article sources (linked to the originals), the article
   count, and a tiny "⬡ Summarized by Apple Intelligence" credit at the
   bottom. The dot at the left of the card is a signal-quality indicator —
   green when the underlying articles average a high relevance score,
   yellow when middling. Below the digest are "Position" cards for each
   player who owns the stock (Kevin and Rick both own NVDA, for example,
   so NVDA's page shows both their positions), and below that, a list of
   every dividend that stock has paid since 2/5.

4. **Tee Times.** A third tab, golf-ball icon. Quick shortcuts into
   Inshalla CC's foreUP booking page — three tappable rows for Today,
   Tomorrow, and the day after, plus a primary "View all available
   times" button. Tapping any of them opens foreUP in a new tab
   pre-filtered to Daily Golf for the chosen date, so you skip the
   "pick a category" screen and land on the time list immediately. A
   "Call pro shop" button below opens the iPhone dialer with the
   number pre-filled. Below that, a **Daily Deals** card hands off to
   Inshalla's Sagacity Golf discount widget so you can browse
   discounted tee times. foreUP and Sagacity both handle the actual
   schedule view, account, and payment.

Every chart has range tabs along the bottom — **1D, 1W, 1M, 3M, 1YR, ALL** —
that re-scope the data. The Compare and per-player views open on **1D** by
default.

The **1D view** is special: the x-axis spans the full trading day
(9:30 AM – 4:00 PM ET), the line shows what's happened so far, and the
most-recent point pulses gently while the market is live. A "● Market open"
or "● Market closed" badge sits just above the chart in 1D so you know
which state you're in, with a "Last updated" timestamp next to it.

The **1W view** is special too: it uses 1-hour bars over the past 5
trading days (~35 points instead of 5) so the line shows real intra-day
texture instead of just five daily closes. The x-axis collapses
overnight and weekend gaps so the line stays continuous Mon–Fri, with
small weekday labels along the bottom telling you which segment belongs
to which day.

Every chart's x-axis has subtle date / time tick labels that adapt to
the range — hours on 1D, weekdays on 1W, month-day on 1M/3M, months on
1YR/ALL. The lines on the Compare chart are normalized to %-change from
the start of the range so the visual order always matches the
leaderboard ranking — the highest line is the player in 1st place. Each
holding row's % return reflects the active range, not all-time.

Tapping a holding from a portfolio view always lands you at the **top**
of that stock's page (no mid-page scroll).

**The whole app flips to a clean light theme while the market is open**
and switches back to dark when it closes. Robinhood-style: white cards
on a near-white page during trading hours; black surfaces when the
market shuts. The transition is automatic — no toggle to remember.

Pull down at the top of any page to refresh. If you've left the app closed
for more than a minute and come back, it auto-refreshes too — no need to
think about staleness.

---

## The four players

| Player | Color | Picks | Per-pick allocation |
|---|---|---|---|
| **Brian** | green | ASTS, AMZN, UBER, SERV, AAPL, QCOM, ISRG, CRSP, HON, EXOD | $10,000 |
| **Kevin** | blue | TSLA, NVDA, AVGO, MRVL, CRDO, PLTR, ORCL, ZS, VST, VRT | $10,000 |
| **Rick** | orange | COHR, CRWV, GFS, GOOGL, NBIS, QBTS, NVDA, RKLB, S, TSLA | $10,000 |
| **Lee** | purple | SPY | $100,000 |

A few notes on this:
- The "$10k per pick" rule comes from "$100k total ÷ 10 picks." Lee chose to
  put the entire $100k into a single S&P 500 ETF, so his per-pick
  allocation is $100k.
- Kevin and Rick both own NVDA and TSLA. Even though they share prices,
  they each have their own independent share count (because each spent
  their own $10k buying it at the 2/5 close).
- Buying happens at the **2026-02-05 closing price**, partial shares allowed.
  Once a share count is set on Feb 5, it doesn't change unless a corporate
  action (spin-off, split) modifies it.
- Dividends are tracked. When AAPL pays $0.26/share, Brian's portfolio
  picks up `36.24 shares × $0.26 = $9.42` in cash — added to his total.

---

## Where the news digests come from

The summaries on each stock's detail page aren't editorial — they're
generated fresh once a day by an Apple Intelligence pipeline that runs on
the Mac mini at home. Yahoo Finance's RSS feed for each ticker is fetched,
articles get filtered through a two-stage relevance gate (a fast keyword
pre-filter that drops crime stories / store openings / sports, then an
Apple Intelligence scoring pass that requires ≥6/10 investor relevance
to make it through), and the survivors get summarized into 3-sentence
digests for each time window — 1D, 1W, 1M, 3M, 1Y, and a "since 2/5/26"
ALL summary that's framed around the 5-year game arc.

The whole pipeline runs on-device — no ChatGPT, no Claude API, no
cloud LLM bills. Apple Intelligence handles every summarization locally
via the FoundationModels framework. When the daily run finishes, it
writes `public/digests.json` and the same git push that fires off price
updates ships the new digests to Vercel. Total runtime: ~8 minutes for
all 29 tickers. If Apple Intelligence is ever unavailable for any reason
(disabled in System Settings, etc.), the script exits cleanly without
overwriting `digests.json` — yesterday's digests keep serving.

The 1M / 3M / 1Y windows show "Monthly digest available after ~29 more
days" until enough archive history accumulates; ALL is always live since
it just summarizes whatever's in the archive at any moment.

## How updates work

You don't have to do anything for the app to stay current. Here's the chain:

```
[Mac mini at home, running 24/7]
    ↓ scheduler app fires every 15 minutes during US market hours (8:30am–3:00pm CT)
    ↓
[scripts/cron-update.sh runs]
    ├── pulls the latest closing prices + intraday bars from Yahoo Finance
    ├── if anything changed: commits + pushes to GitHub
    └── deploys to Vercel
    ↓
[stock-game-gamma.vercel.app rebuilds in ~30 seconds]
    ↓
[Your iPhone shows the latest data the next time you open the app]
```

End-to-end, from "data changes" to "your phone shows it" is about a minute.
The schedule is configurable from a tkinter desktop app on the Mac mini —
launch it with `npm run stockgame`. Pick an interval (5/10/15/30 min, or
1–24 hr), pick a window (defaults to market hours in CT), and click
**Schedule Run**. It stays scheduled until you click **Stop** or close the app.

---

## The tech, in one paragraph

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4, deployed
statically on Vercel. Charts rendered with Visx (D3-powered SVG). Stock data
pulled from Yahoo Finance via `yahoo-finance2`. The whole frontend is
prerendered at build time — no API routes, no live database — and the only
state that changes is the committed `public/data/prices.json` snapshot. The
scheduler app is a Python tkinter window using `threading.Timer` to fire a
single shell script. Sleep is held off with `caffeinate`. The whole pipeline
is about a thousand lines of code.

PWA install on iPhone: open `stock-game-gamma.vercel.app` in Safari → Share
button → Add to Home Screen → it installs full-screen with the icon and
launches like a native app.

---

## Things that look weird but are intentional

- **The headline says "Rick leads" without naming who he's leading.**
  The leaderboard right below shows the full standings. Saying "Rick leads
  Kevin" was redundant once there were more than two players.
- **The 1D chart looks half-empty in the morning.** That's because the line
  only spans the time elapsed during today's session. The empty right side
  is the rest of the trading day; it fills in as the day goes on. Robinhood
  does the same thing.
- **The portfolio totals go up by tiny amounts on dividend dates** even when
  no stock moved. That's the dividend cash hitting the account.
- **"Market closed" appears outside trading hours.** No blinking endpoint when
  the market isn't actually moving — just a static last-known value.
- **The OG card preview in iMessage shows old text for ~24 hours.** Apple
  caches preview cards on their servers; nothing we can do until they
  refresh their cache. New shares of the URL get the new card immediately.
- **Some "tickers" are owned by multiple players** (NVDA, TSLA). The stock
  detail page shows a Position card for each. Their charts are identical
  (same stock = same price); the Position info differs per owner.

---

## How to do common things

### Change my picks
Don't, after Feb 5. The whole game depends on the share counts being fixed
at the 2/5 close. If you really need to swap one stock for another mid-game,
the "honest" approach is to add it as a future-dated event (you'd need to
extend `lib/events.ts` to support trades, which it currently doesn't).

### Add a new player
Edit `lib/picks.ts`: add a new entry to `USERS` with `id`, `name`, `color`,
`tickers`. They'll automatically:
- Appear on the Compare leaderboard with a 5th line
- Get a portfolio drill-down at `/portfolio/{their-id}`
- Be filterable on the Stocks tab
- Show in the "What's driving it" cards
- Have shares computed at the 2/5 close

If their picks include any new tickers, also add them to `TICKER_NAMES` and
run `npm run fetch-prices -- --full` to grab those tickers' price history.

### Add a spin-off (when HON announces theirs)
Edit `lib/events.ts`. Drop in:
```ts
{
  parentTicker: "HON",
  childTicker: "NEWCO",
  childName: "Honeywell Aerospace",
  effectiveDate: "2026-XX-XX",
  sharesPerParentShare: 0.25,
}
```
Run `npm run fetch-prices -- --full`. The portfolio engine handles the rest:
on the effective date, Brian gains `42.76 × 0.25 ≈ 10.69` shares of NEWCO,
and his portfolio total includes the new position from that date forward.

### Set up a new machine
Whether it's the Mac mini that runs the schedule or a laptop where you
edit code, the setup is the same. **One rule before anything else: do
not clone the repo into iCloud Desktop.** iCloud silently creates
duplicate files inside `.git/` and `.next/` that corrupt the repo and
break every cron fire. Clone to `~/Repos/stock-game` instead and let
GitHub be the only sync mechanism between machines.

```
mkdir -p ~/Repos
git clone https://github.com/btheis15/stock-game.git ~/Repos/stock-game
cd ~/Repos/stock-game
git config core.hooksPath .githooks
git config user.name "Brian Theis"
git config user.email "brian.theis15@gmail.com"
npm install --legacy-peer-deps
npm run build         # confirm it works
```

Full first-time-setup detail and the iCloud-corruption postmortem are
in CLAUDE.md §13.2.

### Run a refresh manually
On any machine where the repo is cloned and Node is installed:
```
cd ~/Repos/stock-game
npm run refresh
```
That's the same thing the cron does. ~50 seconds end-to-end.

### Set up the recurring schedule
Open the scheduler UI on the Mac mini:
```
npm run stockgame
```
A native window opens. Pick a time, pick an interval, pick a window, hit
Schedule Run. Leave the app open — it has to be running for the threading
timer to fire. `caffeinate` keeps the Mac awake while it's open.

### Make changes from the laptop while the schedule is running
Edit on a feature branch, push via PR, merge to `main`. The Mac mini's
next scheduled fire `git pull --rebase`s, picks up your changes, and runs
on the new code automatically.

- **App code (components, pages, lib):** Safe to iterate. If you push a
  bug, Vercel keeps serving the last-good deploy until you push a fix.
  Cron itself keeps running.
- **Cron internals (`scripts/fetch-prices.ts`, `scripts/cron-update.sh`):**
  Test locally first (`bash scripts/cron-update.sh`). A bug here makes
  every fire fail until you push a fix; live data goes stale in the
  meantime.
- **The scheduler UI itself (`scripts/stockgame_schedule.py`):** Edits
  require closing + relaunching the tkinter window on the Mac mini.
  This is the one file the running scheduler doesn't auto-pick-up.

### Force-refresh on my phone
Pull down at the top of any page. Or close the app and re-open it after a
minute (the auto-refresh-on-resume logic kicks in).

### Share the link with new players
Just text them `stock-game-gamma.vercel.app`. The OG preview card shows the
title, "Loser pays for golf — tracked since Feb 5, 2026," and a stylized
mini chart with all four players' colors. They open it in Safari, tap
Share → Add to Home Screen, and it lives on their home screen as a
full-screen app.

---

## How to debug it when something looks off

1. **Check the footer.** Bottom of every page: "Data through {date} /
   Snapshot generated {time}". If those dates are old, the cron isn't
   running — log into the Mac mini and check `/tmp/stock-game.log`.
2. **Check the deploy.** `vercel ls` on any machine logged into Vercel CLI
   shows the last few deploys with timestamps. If they stopped, the
   GitHub-Vercel webhook may have lost permission again — re-grant at
   `https://github.com/apps/vercel/installations/select_target`.
3. **Hard refresh on iPhone.** Long-press the home screen icon → Delete →
   re-open the URL in Safari → Add to Home Screen again. Fixes anything
   that's stuck on a stale cached HTML.
4. **Run `npm run refresh` directly.** If it works locally but the cron
   doesn't, the cron environment is missing something. Check that
   `vercel link` succeeded on the Mac mini and that `vercel login` auth
   hasn't expired.

---

## Where things live

- **Live app:** https://stock-game-gamma.vercel.app
- **Code:** https://github.com/btheis15/stock-game
- **Data snapshot:** `public/data/prices.json` (committed)
- **Cron pipeline:** `scripts/cron-update.sh`
- **Scheduler UI:** `scripts/stockgame_schedule.py`
- **All math:** `lib/portfolio.ts`
- **Players, picks, colors:** `lib/picks.ts`

---

## Maintenance promise

Whenever code changes meaningfully — new player, new ticker, new feature,
new pipeline step — both this file and `STATE.md` get updated in the same
commit. That way picking the project up on a new machine, or in a new
Claude session, is always a one-shot read. The `CLAUDE.md` in the repo
spells this out for AI sessions.
