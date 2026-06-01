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
import { NEW_PLAN_NAME } from "@/lib/constants";
import type { Course } from "@/lib/courses/types";
import { completedSetFromPlan } from "@/lib/plan/derive";
import { applyCourseDrop, type CourseDragData } from "@/lib/plan/dnd";
import { addCourseToSlot, removeCourseFromSlot } from "@/lib/plan/mutateSlots";
import { rebuildSlotsForStream } from "@/lib/plan/sequence";
import { toSnapshot } from "@/lib/plan/server/serialize";
import { useAnonHandoff } from "@/lib/plan/sync/useAnonHandoff";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import { usePlanSync } from "@/lib/plan/sync/usePlanSync";
import { applyTranscriptToPlan } from "@/lib/plan/transcriptApply";
import type { LocalPlan, Stream } from "@/lib/plan/types";
import { issuesBySlot, validatePlan } from "@/lib/plan/validate";
import { programIdentity } from "@/lib/programs";
import { termInfo } from "@/lib/terms";
import type { TranscriptParseResult } from "@/lib/transcript/types";
import { ProgramHeader } from "./ProgramHeader";
import { usePlannerModals } from "./usePlannerModals";
import { usePlannerRedirect } from "./usePlannerRedirect";

export interface ProgramOption {
  id: string;
  name: string;
  kind: "engineering" | "flexible";
}

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

  // Latest plan, read by the edit handlers so they don't have to list `plan`
  // in their dep arrays — keeping the handlers referentially stable across
  // edits so the memoized timeline columns aren't invalidated every keystroke.
  const planRef = useRef(plan);
  planRef.current = plan;

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
  const [termChoiceCode, setTermChoiceCode] = useState<string | null>(null);
  // Guards the in-planner transcript import against the double-click
  // duplicate-plan bug — without it, a second click during the network
  // round-trip creates a second server plan.
  const [creating, setCreating] = useState(false);

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

  // Bridge for the in-planner transcript import: writes route to setPlan when
  // there's a current plan, or create+navigate when authed without a planId.
  const persistOrCreate = useCallback(
    async (next: LocalPlan, name: string = NEW_PLAN_NAME) => {
      if (isAuthed && planId === null) {
        const newId = await create(name, toSnapshot(next));
        if (newId) router.replace(`/plan?planId=${newId}`);
        return;
      }
      setPlan(next);
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
        await persistOrCreate(next, "Imported plan");
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
    [creating, persistOrCreate, setTranscriptOpen],
  );

  const handleReset = useCallback(() => {
    // Signed-out only — for signed-in users, the PlanSwitcher provides
    // per-plan delete, which is the equivalent action.
    clearLocalPlan();
    setPicker(null);
    setImportBanner(null);
  }, [clearLocalPlan, setPicker]);

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
    [plan, setPlan],
  );

  // Audit drill-in: the missing-requirement chip already names the course, so
  // the only thing left to choose is the term. Open the term picker for that
  // course rather than auto-appending it to the earliest term with room.
  const handleDrillToRequirement = useCallback((codes: string[]) => {
    const code = codes[0];
    if (!code) return;
    setTermChoiceCode(code);
  }, []);

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
    return { slot, completedBefore, placedCodes, termLabel, level, program };
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
              focusCodes={picker.focusCodes}
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
                onDrillToRequirement={(codes) => {
                  handleDrillToRequirement(codes);
                  setAuditSheetOpen(false);
                }}
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
                planOriginQuery={planOriginQuery}
              />
            </div>
          </div>
          {/* Audit on the side at lg+, hidden below — the bottom sheet
              replaces it on phone widths so the timeline gets full width. */}
          <div className="hidden lg:block lg:min-h-0">
            <AuditPanel
              plan={deferredPlan ?? plan}
              onDrillToRequirement={handleDrillToRequirement}
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
