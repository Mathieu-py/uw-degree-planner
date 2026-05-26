/**
 * State of the in-flight save for the currently-loaded server plan. The
 * planner header surfaces this via `SaveStatusBadge`. Local-storage saves are
 * synchronous and don't use this — they keep using the existing
 * `SaveFailedBanner`.
 */
export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

/**
 * Where the active plan body lives. `null` while loading; `"local"` when the
 * user is signed-out (or signed-in with no `?planId` yet); `{server, planId}`
 * once a server-backed plan has been fetched.
 */
export type PlanSource = "local" | { kind: "server"; planId: string };
