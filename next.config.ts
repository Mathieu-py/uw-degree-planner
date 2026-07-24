import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
// Build-time env: NEXT_PUBLIC_* is always set at build (inlined into the
// client bundle), so the CSP can bake in the Supabase origin.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Sentry's browser SDK POSTs events to the DSN's ingest origin; without it in
// connect-src the CSP blocks all client-side error reporting. Empty when unset.
const sentryOrigin = (() => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return "";
  try {
    return new URL(dsn).origin;
  } catch {
    return "";
  }
})();

// Static CSP per the Next CSP guide's no-nonce variant — a nonce would force
// every route dynamic. 'unsafe-inline' covers the pre-paint theme script and
// Next's own inline RSC-payload scripts; dev needs eval for React stacks.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'", // next/font self-hosts
  // Browser Supabase client talks to auth + PostgREST directly; Sentry POSTs to
  // its ingest origin; HMR needs ws. Absent origins collapse to a single space.
  `connect-src 'self' ${supabaseOrigin} ${sentryOrigin}${isDev ? " ws: wss:" : ""}`
    .replace(/ +/g, " ")
    .trim(),
  "worker-src 'self' blob:", // pdf.js transcript worker
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  // SVGR: import .svg files as React components so we can recolor via
  // `currentColor` (text-* classes) and size via `w-* h-*` like any inline
  // SVG. The `icon: true` SVGR option drops the SVG's intrinsic width/height
  // so size is fully controlled by Tailwind classes on the wrapper.
  turbopack: {
    rules: {
      "*.svg": {
        loaders: [
          {
            loader: "@svgr/webpack",
            options: { icon: true },
          },
        ],
        as: "*.js",
      },
    },
  },
};

// Without SENTRY_AUTH_TOKEN the wrapper skips source-map upload, so local/CI
// builds are unaffected.
export default withSentryConfig(nextConfig, { silent: true });
