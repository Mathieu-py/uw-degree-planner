import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export type RequireUserResult =
  | { ok: true; userId: string; client: SupabaseServerClient }
  | { ok: false; error: "not_authenticated" };

/**
 * Resolve the current user, returning `not_authenticated` for unauthenticated
 * callers rather than throwing. Centralizing the auth check keeps the server
 * actions uniform: every action returns `not_authenticated` when the session is
 * gone (which happens routinely as refresh tokens expire mid-session). The
 * resolved `client` is handed back so callers reuse the same request-scoped
 * Supabase client they authenticated with.
 */
export async function requireUser(): Promise<RequireUserResult> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { ok: false, error: "not_authenticated" };
  return { ok: true, userId: data.user.id, client };
}
