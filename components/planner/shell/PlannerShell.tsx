"use client";

import { useRouter, useSearchParams } from "next/navigation";
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
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icon";
import { useAuthState } from "@/lib/auth/store";
import type { Course } from "@/lib/courses/types";
import { completedSetFromPlan } from "@/lib/plan/derive";
import { eligibleSlotIdsForCourse } from "@/lib/plan/eligibleTerms";
import { useAnonHandoff } from "@/lib/plan/sync/useAnonHandoff";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import { usePlanSync } from "@/lib/plan/sync/usePlanSync";
import type { LocalPlan } from "@/lib/plan/types";
import { issuesBySlot, validatePlan } from "@/lib/plan/validate";
import {
  type ProgramOption,
  programIdentity,
  programReferencedCodes,
} from "@/lib/programs";
import { termInfo } from "@/lib/terms";
import { ProgramHeader } from "./ProgramHeader";
import { usePlanEditors } from "./usePlanEditors";
import { usePlannerModals } from "./usePlannerModals";
import { usePlannerRedirect } from "./usePlannerRedirect";

export type { ProgramOption };

interface Props {
  programOptions: ProgramOption[];
  specializationsByProgram: Record<
    string,
    Array<{ slug: string; name: string }>
  >;
  catalog: Course[];
}

/**
 * Client root for the planner. Branches on auth state: signed-out plans
 * live in localStorage (via usePlanSync's local path); signed-in plans
 * live on Supabase and are keyed by the `?planId=uuid` URL param. The
 * mutation surface (slot picker, transcript import, settings) is identical
 * across both modes — usePlanSync routes the writes.
 *
 * Mounting the inner shell is gated on `ready` from the shared auth store.
 * Without that gate, a returning signed-in user briefly renders the anon
 * branch (and any stale localStorage plan) before the `getUser()` round-trip
 * flips `isAuthed` true and triggers the server load — a visible flicker on
 * every page load. Showing a single skeleton until the auth state resolves
 * makes the loaded-plan branch the first render the user sees.
 */
export function PlannerShell(props: Props) {
  const { isAuthed, ready } = useAuthState();
  if (!ready) {
    return (
      <div className="h-96 rounded-[14px] border border-dashed border-line-2 bg-bg-2 animate-pulse" />
    );
  }
  return <PlannerShellInner {...props} isAuthed={isAuthed} />;
}

interface InnerProps extends Props {
  isAuthed: boolean;
}

function PlannerShellInner({
  programOptions,
  specializationsByProgram,
  catalog,
  isAuthed,
}: InnerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = searchParams.get("planId");

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
      router.replace(`/plan?planId=${newPlanId}`);
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

  // /plan resolves to either the planner or the create flow when there's no
  // ?planId — see usePlannerRedirect. Plan creation lives at /plan/new, so
  // there's no inline empty state here.
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
  // non-interactive, so feed it a deferred copy of the plan: the timeline (the
  // surface the user is actually editing) updates synchronously while React
  // recomputes the audit in a lower-priority pass, keeping edits snappy.
  const deferredPlan = useDeferredValue(plan);

  // Code of the audit chip being dragged, so the timeline can tint its eligible
  // terms. Owned here (not a context) since the eligibility math already needs
  // the shell's plan/catalog/program.
  const [draggingAddCode, setDraggingAddCode] = useState<string | null>(null);
  // A successful drop can unmount the source chip before its `dragend` fires,
  // leaving the flag stale and the timeline stuck highlighted. A drop always
  // yields a new `plan` ref, so clear the flag on any plan change (the same
  // render-phase reset SlotBody uses for in-flight "move" chips).
  const planRef = useRef(plan);
  if (planRef.current !== plan) {
    planRef.current = plan;
    if (draggingAddCode !== null) setDraggingAddCode(null);
  }
  const handleAddDragStart = useCallback(
    (code: string) => setDraggingAddCode(code),
    [],
  );
  const handleAddDragEnd = useCallback(() => setDraggingAddCode(null), []);
  // Codes the program references, so a stale restriction can't grey out a
  // course the program requires. Shared by the drag highlight and the picker.
  const programReferenced = useMemo(
    () => programReferencedCodes(plan?.programId, plan?.specializationId),
    [plan?.programId, plan?.specializationId],
  );
  // Eligible terms for the dragged course, from the synchronous `plan` (the drop
  // surface), not `deferredPlan`. Null when idle so the timeline skips the work.
  const eligibleSlotIds = useMemo(
    () =>
      draggingAddCode && plan
        ? eligibleSlotIdsForCourse(
            plan,
            draggingAddCode,
            catalogByCode,
            programIdentity(plan.programId, plan.specializationId) ?? undefined,
            programReferenced,
          )
        : null,
    [draggingAddCode, plan, catalogByCode, programReferenced],
  );
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
    const level =
      !slot.isCoop && slot.position !== "pre" ? slot.position : undefined;
    // The plan's program lets the picker resolve program-restriction prereqs.
    const program =
      programIdentity(plan.programId, plan.specializationId) ?? undefined;
    // Codes already in the target slot, so coreqs can resolve same-term.
    const sameTerm = new Set(slot.courses.map((c) => c.code));
    return {
      slot,
      completedBefore,
      placedCodes,
      termLabel,
      level,
      program,
      sameTerm,
    };
  }, [plan, picker]);

  const termChoiceCourse = termChoiceCode
    ? (catalogByCode.get(termChoiceCode) ?? null)
    : null;

  // Rendered alongside every branch below: the handoff modal can appear over
  // the loading skeleton, the not-found banner, the empty state, or the
  // populated planner — whichever branch happens to be live when the user
  // signs in.
  const handoffElement = conflict ? (
    <HandoffModal localPlan={conflict.localPlan} onResolve={resolveConflict} />
  ) : null;

  if (!hydrated && !plan) {
    return (
      <PlannerLayout
        isAuthed={isAuthed}
        toolbar={null}
        overlays={handoffElement}
      >
        <div className="h-96 rounded-[14px] border border-dashed border-line-2 bg-bg-2 animate-pulse" />
      </PlannerLayout>
    );
  }

  const isLocalSource = source === "local";
  // Signed-in with a planId that finished loading but produced no plan. Two
  // distinct outcomes both end up here:
  //   - loadError === null → server returned ok with no row: genuinely
  //     missing (deleted, never theirs, bad URL). Show the not-found note.
  //   - loadError !== null → network/auth/DB failure. Show a retryable
  //     error banner; don't gaslight the user about their plan being gone.
  const onServerPath =
    isAuthed && planId !== null && plan === null && typeof source !== "string";
  const planNotFound = onServerPath && loadError === null;
  const planLoadFailed = onServerPath && loadError !== null;

  if (planLoadFailed) {
    return (
      <PlannerLayout isAuthed={isAuthed} overlays={handoffElement}>
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
      <PlannerLayout isAuthed={isAuthed} overlays={handoffElement}>
        <div className="rounded-[10px] border border-partial bg-partial-soft px-4 py-6 text-sm text-ink">
          <p>
            We couldn't find a plan with that id. Pick a different plan from the
            toolbar, or create a new one.
          </p>
        </div>
      </PlannerLayout>
    );
  }

  // No plan to show: the redirect effect above is navigating — to /plan/new
  // (no plan yet) or to the most recent plan (signed in, no planId). Render a
  // skeleton meanwhile so the planner never flashes an empty state.
  if (!plan) {
    return (
      <PlannerLayout isAuthed={isAuthed} overlays={handoffElement}>
        <div className="h-96 rounded-[14px] border border-dashed border-line-2 bg-bg-2 animate-pulse" />
      </PlannerLayout>
    );
  }

  const programName =
    programOptions.find((p) => p.id === plan.programId)?.name ?? "—";

  // Tag the timeline's course links as plan-originated so the detail page hides
  // its (here redundant) "Add to plan" button — the course is already in view —
  // and carry the plan id so "Back to planner" returns to this exact plan (not
  // a generic /plan). Signed-out local plans have no planId and stay at /plan.
  const planOriginQuery = planId
    ? `?from=plan&planId=${encodeURIComponent(planId)}`
    : "?from=plan";

  return (
    <PlannerLayout
      isAuthed={isAuthed}
      // null suppresses the fallback PlanToolbar — the loaded branch
      // handles its own header/controls inside the two-column layout below
      // so the audit panel can align with the very top of the page.
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
              program={pickerMeta.program}
              programReferenced={programReferenced}
              sameTerm={pickerMeta.sameTerm}
              focusCodes={picker.focusCodes}
              initialFilters={picker.initialFilters}
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
                onDrillToRequirement={(codes) => {
                  handleDrillToRequirement(codes);
                  setAuditSheetOpen(false);
                }}
                drag={auditDrag}
              />
            </BottomSheet>
          ) : null}

          {/* Sticky audit trigger — phone widths only. Sits above the
              keyboard/safe area so it doesn't collide with iOS home bar. */}
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
                <DropdownMenu
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
 * PlanToolbar sits as a 240px column at left and the branch's children fill
 * the rest, with the Audit column rendered as the rightmost inspector inside
 * the children. Below lg the sidebar collapses to a top dropdown and the
 * columns stack. Anon users get no sidebar at all (PlanToolbar returns null
 * when isAuthed is false). The optional `toolbar` sits sticky above the row
 * — populated only by the loaded-plan branch. Overlays render outside the
 * flex container so fixed-position modals don't become flex items.
 */
function PlannerLayout({
  isAuthed,
  children,
  toolbar,
  overlays,
}: {
  isAuthed: boolean;
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
        {toolbar === undefined ? <PlanToolbar isAuthed={isAuthed} /> : toolbar}
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
