// Source repository for the project, linked from the footer and error screens.
export const REPO_URL = "https://github.com/Mathieu-py/uw-degree-planner";

// Canonical origin for metadata/robots/sitemap; set NEXT_PUBLIC_SITE_URL in prod.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Display form (no scheme) for places that show the repo as text, not a link.
export const REPO_DISPLAY = REPO_URL.replace(/^https?:\/\//, "");

// Default name for a freshly created plan.
export const NEW_PLAN_NAME = "Untitled plan";

// Runs synchronously during HTML parsing, before paint, so the saved theme
// applies with no flash (defaults to dark). Inline, not next/script, since
// framework scripts aren't guaranteed pre-paint. Mirrors applyTheme(). Shared
// by the root layout and global-error (which renders its own <html>).
export const THEME_INIT_SCRIPT = `(function(){try{var v=localStorage.getItem("udp-theme");document.documentElement.setAttribute("data-mode",v==="light"?"light":"dark");}catch(e){document.documentElement.setAttribute("data-mode","dark");}})();`;
