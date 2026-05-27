"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useModalExit } from "@/lib/hooks/useModalExit";
import type { HandoffResolution } from "@/lib/plan/sync/useAnonHandoff";
import type { LocalPlan } from "@/lib/plan/types";
import { termInfo } from "@/lib/terms";

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
  const { isClosing, handleClose, animateOut, reset } = useModalExit(
    () => void onResolve("cancel"),
  );

  // Import/discard are async actions paired with the exit animation via
  // Promise.all — the fade-out runs while createPlanWithSeed is in flight.
  // On failure (onResolve resolves without the parent unmounting us),
  // reset() restores visibility so the user can retry.
  const pick = useCallback(
    async (choice: HandoffResolution) => {
      if (busy) return;
      setBusy(true);
      try {
        await Promise.all([onResolve(choice), animateOut()]);
      } finally {
        setBusy(false);
        reset();
      }
    },
    [busy, onResolve, animateOut, reset],
  );

  // Disable all action buttons during busy OR during the cancel-exit
  // animation. Without the isClosing check, a user who pressed Esc could
  // still click Import during the 300ms exit and end up resolving twice.
  const disabled = busy || isClosing;

  return (
    <Modal isClosing={isClosing} onClose={handleClose} titleId="handoff-title">
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
        <Button disabled={disabled} onClick={() => pick("import")}>
          Import as another plan
        </Button>
        <Button
          variant="destructiveOutline"
          disabled={disabled}
          onClick={() => pick("discard")}
        >
          Discard local plan
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => pick("cancel")}
        >
          Decide later
        </Button>
      </footer>
    </Modal>
  );
}

function summarize(plan: LocalPlan): string {
  const slotCount = plan.slots.reduce((sum, s) => sum + s.courses.length, 0);
  const start = plan.startTermId
    ? (termInfo(plan.startTermId)?.label ?? `Term ${plan.startTermId}`)
    : "no start term";
  return `${slotCount} placed course${slotCount === 1 ? "" : "s"} · ${start}`;
}
