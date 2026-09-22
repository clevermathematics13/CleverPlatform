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
    // Read by lib/paper-layout-derive.ts to find the answer-box marks in a
    // generated paper. Kept out of the bundle: it ships its own worker and
    // canvas shims that only make sense on the server.
    "pdfjs-dist",
    "libheif-js",
  ],
  // public/ is served statically, which does not put it on the lambda's
  // filesystem. lib/katex-inline-css.ts reads public/katex/ at runtime to
  // embed KaTeX's fonts in every printed page, so the API routes that render
  // PDFs need those files traced in. Without this the module falls back to a
  // CDN @import -- still correct, but back to fetching fonts mid-render.
  outputFileTracingIncludes: {
    "/api/**": ["./public/katex/**"],
  },

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
      // components/reflection/DocPanel.tsx shows the exam paper/mark scheme
      // in a same-origin iframe. The blanket X-Frame-Options: DENY above
      // (last header key wins on a duplicate match, per Next's header
      // ordering) blocks that too, since DENY refuses framing even from the
      // same origin -- the browser's "refused to connect" on the embedded
      // panel is this, not a network error. Narrowed to SAMEORIGIN, and only
      // for this one route, rather than loosened dashboard-wide.
      {
        source: "/api/tests/:id/mark-scheme",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

// withWorkflow enables the "use workflow" and "use step" directives used by
// platform/workflows/nuanced-analysis-generation.ts — required for the AI
// Activity Generator's multi-pass generation to work.
export default withWorkflow(nextConfig);
