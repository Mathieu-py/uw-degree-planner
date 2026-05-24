import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/session";

/**
 * Next.js 16 root `proxy.ts` (formerly `middleware.ts`). Runs on every
 * navigation matched by `config.matcher` and keeps the Supabase auth session
 * alive so Server Components see fresh user state.
 */
export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    // Run on every path except static assets and the Next.js image optimizer.
    // We intentionally include /auth/callback so the code-exchange handler
    // sees a hydrated cookie context.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.ico$).*)",
  ],
};
