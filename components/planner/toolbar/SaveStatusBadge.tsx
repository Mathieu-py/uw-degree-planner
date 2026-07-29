"use client";

import type { SaveStatus } from "@/lib/plan/sync/serverPlan";

interface Props {
  status: SaveStatus;
  /** Called when the user clicks the badge in its error state. */
  onRetry: () => void;
}

/**
 * Header indicator for server-save status; idle renders nothing. Weights are
 * tiered: "Saved" is a quiet check, "Saving…" an amber dot, "Save failed" a
 * button-shaped chip (it needs action). Only the error chip uses `aria-live` —
 * announcing every saving↔saved flip would spam assistive tech.
 */
export function SaveStatusBadge({ status, onRetry }: Props) {
  if (status.kind === "idle") return null;

  if (status.kind === "saving") {
    return (
      <span className="pw-save">
        <span aria-hidden="true" className="sdot sdot-partial" />
        Saving…
      </span>
    );
  }

  if (status.kind === "saved") {
    return (
      <span className="pw-save">
        <span aria-hidden="true" className="sdot sdot-met" />
        All changes saved
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
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium border border-danger bg-danger-soft text-danger hover:brightness-105"
    >
      <span
        aria-hidden="true"
        className="inline-block size-2 rounded-full bg-danger"
      />
      Save failed — retry
    </button>
  );
}
