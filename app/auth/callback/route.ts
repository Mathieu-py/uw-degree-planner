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
  const next = url.searchParams.get("next") ?? "/plan";

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
