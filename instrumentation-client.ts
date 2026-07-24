import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "@/lib/log";

// Errors only — no tracing/replay (free-tier minimal). DSN unset → no-op.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  // Pin the SDK default: no IP/cookies/user attached — backs the legal page's
  // "reported ... without personal data" claim.
  sendDefaultPii: false,
  // Second layer: scrub any request data/PII before the event leaves the browser.
  beforeSend: sanitizeSentryEvent,
});

// Required export; inert while tracing is off.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
