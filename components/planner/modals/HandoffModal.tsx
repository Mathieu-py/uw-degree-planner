"use client";

import { useCallback, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { pluralize } from "@/lib/format";
import { useModalExit } from "@/lib/hooks/useModalExit";
import type { HandoffResolution } from "@/lib/plan/sync/useAnonHandoff";
import type { LocalPlan } from "@/lib/plan/types";
import { termLabel } from "@/lib/terms";

interface Props {
  localPlan: LocalPlan;
  onResolve: (choice: HandoffResolution) => Promise<boolean>;
}

/**
 * Shown when the user signs in with both a local plan AND existing server
 * plans. Two explicit choices:
 *   - "Import as another plan" — uploads the local plan as a new server plan
 *   - "Discard local plan"    — drops the local plan; server-only from now on
 *
 * There's no dedicated "Decide later" button — Escape or a backdrop click
 * resolves `cancel` (re-prompts on next sign-in), which `useModalExit` wires
 * to onClose.
 */
export function HandoffModal({ localPlan, onResolve }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isClosing, handleClose, animateOut, reset } = useModalExit(
    () => void onResolve("cancel"),
  );

  // Import/discard pair the async action with the exit animation via Promise.all
  // (fade-out runs while createPlanWithSeed is in flight). A failed import keeps
  // the modal up with an inline message; success lets the parent unmount it.
  const pick = useCallback(
    async (choice: HandoffResolution) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      let resolved = false;
      try {
        const [ok] = await Promise.all([onResolve(choice), animateOut()]);
        resolved = ok;
      } finally {
        setBusy(false);
        if (!resolved) {
          setError("Couldn't import your plan. Please try again.");
          reset();
        }
      }
    },
    [busy, onResolve, animateOut, reset],
  );

  // Disable actions during busy OR the cancel-exit animation, else an Esc
  // followed by an Import click during the 300ms exit resolves twice.
  const disabled = busy || isClosing;

  return (
    <Modal isClosing={isClosing} onClose={handleClose} titleId="handoff-title">
      <ModalHeader titleId="handoff-title">
        You have an unsaved local plan
      </ModalHeader>
      <div className="px-4 py-4 flex flex-col gap-3.5">
        <p className="text-[13.5px] text-ink-2">
          This browser has a plan you built before signing in, and your account
          already has saved plans. What would you like to do?
        </p>
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-[9px] bg-accent-soft border border-accent-line">
          <span className="text-accent shrink-0">
            <Icon name="doc" size="sm" aria-hidden="true" />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-ink">
              Local plan
            </span>
            <span className="u-small truncate">{summarize(localPlan)}</span>
          </div>
        </div>
        {error ? (
          <Alert size="sm" aria-live="assertive">
            {error}
          </Alert>
        ) : null}
        <div className="flex flex-col gap-2 mt-0.5">
          <Button block disabled={disabled} onClick={() => pick("import")}>
            Import as another plan
          </Button>
          <Button
            variant="dangerOutline"
            block
            disabled={disabled}
            onClick={() => pick("discard")}
          >
            Discard local plan
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function summarize(plan: LocalPlan): string {
  const slotCount = plan.slots.reduce((sum, s) => sum + s.courses.length, 0);
  const start = plan.startTermId
    ? termLabel(plan.startTermId)
    : "no start term";
  return `${slotCount} placed ${pluralize(slotCount, "course")} · ${start}`;
}
