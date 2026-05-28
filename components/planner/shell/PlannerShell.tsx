"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuditPanel } from "@/components/planner/audit/AuditPanel";
import { HandoffModal } from "@/components/planner/modals/HandoffModal";
import { PlanSettingsModal } from "@/components/planner/modals/PlanSettingsModal";
import { TranscriptImportModal } from "@/components/planner/modals/TranscriptImportModal";
import { SlotPicker } from "@/components/planner/picker/SlotPicker";
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
import { buildEmptySlots, rebuildSlotsForStream } from "@/lib/plan/sequence";
import { toSnapshot } from "@/lib/plan/server/serialize";
import { emptyPlan } from "@/lib/plan/storage";
import { useAnonHandoff } from "@/lib/plan/sync/useAnonHandoff";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import { usePlanSync } from "@/lib/plan/sync/usePlanSync";
import { applyTranscriptToPlan } from "@/lib/plan/transcriptApply";
import type { LocalPlan, Stream } from "@/lib/plan/types";
import { issuesBySlot, validatePlan } from "@/lib/plan/validate";
import { termInfo } from "@/lib/terms";
import type { TranscriptParseResult } from "@/lib/transcript/types";
import { EmptyState } from "./EmptyState";
import { ProgramHeader } from "./ProgramHeader";

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

interface PickerContext {
  slotId: string;
  focusCodes?: string[];
}

const NEW_PLAN_NAME = "Untitled plan";

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
      <div className="h-96 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 animate-pulse" />
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
  // `?new=1` lets the user reach the EmptyState (with manual setup +
  // transcript upload) even when they already have plans. Without it, the
  // sidebar's "+ New plan" button would have nowhere to land.
  const newRequested = searchParams.get("new") === "1";

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

  const [pickerCtx, setPickerCtx] = useState<PickerContext | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [auditSheetOpen, setAuditSheetOpen] = useState(false);
  const [importBanner, setImportBanner] = useState<string | null>(null);
  // Guards the EmptyState's create + transcript flows against the
  // double-click duplicate-plan bug — without it, a second click during the
  // network round-trip creates a second server plan.
  const [creating, setCreating] = useState(false);

  // Signed-in with no planId but at least one server plan: route to the most
  // recently updated one so the user lands on a real plan instead of the
  // empty state. listPlans returns `updated_at desc`. `?new=1` opts out so
  // the user can explicitly reach EmptyState from the "+ New plan" entry
  // point even when other plans exist.
  useEffect(() => {
    if (!isAuthed || planId !== null || newRequested) return;
    if (!plans || plans.length === 0) return;
    router.replace(`/plan?planId=${plans[0].id}`);
  }, [isAuthed, planId, newRequested, plans, router]);

  // After a successful create the URL still carries `?new=1`. Drop it when
  // we land on a planId so a future visit to /plan?planId=X behaves normally.
  // Done in a useEffect rather than during create itself so any code path
  // that ends up at a plan (handoff, auto-redirect, manual nav) sheds the
  // flag uniformly.
  useEffect(() => {
    if (planId !== null && newRequested) {
      router.replace(`/plan?planId=${planId}`);
    }
  }, [planId, newRequested, router]);

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

  // Bridge: writes route to setPlan when there's a current plan, or to
  // create+navigate when the user is authed without a planId (first server
  // plan after sign-in / empty server account / explicit "+ New plan" via
  // /plan?new=1).
  const persistOrCreate = useCallback(
    async (next: LocalPlan, name: string = NEW_PLAN_NAME) => {
      if (isAuthed && planId === null) {
        const newId = await create(name, toSnapshot(next));
        if (newId) router.replace(`/plan?planId=${newId}`);
        return;
      }
      setPlan(next);
      // Anon path: when the user just created via /plan?new=1, the URL still
      // carries that flag and the `newRequested` branch keeps EmptyState on
      // screen even though the local plan now exists. Strip the flag so the
      // loaded-plan branch wins on the next render. (The signed-in path
      // doesn't need this — `create` above replaces the URL wholesale.)
      if (!isAuthed && newRequested) {
        router.replace("/plan");
      }
    },
    [isAuthed, planId, newRequested, create, router, setPlan],
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
    [creating, persistOrCreate],
  );

  const handleCreatePlan = useCallback(
    async (params: {
      programId: string;
      startTermId: number;
      stream: Stream;
    }) => {
      if (creating) return;
      setCreating(true);
      try {
        const slots = buildEmptySlots(params.startTermId, params.stream, () =>
          crypto.randomUUID(),
        );
        const next: LocalPlan = {
          ...emptyPlan(),
          programId: params.programId,
          stream: params.stream,
          startTermId: params.startTermId,
          slots,
        };
        await persistOrCreate(next);
      } finally {
        setCreating(false);
      }
    },
    [creating, persistOrCreate],
  );

  const handleReset = useCallback(() => {
    // Signed-out only — for signed-in users, the PlanSwitcher provides
    // per-plan delete, which is the equivalent action.
    clearLocalPlan();
    setPickerCtx(null);
    setImportBanner(null);
  }, [clearLocalPlan]);

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

  const handleOpenPicker = useCallback((slotId: string) => {
    setPickerCtx({ slotId });
  }, []);

  const handleClosePicker = useCallback(() => setPickerCtx(null), []);

  const handlePickCode = useCallback(
    (code: string) => {
      if (!plan || !pickerCtx) return;
      const lc = code.toLowerCase();
      const nextSlots = plan.slots.map((s) =>
        s.id === pickerCtx.slotId && !s.courses.some((c) => c.code === lc)
          ? { ...s, courses: [...s.courses, { code: lc }] }
          : s,
      );
      setPlan({ ...plan, slots: nextSlots });
      setPickerCtx(null);
    },
    [plan, pickerCtx, setPlan],
  );

  const handleRemoveCourse = useCallback(
    (slotId: string, code: string) => {
      if (!plan) return;
      const nextSlots = plan.slots.map((s) =>
        s.id === slotId
          ? {
              ...s,
              courses: s.courses.filter((c) => c.code !== code.toLowerCase()),
            }
          : s,
      );
      setPlan({ ...plan, slots: nextSlots });
    },
    [plan, setPlan],
  );

  const handleRetrySave = useCallback(() => {
    void flushSave();
  }, [flushSave]);

  const pickerMeta = useMemo(() => {
    if (!plan || !pickerCtx) return null;
    const slot = plan.slots.find((s) => s.id === pickerCtx.slotId);
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
    return { slot, completedBefore, placedCodes, termLabel };
  }, [plan, pickerCtx]);

  // Rendered alongside every branch below: the handoff modal can appear over
  // the loading skeleton, the not-found banner, the empty state, or the
  // populated planner — whichever branch happens to be live when the user
  // signs in.
  const handoffElement = conflict ? (
    <HandoffModal localPlan={conflict.localPlan} onResolve={resolveConflict} />
  ) : null;

  // `?new=1` overrides everything: the user explicitly asked for the create
  // flow. Skip the plan load + not-found branches entirely so they see
  // EmptyState immediately, even if a planId is also present (which can
  // happen if they hit "+ New plan" while on a loaded plan).
  if (newRequested) {
    return (
      <PlannerLayout
        isAuthed={isAuthed}
        overlays={
          <>
            {transcriptOpen ? (
              <TranscriptImportModal
                onClose={() => setTranscriptOpen(false)}
                onApplyPlan={handleApplyTranscript}
                catalogCodes={allCourseCodesSet}
              />
            ) : null}
            {handoffElement}
          </>
        }
      >
        <EmptyState
          programOptions={programOptions}
          onCreate={handleCreatePlan}
          onUploadTranscript={() => setTranscriptOpen(true)}
          busy={creating}
        />
      </PlannerLayout>
    );
  }

  if (!hydrated && !plan) {
    return (
      <PlannerLayout
        isAuthed={isAuthed}
        toolbar={null}
        overlays={handoffElement}
      >
        <div className="h-96 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 animate-pulse" />
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
        <div className="rounded-lg border border-rose-300 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 px-4 py-6 text-sm text-rose-900 dark:text-rose-200">
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
        <div className="rounded-lg border border-amber-300 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 px-4 py-6 text-sm text-amber-900 dark:text-amber-200">
          <p>
            We couldn't find a plan with that id. Pick a different plan from the
            toolbar, or create a new one.
          </p>
        </div>
      </PlannerLayout>
    );
  }

  if (!plan) {
    return (
      <PlannerLayout
        isAuthed={isAuthed}
        overlays={
          <>
            {transcriptOpen ? (
              <TranscriptImportModal
                onClose={() => setTranscriptOpen(false)}
                onApplyPlan={handleApplyTranscript}
                catalogCodes={allCourseCodesSet}
              />
            ) : null}
            {handoffElement}
          </>
        }
      >
        <EmptyState
          programOptions={programOptions}
          onCreate={handleCreatePlan}
          onUploadTranscript={() => setTranscriptOpen(true)}
          busy={creating}
        />
      </PlannerLayout>
    );
  }

  const programName =
    programOptions.find((p) => p.id === plan.programId)?.name ?? "—";

  return (
    <PlannerLayout
      isAuthed={isAuthed}
      // null suppresses the fallback PlanToolbar — the loaded branch
      // handles its own header/controls inside the two-column layout below
      // so the audit panel can align with the very top of the page.
      toolbar={null}
      overlays={
        <>
          {pickerCtx && pickerMeta ? (
            <SlotPicker
              targetTermLabel={pickerMeta.termLabel}
              catalog={catalog}
              placedCodes={pickerMeta.placedCodes}
              completedBefore={pickerMeta.completedBefore}
              focusCodes={pickerCtx.focusCodes}
              onPick={handlePickCode}
              onClose={handleClosePicker}
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
              <AuditPanel plan={plan} />
            </BottomSheet>
          ) : null}

          {/* Sticky audit trigger — phone widths only. Sits above the
              keyboard/safe area so it doesn't collide with iOS home bar. */}
          <button
            type="button"
            onClick={() => setAuditSheetOpen(true)}
            className="lg:hidden fixed left-1/2 -translate-x-1/2 z-40 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] rounded-full bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-2 text-xs font-medium shadow-lg hover:bg-zinc-800 dark:hover:bg-zinc-200"
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
        className={`flex flex-col lg:flex-row gap-5 lg:flex-1 lg:min-h-0 transition-opacity duration-200 ${reloading ? "opacity-60" : ""}`}
      >
        <div className="flex-1 min-w-0 flex flex-col gap-4 lg:min-h-0">
          <div className="flex items-center justify-between gap-3">
            <ProgramHeader programName={programName} plan={plan} />
            <div className="flex items-center gap-2 shrink-0 mr-4">
              <Button
                variant="secondary"
                size="lg"
                className="inline-flex items-center gap-2"
                onClick={() => setTranscriptOpen(true)}
              >
                <Icon name="import" size="md" />
                Import transcript
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setSettingsOpen(true)}
                aria-label="Plan settings"
                title="Plan settings"
                className="px-2.5! aspect-square inline-flex items-center justify-center"
              >
                <Icon name="settings" size="md" />
              </Button>
            </div>
          </div>
          {isAuthed ? (
            <PlanToolbar isAuthed inline>
              {saveStatus ? (
                <SaveStatusBadge
                  status={saveStatus}
                  onRetry={handleRetrySave}
                />
              ) : null}
            </PlanToolbar>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 px-3 py-3 w-full min-w-0">
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
                        key: "reset",
                        label: "Reset plan",
                        icon: "↺",
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
              className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200"
            >
              <span>{importBanner}</span>
              <button
                type="button"
                onClick={() => setImportBanner(null)}
                aria-label="Dismiss"
                className="text-amber-700/70 dark:text-amber-300/70 hover:text-amber-900 dark:hover:text-amber-100"
              >
                <Icon name="close" size="sm" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <Timeline
            plan={plan}
            issuesPerSlot={issuesPerSlot}
            onSlotClick={handleOpenPicker}
            onRemoveCourse={handleRemoveCourse}
          />
        </div>
        {/* Inline at lg+, hidden below — the bottom sheet replaces it on
            phone widths so the timeline gets full vertical real estate.
            Lives outside the left column so it aligns with the header at
            the very top of the page, not below the controls row. */}
        <div className="hidden lg:block lg:min-h-0">
          <AuditPanel plan={plan} />
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
