import type { Dispatch, SetStateAction } from "react";
import { useCallback, useRef, useState } from "react";
import { NEW_PLAN_NAME } from "@/lib/constants";
import type { FilterPreset } from "@/lib/courses/types";
import { applyCourseDrop, type CourseDragData } from "@/lib/plan/dnd";
import { addCourseToSlot, removeCourseFromSlot } from "@/lib/plan/mutateSlots";
import { rebuildSlotsForStream } from "@/lib/plan/sequence";
import { toSnapshot } from "@/lib/plan/server/serialize";
import type { PlanSnapshot } from "@/lib/plan/server/types";
import { applyTranscriptToPlan } from "@/lib/plan/transcriptApply";
import type { LocalPlan, Stream } from "@/lib/plan/types";
import type { TranscriptParseResult } from "@/lib/transcript/types";
import type { PickerContext } from "./usePlannerModals";

interface UsePlanEditorsArgs {
  plan: LocalPlan | null;
  picker: PickerContext | null;
  planId: string | null;
  isAuthed: boolean;
  setPlan: (next: LocalPlan) => void;
  clearLocalPlan: () => void;
  flushSave: () => Promise<void>;
  create: (name: string, seed?: PlanSnapshot) => Promise<string | null>;
  router: { replace: (href: string) => void };
  setPicker: Dispatch<SetStateAction<PickerContext | null>>;
  setTranscriptOpen: Dispatch<SetStateAction<boolean>>;
  setImportBanner: Dispatch<SetStateAction<string | null>>;
}

/**
 * The planner's mutation surface: every edit handler (pick, remove, drag, apply
 * transcript, save settings, reset, audit drill-in) plus the small bits of
 * transient state they own (`termChoiceCode`, the in-flight `creating` guard).
 * All writes route through `setPlan`, so persistence + re-validation happen
 * uniformly. Kept apart from the shell so the orchestrator stays scannable.
 *
 * Handlers read the latest plan off a ref rather than closing over `plan`, so
 * they stay referentially stable across edits — the memoized timeline columns
 * don't churn on every keystroke.
 */
export function usePlanEditors({
  plan,
  picker,
  planId,
  isAuthed,
  setPlan,
  clearLocalPlan,
  flushSave,
  create,
  router,
  setPicker,
  setTranscriptOpen,
  setImportBanner,
}: UsePlanEditorsArgs) {
  // Latest plan, read by the edit handlers so they don't have to list `plan`
  // in their dep arrays — keeping the handlers referentially stable across
  // edits so the memoized timeline columns aren't invalidated every keystroke.
  const planRef = useRef(plan);
  planRef.current = plan;

  const [termChoiceCode, setTermChoiceCode] = useState<string | null>(null);
  // Guards the in-planner transcript import against the double-click
  // duplicate-plan bug — without it, a second click during the network
  // round-trip creates a second server plan.
  const [creating, setCreating] = useState(false);

  // Bridge for the in-planner transcript import: writes route to setPlan when
  // there's a current plan, or create+navigate when authed without a planId.
  // Returns whether the write landed — a failed server create (create → null)
  // reports false so the caller doesn't flash a success state.
  const persistOrCreate = useCallback(
    async (next: LocalPlan, name: string = NEW_PLAN_NAME): Promise<boolean> => {
      if (isAuthed && planId === null) {
        const newId = await create(name, toSnapshot(next));
        if (!newId) return false;
        router.replace(`/plan?planId=${newId}`);
        return true;
      }
      setPlan(next);
      return true;
    },
    [isAuthed, planId, create, router, setPlan],
  );

  const handleApplyTranscript = useCallback(
    async (
      parseResult: TranscriptParseResult,
      included: ReadonlySet<string>,
    ) => {
      if (creating) return;
      setCreating(true);
      try {
        const stream: Stream =
          parseResult.detectedSystemOfStudy === "coop" ? "stream8" : "regular";
        const {
          plan: next,
          unsortedCodes,
          unplacedTerms,
        } = applyTranscriptToPlan(parseResult, {
          stream,
          includedUnrecognized: included,
          mintId: () => crypto.randomUUID(),
        });
        const persisted = await persistOrCreate(next, "Imported plan");
        // A failed server create leaves the modal open so the user can retry —
        // don't close it or flash a success banner for an import that was lost.
        if (!persisted) return;
        setTranscriptOpen(false);

        const banner = buildImportBanner({
          stream,
          unsortedCodes,
          unplacedTerms,
          startTermId: next.startTermId,
        });
        setImportBanner(banner);
      } finally {
        setCreating(false);
      }
    },
    [creating, persistOrCreate, setTranscriptOpen, setImportBanner],
  );

  const handleReset = useCallback(() => {
    // Signed-out only — for signed-in users, the PlanSwitcher provides
    // per-plan delete, which is the equivalent action.
    clearLocalPlan();
    setPicker(null);
    setImportBanner(null);
  }, [clearLocalPlan, setPicker, setImportBanner]);

  const handleSaveSettings = useCallback(
    (next: {
      programId: string | null;
      specializationId: string | null;
      stream: Stream;
    }) => {
      if (!plan) return;
      const streamChanged = next.stream !== plan.stream;
      // Stream changes re-sequence the cadence; programId/specializationId
      // alone never touch slots. startTermId === null means the plan has no
      // calendar anchor yet — update the metadata but skip rebuild.
      if (streamChanged && plan.startTermId !== null) {
        const { slots, droppedCodes } = rebuildSlotsForStream(
          plan.slots,
          plan.startTermId,
          next.stream,
          () => crypto.randomUUID(),
        );
        setPlan({
          ...plan,
          programId: next.programId,
          specializationId: next.specializationId,
          stream: next.stream,
          slots,
        });
        if (droppedCodes.length > 0) {
          setImportBanner(
            `Switched stream to ${next.stream}. ${droppedCodes.length} course${droppedCodes.length === 1 ? "" : "s"} no longer fit and ${droppedCodes.length === 1 ? "was" : "were"} removed: ${droppedCodes.join(", ")}.`,
          );
        }
        return;
      }
      setPlan({
        ...plan,
        programId: next.programId,
        specializationId: next.specializationId,
        stream: next.stream,
      });
    },
    [plan, setPlan, setImportBanner],
  );

  // Audit drill-in. A single named course (an "Add") only needs a term, so open
  // the term picker for it. A multi-code "Browse" (a finite list) opens the slot
  // picker focused on those codes; a `preset` (a subject pool / breadth, no
  // fixed list) instead opens the picker with its subject + level filters
  // pre-applied. Both target the first academic term.
  const handleDrillToRequirement = useCallback(
    (codes: string[], preset?: FilterPreset) => {
      if (codes.length === 0 && !preset) return;
      if (!preset && codes.length === 1) {
        setTermChoiceCode(codes[0]);
        return;
      }
      const current = planRef.current;
      const target =
        current?.slots.find((s) => !s.isCoop && s.position !== "pre") ??
        current?.slots[0];
      if (!target) return;
      setPicker({
        slotId: target.id,
        focusCodes: codes.length > 0 ? codes : undefined,
        initialFilters: preset,
      });
    },
    [setPicker],
  );

  const handlePickCode = useCallback(
    (code: string) => {
      if (!plan || !picker) return;
      const next = addCourseToSlot(plan, picker.slotId, { code });
      if (next !== plan) setPlan(next);
      setPicker(null);
    },
    [plan, picker, setPlan, setPicker],
  );

  // Commit the audit drill-in's chosen course into the term the user picked.
  const handlePickTermForCourse = useCallback(
    (slot: { id: string }) => {
      const current = planRef.current;
      if (!current || !termChoiceCode) return;
      const next = addCourseToSlot(current, slot.id, { code: termChoiceCode });
      if (next !== current) setPlan(next);
      setTermChoiceCode(null);
    },
    [termChoiceCode, setPlan],
  );

  const handleRemoveCourse = useCallback(
    (slotId: string, code: string) => {
      const current = planRef.current;
      if (!current) return;
      const next = removeCourseFromSlot(current, slotId, code);
      if (next !== current) setPlan(next);
    },
    [setPlan],
  );

  // Drag-and-drop: a placed chip dropped on another term ("move") or an audit
  // "missing" chip dropped into a term ("add"). All routed through setPlan, so
  // persistence and re-validation happen exactly as for any other edit.
  const handleCourseDrop = useCallback(
    (toSlotId: string, data: CourseDragData) => {
      const cur = planRef.current;
      if (!cur) return;
      const next = applyCourseDrop(cur, toSlotId, data);
      if (next !== cur) setPlan(next);
    },
    [setPlan],
  );

  const handleRetrySave = useCallback(() => {
    void flushSave();
  }, [flushSave]);

  return {
    termChoiceCode,
    setTermChoiceCode,
    handleApplyTranscript,
    handleReset,
    handleSaveSettings,
    handleDrillToRequirement,
    handlePickCode,
    handlePickTermForCourse,
    handleRemoveCourse,
    handleCourseDrop,
    handleRetrySave,
  };
}

function buildImportBanner(args: {
  stream: Stream;
  unsortedCodes: string[];
  unplacedTerms: string[];
  startTermId: number | null;
}): string {
  const parts: string[] = [];
  if (args.startTermId === null) {
    parts.push(
      "Transcript imported but no recognizable term labels were found — slots were not generated.",
    );
  } else if (args.stream === "stream8") {
    parts.push(
      "Imported as Stream 8 co-op (the default for transcripts marked co-operative). Reset and re-import to switch to Stream 4.",
    );
  }
  if (args.unsortedCodes.length > 0) {
    parts.push(
      `${args.unsortedCodes.length} course${args.unsortedCodes.length === 1 ? "" : "s"} couldn't be placed onto the cadence (${args.unplacedTerms.join(", ")}): ${args.unsortedCodes.join(", ")}.`,
    );
  }
  return parts.join(" ");
}
