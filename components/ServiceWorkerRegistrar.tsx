"use client";

import { useEffect } from "react";

// Registers the offline-fallback-only worker (public/sw.js). The worker
// never caches documents or data — it only serves /offline.html when a
// navigation fails with no connectivity. See the comment block in sw.js
// before changing anything about this.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failing is harmless — the app just loses the branded
      // offline page.
    });
  }, []);

  return null;
}
