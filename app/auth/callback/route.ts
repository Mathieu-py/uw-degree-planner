import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * OAuth code-exchange handler. After Google sign-in, Supabase redirects here
 * with `?code=…`; we trade it for a session (writing auth cookies via setAll)
 * and redirect to `?next=…`, defaulting to `/plan`.
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
 * Constrain the `?next=` redirect to a same-origin path, else `?next=//evil.com`
 * becomes a protocol-relative open redirect. Accepts only a single leading `/`
 * (not `//` or `/\`); anything else falls back to `/plan`.
 */
function sanitizeNextPath(raw: string | null): string {
  if (!raw) return "/plan";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return "/plan";
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return "/plan";
  return trimmed;
}
