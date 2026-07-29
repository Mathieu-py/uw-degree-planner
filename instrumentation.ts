import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "@/lib/log";

export function register() {
  // DSN unset (local/CI) → the SDK stays uninitialized and captures no-op.
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0,
    // Pin the SDK default: no IP/cookies/user attached — backs the legal page's
    // "reported ... without personal data" claim.
    sendDefaultPii: false,
    // Second layer: scrub request data/PII that captureRequestError attaches.
    beforeSend: sanitizeSentryEvent,
  });
}

// Server render/action/route errors, correlated to error.tsx digests.
export const onRequestError = Sentry.captureRequestError;
