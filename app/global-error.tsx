"use client";

import { buttonClasses } from "@/components/ui/buttonClasses";
import { THEME_INIT_SCRIPT } from "@/lib/constants";
import { hanken, jetbrainsMono } from "./fonts";
import "./globals.css";

// Catches errors thrown by the root layout itself, so it renders its own
// <html>/<body> and stays free of the layout's providers/chrome.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted static
            anti-FOUC snippet; must run before paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col items-center justify-center gap-4 px-7 py-10 text-center">
        <p className="u-eyebrow">Error · Something went wrong</p>
        <h1 className="u-display text-[clamp(30px,4vw,44px)]">
          The app failed to load.
        </h1>
        <p className="u-lede max-w-[520px]">
          Try again in a moment — if it keeps happening, let us know on GitHub.
        </p>
        {error.digest ? (
          <p className="u-mono u-small">Reference: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={() => unstable_retry()}
          className={buttonClasses({ variant: "primary", size: "lg" })}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
