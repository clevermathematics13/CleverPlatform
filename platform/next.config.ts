import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

// Build: 2026-06-16
const nextConfig: NextConfig = {
  devIndicators: false,
  // Prevent webpack from bundling native/binary packages used in API routes
  serverExternalPackages: [
    "puppeteer-core",
    "@sparticuz/chromium-min",
    "@myriaddreamin/typst-ts-node-compiler",
  ],
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

// withWorkflow enables the "use workflow" and "use step" directives used by
// platform/workflows/nuanced-analysis-generation.ts — required for the AI
// Activity Generator's multi-pass generation to work.
export default withWorkflow(nextConfig);
