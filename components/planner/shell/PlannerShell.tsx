"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { AuditPanel } from "@/components/planner/audit/AuditPanel";
import { DemoModeBanner } from "@/components/planner/DemoModeBanner";
import { HandoffModal } from "@/components/planner/modals/HandoffModal";
import { PlanSettingsModal } from "@/components/planner/modals/PlanSettingsModal";
import { TranscriptImportModal } from "@/components/planner/modals/TranscriptImportModal";
import { SlotPicker } from "@/components/planner/picker/SlotPicker";
import { TermChoiceModal } from "@/components/planner/picker/TermChoiceModal";
import { Timeline } from "@/components/planner/timeline/Timeline";
import { PlanToolbar } from "@/components/planner/toolbar/PlanToolbar";
import { SaveStatusBadge } from "@/components/planner/toolbar/SaveStatusBadge";
import { PlannerSkeleton } from "@/components/states/PlannerSkeleton";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useAuthState } from "@/lib/auth/store";
import type { Course } from "@/lib/courses/types";
import { buildCourseOrigin } from "@/lib/plan/courseOrigin";
import { completedSetFromPlan, isAcademicSlot } from "@/lib/plan/derive";
import { eligibleSlotIdsForCourse } from "@/lib/plan/eligibleTerms";
import { removeCourseFromSlot } from "@/lib/plan/mutateSlots";
import { useAnonHandoff } from "@/lib/plan/sync/useAnonHandoff";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import { usePlanSync } from "@/lib/plan/sync/usePlanSync";
import type { LocalPlan } from "@/lib/plan/types";
import { issuesBySlot, validatePlan } from "@/lib/plan/validate";
import { joinProgramNames, type ProgramOption } from "@/lib/programs";
import { usePlanProgramContext } from "@/lib/programs/usePlanPrograms";
import { termInfo } from "@/lib/terms";
import { ProgramHeader } from "./ProgramHeader";
import { usePlanEditors } from "./usePlanEditors";
import { usePlannerModals } from "./usePlannerModals";
import { usePlannerRedirect } from "./usePlannerRedirect";

export type { ProgramOption };

interface Props {
  /** Active plan id from the `/plan/[planId]` route param; null at bare `/plan`. */
  planId: string | null;
  programOptions: ProgramOption[];
  specializationsByProgram: Record<
    string,
    Array<{ slug: string; name: string }>
  >;
  catalog: Course[];
}

/**
 * Client root for the planner. Branches on auth: signed-out plans live in
 * localStorage (usePlanSync's local path); signed-in plans live on Supabase,
 * keyed by the `/plan/[planId]` route param. The mutation surface is identical
 * across both — usePlanSync routes the writes.
 *
 * Mounting the inner shell is gated on `ready` from the auth store: without it,
 * a returning user briefly renders the anon branch (and stale local plan)
 * before `getUser()` flips `isAuthed` — a flicker on every load.
 */
export function PlannerShell(props: Props) {
  const { isAuthed, ready } = useAuthState();
  if (!ready) {
    return <PlannerSkeleton />;
  }
  return <PlannerShellInner {...props} isAuthed={isAuthed} />;
}

interface InnerProps extends Props {
  isAuthed: boolean;
}

function PlannerShellInner({
  planId,
  programOptions,
  specializationsByProgram,
  catalog,
  isAuthed,
}: InnerProps) {
  const router = useRouter();

  const {
    plan,
    source,
    hydrated,
    reloading,
    saveStatus,
    loadError,
    setPlan,
    clearLocalPlan,
    flushSave,
  } = usePlanSync({ isAuthed, planId });
  const { plans, create } = usePlanList({ isAuthed });
  const activePlanName =
    isAuthed && planId
      ? (plans?.find((p) => p.id === planId)?.name ?? "Untitled plan")
      : "Local plan";
  const { conflict, resolveConflict } = useAnonHandoff({
    isAuthed,
    createPlanWithSeed: create,
    onImported: (newPlanId) => {
      router.replace(`/plan/${newPlanId}`);
      setImportBanner("Plan imported to your account.");
    },
  });

  const {
    picker,
    setPicker,
    openPicker,
    closePicker,
    transcriptOpen,
    setTranscriptOpen,
    settingsOpen,
    setSettingsOpen,
    auditSheetOpen,
    setAuditSheetOpen,
  } = usePlannerModals();
  const [importBanner, setImportBanner] = useState<string | null>(null);

  const {
    termChoiceCode,
    setTermChoiceCode,
    handleApplyTranscript,
    handleReset,
    handleSaveSettings,
    handleDrillToRequirement,
    handlePickCode,
    handlePickTermForCourse,
    handleRemoveCourse,
    handleAcknowledgeRequirement,
    handleCourseDrop,
    handleRetrySave,
  } = usePlanEditors({
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
  });

  // With no ?planId, /plan redirects to the planner or the create flow (see
  // usePlannerRedirect). Creation lives at /plan/new — no inline empty state.
  usePlannerRedirect({ isAuthed, planId, plans, hydrated, plan });

  // Catalog-derived lookups.
  const allCourseCodesSet = useMemo(
    () => new Set(catalog.map((c) => c.code)),
    [catalog],
  );
  const catalogByCode = useMemo(
    () => new Map(catalog.map((c) => [c.code, c])),
    [catalog],
  );

  const issues = useMemo(
    () => (plan ? validatePlan(plan, catalogByCode) : []),
    [plan, catalogByCode],
  );
  const issuesPerSlot = useMemo(() => issuesBySlot(issues), [issues]);

  // The audit panel recompiles the full rule tree on every plan change and is
  // non-interactive, so feed it a deferred plan: the timeline updates
  // synchronously while React recomputes the audit at lower priority.
  const deferredPlan = useDeferredValue(plan);

  // Code of the dragged audit chip, so the timeline can tint its eligible terms.
  const [draggingAddCode, setDraggingAddCode] = useState<string | null>(null);
  // The placed course being dragged between terms (code + its current slot), so
  // the same eligibility highlight runs on a move, not just an add.
  const [movingCourse, setMovingCourse] = useState<{
    code: string;
    fromSlotId: string;
  } | null>(null);
  // A successful drop can unmount the source chip before `dragend` fires,
  // leaving the flag stale. A drop yields a new `plan` ref, so clear it on any
  // plan change.
  const planRef = useRef(plan);
  if (planRef.current !== plan) {
    planRef.current = plan;
    if (draggingAddCode !== null) setDraggingAddCode(null);
    if (movingCourse !== null) setMovingCourse(null);
  }
  const handleAddDragStart = useCallback(
    (code: string) => setDraggingAddCode(code),
    [],
  );
  const handleAddDragEnd = useCallback(() => setDraggingAddCode(null), []);
  const handleMoveDrag = useCallback(
    (moving: { code: string; fromSlotId: string } | null) =>
      setMovingCourse(moving),
    [],
  );
  // Program identities (small index) + the codes each program references
  // (on-demand detail), unioned across a double degree. Referenced codes
  // keep a stale restriction from greying out a required course. Both feed the
  // drag highlight and the slot picker.
  const { programs, programReferenced } = usePlanProgramContext(plan);
  // Eligible terms for the dragged course, from the synchronous `plan` (the drop
  // surface), not `deferredPlan`. Null when idle so the timeline skips the work.
  // Drives the green/muted tinting for both an audit add and a between-term move;
  // a move is judged against the plan WITHOUT the in-flight course (else it reads
  // as "already placed" everywhere and its own slot satisfies its prereqs).
  const eligibleSlotIds = useMemo(() => {
    if (!plan) return null;
    if (draggingAddCode) {
      return eligibleSlotIdsForCourse(
        plan,
        draggingAddCode,
        catalogByCode,
        programs,
        programReferenced,
      );
    }
    if (movingCourse) {
      const without = removeCourseFromSlot(
        plan,
        movingCourse.fromSlotId,
        movingCourse.code,
      );
      return eligibleSlotIdsForCourse(
        without,
        movingCourse.code,
        catalogByCode,
        programs,
        programReferenced,
      );
    }
    return null;
  }, [
    draggingAddCode,
    movingCourse,
    plan,
    catalogByCode,
    programs,
    programReferenced,
  ]);
  const auditDrag = useMemo(
    () => ({
      draggingCode: draggingAddCode,
      onStart: handleAddDragStart,
      onEnd: handleAddDragEnd,
    }),
    [draggingAddCode, handleAddDragStart, handleAddDragEnd],
  );

  const pickerMeta = useMemo(() => {
    if (!plan || !picker) return null;
    const slot = plan.slots.find((s) => s.id === picker.slotId);
    if (!slot) return null;
    const completedBefore =
      slot.termId !== null
        ? completedSetFromPlan(plan, slot.termId)
        : completedSetFromPlan(plan);
    const placedCodes = new Set(
      plan.slots.flatMap((s) => s.courses.map((c) => c.code)),
    );
    const termLabel =
      slot.termId !== null
        ? (termInfo(slot.termId)?.label ?? `Term ${slot.termId}`)
        : "Pre-arrival";
    // The slot's position is the student's level in this term ("1A".."4B"),
    // letting the picker resolve level-gated prereqs. Pre/co-op have no level.
    const level = isAcademicSlot(slot) ? slot.position : undefined;
    // Codes already in the target slot, so coreqs can resolve same-term.
    const sameTerm = new Set(slot.courses.map((c) => c.code));
    // from=picker context for each row's Details link → one-click "Add to {term}".
    // Pre slots have no termId, so term is omitted and the detail page falls back.
    const detailsQuery = buildCourseOrigin({
      from: "picker",
      planId: planId ?? undefined,
      term: slot.termId ?? undefined,
    });
    return {
      slot,
      completedBefore,
      placedCodes,
      termLabel,
      level,
      sameTerm,
      detailsQuery,
    };
  }, [plan, picker, planId]);

  const termChoiceCourse = termChoiceCode
    ? (catalogByCode.get(termChoiceCode) ?? null)
    : null;

  // Rendered alongside every branch below, so the handoff modal can appear over
  // whichever branch is live when the user signs in.
  const handoffElement = conflict ? (
    <HandoffModal localPlan={conflict.localPlan} onResolve={resolveConflict} />
  ) : null;

  if (!hydrated && !plan) {
    return (
      <PlannerLayout
        isAuthed={isAuthed}
        planId={planId}
        toolbar={null}
        overlays={handoffElement}
      >
        <PlannerSkeleton />
      </PlannerLayout>
    );
  }

  const isLocalSource = source === "local";
  // Signed-in with a planId that loaded but produced no plan. Two outcomes:
  //   - loadError === null → ok with no row: genuinely missing → not-found note.
  //   - loadError !== null → network/auth/DB failure → retryable error banner.
  const onServerPath =
    isAuthed && planId !== null && plan === null && typeof source !== "string";
  const planNotFound = onServerPath && loadError === null;
  const planLoadFailed = onServerPath && loadError !== null;

  if (planLoadFailed) {
    return (
      <PlannerLayout
        isAuthed={isAuthed}
        planId={planId}
        overlays={handoffElement}
      >
        <div className="rounded-[10px] border border-danger bg-danger-soft px-4 py-6 text-sm text-danger">
          <p className="font-medium">We couldn't load this plan.</p>
          <p className="mt-1 text-xs opacity-80">{loadError}</p>
          <p className="mt-2 text-xs opacity-80">
            Reload the page or pick a different plan from the toolbar.
          </p>
        </div>
      </PlannerLayout>
    );
  }

  if (planNotFound) {
    return (
      <PlannerLayout
        isAuthed={isAuthed}
        planId={planId}
        overlays={handoffElement}
      >
        <div className="rounded-[10px] border border-partial bg-partial-soft px-4 py-6 text-sm text-ink">
          <p>
            We couldn't find a plan with that id. Pick a different plan from the
            toolbar, or create a new one.
          </p>
        </div>
      </PlannerLayout>
    );
  }

  // No plan: the redirect effect above is navigating (to /plan/new or the most
  // recent plan). Render a skeleton so the planner never flashes empty.
  if (!plan) {
    return (
      <PlannerLayout
        isAuthed={isAuthed}
        planId={planId}
        overlays={handoffElement}
      >
        <PlannerSkeleton />
      </PlannerLayout>
    );
  }

  const programName =
    joinProgramNames(
      plan.programIds,
      (id) => programOptions.find((p) => p.id === id)?.name,
    ) ?? "—";

  // Tag the timeline's course links as plan-originated so the detail page hides
  // its redundant "Add to plan", and carry the plan id so "Back to planner"
  // returns to this exact plan. Local plans have no planId and stay at /plan.
  const planOriginQuery = buildCourseOrigin({
    from: "plan",
    planId: planId ?? undefined,
  });

  return (
    <PlannerLayout
      isAuthed={isAuthed}
      planId={planId}
      // null suppresses the fallback PlanToolbar — the loaded branch handles its
      // own header inside the layout below so the audit panel aligns to the top.
      toolbar={null}
      overlays={
        <>
          {picker && pickerMeta ? (
            <SlotPicker
              targetTermLabel={pickerMeta.termLabel}
              catalog={catalog}
              placedCodes={pickerMeta.placedCodes}
              completedBefore={pickerMeta.completedBefore}
              level={pickerMeta.level}
              programs={programs}
              programReferenced={programReferenced}
              sameTerm={pickerMeta.sameTerm}
              focusCodes={picker.focusCodes}
              initialFilters={picker.initialFilters}
              detailsQuery={pickerMeta.detailsQuery}
              onPick={handlePickCode}
              onClose={closePicker}
            />
          ) : null}

          {termChoiceCourse ? (
            <TermChoiceModal
              course={termChoiceCourse}
              plan={plan}
              onPick={handlePickTermForCourse}
              onClose={() => setTermChoiceCode(null)}
            />
          ) : null}

          {settingsOpen ? (
            <PlanSettingsModal
              plan={plan}
              programOptions={programOptions}
              specializationsByProgram={specializationsByProgram}
              onClose={() => setSettingsOpen(false)}
              onSave={handleSaveSettings}
            />
          ) : null}

          {transcriptOpen ? (
            <TranscriptImportModal
              onClose={() => setTranscriptOpen(false)}
              onApplyPlan={handleApplyTranscript}
              catalogCodes={allCourseCodesSet}
            />
          ) : null}

          {auditSheetOpen ? (
            <BottomSheet
              onClose={() => setAuditSheetOpen(false)}
              titleId="audit-sheet-title"
              title="Degree audit"
            >
              <AuditPanel
                plan={deferredPlan ?? plan}
                catalog={catalog}
                onDrillToRequirement={(codes, preset) => {
                  handleDrillToRequirement(codes, preset);
                  setAuditSheetOpen(false);
                }}
                onAcknowledgeRequirement={handleAcknowledgeRequirement}
                drag={auditDrag}
              />
            </BottomSheet>
          ) : null}

          {/* Sticky audit trigger, phone only. Above the safe area so it clears
              the iOS home bar. */}
          <button
            type="button"
            onClick={() => setAuditSheetOpen(true)}
            className="lg:hidden fixed left-1/2 -translate-x-1/2 z-40 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] rounded-full bg-primary text-primary-ink px-4 py-2 text-xs font-medium shadow-card-lg hover:bg-primary-hover"
            aria-label="Open degree audit"
          >
            Audit
          </button>

          {handoffElement}
        </>
      }
    >
      <div
        aria-busy={reloading}
        className={`flex flex-col gap-3 lg:flex-1 lg:min-h-0 transition-opacity duration-200 ${reloading ? "opacity-60" : ""}`}
      >
        {/* Header, plan switcher, and banner span the full width above the
            timeline + audit row. */}
        <div className="flex items-center justify-between gap-3">
          <ProgramHeader
            programName={programName}
            planName={activePlanName}
            plan={plan}
          />
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="lg"
              className="inline-flex items-center gap-2"
              onClick={() => setTranscriptOpen(true)}
            >
              <Icon name="import" size="md" />
              Import transcript
            </Button>
          </div>
        </div>
        {isAuthed ? (
          <PlanToolbar
            isAuthed
            planId={planId}
            inline
            extraItems={[
              {
                key: "settings",
                label: "Plan settings",
                icon: <Icon name="settings" size="md" />,
                onSelect: () => setSettingsOpen(true),
              },
            ]}
          >
            {saveStatus ? (
              <SaveStatusBadge status={saveStatus} onRetry={handleRetrySave} />
            ) : null}
          </PlanToolbar>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line card-2 px-3 py-3 w-full min-w-0">
            <span
              className="text-sm font-medium truncate max-w-[16rem]"
              title={activePlanName}
            >
              {activePlanName}
            </span>
            {isLocalSource ? (
              <div className="ml-auto flex items-center gap-2">
                <ActionMenu
                  label="Edit plan"
                  icon={<Icon name="edit" size="sm" />}
                  items={[
                    {
                      key: "settings",
                      label: "Plan settings",
                      icon: <Icon name="settings" size="md" />,
                      onSelect: () => setSettingsOpen(true),
                    },
                    {
                      key: "reset",
                      label: "Reset plan",
                      icon: <Icon name="reset" size="md" />,
                      destructive: true,
                      onSelect: handleReset,
                    },
                  ]}
                />
              </div>
            ) : null}
          </div>
        )}
        {importBanner ? (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="flex items-start justify-between gap-3 rounded-[10px] border border-partial bg-partial-soft px-4 py-2.5 text-xs text-ink"
          >
            <span>{importBanner}</span>
            <button
              type="button"
              onClick={() => setImportBanner(null)}
              aria-label="Dismiss"
              className="text-ink-3 hover:text-ink"
            >
              <Icon name="close" size="sm" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {/* Timeline (vertically scrollable) + audit on the side. */}
        <div className="flex flex-col lg:flex-row gap-5 lg:flex-1 lg:min-h-0">
          <div className="flex-1 min-w-0 flex flex-col gap-3 lg:min-h-0">
            <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto [scrollbar-width:thin] pr-1">
              <Timeline
                plan={plan}
                issuesPerSlot={issuesPerSlot}
                onSlotClick={openPicker}
                onRemoveCourse={handleRemoveCourse}
                onCourseDrop={handleCourseDrop}
                onMoveDrag={handleMoveDrag}
                eligibleSlotIds={eligibleSlotIds}
                planOriginQuery={planOriginQuery}
              />
            </div>
          </div>
          {/* Audit on the side at lg+, hidden below — the bottom sheet
              replaces it on phone widths so the timeline gets full width. */}
          <div className="hidden lg:block lg:min-h-0">
            <AuditPanel
              plan={deferredPlan ?? plan}
              catalog={catalog}
              onDrillToRequirement={handleDrillToRequirement}
              onAcknowledgeRequirement={handleAcknowledgeRequirement}
              drag={auditDrag}
            />
          </div>
        </div>
      </div>
    </PlannerLayout>
  );
}

/**
 * Three-column shell wrapping every branch of PlannerShellInner. At lg+ the
 * PlanToolbar is a 240px left column, children fill the rest, and the Audit
 * column is the rightmost inspector inside children; below lg the sidebar
 * collapses to a top dropdown. Anon users get no sidebar (PlanToolbar returns
 * null). Overlays render outside the flex container so fixed modals aren't flex
 * items.
 */
function PlannerLayout({
  isAuthed,
  planId,
  children,
  toolbar,
  overlays,
}: {
  isAuthed: boolean;
  /** Current route plan id, forwarded to the fallback toolbar's switcher. */
  planId: string | null;
  children: React.ReactNode;
  /**
   * `undefined` → render the fallback standalone PlanToolbar above content
   * (EmptyState / load-error branches). `null` → render no toolbar slot at
   * all (the loaded-plan branch handles its own header inside `children`).
   * Anything else → render as the toolbar.
   */
  toolbar?: React.ReactNode;
  overlays?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-1 lg:min-h-0">
        {!isAuthed ? <DemoModeBanner /> : null}
        {toolbar === undefined ? (
          <PlanToolbar isAuthed={isAuthed} planId={planId} />
        ) : (
          toolbar
        )}
        <div className="flex flex-col gap-5 lg:flex-1 lg:min-h-0">
          {children}
        </div>
      </div>
      {overlays}
    </>
  );
}

export function planSubtitle(plan: LocalPlan): string {
  const stream =
    plan.stream === "stream4"
      ? "Stream 4 co-op"
      : plan.stream === "stream8"
        ? "Stream 8 co-op"
        : "Regular (no co-op)";
  const start = plan.startTermId
    ? (termInfo(plan.startTermId)?.label ?? `Term ${plan.startTermId}`)
    : "no start term";
  return `${stream} · ${start} · ${plan.slots.length} slots`;
}
