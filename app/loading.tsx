// Root loading fallback for the tab routes (Compare / Stocks / Tee Times).
// Every page is force-dynamic, so without this boundary the server held the
// whole response until the page's data resolved — on a cold open that was
// dead air before the launch splash (components/Splash.tsx) could even
// paint. With it, the shell + splash stream immediately and this skeleton
// sits behind the splash; on an un-prefetched tab switch it's the instant
// visual response. Detail routes keep their own DetailSkeleton.
export default function Loading() {
  return (
    <div aria-hidden className="pt-4">
      <div className="px-4 pb-3">
        <div className="skeleton bg-pressed-40 rounded h-[11px] w-20 mb-2" />
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
              <div className="w-3 h-3 rounded-full bg-pressed-40 skeleton shrink-0" />
              <div className="skeleton bg-pressed-40 rounded h-[13px] w-20 flex-1 max-w-[96px]" />
              <div className="ml-auto skeleton bg-pressed-40 rounded h-[13px] w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
