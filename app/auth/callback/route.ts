import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * OAuth code-exchange handler. Supabase redirects the user back here after a
 * successful Google sign-in with `?code=…`; we trade it for a session
 * (which writes the auth cookies via our setAll callback) and redirect to
 * the destination from `?next=…`, defaulting to `/plan`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = sanitizeNextPath(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${url.origin}/?auth_error=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${url.origin}/?auth_error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${url.origin}${next}`);
}

/**
 * Constrain the `?next=` redirect target to a same-origin path. Without this,
 * `?next=//evil.com` would produce `https://app.com//evil.com` which browsers
 * treat as protocol-relative — i.e. an open redirect to a different origin.
 *
 * Accepts only values that start with a single `/` (not `//` or `/\`); anything
 * else falls back to `/plan`.
 */
function sanitizeNextPath(raw: string | null): string {
  if (!raw) return "/plan";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return "/plan";
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return "/plan";
  return trimmed;
}
