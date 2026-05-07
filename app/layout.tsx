import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { Footer } from "@/components/Footer";
import { InstallHint } from "@/components/InstallHint";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ThemeController } from "@/components/ThemeController";
import { loadPriceData } from "@/lib/data";

function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

const SITE_URL = siteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Stock Game — 5-Year Portfolio Showdown",
  description: "Loser pays for golf — tracked since Feb 5, 2026.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Stock Game",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: "Stock Game",
    title: "Stock Game — 5-Year Portfolio Showdown",
    description: "Loser pays for golf — tracked since Feb 5, 2026.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Stock Game — 5-Year Portfolio Showdown",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Game — 5-Year Portfolio Showdown",
    description: "Loser pays for golf — tracked since Feb 5, 2026.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const data = await loadPriceData();
  const lastDate = data.tradingDates[data.tradingDates.length - 1];
  // Pass the most-recent intraday bar timestamp from any single ticker so the
  // ThemeController can evaluate isMarketLive client-side (NOT at build time —
  // the snapshot may be minutes old by the time the user views).
  const sampleTicker = Object.values(data.tickers)[0];
  const latestIntradayTs =
    sampleTicker?.intraday?.[sampleTicker.intraday.length - 1]?.t;
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-black text-white antialiased">
        <ThemeController latestIntradayTs={latestIntradayTs} />
        <InstallHint />
        <PullToRefresh />
        <main
          className="max-w-md mx-auto pb-20"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {children}
          <Footer lastDate={lastDate} generatedAt={data.generatedAt} />
        </main>
        <TabBar />
      </body>
    </html>
  );
}
