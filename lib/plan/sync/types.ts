/**
 * In-flight save state for the loaded server plan, shown via `SaveStatusBadge`.
 * Synchronous local-storage saves don't use this (they use `SaveFailedBanner`).
 */
export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

/**
 * Where the active plan lives. `null` while loading; `"local"` when signed-out
 * (or signed-in with no `?planId` yet); `{server, planId}` once fetched.
 */
export type PlanSource = "local" | { kind: "server"; planId: string };
