// What's New — the user-facing changelog.
//
// This is the single source of truth for the "What's New" bell in the app.
// Add an entry here whenever a *major, user-noticeable* feature ships — a new
// tab, a new chart, a new way to compare, etc. Skip the plumbing: data-refresh
// internals, scheduler tweaks, doc updates, and bug fixes don't belong here.
// The bell only shows entries from the last RECENT_WINDOW_DAYS days (see
// recentEntries below), so the list stays a short highlight reel rather than a
// full commit log.
//
// Voice: write for a friend who doesn't code. Say what the feature *is* and how
// they'd *use* it, in plain words. No jargon ("intraday", "SSG", "digest
// pipeline"), no ticker-soup, no internal file names.

export type ChangeCategory = "New" | "Improved";

export interface ChangelogEntry {
  /** Stable slug — used as the localStorage "seen" marker isn't tied to this,
   *  but it keeps React keys stable and lets us deep-link later if we want. */
  id: string;
  /** YYYY-MM-DD — the day the feature went live. Drives sort + the 30-day window. */
  date: string;
  category: ChangeCategory;
  /** A single emoji shown in the row. Keep it literal to the feature. */
  icon: string;
  /** Short headline, shown in the collapsed row. */
  title: string;
  /** One sentence under the title, always visible. */
  summary: string;
  /** Plain-language paragraphs shown when the row is expanded. First = what it
   *  is, the rest = how to use it / why it's useful. */
  details: string[];
}

// Newest first. The component sorts defensively anyway, but keeping this in
// reverse-chronological order makes the file easy to scan.
export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "smarter-news-briefings",
    date: "2026-06-18",
    category: "Improved",
    icon: "✨",
    title: "Smarter news summaries",
    summary:
      "The daily briefings now use Apple's new Private Cloud Compute (macOS 27) — a much bigger, private AI model — so they're sharper, more specific, and no longer vague.",
    details: [
      "The plain-English summaries that explain what's moving the game and each stock are now written by Apple's Private Cloud Compute, a feature new to macOS 27. Until now they came from the small AI model that runs directly on the Mac; the same kind of request now goes to Apple's much larger AI model running on Apple's own private servers, which is far better at reading a whole day of news and writing a tight, accurate recap.",
      "It's still entirely Apple — nothing is ever sent to an outside AI service. Apple's private servers are built so that your request is processed and then deleted, and no one (not even Apple) can see what was sent. So you get the quality of a big cloud model with the privacy of something running on your own device.",
      "Why you'll notice the difference: the old summaries tended to pad with filler like “rose in a generic market move,” and sometimes paired a stock with the wrong piece of news. The new ones name the actual catalyst — an earnings beat, an analyst call, a product launch — keep it to a couple of tight sentences, and read like a real market recap. Tap “Show more” on any briefing to read the full version.",
    ],
  },
  {
    id: "combined-players-fund",
    date: "2026-05-30",
    category: "New",
    icon: "🧩",
    title: "Combined Players fund",
    summary:
      "Everyone's picks, pooled into one $100,000 fund — see who's carrying the group and how the whole field stacks up.",
    details: [
      "There's a new pretend fund that pools all of our picks into one basket. Imagine everybody's stocks dumped together and $100,000 spread evenly across every pick — with five of us picking ten each, that's 50 slots of $2,000. If two people picked the same stock, it counts twice, so the crowd favorites carry extra weight.",
      "Scroll to the bottom of the Compare tab to find the new “Combined breakdown” — the same Sector / Industry / Market-cap donut your own account gets, but for the whole pooled fund. Tap a slice to see which stocks fill it. Underneath, an “About the combined portfolio” summary sums up how the whole book is built and the themes we keep coming back to.",
      "Want to race it against everyone? It's also a line you can switch on from the filter button on the Compare chart (it's off by default), and tapping it opens its own page with the full holdings list, just like any other fund.",
    ],
  },
  {
    id: "investment-thesis",
    date: "2026-05-29",
    category: "New",
    icon: "✍️",
    title: "Add your investment thesis",
    summary:
      "Write the “why” behind your picks — a big-picture theme plus a quick take on each of your stocks.",
    details: [
      "Your portfolio page now has a “Why these picks” section at the bottom where you can explain your thinking — the overall theme tying your portfolio together, and a short reason for each stock you hold. Readers tap any holding to expand your full take.",
      "Adding yours is as easy as building a fund. Open your portfolio from the leaderboard, scroll to “Why these picks,” and tap “Add thesis” (or “Edit” if you’ve already written one). Fill in as much or as little as you like — every field is optional — then save. It updates the page for everyone right away.",
      "It’s open on purpose, just like funds: anyone can edit any portfolio’s thesis, so please only edit your own. Brian’s Physical-AI thesis is already in there as an example of what it looks like filled out.",
    ],
  },
  {
    id: "custom-funds",
    date: "2026-05-28",
    category: "New",
    icon: "🧺",
    title: "Build your own fund",
    summary:
      "Create a custom basket of stocks and watch it race against everyone else on the leaderboard.",
    details: [
      "You're no longer limited to watching the five of us. You can now build your own pretend fund — pick any stocks you like, decide how much of each to hold, give it a name, and it starts competing right alongside our portfolios.",
      "To make one, go to the Compare screen and tap “Add Fund.” A quick intro explains how it works, then you name your fund, search for the stocks you want, set how the money splits between them (or let it divide evenly), and save. Its line shows up on the chart and its score appears on the leaderboard.",
      "Funds you create start switched off on the chart so things don't get crowded. Tap the filter button to turn yours on, and use “Manage” to edit, rename, or archive a fund later.",
    ],
  },
  {
    id: "legacy-auto",
    date: "2026-05-23",
    category: "New",
    icon: "🚗",
    title: "Legacy Auto joins the race",
    summary:
      "A new themed competitor made of classic carmakers — Ford, GM, Stellantis, Toyota, and Honda.",
    details: [
      "We added a sixth competitor for fun: a portfolio made entirely of old-school automakers (Ford, GM, Stellantis, Toyota, and Honda). It's a fun benchmark for seeing how the traditional car industry is doing against everyone's tech-heavy picks.",
      "It's hidden on the chart by default since it's a themed comparison rather than a real player. To see it, tap the filter button on the Compare screen and switch on “Legacy Auto.”",
    ],
  },
  {
    id: "portfolio-donut",
    date: "2026-05-20",
    category: "New",
    icon: "🍩",
    title: "Portfolio breakdown wheel",
    summary:
      "See at a glance how each person's money is split across different industries.",
    details: [
      "Every player's portfolio page now has a colorful ring chart that shows how their money is divided across industries — how much is in tech, energy, healthcare, and so on.",
      "Tap any slice of the ring to see exactly how much is in that group. Below the chart there's also a short, plain-English write-up of each person's overall strategy.",
      "To find it, tap a player from the leaderboard to open their portfolio, then scroll down to the breakdown.",
    ],
  },
  {
    id: "sp500-benchmark",
    date: "2026-05-18",
    category: "New",
    icon: "📊",
    title: "Compare against the S&P 500",
    summary:
      "See whether players are actually beating the overall stock market, not just each other.",
    details: [
      "The leaderboard and charts now include the S&P 500 — a common stand-in for “the whole market.” This answers the real question: is anyone actually beating the market, or would we all have done better just buying everything?",
      "On the Compare screen the S&P 500 shows up as its own line and row. On a player's portfolio page you'll see how far ahead of (or behind) the market they are.",
    ],
  },
  {
    id: "company-profiles",
    date: "2026-05-13",
    category: "New",
    icon: "🏢",
    title: "Company info on every stock",
    summary:
      "Tap any stock to read what the company does and see its sales, profit, and earnings history.",
    details: [
      "Each stock now has its own profile. Tap a stock to see a short description of what the company actually does, key numbers like its size and price tags, and simple charts of its revenue, profit, and how its earnings have compared to what experts expected.",
      "If you want the exact figures behind a chart, tap “Show numbers” underneath it to expand a table.",
      "To get there, open the Stocks tab and tap any company, or tap a stock name anywhere it appears in the app.",
    ],
  },
  {
    id: "extended-hours-twilight",
    date: "2026-05-13",
    category: "Improved",
    icon: "🌆",
    title: "Early and late trading, plus a twilight look",
    summary:
      "The Today view now includes before- and after-hours trading, with a softer color scheme after the bell.",
    details: [
      "The “Today” (1D) view used to only show the regular trading day. Now it also includes the quieter trading that happens before the market opens and after it closes, so you get the full picture of a stock's day.",
      "The app also eases into a softer “twilight” color scheme during those off-hours, so it's obvious at a glance when regular trading isn't running.",
    ],
  },
  {
    id: "news-briefings",
    date: "2026-05-10",
    category: "New",
    icon: "📰",
    title: "Daily news briefings",
    summary:
      "Plain-English summaries of the news moving the game and each stock, refreshed through the day.",
    details: [
      "The app now writes short, easy-to-read summaries explaining what's actually driving the scores — which stocks moved, why, and what's coming up. There's a game-wide briefing on the Compare screen and a per-company briefing on each stock's page.",
      "The headline numbers in the briefings update through the day as prices move, while the written story refreshes each morning.",
      "Tap “Show more” on any briefing to read the full version and see the news sources it was based on.",
    ],
  },
  {
    id: "tee-times",
    date: "2026-05-07",
    category: "New",
    icon: "⛳",
    title: "Tee Times tab",
    summary:
      "A shortcut to book a round at Inshalla CC — fitting, since the loser buys the golf.",
    details: [
      "There's a new Tee Times tab at the bottom of the app. Since the loser of this whole game is buying golf, we figured we'd make it easy to book.",
      "It gives you quick links to reserve a tee time at Inshalla Country Club for today, tomorrow, or the day after, plus a button to browse all available times.",
    ],
  },
  {
    id: "auto-theme",
    date: "2026-05-07",
    category: "Improved",
    icon: "🌗",
    title: "Automatic light & dark mode",
    summary:
      "The app brightens up while the market's open and goes dark when it's closed — on its own.",
    details: [
      "You don't have to pick a theme. The app automatically uses a bright look while the stock market is open for the day and switches to a dark look once trading wraps up, then back again the next morning.",
    ],
  },
  {
    id: "live-today-view",
    date: "2026-05-05",
    category: "New",
    icon: "🟢",
    title: "Live “Today” view",
    summary:
      "A 1D tab that updates through the trading day, with a pulsing dot at the latest price.",
    details: [
      "There's a “Today” (1D) tab that shows how everyone's doing just for the current day, updating as the market moves. A glowing dot marks the most recent price.",
      "A small badge tells you whether the market is open right now or already closed, so you know if what you're seeing is live or final for the day.",
    ],
  },
];

/** How far back the "What's New" bell looks. Older entries stay in this file
 *  for the record but drop out of the in-app list. */
export const RECENT_WINDOW_DAYS = 30;

/** Entries from the last RECENT_WINDOW_DAYS days, newest first. Pass a fixed
 *  `now` in tests; defaults to the current time. */
export function recentEntries(now: number = Date.now()): ChangelogEntry[] {
  const cutoff = now - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return [...CHANGELOG]
    .filter((e) => entryTime(e) >= cutoff)
    .sort((a, b) => entryTime(b) - entryTime(a));
}

/** The date of the newest recent entry (YYYY-MM-DD), or null if none. Used to
 *  decide whether the unread dot should show. */
export function newestRecentDate(now: number = Date.now()): string | null {
  const recent = recentEntries(now);
  return recent.length > 0 ? recent[0].date : null;
}

// Anchor each date at local noon so day comparisons don't wobble across time
// zones / DST the way midnight-UTC parsing can.
function entryTime(e: ChangelogEntry): number {
  return new Date(`${e.date}T12:00:00`).getTime();
}
