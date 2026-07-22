"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { AuditPanel } from "@/components/planner/audit/AuditPanel";
import { DemoModeBanner } from "@/components/planner/DemoModeBanner";
import { HandoffModal } from "@/components/planner/modals/HandoffModal";
import { PlanSettingsModal } from "@/components/planner/modals/PlanSettingsModal";
import { TranscriptImportModal } from "@/components/planner/modals/TranscriptImportModal";
import { SlotPicker } from "@/components/planner/picker/SlotPicker";
import { TermChoiceModal } from "@/components/planner/picker/TermChoiceModal";
import { Timeline } from "@/components/planner/timeline/Timeline";
import {
  INLINE_BAR_CLASS,
  PlanToolbar,
} from "@/components/planner/toolbar/PlanToolbar";
import { SaveStatusBadge } from "@/components/planner/toolbar/SaveStatusBadge";
import { PlannerSkeleton } from "@/components/states/PlannerSkeleton";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useAuthState } from "@/lib/auth/store";
import type { Course } from "@/lib/courses/types";
import { describeActionError } from "@/lib/format";
import { buildCourseOrigin } from "@/lib/plan/courseOrigin";
import { completedSetFromPlan, isAcademicSlot } from "@/lib/plan/derive";
import { useAnonHandoff } from "@/lib/plan/sync/useAnonHandoff";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import { usePlanSync } from "@/lib/plan/sync/usePlanSync";
import type { LocalPlan } from "@/lib/plan/types";
import { usePlanValidation } from "@/lib/plan/usePlanValidation";
import { joinProgramNames, type ProgramOption } from "@/lib/programs";
import { usePlanProgramContext } from "@/lib/programs/usePlanPrograms";
import { termLabel } from "@/lib/terms";
import { ProgramHeader } from "./ProgramHeader";
import { useDragEligibility } from "./useDragEligibility";
import { usePlanEditors } from "./usePlanEditors";
import { type PickerContext, usePlannerModals } from "./usePlannerModals";
import { usePlannerRedirect } from "./usePlannerRedirect";

interface Props {
  /** Active plan id from the `/plan/[planId]` route param; null at bare `/plan`. */
  planId: string | null;
  /** Server-loaded plan for the signed-in path; null when signed-out or missing. */
  initialPlan: LocalPlan | null;
  /**
   * Error from the server-side plan load, so a transient failure reads as
   * retryable rather than "deleted". Null when the load succeeded or the row was
   * genuinely absent (that's the not-found case).
   */
  initialLoadError: string | null;
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
 * Mounted behind the page's AuthGate, so `isAuthed` is resolved here — an
 * ungated mount would flash the anon branch (and stale local plan) for
 * returning users.
 */
export function PlannerShell({
  planId,
  initialPlan,
  initialLoadError,
  programOptions,
  specializationsByProgram,
  catalog,
}: Props) {
  const { isAuthed } = useAuthState();
  const router = useRouter();

  const { plan, hydrated, saveStatus, setPlan, clearLocalPlan, flushSave } =
    usePlanSync({ isAuthed, planId, initialPlan });
  const { plans, create, loadError: listLoadError } = usePlanList(isAuthed);
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
  const { catalogByCode, issues, issuesPerSlot } = usePlanValidation(
    plan,
    catalog,
  );

  // The audit recompiles the full rule tree per plan change, so it gets a
  // deferred plan (timeline stays synchronous). Issues defer alongside —
  // they're audit-memo deps, so live ones would drag the recompile back
  // onto the urgent render.
  const deferredPlan = useDeferredValue(plan);
  const deferredIssues = useDeferredValue(issues);

  // Program identities (small index) + the codes each program references
  // (on-demand detail), unioned across a double degree. Referenced codes keep a
  // stale restriction from greying out a required course. Feed the drag
  // highlight and the slot picker.
  const { programs, programReferenced } = usePlanProgramContext(plan);
  const { eligibleSlotIds, auditDrag, handleMoveDrag } = useDragEligibility({
    plan,
    catalogByCode,
    programs,
    programReferenced,
  });

  const pickerMeta = useMemo(
    () => buildPickerMeta(plan, picker, planId),
    [plan, picker, planId],
  );

  const termChoiceCourse = termChoiceCode
    ? (catalogByCode.get(termChoiceCode) ?? null)
    : null;

  // Rendered alongside every branch below, so the handoff modal can appear over
  // whichever branch is live when the user signs in.
  const handoffElement = conflict ? (
    <HandoffModal localPlan={conflict.localPlan} onResolve={resolveConflict} />
  ) : null;

  // Pre-hydration: no plan yet (signed-out, before the localStorage read), so
  // suppress the fallback toolbar too.
  if (!hydrated && !plan) {
    return (
      <PlannerLoadState
        kind="initial"
        isAuthed={isAuthed}
        planId={planId}
        handoffElement={handoffElement}
      />
    );
  }

  // Signed-in with a planId but no plan (initialPlan came back null). A load
  // error is transient and retryable; a clean null is a genuinely missing row.
  // Both keep the toolbar so the user can switch to another plan.
  if (isAuthed && planId !== null && plan === null) {
    return (
      <PlannerLoadState
        kind={initialLoadError ? "error" : "notFound"}
        isAuthed={isAuthed}
        planId={planId}
        loadError={initialLoadError}
        handoffElement={handoffElement}
      />
    );
  }
  // The redirect effect above is navigating (to /plan/new or the most recent
  // plan); skeleton so the planner never flashes empty.
  if (!plan) {
    // At bare /plan a list-load failure can't resolve a redirect target, so show
    // the error rather than a skeleton that would never resolve.
    if (planId === null && listLoadError) {
      return (
        <PlannerLoadState
          kind="error"
          isAuthed={isAuthed}
          planId={planId}
          loadError={listLoadError}
          handoffElement={handoffElement}
        />
      );
    }
    return (
      <PlannerLoadState
        kind="redirecting"
        isAuthed={isAuthed}
        planId={planId}
        handoffElement={handoffElement}
      />
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
              targetTermLabel={pickerMeta.targetTermLabel}
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
              {/* plan and issues must fall back to live together (same commit). */}
              <AuditPanel
                plan={deferredPlan ?? plan}
                catalogByCode={catalogByCode}
                issues={deferredPlan ? deferredIssues : issues}
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
      <div className="flex flex-col gap-3 lg:flex-1 lg:min-h-0">
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
          <div className={INLINE_BAR_CLASS}>
            <span
              className="text-sm font-medium truncate max-w-[16rem]"
              title={activePlanName}
            >
              {activePlanName}
            </span>
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
              catalogByCode={catalogByCode}
              issues={deferredPlan ? deferredIssues : issues}
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
 * Three-column shell wrapping every branch of PlannerShell. At lg+ the
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

type LoadStateKind = "initial" | "error" | "notFound" | "redirecting";

/**
 * The planner's non-loaded states — loading skeleton, load error, missing plan
 * — each wrapping PlannerLayout so the handoff modal still shows. `initial` has
 * no plan yet, so it drops the fallback toolbar; the rest keep it so the user
 * can switch plans to recover.
 */
function PlannerLoadState({
  kind,
  isAuthed,
  planId,
  loadError,
  handoffElement,
}: {
  kind: LoadStateKind;
  isAuthed: boolean;
  planId: string | null;
  /** Only the list-load-failure ("error") state carries a message. */
  loadError?: string | null;
  handoffElement: React.ReactNode;
}) {
  const body =
    kind === "error" ? (
      <div className="rounded-[10px] border border-danger bg-danger-soft px-4 py-6 text-sm text-danger">
        <p className="font-medium">We couldn't load this plan.</p>
        {loadError ? (
          <p className="mt-1 text-xs opacity-80">
            {describeActionError(loadError)}
          </p>
        ) : null}
        <p className="mt-2 text-xs opacity-80">
          Reload the page or pick a different plan from the toolbar.
        </p>
      </div>
    ) : kind === "notFound" ? (
      <div className="rounded-[10px] border border-partial bg-partial-soft px-4 py-6 text-sm text-ink">
        <p>
          We couldn't load that plan — it may have been deleted. Pick a
          different plan from the toolbar, or create a new one.
        </p>
      </div>
    ) : (
      <PlannerSkeleton />
    );
  return (
    <PlannerLayout
      isAuthed={isAuthed}
      planId={planId}
      toolbar={kind === "initial" ? null : undefined}
      overlays={handoffElement}
    >
      {body}
    </PlannerLayout>
  );
}

/**
 * Target-slot inputs for the SlotPicker overlay, derived from the clicked slot.
 * `targetTermLabel` uses the shared lib/terms helper, not a local shadow.
 */
function buildPickerMeta(
  plan: LocalPlan | null,
  picker: PickerContext | null,
  planId: string | null,
) {
  if (!plan || !picker) return null;
  const slot = plan.slots.find((s) => s.id === picker.slotId);
  if (!slot) return null;
  const completedBefore =
    slot.termId !== null
      ? completedSetFromPlan(plan, slot.termId)
      : // Pre-arrival is the earliest slot — nothing precedes it, so no prereqs
        // count as met (all-completed would falsely satisfy them).
        new Set<string>();
  const placedCodes = new Set(
    plan.slots.flatMap((s) => s.courses.map((c) => c.code)),
  );
  const targetTermLabel =
    slot.termId !== null ? termLabel(slot.termId) : "Pre-arrival";
  // Slot position = the student's level this term ("1A".."4B") for level-gated
  // prereqs. Pre/co-op slots have no level.
  const level = isAcademicSlot(slot) ? slot.position : undefined;
  // Codes already in the target slot, so coreqs resolve same-term.
  const sameTerm = new Set(slot.courses.map((c) => c.code));
  // from=picker context for each row's Details link → one-click "Add to {term}".
  const detailsQuery = buildCourseOrigin({
    from: "picker",
    planId: planId ?? undefined,
    term: slot.termId ?? undefined,
  });
  return {
    slot,
    completedBefore,
    placedCodes,
    targetTermLabel,
    level,
    sameTerm,
    detailsQuery,
  };
}
