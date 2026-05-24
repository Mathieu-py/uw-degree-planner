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
  return { url, anonKey };
}
