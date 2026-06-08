"use server";

import type { ActionResult } from "@/lib/plan/server/types";
import { mapDbError } from "@/lib/server/dbError";
import { requireUser } from "@/lib/supabase/requireUser";

// Same rules as the sign-up form (LoginForm's usernameSchema): 3–20 chars,
// letters/numbers/underscores. Re-validated here — the server action is the
// trust boundary.
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Rename the signed-in user. Writes both `profiles.username` (unique-index
 * guarded) and `user_metadata.username` (which the auth store seeds), so the
 * header reflects the new name on the next refresh without a profiles fetch.
 */
export async function updateProfile(input: {
  username: string;
}): Promise<ActionResult<{ username: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const username = input.username.trim();
  if (!username) return { ok: false, error: "username_required" };
  if (username.length < 3 || username.length > 20) {
    return { ok: false, error: "username_invalid" };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: "username_invalid" };
  }

  // Profiles row first — its unique constraint is the source of truth for
  // collisions. `.select()` tells "updated" from "RLS hid the row".
  const { data, error } = await auth.client
    .from("profiles")
    .update({ username })
    .eq("id", auth.userId)
    .select("username");

  if (error) {
    // 23505 = unique_violation; the message also carries the constraint name.
    if (
      error.code === "23505" ||
      /duplicate key|unique constraint|profiles_username/i.test(error.message)
    ) {
      return { ok: false, error: "username_taken" };
    }
    return { ok: false, error: mapDbError(error, "updateProfile") };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "not_found" };
  }

  // Best-effort metadata sync; a failure doesn't undo the profiles write (the
  // auth store upgrades from profiles on its next fetch anyway).
  await auth.client.auth.updateUser({ data: { username } });

  return { ok: true, data: { username } };
}

/**
 * Permanently delete the signed-in user's account and data. The
 * `delete_own_account` RPC (migration 0005) removes the auth.users row scoped to
 * auth.uid(); the cascade clears profiles + plans. Caller signs out afterward.
 */
export async function deleteAccount(): Promise<ActionResult<void>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { error } = await auth.client.rpc("delete_own_account");
  if (error) return { ok: false, error: mapDbError(error, "deleteAccount") };
  return { ok: true, data: undefined };
}
