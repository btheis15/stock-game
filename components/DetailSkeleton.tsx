// Route-level loading fallback for the three drill-down pages
// (/portfolio/[user], /stock/[ticker], /fund/[id]). All three are
// force-dynamic (see CLAUDE.md §8.7) with no cached static shell, so without
// a loading.tsx Next.js shows nothing at all until the full server round
// trip resolves — on a cache miss or slow connection that's enough dead air
// that a tap reads as "did nothing," and the natural reaction is to tap
// again. This paints instantly (it's the Suspense fallback, no data
// dependency) so every navigation gets an immediate visual response.
// Shapes mirror PriceHeader / ScrubChart / RangeTabs / holdings-row so the
// real content doesn't pop the layout when it swaps in.
export function DetailSkeleton() {
  return (
    <div aria-hidden>
      <div
        className="sticky top-0 z-30 flex items-center gap-3 px-4 pb-2 bg-chrome-soft backdrop-blur-md"
        style={{
          marginTop: "calc(-1 * env(safe-area-inset-top))",
          paddingTop: "max(env(safe-area-inset-top), 12px)",
        }}
      >
        <div className="w-9 h-9 -ml-2 rounded-full bg-card shrink-0" />
      </div>

      <div className="px-4 pt-1 pb-3">
        <div className="skeleton bg-pressed-40 rounded h-[11px] w-20 mb-2" />
        <div className="skeleton bg-pressed-40 rounded h-[20px] w-36 mb-2" />
        <div className="skeleton bg-pressed-40 rounded h-[30px] w-44 mb-2" />
        <div className="skeleton bg-pressed-40 rounded h-[14px] w-28" />
      </div>

      <div className="px-4">
        <div className="skeleton bg-pressed-40 rounded-2xl w-full" style={{ height: 260 }} />
      </div>

      <div className="flex items-center justify-around w-full px-2 py-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton bg-pressed-40 rounded-full h-[26px] w-9" />
        ))}
      </div>

      <div className="px-4">
        <div className="rounded-2xl bg-card border border-hairline divide-y divide-hairline overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-3 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-pressed-40 skeleton shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="skeleton bg-pressed-40 rounded h-[13px] w-16 mb-1.5" />
                <div className="skeleton bg-pressed-40 rounded h-[11px] w-24" />
              </div>
              <div className="skeleton bg-pressed-40 rounded h-[13px] w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
