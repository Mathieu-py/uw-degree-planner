"use client";

import { useMemo, useState } from "react";
import type { ProgramOption } from "@/components/planner/shell/PlannerShell";
import { Button } from "@/components/ui/Button";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { SegmentedRadio } from "@/components/ui/SegmentedRadio";
import { Select } from "@/components/ui/Select";
import { useModalExit } from "@/lib/hooks/useModalExit";
import { type LocalPlan, STREAM_OPTIONS, type Stream } from "@/lib/plan/types";
import { termInfo } from "@/lib/terms";
import { ProgramMultiSelect } from "./ProgramMultiSelect";

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
    programIds: string[];
    specializationIds: Record<string, string>;
    stream: Stream;
  }) => void;
}

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
  const [programIds, setProgramIds] = useState<string[]>(plan.programIds);
  const [specializationIds, setSpecializationIds] = useState<
    Record<string, string>
  >(plan.specializationIds);
  const [stream, setStream] = useState<Stream>(plan.stream);

  const programName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of programOptions) map[o.id] = o.name;
    return map;
  }, [programOptions]);

  // One specialization picker per program that actually offers specializations.
  const specPrograms = useMemo(
    () =>
      programIds
        .map((id) => ({ id, specs: specializationsByProgram[id] ?? [] }))
        .filter((p) => p.specs.length > 0),
    [programIds, specializationsByProgram],
  );

  function patchPrograms(next: string[]) {
    setProgramIds(next);
    // Drop specialization entries for programs no longer on the plan, so a
    // removed-then-readded program doesn't silently resurrect its old spec.
    setSpecializationIds((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([pid]) => next.includes(pid)),
      ),
    );
  }

  function setSpec(programId: string, slug: string) {
    setSpecializationIds((prev) => {
      const next = { ...prev };
      // Empty selection ("(none)") omits the key — the map stays omit-empty.
      if (slug) next[programId] = slug;
      else delete next[programId];
      return next;
    });
  }

  const programsDirty = !sameIds(programIds, plan.programIds);
  const specDirty = !sameSpecMap(specializationIds, plan.specializationIds);
  const streamDirty = stream !== plan.stream;
  const dirty = programsDirty || specDirty || streamDirty;
  const noPrograms = programIds.length === 0;

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
        <div className="flex flex-col gap-1.5 text-xs">
          <span className="text-[12.5px] font-semibold text-ink-2">
            Programs
          </span>
          <ProgramMultiSelect
            programOptions={programOptions}
            selected={programIds}
            onChange={patchPrograms}
          />
          {noPrograms ? (
            <span className="text-partial mt-0.5">
              Pick at least one program — your plan needs one to audit against.
            </span>
          ) : programIds.length > 1 ? (
            <span className="text-ink-3 mt-0.5">
              Double degree — your audit shows one section per program.
            </span>
          ) : null}
        </div>

        {specPrograms.length === 0 ? (
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="text-[12.5px] font-semibold text-ink-2">
              Specialization / Option
            </span>
            <span className="text-ink-3">
              No specializations available for{" "}
              {programIds.length > 1 ? "these programs" : "this program"}.
            </span>
          </div>
        ) : (
          specPrograms.map(({ id, specs }) => (
            <label key={id} className="flex flex-col gap-1.5 text-xs">
              <span className="text-[12.5px] font-semibold text-ink-2">
                {specPrograms.length > 1 || programIds.length > 1
                  ? `${programName[id] ?? id} — specialization`
                  : "Specialization / Option"}
              </span>
              <Select
                value={specializationIds[id] ?? ""}
                onChange={(e) => setSpec(id, e.target.value)}
              >
                <option value="">(none)</option>
                {specs.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
          ))
        )}

        <div className="flex flex-col gap-1.5 text-xs">
          <span className="text-[12.5px] font-semibold text-ink-2">
            Co-op stream
          </span>
          <SegmentedRadio
            options={STREAM_OPTIONS}
            value={stream}
            onChange={setStream}
            ariaLabel="Co-op stream"
          />
          {streamDirty ? (
            <span className="text-partial mt-0.5">
              Saving will re-sequence terms — your courses stay on the same
              academic term (1A, 2B, …) but may shift to different calendar
              months.
            </span>
          ) : null}
        </div>

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
          disabled={!dirty || noPrograms}
          onClick={() => {
            onSave({ programIds, specializationIds, stream });
            handleClose();
          }}
        >
          Save changes
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** Order-sensitive equality for the program-id list (drives the dirty check). */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Shallow key/value equality for the per-program specialization map. */
function sameSpecMap(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ak = Object.keys(a);
  return ak.length === Object.keys(b).length && ak.every((k) => a[k] === b[k]);
}
