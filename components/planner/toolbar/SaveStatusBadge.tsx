"use client";

import { Icon } from "@/components/ui/Icon";
import type { SaveStatus } from "@/lib/plan/sync/types";

interface Props {
  status: SaveStatus;
  /** Called when the user clicks the badge in its error state. */
  onRetry: () => void;
}

/**
 * Header indicator for in-flight server-save status. Idle renders nothing
 * so the header isn't permanently noisy after a save settles.
 *
 * Visual weights are tiered: "Saved" reads as a quiet check + label (it's
 * the common steady state), "Saving…" gets an amber spinner-style dot to
 * signal in-flight work, and "Save failed" is a button-shaped chip
 * because it requires a user action. Only the error chip announces via
 * `aria-live`: rapid editing flips saving↔saved every 1.5–3s, and
 * announcing each transition would spam assistive tech.
 */
export function SaveStatusBadge({ status, onRetry }: Props) {
  if (status.kind === "idle") return null;

  if (status.kind === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
        <span
          aria-hidden="true"
          className="inline-block size-2 rounded-full bg-amber-500"
        />
        Saving…
      </span>
    );
  }

  if (status.kind === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
        <Icon name="check" size="sm" aria-hidden="true" />
        Saved
      </span>
    );
  }

  // status.kind === "error" — clickable retry, kept chip-shaped so it
  // visibly demands attention.
  return (
    <button
      type="button"
      onClick={onRetry}
      title={status.message}
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/60"
    >
      <span
        aria-hidden="true"
        className="inline-block size-2 rounded-full bg-rose-500"
      />
      Save failed — retry
    </button>
  );
}
