"use server";

import { type ActionResult, mapDbError, withUser } from "@/lib/server/actions";

/**
 * Permanently delete the signed-in user's account and data. The
 * `delete_own_account` RPC (migration 0005) removes the auth.users row scoped to
 * auth.uid(); the cascade clears plans. Caller signs out afterward.
 */
export async function deleteAccount(): Promise<ActionResult<void>> {
  return withUser(async ({ client }) => {
    const { error } = await client.rpc("delete_own_account");
    if (error) return { ok: false, error: mapDbError(error, "deleteAccount") };
    return { ok: true, data: undefined };
  });
}
