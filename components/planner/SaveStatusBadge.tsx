"use client";

import type { SaveStatus } from "@/lib/plan/sync/types";

interface Props {
  status: SaveStatus;
  /** Called when the user clicks the badge in its error state. */
  onRetry: () => void;
}

const BASE =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border";

/**
 * Header chip that reflects the in-flight server-save status. Idle renders
 * nothing — the chip should disappear when there's nothing to say, so the
 * header doesn't read "Idle" forever after a successful save settles.
 *
 * Only the error chip announces via `aria-live`: rapid editing flips
 * saving↔saved every 1.5–3s, and announcing each transition would spam
 * assistive tech. The error case is genuinely something the user must know
 * about (their work isn't persisting).
 */
export function SaveStatusBadge({ status, onRetry }: Props) {
  if (status.kind === "idle") return null;

  if (status.kind === "saving") {
    return (
      <span
        className={`${BASE} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200`}
      >
        <Dot className="bg-amber-500" />
        Saving…
      </span>
    );
  }

  if (status.kind === "saved") {
    return (
      <span
        className={`${BASE} border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200`}
      >
        <Dot className="bg-emerald-500" />
        Saved
      </span>
    );
  }

  // status.kind === "error" — clickable retry.
  return (
    <button
      type="button"
      onClick={onRetry}
      title={status.message}
      aria-live="polite"
      className={`${BASE} border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/60`}
    >
      <Dot className="bg-rose-500" />
      Save failed — retry
    </button>
  );
}

function Dot({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-1.5 rounded-full ${className}`}
    />
  );
}
