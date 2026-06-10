"use client";

import { useMemo, useState } from "react";
import type { ProgramOption } from "@/components/planner/shell/PlannerShell";
import { Button } from "@/components/ui/Button";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useModalExit } from "@/lib/hooks/useModalExit";
import type { LocalPlan, Stream } from "@/lib/plan/types";
import { termInfo } from "@/lib/terms";

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
    stream: Stream;
  }) => void;
}

const STREAM_LABELS: Record<Stream, string> = {
  regular: "Regular (no co-op)",
  stream4: "Stream 4 co-op",
  stream8: "Stream 8 co-op",
};

/**
 * Modal to change a plan's program, specialization, and stream. Stream changes
 * re-sequence the cadence: courses on positions that survive (matched by label)
 * carry forward; those on vanished positions (e.g. coop slots → "regular") drop
 * and surface as a caller banner. Start-term changes still need Reset + re-import.
 */
export function PlanSettingsModal({
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
  const [stream, setStream] = useState<Stream>(plan.stream);

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
  const streamDirty = stream !== plan.stream;
  const dirty = programDirty || specDirty || streamDirty;

  return (
    <Modal
      isClosing={isClosing}
      onClose={handleClose}
      titleId="plan-settings-title"
    >
      <ModalHeader titleId="plan-settings-title" onClose={handleClose}>
        Plan settings
      </ModalHeader>

      <div className="px-4 py-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="text-[12.5px] font-semibold text-ink-2">
            Program
          </span>
          <Select
            value={programId ?? ""}
            onChange={(e) => patchProgram(e.target.value || null)}
          >
            <option value="">(none)</option>
            {programOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="text-[12.5px] font-semibold text-ink-2">
            Specialization / Option
          </span>
          <Select
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
          </Select>
          {programId && specs.length === 0 ? (
            <span className="text-ink-3 mt-0.5">
              No specializations available for this program.
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="text-[12.5px] font-semibold text-ink-2">
            Co-op stream
          </span>
          <Select
            value={stream}
            onChange={(e) => setStream(e.target.value as Stream)}
          >
            {(Object.keys(STREAM_LABELS) as Stream[]).map((s) => (
              <option key={s} value={s}>
                {STREAM_LABELS[s]}
              </option>
            ))}
          </Select>
          {streamDirty ? (
            <span className="text-partial mt-0.5">
              Saving will re-sequence terms — your courses stay on the same
              academic term (1A, 2B, …) but may shift to different calendar
              months.
            </span>
          ) : null}
        </label>

        <div className="rounded-[9px] border border-accent-line bg-accent-soft px-3 py-2.5 text-xs text-ink-2 flex flex-col gap-1.5">
          <div className="flex justify-between">
            <span className="font-semibold text-ink">Start term</span>
            <span className="u-mono u-small">
              {plan.startTermId
                ? (termInfo(plan.startTermId)?.label ??
                  String(plan.startTermId))
                : "—"}
            </span>
          </div>
          <p className="text-ink-3">
            Changing the start term re-bases every calendar term — use{" "}
            <strong className="text-ink-2 font-semibold">Reset plan</strong> and
            re-import.
          </p>
        </div>
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          disabled={!dirty}
          onClick={() => {
            onSave({ programId, specializationId, stream });
            handleClose();
          }}
        >
          Save changes
        </Button>
      </ModalFooter>
    </Modal>
  );
}
