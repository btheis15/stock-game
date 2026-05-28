# Stock Game — Overview

A friendly stock-picking competition between five people (plus a "Legacy
Auto" themed portfolio for comparison), tracked daily since **February 5,
2026**. Each player gets a $100,000 paper portfolio, divided evenly
across their picks. The app is a mobile-first PWA that anyone can open
in Safari and add to their iPhone home screen — it looks and behaves like
Robinhood, except instead of one portfolio you see every player overlaid on the
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

1. **Compare** (home tab). One colored line per portfolio on a shared chart:
   Brian green, Kevin blue, Rick orange, Lee purple, Gene pink, Legacy Auto
   yellow, plus a grey S&P 500 baseline. Drag your finger across the chart
   and the header above updates with the gap (in dollars and percent) at
   that exact moment. Below the chart is a sports-standings leaderboard
   showing 1st through last place with each portfolio's current value. Below that, a **game-wide
   AI briefing** scoped to the active range — three sentences explaining
   *why* the standings look the way they do, citing actual percentages
   ("Rick is leading the leaderboard with +10.12% portfolio, driven by
   top holdings RKLB +33.83% and NBIS +14.60%…"). Below that, "What's driving
   it" — for each player, the top three holdings boosting them and the bottom
   three dragging them down. Each row shows the ticker, the stock's current
   share price, the % move for the range, and the per-share dollar move
   ("points up/down").

2. **Per-player drill-down.** Tap a leaderboard card — or the *name* in any
   "What's driving it" card — and you land on that player's portfolio. Same
   big chart, but only their line. Below the chart, a **portfolio briefing**
   summarizing what's happening across that player's holdings for the active
   range — three sentences referencing their actual tickers, with the same
   "Show more" expand-for-sources affordance as the per-stock digest. Below
   that, a list of every holding they have, sorted by performance for the
   active range. Scroll past the holdings and there's a **portfolio
   breakdown** donut chart with three views (Sector / Industry / Market
   cap) — tap a slice (or its row) to see exactly which tickers fill that
   bucket. Below the donut sits an **About this portfolio** card with a
   "✦ Claude analysis" attribution — a hand-written, one-time summary
   of *what* that player is investing in: a one-line investor-archetype
   chip (e.g. "Tech barbell", "AI buildout — picks and shovels",
   "Defensive value"), a headline, and 2-3 paragraphs of expandable
   commentary describing the themes and types of companies in the
   portfolio. Intentionally number-free — no percentages or dollar
   amounts. The donut + breakdown list above handle the live numerical
   side; this card is the editorial layer that stays the same as prices
   move around.

3. **Per-stock detail.** Tap any holding row, or any individual stock inside
   a "What's driving it" card, and you see that stock's price chart plus —
   directly below the range tabs — a Robinhood-style **news digest** scoped
   to whichever range tab you're on. The digest shows three sentences of
   plain-English summary ("what happened today" for 1D, "the year's most
   important storyline" for 1Y, "the defining arc of the company since 2/5"
   for ALL), with a "Show more" tap target that reveals the full prose,
   the underlying article sources (linked to the originals), and the article
   count. A tiny "⬡ Summarized by Apple Intelligence" credit sits inline on
   the same row as the "DAILY BRIEFING" label (right-aligned), so the
   attribution is always visible without expanding the card. The dot at the
   left of the card is a signal-quality indicator — green when the
   underlying articles average a high relevance score, yellow when
   middling. Below the digest are "Position" cards for each player who
   owns the stock (Kevin and Rick both own NVDA, for example, so NVDA's
   page shows both their positions). Below that, an **About** card with the
   company's description + key statistics (market cap, P/E, EPS, sector,
   52-week range, dividend yield, headquarters, employees, website), then
   a **Financials** chart with Quarterly / Annual toggle showing Revenue,
   Gross profit, and Net income as grouped bars with a Net margin line
   overlay and a solid zero reference line so positive vs. negative bars
   read cleanly, then an **Earnings** chart (quarterly-only) showing
   analyst estimate vs actual EPS per period as two dots stacked at the
   same x — when they overlap concentrically the actual was near
   consensus; when they stack vertically the gap reads as the surprise.
   Both charts have a "Show numbers" toggle below them that expands a
   stack of per-period cards with the exact figures — useful for
   net-margin and surprise values that aren't readable off the chart.
   Tickers Yahoo doesn't fully cover (some
   small caps and recent IPOs) hide whichever fields they're missing
   rather than blanking the section. Finally, a list of every
   dividend that stock has paid since 2/5.

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

## The six players

| Player | Color | Picks | Per-pick allocation |
|---|---|---|---|
| **Brian** | green | ASTS, AMZN, UBER, SERV, AAPL, QCOM, ISRG, CRSP, HON, EXOD | $10,000 |
| **Kevin** | blue | TSLA, NVDA, AVGO, MRVL, CRDO, PLTR, ORCL, ZS, VST, VRT | $10,000 |
| **Rick** | orange | COHR, CRWV, GFS, GOOGL, NBIS, QBTS, NVDA, RKLB, S, TSLA | $10,000 |
| **Lee** | purple | PEP, GM, TAP, VZ, UL, DKS, WMT, PFE, HD, AAPL | $10,000 |
| **Gene** | pink | ASML, CRSP, OKLO, GLUE, VVOS, HUT, AMRZ, SMR, RKLB, ZBRA | $10,000 |
| **Legacy Auto** | yellow | F, GM, STLA, TM, HMC | $20,000 |

A few notes on this:
- Per-pick allocation is `$100k ÷ number of picks` — 10 picks → $10k each;
  Legacy Auto's 5 picks → $20k each. Every player starts with the same
  $100k total.
- Several tickers are jointly held: NVDA + TSLA by Kevin and Rick, AAPL
  by Brian and Lee, CRSP by Brian and Gene, RKLB by Rick and Gene, GM by
  Lee and Legacy Auto. Joint owners share prices but each has their own
  independent share count (each spent their own per-pick dollars buying
  it at the 2/5 close).
- Buying happens at the **2026-02-05 closing price**, partial shares allowed.
  Once a share count is set on Feb 5, it doesn't change unless a corporate
  action (spin-off, split) modifies it.
- Dividends are tracked. When AAPL pays $0.26/share, Brian's portfolio
  picks up `36.24 shares × $0.26 = $9.42` in cash — added to his total.

There's also a **sixth "player" in the standings: the S&P 500**, shown
in gray. It's not a real player — there's no portfolio drill-down, no
news digests, no per-stock detail page — but its $100k-invested-in-SPY-on-Feb-5
curve sits on the Compare chart and slots into the leaderboard wherever
its range performance lands. So if the market is up 4% on the month and
two players are beating it, the S&P 500 row shows up in 3rd. The
benchmark uses SPY (the ETF) under the hood so dividend payouts are
included the same way they are for every player's holdings — a fair
total-return comparison.

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
updates ships the new digests to Vercel. Total runtime: ~6–8 minutes for the
daily tier (1D/1W stock + portfolio briefings + all game windows),
plus ~6 minutes for the Saturday weekly tier that catches the 1M / 3M / 1Y
/ ALL slow windows. If Apple Intelligence is ever unavailable for any reason
(disabled in System Settings, etc.), the script exits cleanly without
overwriting `digests.json` — yesterday's digests keep serving.

The 1M / 3M / 1Y windows show "Monthly digest available after ~29 more
days" until enough archive history accumulates; ALL is always live since
it just summarizes whatever's in the archive at any moment.

The same pipeline also produces two roll-up digests: a per-player
"portfolio briefing" on `/portfolio/{user}` and a leaderboard digest on
the home page. Both ground themselves in real portfolio math — the
pipeline reads `prices.json`, computes each player's per-ticker dollar
contribution (shares × price delta) for the window, and feeds the LLM a
ranked **STANDINGS block** of top movers + drags. The model is told to
cite specific holdings only when they appear at the top of that block,
so the prose tracks "what actually drove the portfolio" instead of
"which holding had the loudest press." Articles in those prompts are
restricted to the tickers that moved the needle and inline-tagged with
the owner (e.g. `[NVDA/kevin,rick]`), which keeps the model from
attributing a move to the wrong player.

## How updates work

Two pipelines run on the Mac mini's tkinter scheduler. You leave the app open
and click **Schedule Run** once; it handles the rest.

**Pipeline 1 — price refresh + fast briefing re-render** fires every ~15 min
during extended market hours (3:00 AM – 7:00 PM CT, covering pre-market +
regular + after-hours). Skips Saturdays and Sundays. Two steps:

1. Pulls fresh closes + intraday bars from Yahoo Finance into
   `public/data/prices.json`.
2. **Fast tier** — re-renders the game-wide 1D / 1W / 1M briefings against
   the new prices using a templating trick (see below). No AI calls, no
   article fetch; finishes in under a second. The point: when you open the
   app mid-day, the "What's driving it" prose on the leaderboard already
   reflects the latest standings, not the morning's snapshot.

Both pieces commit and push together; Vercel rebuilds.

**Pipeline 2 — daily AI briefings** fires Mon–Fri at the configured time
(~7 AM CT, before regular market open). Apple Intelligence regenerates:
the 1D and 1W per-stock briefings, the 1D and 1W portfolio briefings, and
every game-wide window. The three short game windows (1D / 1W / 1M) are
emitted with a parallel `digestTemplate` field — the same prose with
percentages replaced by `{{TICKER}}` / `{{user:NAME}}` placeholders. The
fast tier reads those templates 15 min later, substitutes the live numbers,
and saves the rendered prose back. Total runtime: ~6–8 min (smaller than
the old all-windows run because we no longer regenerate every window every
day).

**Pipeline 3 — weekly slow tier** fires on Saturday at the same configured
time. Regenerates the 1M / 3M / 1Y / ALL briefings for every stock and
every player. No RSS fetch (those windows already have the archive depth
they need); just Apple Intelligence summarization from the existing
articles. Game windows aren't touched — they refresh daily + every 15 min.
Total runtime: ~6 min.

**Sunday** — no digest runs.

A "Skip article fetch" checkbox on the scheduler skips RSS fetching + AI
relevance scoring and just regenerates digests from the existing archive —
useful when iterating on the prompt.

**Manual briefing buttons (mid-day, on demand):** the scheduler now has
four explicit-scope buttons for one-shot runs that override whatever the
calendar-day timer would normally fire:

- **Run Daily Briefing** — forces a daily-tier run (1D + 1W per-stock,
  1D + 1W per-portfolio, all 6 game windows). Useful if you want today's
  briefing regenerated mid-day, e.g. after a roster change or a prompt
  tweak. ~25-30 min.
- **Run Weekly Briefing** — forces a weekly-tier run (1M / 3M / 1Y /
  ALL per-stock + per-portfolio). ~10-15 min steady-state; ~2-3 hours
  the first time it's fired after the Phase 2 chain-of-summaries
  refactor ships (one-time backfill, see below).
- **Re-run Game Only** — ~30 s; regenerates just the 6 game-wide
  leaderboard briefings from the existing archive. For prompt-tuning
  previews. Newly-generated 1D/1W/1M emit fresh templates so the next
  15-min fast tier picks up the new prose with live pcts.
- **Run All Briefings (Daily + Weekly)** — chains the two back-to-back
  under the same digest lock. Total: ~40-45 min steady-state. The
  "do everything now" button.

**Hierarchical chain-of-summaries** is how the digest pipeline keeps
long-window briefings (1M / 3M / 1Y / ALL) high-signal without
overflowing Apple Intelligence's context window or generating thin
"top 24 articles" summaries. Each ticker has cached layers in
`~/StockDigests/summaries/{T}/`:

- **Daily summaries** — written every daily run for that day, ~2 s each.
- **Weekly summaries** — written the first time a 1M+ digest needs the
  week, combines that week's 7 daily summaries.
- **Monthly summaries** — written when a 1Y / ALL digest needs the
  month, combines the 4 weekly summaries in that month.

Completed periods don't change, so each layer caches forever — a 1Y
digest run reads 12 monthly summaries from disk and makes exactly one
AI call (the final synthesis). The first weekly run after this
architecture ships does a one-time backfill (~2-3 hours) populating
~3 months of cache; every subsequent weekly run is fast.

The pipelines run independently — a long digest run never blocks the 15-min
price tick. The refresh pipeline is the only thing that pushes to `main`;
the digest pipeline commits locally and lets the next refresh carry it.

```
[Mac mini at home, running 24/7]
   ↓ scheduler fires its timers
   ├──────────────────────────────┬────────────────────────────────────────┐
[every ~15 min                  [Mon–Fri at 7 AM CT]                   [Sat 7 AM CT]
 ext. market hours]
   ↓                             ↓                                       ↓
scripts/cron-update.sh        scripts/digest-update.sh                 scripts/digest-update.sh
  (fetch + fast re-render)      DIGEST_SCOPE=daily                       DIGEST_SCOPE=weekly
   ↓                             ↓                                       ↓
public/data/prices.json       public/digests.json                      public/digests.json
public/digests.json             (1D/1W stocks + portfolios,              (1M/3M/1Y/ALL stocks
   (template re-render only)     all game windows w/ templates)           + portfolios)
                  ↓ all commits pushed by Pipeline 1 on its next tick
                [stock-game-gamma.vercel.app rebuilds in ~30 seconds]
                  ↓
                [Your iPhone shows the latest on next open]
```

End-to-end refresh latency: ~50 seconds for prices and the fast briefing
re-render; ~8 minutes for the daily briefing; ~6 minutes for the weekly slow
tier. Launch the scheduler with `npm run stockgame`. Pick an interval, pick
a digest time, hit **Schedule Run**. "Weekdays only" still skips Sat + Sun
for the 15-min stock refresh; the weekly digest fires on Saturday regardless
(or also skips Sat if you check the "weekdays only" box).

### Working on this from the laptop without restarting the Mac mini

GitHub is the source of truth. Every change you push from the laptop flows
to the Mac mini automatically on its next cron tick:

- **bash, Swift, TS** (cron-update.sh, digest.swift, fetch-prices.ts,
  lib/picks.ts, components/…) — re-read from disk every time they run.
  Nothing to do; the next tick picks them up.
- **Python scheduler** (stockgame_schedule.py) — the long-running tkinter
  app, which would otherwise sit on the version it launched with. The
  scheduler watches its own source file every 60 s; when cron-update.sh's
  `git pull` brings down a newer copy, the scheduler persists its active
  schedule to `~/.stockgame-schedule.json`, syntax-checks the new file,
  and re-execs itself. On launch it restores the schedule, deletes the
  state file, and shows "Code: re-launched with latest version" in the
  GitHub-sync row at the bottom of the window.

The "Auto-restart on GitHub update" checkbox is on by default. There's
also a manual "Restart now" button next to it for when you want a
just-pushed change live immediately rather than within 60 s. Either way:
if your push has a Python syntax error, the `py_compile` check inside
the restart aborts the re-exec, the old process keeps running, and the
sync label flips red so you know to push a fix.

So: edit on the laptop, commit, push, walk away. The Mac mini stays on
the latest `origin/main` commit without intervention.

### How the live-pct templating works

The daily Apple Intelligence run for the game-wide 1D / 1W / 1M briefings
is prompted to write every percentage in a bracketed format —
`ASTS [-10.23%]`, `TSLA [+5.62%]`, `Brian [+8.45%]`. After generation, a
regex pass extracts those bracketed numbers and replaces them with
placeholders (`{{ASTS}}`, `{{TSLA}}`, `{{user:brian}}`), stored next to the
rendered prose as `digestTemplate`. The 15-min fast tier reads the template,
computes the *current* pct for each placeholder from the freshly-pulled
`prices.json`, and substitutes them back in. Same prose — *"ASTS missed
earnings, helping Rick"* — but the bracketed numbers stay live without any
AI involvement. If the model ever drifts off the bracket format, the
extractor logs a warning and that window simply keeps the morning's
rendered prose until the next daily run.

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

### Change a player's picks or add a new player (from anywhere — phone, laptop, GitHub web)
Edit `config/roster.json`. That single file is the source of truth for both
the frontend (`lib/picks.ts` imports it) AND the briefing pipeline
(`scripts/digest.swift` reads it at startup). The Mac mini's 15-min `git
pull --rebase` picks up the change; the next price-refresh fetches
historical bars for any newly-added tickers back to `start_date`; the next
daily digest run regenerates per-portfolio + game digests against the new
roster.

The "share counts are fixed at the 2/5 close" property still holds: when a
ticker is added to a player, shares are computed as `starting_dollars / N
/ startClose` — i.e., as if the player had held it from start_date. Same
backtracking the original Feb 5 picks got.

When a roster change is detected (fingerprint in
`~/StockDigests/.roster-fingerprint.json` vs current
`config/roster.json`), `digest.swift` automatically drops the stale
per-portfolio entries for the changed users plus all game-wide entries
from `public/digests.json`. The next chunk / finalize regenerates them
against the new roster. Per-ticker article archives and summaries are
keyed by ticker, not user, so they survive a roster shuffle untouched.

**Workflow from GitHub web UI:**
1. Edit `config/roster.json` (change a ticker, add a user, etc.).
2. Optionally validate locally first: `python3 scripts/validate-roster.py`.
   This catches missing commas, lowercase tickers, missing `ticker_names`
   entries, duplicate user IDs, etc. — the kind of typos that would
   otherwise break the Vercel build or the next digest run.
3. Commit + push (GitHub's web UI does both in one click).
4. Within ~15 min, the Mac mini's next refresh tick pulls the change.
   Within ~24 hr (or sooner if the change lands during a chunked morning
   window), the digests reflect the new roster.

If the JSON is malformed, `digest.swift` falls back to the embedded
last-known-good roster so the briefing pipeline keeps running; the Vercel
build fails on the bad import and the previous deploy keeps serving. Push
a fix and both sides recover on the next 15-min cycle.

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
mini chart with every player's color. They open it in Safari, tap
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
