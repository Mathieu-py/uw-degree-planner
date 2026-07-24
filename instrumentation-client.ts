import * as Sentry from "@sentry/nextjs";

// Errors only — no tracing/replay (free-tier minimal). DSN unset → no-op.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
});

// Required export; inert while tracing is off.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
