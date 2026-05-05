import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";

export const metadata: Metadata = {
  title: "Stock Game",
  description: "Brian vs Kevin — portfolio showdown since Feb 5, 2026",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Stock Game",
  },
  formatDetection: {
    telephone: false,
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-black text-white antialiased">
        <main
          className="max-w-md mx-auto pb-20"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {children}
        </main>
        <TabBar />
      </body>
    </html>
  );
}
