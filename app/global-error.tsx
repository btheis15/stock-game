"use client";

// Last-resort boundary: catches errors thrown by the root layout itself.
// It replaces <html>/<body>, so globals.css (and every Tailwind utility /
// theme override) is unavailable — inline styles only, pure black + white
// to match the app's dark default.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A root-layout crash usually means bad module state; a hard reload is the
  // reliable recovery, so `reset` (soft re-render) is deliberately unused.
  void error;
  void reset;
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          WebkitFontSmoothing: "antialiased",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#71717a",
            }}
          >
            Stock Game
          </div>
          <h1 style={{ margin: "8px 0 0", fontSize: "22px", fontWeight: 700 }}>
            Something went wrong
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#71717a" }}>
            The app hit an error it couldn&apos;t recover from.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: "24px",
              padding: "10px 20px",
              borderRadius: "9999px",
              border: "none",
              background: "#fff",
              color: "#000",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
