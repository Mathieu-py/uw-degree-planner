// Source repository for the project, linked from the footer and error screens.
export const REPO_URL = "https://github.com/Mathieu-py/uw-degree-planner";

// Canonical origin for metadata/robots/sitemap. Required in production so a
// misconfigured deploy fails the build instead of silently emitting localhost
// URLs; dev/test fall back to localhost. Trailing slashes stripped so
// `${SITE_URL}/path` (robots.ts, sitemap.ts) never doubles up.
const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
if (!rawSiteUrl && process.env.NODE_ENV === "production")
  throw new Error("NEXT_PUBLIC_SITE_URL must be set in production.");
export const SITE_URL = (rawSiteUrl ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);

// Display form (no scheme) for places that show the repo as text, not a link.
export const REPO_DISPLAY = REPO_URL.replace(/^https?:\/\//, "");

// Default name for a freshly created plan.
export const NEW_PLAN_NAME = "Untitled plan";

// Runs synchronously during HTML parsing, before paint, so the saved theme
// applies with no flash (defaults to light). Inline, not next/script, since
// framework scripts aren't guaranteed pre-paint. Mirrors applyTheme(). Shared
// by the root layout and global-error (which renders its own <html>).
export const THEME_INIT_SCRIPT = `(function(){try{var v=localStorage.getItem("udp-theme");document.documentElement.setAttribute("data-mode",v==="dark"?"dark":"light");}catch(e){document.documentElement.setAttribute("data-mode","light");}})();`;
