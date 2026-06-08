import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export type RequireUserResult =
  | { ok: true; userId: string; client: SupabaseServerClient }
  | { ok: false; error: "not_authenticated" };

/**
 * Resolve the current user, returning `not_authenticated` rather than throwing.
 * Keeps server actions uniform when a session expires mid-flight. Hands back the
 * resolved request-scoped `client` so callers reuse the one they authenticated
 * with.
 */
export async function requireUser(): Promise<RequireUserResult> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { ok: false, error: "not_authenticated" };
  return { ok: true, userId: data.user.id, client };
}
