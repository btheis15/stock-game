import type { NextConfig } from "next";

const noStoreHtml = {
  key: "Cache-Control",
  value: "public, max-age=0, must-revalidate",
};

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/",
        headers: [noStoreHtml],
      },
      {
        source: "/portfolio/:path*",
        headers: [noStoreHtml],
      },
      {
        source: "/stock/:path*",
        headers: [noStoreHtml],
      },
      {
        source: "/stocks",
        headers: [noStoreHtml],
      },
      {
        source: "/data/prices.json",
        headers: [noStoreHtml],
      },
      {
        source: "/digests.json",
        headers: [noStoreHtml],
      },
      {
        source: "/manifest.webmanifest",
        headers: [noStoreHtml],
      },
    ];
  },
};

export default nextConfig;
