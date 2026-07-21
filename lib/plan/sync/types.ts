/**
 * In-flight save state for the loaded server plan, shown via `SaveStatusBadge`.
 * Synchronous local-storage saves don't use this (they use `SaveFailedBanner`).
 */
export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };
