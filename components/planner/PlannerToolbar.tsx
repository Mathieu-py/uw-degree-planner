"use client";

import type { SaveStatus } from "@/lib/plan/sync/types";
import { SaveStatusBadge } from "./SaveStatusBadge";

interface Props {
  /** Display name for the active plan — "Local plan" for anon, the
   *  PlanSummary.name for authed users. */
  planName: string;
  /** Compact one-line summary: "{program} · {stream} · {start} · {n} slots". */
  summary: string;
  /** Anon users have no server save; the chip is hidden when status is null. */
  saveStatus: SaveStatus | null;
  onRetrySave: () => void;
  onOpenSettings: () => void;
  onUploadTranscript: () => void;
  /** Only provided for the signed-out local-source path — signed-in users
   *  delete plans from the sidebar instead. */
  onReset?: () => void;
}

/**
 * Sticky workspace toolbar that consolidates plan controls above the
 * three-zone workspace (Plans | Timeline | Audit). Replaces the in-page
 * "Current plan" card that lived inside PlannerShell prior to PR 1.5.
 */
export function PlannerToolbar({
  planName,
  summary,
  saveStatus,
  onRetrySave,
  onOpenSettings,
  onUploadTranscript,
  onReset,
}: Props) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur px-4 py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-medium truncate max-w-[14rem]" title={planName}>
          {planName}
        </span>
        {saveStatus ? (
          <SaveStatusBadge status={saveStatus} onRetry={onRetrySave} />
        ) : null}
      </div>

      <button
        type="button"
        onClick={onOpenSettings}
        className="flex-1 min-w-0 text-center text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 underline-offset-4 hover:underline truncate"
        title="Plan settings"
      >
        {summary}
      </button>

      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onUploadTranscript}
          className="text-xs text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-50 underline-offset-4 hover:underline"
        >
          Import transcript
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 underline-offset-4 hover:underline"
        >
          Settings
        </button>
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400 underline-offset-4 hover:underline"
          >
            Reset plan
          </button>
        ) : null}
      </div>
    </div>
  );
}
