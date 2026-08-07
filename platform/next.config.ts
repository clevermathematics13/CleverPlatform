import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

// Build: 2026-08-05
const nextConfig: NextConfig = {
  devIndicators: false,
  // Prevent webpack from bundling native/binary/WASM packages used in API routes
  serverExternalPackages: [
    "puppeteer-core",
    "@sparticuz/chromium-min",
    "@myriaddreamin/typst-ts-node-compiler",
    "heic-convert",
    "libheif-js",
  ],
  experimental: {
    serverActions: {
      // SECURITY: never use a bare "*.vercel.app" wildcard here. It trusts
      // every deployment on Vercel — anyone's — as a Server Action origin,
      // which exposes teacher-gated actions (e.g. startStudentImpersonation)
      // to cross-site request forgery. List exact hosts only.
      allowedOrigins: [
        "localhost:3000",
        "www.clevermathematics.com",
        "clevermathematics.com",
        "clever-platform.vercel.app",
      ],
      bodySizeLimit: "20mb",
    },
  },

  // Baseline security headers. There is no middleware.ts in this app, so
  // without these the dashboard can be framed by a third-party site
  // (clickjacking against teacher-only controls).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

// withWorkflow enables the "use workflow" and "use step" directives used by
// platform/workflows/nuanced-analysis-generation.ts — required for the AI
// Activity Generator's multi-pass generation to work.
export default withWorkflow(nextConfig);
