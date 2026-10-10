// Tracks whether this tab has made at least one in-app navigation, so
// HeaderBack knows whether router.back() has somewhere to go. Opening a
// deep link cold (a shared /portfolio/kevin#MRVL, a PWA relaunch onto a
// detail page) leaves no in-app history entry — router.back() would then
// silently do nothing, or leave the app entirely in a browser tab.
// Module state persists across App Router navigations; app/template.tsx
// marks it on every route change.
let navigated = false;

export function markInAppNavigation() {
  navigated = true;
}

export function hasInAppHistory() {
  return navigated;
}
