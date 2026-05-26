"use client";

import { useMemo, useState } from "react";
import type { LocalPlan, Stream } from "@/lib/plan/types";
import { termInfo } from "@/lib/terms";
import { Button } from "../ui/Button";
import { Modal } from "./Modal";
import type { ProgramOption } from "./PlannerShell";
import { useModalExit } from "./useModalExit";

interface SpecOption {
  slug: string;
  name: string;
}

interface Props {
  plan: LocalPlan;
  programOptions: ProgramOption[];
  /** Map of programId → list of available specializations for that program. */
  specializationsByProgram: Record<string, SpecOption[]>;
  onClose: () => void;
  onSave: (next: {
    programId: string | null;
    specializationId: string | null;
  }) => void;
}

const INPUT =
  "w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm";

const STREAM_LABELS: Record<Stream, string> = {
  regular: "Regular (no co-op)",
  stream4: "Stream 4 co-op (January start)",
  stream8: "Stream 8 co-op (May start)",
};

/**
 * Modal that lets the student change program and specialization on an
 * existing plan without resetting. Stream and start-term changes are not
 * supported here — they re-sequence every slot — and surface a clear note
 * pointing to "Reset plan" instead.
 */
export function PlanSettings({
  plan,
  programOptions,
  specializationsByProgram,
  onClose,
  onSave,
}: Props) {
  const { isClosing, handleClose } = useModalExit(onClose);
  const [programId, setProgramId] = useState<string | null>(plan.programId);
  const [specializationId, setSpecializationId] = useState<string | null>(
    plan.specializationId,
  );

  // Available specs follow the selected program. Clearing program nulls spec.
  const specs = useMemo<SpecOption[]>(() => {
    if (!programId) return [];
    return specializationsByProgram[programId] ?? [];
  }, [programId, specializationsByProgram]);

  function patchProgram(next: string | null) {
    setProgramId(next);
    // If switching program, the old specialization is unlikely to apply.
    setSpecializationId(null);
  }

  const programDirty = programId !== plan.programId;
  const specDirty = specializationId !== plan.specializationId;
  const dirty = programDirty || specDirty;

  return (
    <Modal
      isClosing={isClosing}
      onClose={handleClose}
      titleId="plan-settings-title"
    >
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 flex items-center justify-between">
        <h2 id="plan-settings-title" className="text-sm font-medium">
          Plan settings
        </h2>
        <Button variant="icon" onClick={handleClose} aria-label="Close">
          <span aria-hidden="true">×</span>
        </Button>
      </header>

      <div className="px-4 py-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Program
          </span>
          <select
            className={INPUT}
            value={programId ?? ""}
            onChange={(e) => patchProgram(e.target.value || null)}
          >
            <option value="">(none)</option>
            {programOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Specialization / Option
          </span>
          <select
            className={INPUT}
            value={specializationId ?? ""}
            onChange={(e) => setSpecializationId(e.target.value || null)}
            disabled={specs.length === 0}
          >
            <option value="">(none)</option>
            {specs.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
          {programId && specs.length === 0 ? (
            <span className="text-zinc-400 dark:text-zinc-500 mt-0.5">
              No specializations available for this program.
            </span>
          ) : null}
        </label>

        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 flex flex-col gap-1">
          <div className="flex justify-between">
            <span>Start term</span>
            <span>
              {plan.startTermId
                ? (termInfo(plan.startTermId)?.label ??
                  String(plan.startTermId))
                : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Co-op stream</span>
            <span>{STREAM_LABELS[plan.stream]}</span>
          </div>
          <p className="text-[11px] mt-1 text-zinc-500 dark:text-zinc-500">
            Changing stream or start term re-sequences every slot. To do that,
            use <strong>Reset plan</strong> and re-import.
          </p>
        </div>
      </div>

      <footer className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          disabled={!dirty}
          onClick={() => {
            onSave({ programId, specializationId });
            handleClose();
          }}
        >
          Save
        </Button>
      </footer>
    </Modal>
  );
}
