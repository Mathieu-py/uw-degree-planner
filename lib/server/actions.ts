/** Shared plumbing for server actions: the result shape, the auth wrapper,
 *  and DB-outcome → client-code mappers. */

import { logError } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Uniform server-action result: UI branches on `ok` instead of try/catch.
 *  Programmer errors (missing env, bad argument types) still throw. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

type RequireUserResult =
  | { ok: true; userId: string; client: SupabaseServerClient }
  | { ok: false; error: "not_authenticated" };

/** Resolve the current user (`not_authenticated` instead of throwing), handing
 *  back the request-scoped client so callers reuse the one they auth'd with. */
async function requireUser(): Promise<RequireUserResult> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { ok: false, error: "not_authenticated" };
  return { ok: true, userId: data.user.id, client };
}

/** Run `fn` with a resolved user, so no action can forget the auth guard. */
export async function withUser<T>(
  fn: (auth: {
    userId: string;
    client: SupabaseServerClient;
  }) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };
  return fn(auth);
}

// supabase-js errors (PostgrestError + RPC) share these two fields.
interface DbErrorLike {
  code?: string;
  message?: string;
}

/** Map a raw DB/RPC error to a generic client code, logging detail server-side
 *  (verbatim `error.message` would leak schema internals). The fallback —
 *  action-specific codes are matched before reaching here. */
export function mapDbError(error: DbErrorLike, context: string): string {
  // Raw error (message may leak schema internals) goes to the console only;
  // Sentry gets the operation + SQLSTATE, nothing else.
  logError(`[db] ${context}`, error, {
    op: context,
    category: "db",
    code: error.code,
  });

  switch (error.code) {
    case "23505": // unique_violation
    case "23503": // foreign_key_violation
    case "23514": // check_violation
      return "conflict";
    case "22P02": // invalid_text_representation
    case "22003": // numeric_value_out_of_range
      return "invalid_input";
    default:
      return "something_went_wrong";
  }
}

/** PostgREST update/delete with `.select()`: zero rows back means the row
 *  didn't exist OR RLS hid it — indistinguishable, so one combined code. */
export function requireAffectedRow(
  data: unknown[] | null,
): { ok: false; error: "not_found_or_unauthorized" } | null {
  return !data || data.length === 0
    ? { ok: false, error: "not_found_or_unauthorized" }
    : null;
}
