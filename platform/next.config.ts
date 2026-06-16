import type { NextConfig } from "next";

// Build: 2026-06-16
const nextConfig: NextConfig = {
  devIndicators: false,
  // Prevent webpack from bundling native/binary packages used in API routes
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium-min"],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "*.app.github.dev",
        "*.vercel.app",
      ],
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
