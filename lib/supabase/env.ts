/**
 * Read the public Supabase URL + anon key from the environment, failing
 * loudly when either is missing. The keys are `NEXT_PUBLIC_*` so Next.js
 * inlines them at build time for both client and server bundles.
 */
export function supabasePublicEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (run `pnpm exec supabase status` for local-dev values).",
    );
  }
  // Inlined verbatim into next.config's connect-src, so it must be a bare
  // http(s) origin — a path, query, fragment, credentials, or non-http scheme
  // would silently corrupt the CSP. Never echo the raw value on failure (it
  // lands in build logs and error screens).
  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (
    !parsed ||
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    `${parsed.origin}/` !== parsed.href
  ) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be a bare http(s) origin (no path, query, credentials, or fragment).",
    );
  }
  return { url, anonKey };
}
