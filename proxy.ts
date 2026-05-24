import { type NextRequest, NextResponse } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/session";

/**
 * Next.js 16 root `proxy.ts` (formerly `middleware.ts`). Runs on every
 * navigation matched by `config.matcher` and keeps the Supabase auth session
 * alive so Server Components see fresh user state.
 *
 * Wrapped in try/catch as a backstop: a failed session refresh (network
 * blip, misconfigured env, transient Supabase outage) should never break
 * navigation for the rest of the app. The signed-out paths work fine
 * without a session, and the next request will retry the refresh.
 */
export async function proxy(request: NextRequest) {
  try {
    return await updateSupabaseSession(request);
  } catch (err) {
    console.warn("proxy: session refresh failed; continuing without it", err);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    // Run on every path except static assets and the Next.js image optimizer.
    // We intentionally let /auth/callback through (no extension, doesn't match
    // the file-extension negation) so the code-exchange handler sees a hydrated
    // cookie context. The extension list covers things served from /public and
    // common asset types; Next.js still runs the proxy for /_next/data routes
    // regardless of this matcher (documented behavior).
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:css|js|map|jpg|jpeg|gif|webp|avif|svg|png|ico|txt|xml|json|wasm|eot|ttf|woff|woff2|mp4|webm|ogg|mp3|m4a|zip|gz|crt|pem)$).*)",
  ],
};
