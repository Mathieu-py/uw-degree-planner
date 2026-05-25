"use client";

import { useCallback, useState } from "react";
import type { HandoffResolution } from "@/lib/plan/sync/useAnonHandoff";
import type { LocalPlan } from "@/lib/plan/types";
import { termInfo } from "@/lib/terms";
import { useEscape } from "./useEscape";

interface Props {
  localPlan: LocalPlan;
  onResolve: (choice: HandoffResolution) => Promise<void>;
}

/**
 * Shown when the user signs in with both a local plan AND existing server
 * plans. Three options:
 *   - "Import as another plan" — uploads the local plan as a new server plan
 *   - "Discard local plan"    — drops the local plan; server-only from now on
 *   - "Decide later"          — closes the modal, prompts again on next sign-in
 */
export function HandoffModal({ localPlan, onResolve }: Props) {
  const [busy, setBusy] = useState(false);

  const pick = useCallback(
    async (choice: HandoffResolution) => {
      if (busy) return;
      setBusy(true);
      try {
        await onResolve(choice);
      } finally {
        setBusy(false);
      }
    },
    [busy, onResolve],
  );

  const onEscape = useCallback(() => {
    void pick("cancel");
  }, [pick]);
  useEscape(onEscape);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={() => void pick("cancel")}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-title"
        className="relative bg-white dark:bg-zinc-950 rounded-lg shadow-2xl max-w-md w-full flex flex-col overflow-hidden border border-zinc-200 dark:border-zinc-800"
      >
        <header className="border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <h2 id="handoff-title" className="text-sm font-medium">
            You have an unsaved local plan
          </h2>
        </header>
        <div className="px-4 py-4 flex flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          <p>
            Your browser has a plan built before you signed in. Your account
            already has at least one saved plan — what would you like to do?
          </p>
          <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
            Local plan: {summarize(localPlan)}
          </div>
        </div>
        <footer className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => pick("import")}
            className="rounded bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 text-xs font-medium px-3 py-1.5 disabled:opacity-50"
          >
            Import as another plan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => pick("discard")}
            className="rounded border border-rose-300 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs font-medium px-3 py-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
          >
            Discard local plan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => pick("cancel")}
            className="rounded border border-zinc-300 dark:border-zinc-700 text-xs px-3 py-1.5 disabled:opacity-50"
          >
            Decide later
          </button>
        </footer>
      </div>
    </div>
  );
}

function summarize(plan: LocalPlan): string {
  const slotCount = plan.slots.reduce((sum, s) => sum + s.courses.length, 0);
  const start = plan.startTermId
    ? (termInfo(plan.startTermId)?.label ?? `Term ${plan.startTermId}`)
    : "no start term";
  return `${slotCount} placed course${slotCount === 1 ? "" : "s"} · ${start}`;
}
