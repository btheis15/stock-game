# DESIGN.md — portable UI patterns and design-system notes

> **Purpose:** capture the design language and interaction patterns this
> project uses, in a project-agnostic way, so they can be lifted into other
> apps. Pair with `STATE.md` for the implementation details specific to this
> project.

> **Use this for:** any mobile-first dashboard / data-viz / PWA where you
> want a clean, "premium native-feeling" look — financial apps, fitness
> trackers, IoT dashboards, any "track a thing over time" UI.

---

## §1. Design philosophy in one paragraph

**Robinhood-without-the-trading.** Dark by default. Single big number per
view. Big chart that owns the upper third of the screen. Beneath it,
information stacks vertically in card groups, each card a self-contained
unit. Everything is one-thumb-reachable on mobile. Animation is purposeful,
never decorative — a live pulse on something that's actually live, a soft
flash on something the user just navigated to, and deliberate iOS-style
transitions for navigation and overlays (tab cross-fade, drill-in
push/pop, slide-up sheets), all done in CSS within a tight perf budget. The
point of the design is to make it pleasant to scroll through every day, not
to dazzle once.

---

## §2. Visual foundations

### §2.1. Color

| Role | Hex | Usage |
|---|---|---|
| Background | `#000000` | Pure black. Not zinc-950 — actual black, so OLED screens save power and the gradients have something to fade into. |
| Foreground | `#FFFFFF` | All primary text. |
| Dim text | `#A1A1AA` (zinc-400) | Secondary labels, metadata. |
| Tiny labels | `#71717A` (zinc-500) | Section captions, tertiary info. |
| Card surface | `#0E0E10` (or `bg-zinc-900/70`) | Elevated cards on the black background. ~80% opacity gives a faint sense of depth. |
| Card border | `#1F1F23` (or `border-zinc-800`) | Just visible. Provides edge separation without weight. |
| **Gain (green)** | `#00C805` | Positive values, "up" arrows, confirmations. The exact Robinhood green. |
| **Loss (red)** | `#FF453A` | Negative values, "down" arrows. Apple's system red, slightly desaturated. |
| Accents (per-entity) | `#00C805` / `#5AC8FA` / `#FF9F0A` / `#BF5AF2` | When you have N entities, give each a distinct color. Don't overload green/red, those are reserved for "good/bad." |

**Don't use zinc-950 or near-black.** Use actual `#000`. The visual difference matters: charts and cards lift off a true black background better.

**Accent colors are personal-identity, not categorical.** Same player = same color everywhere (line on chart, border on card, text in places). This is the visual handle the user grabs onto.

**Gain/loss colors are universal, never overridden.** Even a player with a green personal accent shows red text when their number is negative. Don't mix the two language systems.

### §2.2. Typography

System font stack (don't load a custom font for this style — it adds weight and SF Pro is already what users expect on iOS):

```css
font-family:
  -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
  "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

Hierarchy:

| Role | Size | Weight | Notes |
|---|---|---|---|
| Hero number (price, total) | 34-48px | 600 | Tabular-nums. The thing the user came to see. |
| Title | 22px | 600 | "{Player}'s portfolio", page titles |
| Section header | 15px | 600 | "Holdings", "What's driving it" |
| Body | 14px | 400-500 | Lists, info rows |
| Tiny / metadata | 11-13px | 400 | Subtle context, dates, sub-info |
| Labels (uppercase) | 10-11px | 700 | `tracking-[0.12em] uppercase` — small all-caps labels for "TOP PERFORMERS" / "COMPARE" / etc. |

**Use `tabular-nums` everywhere a number is shown.** It's a one-line CSS
property that aligns digits in a column so prices don't jiggle as they
update. This is the single highest-leverage typography choice in a numeric
dashboard.

**Avoid full-uppercase except for tiny tracking-wide labels.** Title-case
hero text. Sentence-case body. Reserve `text-[10px] uppercase tracking-wider`
for the tiny metadata-style headers above sections.

### §2.3. Spacing & layout

- **Mobile-first, max-width 28rem (448px).** Layout works at iPhone widths
  (375-430) and centers nicely on desktop. Don't add a separate desktop
  layout — accept it'll look like a phone on a laptop. Most users will
  be on the iPhone PWA install anyway.
- **Vertical rhythm: cards and groups separated by `mt-3` to `mt-6`.**
  Sections that are conceptually different get more space; cards within
  a section get less.
- **Card padding: `p-4` (16px).** Inside cards, divider rows use `py-3`
  (12px vertical) with full-width separators.
- **Border radius scale: `rounded-2xl` (16px) for cards, `rounded-full` for chips and avatars.** Don't mix in oddball values; the consistent corner language ties everything together.
- **Safe area insets matter.** Use `env(safe-area-inset-top)` and
  `env(safe-area-inset-bottom)` so iPhone notch/home-indicator don't eat
  content. Set on `<html>` or `<body>` and on fixed-position elements.

---

## §3. Layout pattern: the standard view

Every "view" page in the app follows this skeleton:

```
┌──────────────────────────────┐ ← sticky header (back button, optional title)
│  ←  Compare                  │   bg-black/85 backdrop-blur-md
├──────────────────────────────┤
│  CATEGORY                    │ ← uppercase 10-11px tracking-wide label
│                              │
│  Big page title              │ ← 22px bold
│  $123,456.78                 │ ← hero 34-48px tabular-nums
│  ▲ +$1,234 (+1.23%)          │ ← signed delta, gain-color
│                              │
│        [chart, 260-280px]    │ ← scrub-able, full bleed
│                              │
│  1D  1W  1M  3M  1YR  ALL    │ ← range tabs, even-spaced
│                              │
│  ┌────────┐ ┌────────┐       │ ← grid cards (2-col)
│  │ Card A │ │ Card B │       │
│  └────────┘ └────────┘       │
│                              │
│  ## Section header           │ ← 15px bold
│  ┌──────────────────────┐    │ ← single tall card with divided rows
│  │ row · row · row · row│    │
│  └──────────────────────┘    │
│                              │
│  Footer / quiet metadata     │
└──────────────────────────────┘ ← fixed bottom tab bar (when applicable)
```

The mental model: **chart up top is the "what," everything below is the "why."** Headers tell you what number you're looking at. The chart tells you how it's changed. The leaderboard / breakdown / list explains why.

---

## §4. Component patterns

These are all reusable across projects. Each is small (50-200 LOC).

### §4.1. Sticky header with back button

```
┌──────────────────────────────────┐
│  ⬅  Title                        │
└──────────────────────────────────┘
   - position: sticky; top: 0
   - z-30 (above body, below modals)
   - bg-black/85 with backdrop-blur-md
   - 36-40px circular back button, dark fill, contained chevron icon
   - Uses router.back() for natural app history
```

**Why sticky, not fixed:** sticky scrolls naturally with content but pins
when you scroll past it. Lets the user always tap "back" no matter how
deep into the page they've scrolled.

**Why backdrop-blur:** content scrolling under it stays partially visible
through a frosted-glass effect — feels native, not wallpapered.

### §4.2. Hero number ("PriceHeader") component

```
TICKER · BADGE
Title in big text
$1,234.56
▲ +$12.34 (+0.99%)  ·  Optional date
```

Anatomy:
- Tiny uppercase label up top (category, ticker, etc.)
- Title (sentence case)
- Hero number — `tabular-nums`, 34-48px, weight 600
- Signed delta with up/down triangle, color-coded gain/loss
- Optional date suffix (visible only when scrubbing)

Pattern: the hero number and delta should both update *live* when the user
scrubs the chart below — the header reflects whatever moment in time the
user is looking at.

### §4.3. Range tabs

```
1D  1W  1M  3M  1YR  ALL
```

Style:
- Horizontal row of pill buttons, evenly spaced
- Active tab: filled background in the entity's accent color, black text
- Inactive: gray text on transparent background
- Tap target: 32-36px tall minimum
- Order: shortest to longest range

The active accent color is **the leader's** color in multi-entity views, or
just one accent in single-entity views. This subtly reinforces "the thing
you're tracking" via color continuity.

### §4.4. Cards

Two card sub-patterns:

**Grid cards (2-col):**
- For comparing peers (leaderboards, summaries)
- Each card: small color dot + label + hero metric + delta
- Optional badge (e.g., "1ST", "LIVE") in top-right corner
- Tap-to-drill: each card is a `<Link>` to the detail view

**Stack cards (full-width with divided rows):**
- For lists where each row has the same shape (holdings, history, dividends)
- Single rounded container, internal `divide-y` between rows
- Each row: 12-14px padding, leading icon/avatar, middle column with
  primary + secondary text, trailing column with primary + secondary
  numbers right-aligned
- Tap-to-drill: each row is a `<Link>`

Both card types: `bg-zinc-900/70 border border-zinc-800 rounded-2xl`.

### §4.5. Badges

Three flavors:

| Style | Use | Example |
|---|---|---|
| Filled (entity accent + black text) | "winner" / "primary" status | `LEADING`, `1ST`, `ACTIVE` |
| Bordered + dim text | "secondary" / "ranked" status | `2ND`, `3RD`, `4TH` |
| Icon-led pill (colored dot + label) | live state | `● LIVE`, `● MARKET CLOSED` |

Always tiny (`text-[9-11px]`), uppercase, letter-spacing wide
(`tracking-wider`), padded `px-1.5 py-0.5`.

### §4.6. Live state badge

```
● LIVE              ← green dot pulsing slowly + green tracking-wide text
● MARKET CLOSED     ← grey dot static + grey text
```

Pattern: anywhere data has a "live now" vs "static snapshot" distinction,
show this. The pulsing dot is a 1.6s ease-out infinite opacity oscillation.

### §4.7. Bottom tab bar (when needed)

```
┌──────────────────────────────┐
│   icon       icon            │
│   Label      Label           │
└──────────────────────────────┘
```

- Fixed bottom, full width, `bg-black/95 backdrop-blur-md border-t`
- 2-4 tabs ideal; >4 starts feeling cramped on iPhone widths
- Active: bright white text + filled icon
- Inactive: zinc-500 text + outline icon
- Honor `env(safe-area-inset-bottom)` so the iPhone home indicator doesn't sit on top of it

**Tab philosophy:** if you're tempted to add a 5th tab, ask whether it
should instead live as a tappable card on one of the existing tabs.
Drilling-down via cards keeps the chrome clean.

### §4.8. PWA install hint

iOS Safari doesn't have a "install prompt" event like Android. But you can
detect if the page is running in standalone mode and, if not, show a top
banner asking the user to "Add to Home Screen" with a share-icon walkthrough.

```
[ Add to Home Screen for full-screen mode. Tap ⤴ then Add to Home Screen.  ✕ ]
```

- Detect: `window.matchMedia('(display-mode: standalone)').matches` AND
  `/iPad|iPhone|iPod/.test(navigator.userAgent)`
- Dismissible; persist dismiss in `localStorage`
- Position: top, sticky, above the safe-area-inset-top
- Don't nag — once dismissed, never show again

### §4.9. Pull-to-refresh + auto-refresh-on-resume

Two pieces:

**Pull-to-refresh:** standalone PWAs lose Safari's native pull gesture, so
you implement it manually. At scroll-top, tracking touchstart Y; on
touchmove with positive dy, show a small dark indicator pill that drops
from the top edge with an arrow that rotates as you pull. Past a threshold
(70px) the arrow turns the entity's accent color and snaps green; release
triggers `location.reload()`. Touches that start inside an `<svg>` or any
element with `data-no-ptr` are ignored (so chart scrubs don't trigger PTR).

**Auto-refresh-on-resume:** `visibilitychange` listener tracks when the page
goes hidden. If hidden > 60s and then becomes visible (user re-opens the app
from home screen), force `location.reload()`. This guarantees fresh data on
app open without polling.

These two together cover both "I want to refresh now" and "I just opened
the app, give me current state."

### §4.10. Footer / freshness indicator

A small, dim block at the bottom of every page:

```
Data through May 5, 2026
Snapshot generated May 5, 9:59 AM
```

Cheap, calm, and tells you immediately whether the data pipeline is alive.
Way more useful than a big "Connection: OK" toast that's only there when
everything's broken.

---

## §5. Interaction patterns

### §5.1. The scrub chart

The single most important UI in any time-series dashboard. Touch the chart,
drag your finger across, see values update in the header above. Robinhood
calls this "the entire app." Implementation details:

- **Touch handling:** use **Pointer Events** (not Touch Events). On
  `pointerdown`, call `setPointerCapture` so the SVG keeps receiving
  events even if the finger leaves its bounds.
- **`touch-action: none` on the chart SVG.** This is the single most
  important CSS line in the chart. Without it, vertical drift mid-scrub
  causes iOS Safari to interpret the gesture as "user wants to scroll the
  page," releases pointer capture, and your chart appears to "let go" of
  the finger. With it, the chart owns any touch that lands on it until
  release.
- **Page still scrolls** because `touch-action: none` is only on the chart,
  not the body. Above and below the chart, normal scrolling works.
- **Scrub state is lifted to the parent.** The chart calls
  `onScrub(state | null)` on every move and the parent renders the header
  numbers from that state. This is what lets the hero number track the
  finger.
- **Scrub state shape:** `{ index, date, values: { id, value }[] }`. Index
  for indexing back into the source data; date for display; values for
  multi-line charts.
- **Crosshair render:** a faint vertical line + a filled colored dot on
  each line at the scrubbed point. No data labels in the chart itself —
  the labels are in the hero number above.
- **Scroll-up release:** `pointerup`, `pointercancel`, and `pointerleave`
  all clear scrub. Safety net.

### §5.2. Live endpoint pulse

When the data is **currently updating** (within ~30 min of last bar arrival),
draw two concentric circles at the most-recent point of each line:

```css
@keyframes livePulseRing {
  0%   { r: 4; opacity: 0.7; }
  100% { r: 14; opacity: 0; }
}
@keyframes livePulseFill {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
```

The ring expands and fades out (sonar-style); the fill brightness oscillates
gently. Together they read as "this is alive, keep watching."

Don't show the pulse when the data isn't live — use a market-state badge
above the chart to signal that explicitly.

### §5.3. Range tab → chart re-scope

Tapping a range tab updates the parent state, which:
- Recomputes the data slice (e.g., "last 7 days" for 1W)
- Passes new data to the chart
- Chart re-derives x/y scales, redraws

Special case for the "live / today" range (often "1D" in finance):
- Chart x-axis is forced to span the full session (e.g., market hours
  9:30 AM - 4:00 PM), even when only a fraction is filled
- Line covers only the elapsed portion; rest of axis is empty
- Endpoint pulse is enabled
- For multi-line comparison charts, **normalize lines to start at 0%** so
  they all begin at the same y, otherwise lines with different absolute
  values stack apart and you can't see intraday wiggle

### §5.4. Deep-link with anchor + flash

Tap a row in a list → land on the detail page scrolled to that row, with
a brief green flash on the row to confirm "this is what you tapped."

Pattern:
- Source link: `/destination#item-id`
- Destination row: `<Link id={itemId} ...>`
- CSS: `:target` selector triggers a brief background-color animation
  (1.6s, fades from accent-tint to transparent)
- `scroll-margin-top` on the row to clear the sticky header
- `html { scroll-behavior: smooth }` so the jump animates

This is a 4-line CSS solution that gives you a really polished cross-page
navigation feel.

### §5.5. Gesture priorities

When multiple gesture systems coexist on a single page (chart scrub +
pull-to-refresh + native scroll), order them so:

1. **Chart scrub wins inside the chart** (touch-action: none on the SVG).
2. **Pull-to-refresh wins at scroll-top, outside the chart.**
3. **Native scroll wins everywhere else.**

PTR's touchstart explicitly bails if the touch starts inside an `<svg>` or
any `[data-no-ptr]` ancestor.

---

## §6. Animation principles

Animation in this app serves three jobs — **liveness, feedback, and
purposeful iOS-style transitions** — and nothing else. Content itself is
still calm: cards don't fly in, numbers don't count up. But navigation and
overlays now have deliberate motion, because a native-feeling app moves
between screens, it doesn't just hard-cut.

**The liveness / feedback set** (these animate because the user would notice
them missing):

1. **Live pulse** on the live-endpoint of the chart.
2. **Holding flash** when arriving at a row via deep-link (1.6s green-tint fade).
3. **Pull-to-refresh indicator** dropping from the top edge during the gesture.
4. **Scrub crosshair** following the finger (movement, not a CSS animation).
5. **`.press` tap-shrink** on interactive chrome (TabBar links, HeaderBack
   button, FilterToolbar buttons, WhatsNew bell/close): a quick active
   `scale(0.96)`, the same touch-down cue iOS gives every button.

**The transition / overlay set** (see §6.1 for the system):

6. **Route transitions** — tab switches cross-fade; drilling into a detail
   route pushes in from the right, backing out pops in from the left.
7. **Sheets** — the iOS bottom-sheet primitive slides up to open and slides
   back down to dismiss.

Things that **still don't** animate, intentionally:
- Range tab transitions (data swaps; chart re-renders crisply, no slide)
- Card mount/unmount inside a page (no per-item stagger)
- Numbers (no count-up)

The rule is unchanged in spirit: motion must earn its place. If the user
wouldn't notice it missing, don't add it. Liveness, feedback, and
screen-to-screen continuity all pass that test; gratuitous polish doesn't.

### §6.1. The motion layer (iOS-style transitions + sheets)

A small, **CSS-only** motion layer gives the app native-feeling navigation
and overlays. No JS animation library drives any of it — the transitions are
pure keyframes/transitions on transform and opacity (GPU-friendly), kept
inside the 16ms budget. (Framer Motion still ships for a few content
micro-interactions — see §6.2 — but it is not used for navigation or sheets.)

**Motion tokens** (in `app/globals.css`, alongside the color tokens):

```css
--ease-ios:     cubic-bezier(0.32, 0.72, 0, 1);   /* slides / pushes */
--ease-out-ios: cubic-bezier(0.16, 1, 0.3, 1);    /* fades / settles */
--dur-press: 140ms;   /* tap-shrink */
--dur-fade:  220ms;   /* tab cross-fade */
--dur-slide: 320ms;   /* push / pop / sheet slide */
```

**Route transitions** (`app/template.tsx`). A Next.js `template.tsx`
re-mounts on every navigation, so it's the natural place to drive an
enter animation. The direction is picked from a module-level "previous
path" compared against the detail-route regex `/^\/(stock|portfolio|fund)\//`:

- **Top-level tab switches** (Compare `/`, Stocks `/stocks`, Tee Times
  `/tee-times`) **cross-fade** (`.pt-fade`).
- **Drilling into a detail route** (`/stock/*`, `/portfolio/*`, `/fund/*`)
  **pushes** in from the right (`.pt-push`).
- **Backing out** of a detail route **pops** in from the left (`.pt-pop`).

These keyframes use `animation-fill-mode: backwards` so **no transform
lingers at rest**. That's deliberate: several pages render
`position: fixed` modals inline, and a leftover ancestor transform would
re-root those fixed elements to the transformed box. Once the enter
animation finishes, the page is back to an untransformed layout.

**Sheets** (`components/Sheet.tsx`). A reusable iOS bottom-sheet primitive:

- **Portals to `document.body`**, so it's immune to any ancestor transform
  (the same fixed-positioning concern as above — a sheet must not be
  re-rooted by a page-transition transform).
- **Slides up** to open (`.sheet-panel` / `sheetIn`); a `closing` state
  **slides back down** (`.is-closing` / `sheetOut`) and then unmounts on
  `animationend` (so the exit animation actually plays before teardown).
- **Content-height detent by default** (sheet is only as tall as its
  content); a `full` prop gives full height for forms.
- Grab handle, optional custom-header slot, optional **`footer` slot**
  (a pinned action bar below the scroll area — Back/Next/Save rows for
  form sheets), `role="dialog"` + `aria-modal`, body-scroll lock while
  open, **Escape-to-close**.
- **No drag-to-dismiss.** You close via backdrop tap, a Done control, or
  Escape. (Drag-to-dismiss was intentionally skipped — it's gesture-budget
  and older-device risk for little gain here.)

`FilterSheet` (`components/FundsFilter.tsx`), `WhatsNew`
(`components/WhatsNew.tsx`), `CreateFundModal`, and `EditThesisModal`
(the latter two as `full` sheets with `footer`) all render through
`<Sheet>`. Reach for
`<Sheet>` for any new filter / form / info / destructive-confirm overlay —
not a bespoke modal.

**Reduced motion.** `app/globals.css` now has a global
`@media (prefers-reduced-motion: reduce)` guard that neutralizes
transitions, animations, and smooth-scroll app-wide. (The repo previously
had no reduced-motion handling at all — this closes that gap.) **Any new
motion must fall under that guard** — i.e., be a plain CSS
transition/animation so the global rule degrades it for free.

### §6.2. What is NOT in the motion layer

So downstream ports don't over-claim:

- **No shared-element / cross-route morph** (View Transitions API). It was
  intentionally skipped for older-device compatibility.
- **Framer Motion was not removed.** It still drives a few content
  micro-interactions — `BreakdownDonut` (slice-pop spring),
  `PortfolioComposition` (view cross-fade), and `PortfolioThesis`
  (accordion). Only `WhatsNew` moved off Framer Motion; its expand/collapse
  is now a CSS `grid-template-rows: 0fr → 1fr` transition.
- **No drag-to-dismiss on sheets** (see §6.1).
- **No JS-driven per-frame animation for the chart scrub.** The 16ms gesture
  budget and `touch-action: none` on the chart SVG are unchanged (§5.1, §14).

---

## §7. Information density patterns

### §7.1. The leaderboard

When you have N entities to compare, show all of them in a 2-column grid
(or 3-column on larger screens), sorted by the metric that matters,
labeled with rank badges (1st / 2nd / 3rd / Nth). Reserves the largest
visual emphasis for #1 (filled accent badge) vs everyone else (bordered
badge).

### §7.2. Top-N + Bottom-N per entity

For "what's driving it" insights, show per-entity breakdowns of:
- Top 3 contributors (only if positive return in the active range)
- Bottom 3 detractors (only if negative return)

Sort the entity cards by that entity's rank in the leaderboard for the
active range. (The leader's card appears first.) This gives a "story"
flow: leader's story → next-best → all the way to last place.

### §7.3. The signed-number row

Every list row that has a numeric metric follows this pattern:

```
[Avatar] Item title                      $123.45
         Subtitle (small dim)            +12.34%
```

- Left: 36-40px circular avatar/badge
- Middle: title (white, 14px) + subtitle (zinc-500, 11px, tabular-nums)
- Right: primary number (white, 14px, tabular-nums) + signed delta with gain/loss color (11-12px, tabular-nums)

Right-aligned numbers in a tabular font means a column of rows reads
like a real spreadsheet — easy to scan, no jiggle.

### §7.4. Empty / quiet states

Don't ship empty states with illustrations. A short sentence in dim text
is usually enough:

> "Flat across the board this range."
> "Not held by any player."
> "(no log yet — run the script once to populate)"

If there's truly no data and no action the user should take, that's a hint
that the feature shouldn't be visible at all in this state. Hide it
instead.

---

## §8. Mobile-first PWA conventions

These are all small but they compound into a "feels native" experience:

- **`manifest.webmanifest`** with `display: standalone`, `start_url: "/"`,
  `background_color` and `theme_color` matching your dark theme.
- **`apple-mobile-web-app-capable: yes`** so it installs full-screen on iOS.
- **Apple touch icon** (180×180 PNG) — this is the icon iOS uses on the
  home screen.
- **Standard PWA icons** (192×192 + 512×512) for Android / Chrome.
- **OG card** (1200×630 PNG) for link previews in iMessage/Slack.
- **Theme color = your background color.** Sets the iOS Safari status-bar
  and standalone-app status-bar tint.
- **`viewportFit: 'cover'`** + `userScalable: false` so the page goes
  edge-to-edge and doesn't pinch-zoom (intentional for an "app").
- **`tap-highlight-color: transparent`** so iOS doesn't gray-flash buttons
  on tap.
- **`-webkit-touch-callout: none`** on buttons so long-press doesn't show
  the "save image" sheet.
- **`overscroll-behavior-y: none`** on body so iOS doesn't bounce-rubber-band
  the whole app (bad on a one-screen dashboard; less bad on a long-scrolling
  page — judgment call).
- **`scroll-behavior: smooth`** on `html` so anchor jumps animate. The
  global `prefers-reduced-motion` guard (§6.1) overrides this to `auto`
  for users who've opted out of motion.

---

## §9. Distribution architecture — GitHub → Vercel → installable PWA

This is one of the highest-leverage patterns in the project. **Zero app
stores, zero deploy infrastructure, zero install friction for users**, and
the result is something that looks and behaves like a "real" iPhone/Android
app on the home screen. Lift this entire pattern into any small project.

### §9.1. The shape

```
┌───────────────────┐    git push     ┌───────────┐    webhook    ┌─────────┐
│  Code + content   │ ──────────────→ │  GitHub   │ ─────────────→│ Vercel  │
│  on your laptop   │                 │  (main)   │               │ rebuild │
└───────────────────┘                 └───────────┘               └────┬────┘
                                                                       │
                                                                       │ static
                                                                       ▼ output
                                                                  ┌─────────┐
                                                                  │ Vercel  │
                                                                  │ edge    │
                                                                  │ CDN     │
                                                                  └────┬────┘
                                                                       │
                                                                       │ HTTPS URL
                                                                       ▼
                                       ┌──────────────────────────────────────┐
                                       │ Anyone with the URL opens it on:     │
                                       │  • iPhone Safari → Share → Add to    │
                                       │    Home Screen → installs full-screen│
                                       │  • Android Chrome → menu → Install   │
                                       │    app → installs full-screen        │
                                       │  • Desktop browser → use it as a tab │
                                       │    or "Install" via Chrome's URL bar │
                                       └──────────────────────────────────────┘
```

Three layers, each free or near-free:

| Layer | Service | What you pay |
|---|---|---|
| Source of truth | GitHub | Free for public repos. Private under most paid tiers anyway. |
| Build + host + CDN | Vercel (or Netlify, Cloudflare Pages) | Free tier is generous — 100GB bandwidth/month, unlimited deploys. |
| Install UX | The user's browser | Free. PWA features are platform-built-in. |

You ship one thing: a static-site web app at a URL. The URL is the
distribution mechanism. Texting it to someone *is* "downloading the app."

### §9.2. Why this beats native app stores for small projects

| Native app store | This pattern |
|---|---|
| $99/yr Apple Developer fee | $0 |
| Store review (days, can be rejected) | Push → live in 60 seconds |
| Separate iOS + Android builds | One codebase, both platforms |
| Update requires user to update | Updates push automatically |
| Deeplinks need configuration | Just URLs |
| Sharing requires App Store search | Text the URL, done |
| Crash reports / analytics overhead | Just `console.log` |

The tradeoff: you give up a few platform APIs (push notifications without
a server, deep biometric integration, ARKit, etc). For a dashboard /
tracker / utility app — the kind of "personal project that 4 friends use"
— you give up nothing that matters.

### §9.3. The deploy pipeline (concrete)

1. **GitHub repo** holds the code. `main` branch is the deploy trigger.
2. **Vercel project** is connected to the repo via a one-time browser
   permission grant (Vercel's GitHub App). After that, every push to
   `main` triggers an automatic rebuild and deploy.
3. **No CI/CD configuration required.** Vercel auto-detects the framework
   (Next.js, Vite, plain static, etc.) and runs the right build command.
4. **One-click deploy URL.** Vercel gives you a `*.vercel.app` URL after
   the first deploy. Stable forever; doesn't change with rebuilds. You can
   add a custom domain if you want (`yourapp.com`) — just point a CNAME.

For Vercel specifically, two ways to wire up:
- **Web UI:** vercel.com/new → Import GitHub repo → Deploy. Three clicks.
- **CLI:** `npm install -g vercel; vercel login; vercel link; vercel deploy --prod`.

The web UI path is fine for first setup; the CLI is useful as a fallback
if the GitHub webhook ever breaks.

### §9.4. The PWA install surface

A web app becomes "installable" when it has these three things:

1. **A web app manifest** (`/manifest.webmanifest`) declaring the app name,
   icons, theme color, and `display: standalone`.
2. **Icon files** at the right sizes (`icon-192.png`, `icon-512.png`,
   `apple-touch-icon.png` at 180×180).
3. **`<link rel="manifest" ...>` and Apple-specific meta tags** in the
   page `<head>`.

That's it. You don't need a service worker for the app to be installable
(though one helps with offline). With just these three pieces:

- **iOS Safari:** the user can tap Share → Add to Home Screen and your app
  appears on their home screen with the icon, launches full-screen (no
  browser chrome), and shows your `theme_color` in the status bar.
- **Android Chrome:** Chrome detects the PWA and shows an "Install app"
  prompt or option in the menu. Once installed, same full-screen native
  feel.
- **Desktop Chrome / Edge:** address bar shows an "Install" icon; clicking
  it puts the app in its own dock/taskbar window.

### §9.5. Manifest template

```json
{
  "name": "Your App Name",
  "short_name": "Your App",
  "description": "One-line tagline",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

Plus in your HTML `<head>`:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Your App" />
<meta name="theme-color" content="#000000" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
```

In Next.js, all of that lives in `metadata` and `viewport` exports from
`app/layout.tsx`. Other frameworks have similar conventions.

### §9.6. iOS install discoverability

iOS Safari (unlike Android Chrome) **doesn't proactively prompt** users to
install your PWA. They have to know to do it themselves. Two patterns:

1. **An install hint banner** that appears only when:
   - User-agent matches iPad/iPhone/iPod
   - `display-mode: standalone` media query is *false* (i.e., not already
     installed)
   - User hasn't dismissed the banner before (localStorage flag)

   The banner reads something like:
   ```
   Add to Home Screen for full-screen mode. Tap ⤴ then Add to Home Screen.
   ```
   The `⤴` is an inline SVG of the iOS share icon so the user knows what
   to look for. Dismissible via an X button.

2. **OG card** (1200×630 PNG) so when the URL is shared in iMessage, Slack,
   Twitter, etc., the link preview shows the app branding instead of a
   bare URL. This is what makes "just text it to friends" actually work as
   a distribution channel — the preview card tells them "this is a real
   thing."

### §9.7. Cache strategy for "always fresh on open"

The classic PWA caching gotcha: iOS aggressively caches whatever was at
the URL when the user "Added to Home Screen," and the cached version can
persist for days unless you tell it not to. The fix:

```js
// next.config.ts (Next.js example) or equivalent header config
async headers() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "Cache-Control", value: "public, max-age=0, must-revalidate" }
      ]
    }
  ];
}
```

This makes every page load issue a conditional request to the server — the
client checks "has anything changed?" before reusing its cache. If nothing
changed, the response is a fast 304 Not Modified. If something changed,
the new content arrives. Net effect: the app is always fresh on open
**without sacrificing edge caching speed**.

Static JS/CSS chunks (Next.js auto-hashes their filenames) get the default
long-cache treatment because their content is content-addressed — they
literally can't go stale.

### §9.8. Cache-busting at the user level

Even with the cache headers above, sometimes you need to force a refresh:

- **Pull-to-refresh gesture** at the top of the page → `location.reload()`
- **Visibility-change handler** → if the app was hidden > 60s and becomes
  visible again, reload automatically. Guarantees fresh data on every "I
  just opened the app" session.

These two together make the app feel "always live" without any user effort.

### §9.9. The shareability flywheel

Because the app is just a URL:

- **Sharing = installing.** Send the URL → recipient opens in Safari/Chrome
  → Add to Home Screen. No App Store search. No "is this safe?" friction
  unless you've made it look sketchy (you haven't, the OG card is nice).
- **Updates are global.** When you push a feature, *every installed copy*
  picks it up the next time it's opened. There's no "30% of users haven't
  updated yet" cohort. Bug fixes propagate in seconds.
- **One URL = one app.** `myapp.vercel.app` is the install link, the
  share link, the "open this in your browser" link, the "scan this QR
  code" link. Single-name marketing.

### §9.10. When this pattern is wrong

This pattern doesn't fit:

- **Apps that need iOS-only platform APIs.** ARKit, HealthKit deep
  integration, native push notifications without a server.
- **Apps that need persistent local data when fully offline.** PWAs can
  do offline via service workers but it adds complexity; if your whole
  app is offline-first, native is cleaner.
- **Apps that need to be in the App Store for credibility.** Some users
  trust App Store apps more than "go to a URL." For consumer-facing
  products this matters; for personal projects, friends-and-family
  utilities, internal tools, it doesn't.
- **Apps with revenue requiring app-store IAP.** Apple takes 30% of
  in-app purchases through the App Store; bypassing it gets you banned.
  PWAs sidestep this because Apple doesn't (yet) charge fees on web
  apps — but if you need IAP, you're back to native.

For everything else — dashboards, trackers, productivity tools, internal
admin UIs, "10 friends use it" projects — this is the right answer.

---

## §10. Time-series chart conventions (when data over time is the point)

### §9.1. Always use a baseline reference line

Faint dashed horizontal line at the "starting" or "previous" value. Three
flavors depending on the view:

- Single-entity: starting value of the active range. "Above the line =
  you're up since the start of this view."
- Multi-entity comparison: 0% (after normalizing each line to start at 0).
- Live / today: previous trading day's close. "Above the line = today's
  in the green."

Without it, the user can't immediately tell whether the line is up or down
overall. Two extra DOM nodes for an enormous gain in legibility.

### §9.2. Curve type: `monotoneX`

Visx's `curveMonotoneX` interpolation gives smooth, non-overshooting curves
on time-series data. Don't use `linear` (looks jagged), don't use
`cardinal` or `basis` (overshoots minima/maxima — looks like the data is
doing something it isn't). Monotone is the right default for finance, IoT,
fitness, anything where the y-value at each x has meaning.

### §9.3. Area gradient under the line

Behind the line, a soft gradient fading from the line color (top) to
transparent (bottom) gives the chart visual weight without distracting
gridlines or axis labels. Tune the opacity:

- Single-line chart: top opacity ~0.32 looks rich
- Multi-line chart: top opacity ~0.18 so they don't muddy together
- 4+ line chart: consider dropping the gradient entirely; lines alone
  are clearer

### §9.4. No axis labels (usually)

The hero number above the chart and the scrub crosshair below provide all
the y-axis information the user needs. The x-axis labels become clutter
on a small screen. Robinhood ships zero axis labels and the charts are
totally readable.

If you genuinely need axis labels (e.g., a "share with screenshot" mode),
make them tiny (10px) and dim (zinc-600), and put them at the chart's
bottom edge only.

---

## §11. What NOT to do

- **Don't add a loading spinner for static-rendered data.** Pages are
  pre-rendered; data is always there. Skeletons are cargo-culted from
  apps that have a real network round-trip.
- **Don't add toasts for confirmations.** "Saved!" / "Done!" dialogs add
  visual chrome without value. If the action succeeded, the UI already
  reflects it.
- **Don't gate access to information behind expand/collapse.** If it's
  worth showing, show it. Mobile users are happy to scroll.
- **Don't use modal sheets for navigation.** Drilling into a detail page
  is still a real route change with a back button — now animated as an
  iOS push/pop (§6.1), but a genuine navigation, not a sheet. Sheets and
  modals are for forms, filters, info, and destructive actions — never for
  getting from one screen to another.
- **Don't add settings cogs for theme switching unless the user asked.**
  Dark mode is the design; light mode would be a different app.
- **Don't render numbers with `Intl.NumberFormat` and call it done.**
  Build small `fmt*` helpers (`fmtUSD`, `fmtSignedUSD`, `fmtPct`,
  `fmtDateLong`, `fmtTimeOfDay`, etc.) and use them everywhere. Number
  formatting is consistency-critical.

---

## §12. Reusable component contracts

If you're porting this design language to another project, these are the
component contracts that travel cleanly:

| Component | Props | Notes |
|---|---|---|
| `<PriceHeader>` | `{ ticker?, label?, title, value, baseline, scrubDate?, accent?, fractionDigits? }` | Hero number with delta. Drop-in for any "current value" header. |
| `<ScrubChart>` | `{ series[], baseline?, height?, onScrub?, xDomain?, liveEndpoint? }` | The whole chart. Series can be 1+ lines. |
| `<RangeTabs>` | `{ value, onChange, accent? }` | Range selector. Controlled. |
| `<MarketStateBadge>` | `{ live: boolean }` | Live / closed pill with optional pulse. |
| `<TabBar>` | array of `{ href, label, icon, match }` | Bottom nav. Two-to-four tabs. |
| `<HeaderBack>` | `{ title? }` | Sticky back button. |
| `<InstallHint>` | none — self-contained | iOS-only top banner, dismissible. |
| `<PullToRefresh>` | none — self-contained | Mounts globally; handles both gesture and visibility-resume. |
| `<Footer>` | `{ lastDate, generatedAt }` | Freshness indicator. |
| `<Sheet>` | `{ open, onClose, title?, header?, footer?, full?, children }` | iOS bottom-sheet (§6.1). Portals to `<body>`; slide-up/down; Escape + backdrop close; no drag-to-dismiss. Use for filters / forms / info / confirms. |

---

## §13. Reference: the formatter library

Steal these as-is:

```ts
fmtUSD(n, fractionDigits=2)      → "$123,456.78"
fmtSignedUSD(n, fractionDigits=2) → "+$123.45" or "−$123.45"
fmtPct(n, fractionDigits=2)       → "+12.34%" or "−12.34%"
fmtDateLong(iso)                  → "May 5, 2026"
fmtDateShort(iso)                 → "May 5"
fmtTimeOfDay(iso)                 → "1:45 PM"
```

Notes:
- Use the proper minus glyph (U+2212, `−`) for losses, not a hyphen-minus.
  Looks better in the typography and aligns nicely with `+` width.
- All formatters take ISO strings (or numbers for currency/pct), never
  Date objects. Strings stringify-and-parse identically; Date objects
  introduce timezone subtleties.

---

## §14. Mental rules I find myself repeating

- **The chart is the app.** Make it beautiful and fast; everything else
  is supporting cast.
- **Numbers are the second-most important thing.** Get them tabular,
  signed, color-coded, formatted consistently.
- **Color is identity, not decoration.** Use accents to encode "who" or
  "what" — never as eye candy.
- **Animation is for liveness, feedback, and purposeful iOS-style
  transitions** — all done in CSS within the perf budget. Not for
  gratuitous polish or content razzle-dazzle. Navigation cross-fades,
  drill-in push/pop, and slide-up sheets earn their place; a card flying
  in for no reason does not. See §6.
- **One screen = one job.** Compare answers "who's winning?" Detail
  answers "why?" Don't try to answer both on one screen.
- **Mobile is the canonical width.** Test at 375px first; widen later if
  ever.
- **Latency budget for mobile gestures: 16ms.** Everything in the chart
  must respond to touch before the next frame. Prefer math in `useMemo`,
  refs over state for high-frequency updates, and skip Framer Motion for
  per-frame work — pure CSS transforms are faster. The whole motion layer
  (§6.1) follows this rule too: route transitions and sheets are CSS
  keyframes on transform/opacity, no JS animation library in the navigation
  or scrub path.

---

## §15. End

If you're starting a new project and want this same feel: pull
`<ScrubChart>`, `<PriceHeader>`, `<RangeTabs>`, `<MarketStateBadge>`,
`<HeaderBack>`, `<TabBar>`, `<PullToRefresh>`, `<InstallHint>`, the
formatter library, and the CSS keyframes. Then add the **motion layer**
(§6.1) so navigation and overlays feel native:

- **`app/template.tsx`** — the route-transition driver (tab cross-fade,
  drill-in push/pop). Adjust the detail-route regex to your own URL shape.
- **`components/Sheet.tsx`** — the portal-based iOS bottom-sheet primitive;
  route every filter / form / info / confirm overlay through it.
- **The `app/globals.css` motion block** — the motion tokens
  (`--ease-ios`, `--ease-out-ios`, `--dur-press/fade/slide`), the
  `.press` tap-shrink utility, the route + sheet keyframes
  (`.pt-fade` / `.pt-push` / `.pt-pop`, `sheetIn` / `sheetOut`), and the
  global `prefers-reduced-motion` guard. Don't ship one without the others —
  the keyframes need the tokens, and the reduced-motion guard is what keeps
  the whole layer accessible.

That's about 1,300 lines of code total and it gives you the entire design
language. Customize the accent colors and the data shapes; the chrome —
including the motion layer — is invariant.
