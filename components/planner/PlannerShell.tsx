"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { completedSetFromPlan } from "@/lib/plan/derive";
import { buildEmptySlots } from "@/lib/plan/sequence";
import { clearPlan, emptyPlan, loadPlan, savePlan } from "@/lib/plan/storage";
import { applyTranscriptToPlan } from "@/lib/plan/transcriptApply";
import type { LocalPlan, Stream } from "@/lib/plan/types";
import { issuesBySlot, validatePlan } from "@/lib/plan/validate";
import { termInfo } from "@/lib/terms";
import type { TranscriptParseResult } from "@/lib/transcript/types";
import type { Course } from "@/lib/types";
import { AuditPanel } from "./AuditPanel";
import { EmptyState } from "./EmptyState";
import { PlanSettings } from "./PlanSettings";
import { SlotPicker } from "./SlotPicker";
import { Timeline } from "./Timeline";
import { TranscriptImportModal } from "./TranscriptImportModal";

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

/**
 * Client root for the planner. Owns the in-memory plan state, hydrates from
 * localStorage on mount, persists on every mutation, and routes slot-picker
 * open/close through a single shared modal.
 */
export function PlannerShell({
  programOptions,
  specializationsByProgram,
  catalog,
}: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [plan, setPlan] = useState<LocalPlan | null>(null);
  const [pickerCtx, setPickerCtx] = useState<PickerContext | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importBanner, setImportBanner] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    setPlan(loadPlan());
    setHydrated(true);
  }, []);

  // Auto-dismiss the storage-failure banner after a short read; the user
  // shouldn't have to chase down a × button to clear it. We re-arm on every
  // new failure so consecutive failed saves keep the banner visible.
  useEffect(() => {
    if (!saveFailed) return;
    const t = setTimeout(() => setSaveFailed(false), 8000);
    return () => clearTimeout(t);
  }, [saveFailed]);

  // Catalog-derived lookups. Memoized on `catalog` identity so we don't
  // rebuild the Set/Map every render; the transcript modal now consumes the
  // Set directly instead of rebuilding it internally on every parse.
  const allCourseCodesSet = useMemo(
    () => new Set(catalog.map((c) => c.code)),
    [catalog],
  );
  const catalogByCode = useMemo(
    () => new Map(catalog.map((c) => [c.code, c])),
    [catalog],
  );

  // Run validation whenever the plan changes. Issues are grouped by slotId
  // so the timeline can render badges per-slot without scanning the full list.
  const issues = useMemo(
    () => (plan ? validatePlan(plan, catalogByCode) : []),
    [plan, catalogByCode],
  );
  const issuesPerSlot = useMemo(() => issuesBySlot(issues), [issues]);

  // Centralized persist: every plan-write goes through here so a storage
  // failure (quota, private mode) flips the saveFailed banner exactly once.
  // Note: setPlan still runs even on failure — the in-memory state is the
  // source of truth, the banner just tells the user a refresh will lose it.
  const persist = useCallback((next: LocalPlan) => {
    const ok = savePlan(next);
    setPlan(next);
    setSaveFailed(!ok);
  }, []);

  const handleApplyTranscript = useCallback(
    (parseResult: TranscriptParseResult, included: ReadonlySet<string>) => {
      // Co-op detected → default to stream 8 (most common at UW for the
      // programs that surface "Co-operative Program" in the Plan line).
      // The user can reset and re-import if their actual stream is 4.
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
      persist(next);
      setTranscriptOpen(false);

      const banner = buildImportBanner({
        stream,
        unsortedCodes,
        unplacedTerms,
        startTermId: next.startTermId,
      });
      setImportBanner(banner);
    },
    [persist],
  );

  const handleCreatePlan = useCallback(
    (params: { programId: string; startTermId: number; stream: Stream }) => {
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
      persist(next);
    },
    [persist],
  );

  const handleReset = useCallback(() => {
    clearPlan();
    setPlan(null);
    setPickerCtx(null);
    setImportBanner(null);
    setSaveFailed(false);
  }, []);

  const handleSaveSettings = useCallback(
    (next: { programId: string | null; specializationId: string | null }) => {
      if (!plan) return;
      persist({
        ...plan,
        programId: next.programId,
        specializationId: next.specializationId,
      });
    },
    [plan, persist],
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
      persist({ ...plan, slots: nextSlots });
      setPickerCtx(null);
    },
    [plan, pickerCtx, persist],
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
      persist({ ...plan, slots: nextSlots });
    },
    [plan, persist],
  );

  // Derive: completed set BEFORE the target slot, used for prereq evaluation
  // inside the picker, and metadata about the target slot's term.
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

  // Hold the layout stable across SSR/hydration to avoid a flash of empty
  // state for returning users.
  if (!hydrated) {
    return (
      <div className="h-96 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 animate-pulse" />
    );
  }

  if (!plan) {
    return (
      <>
        {saveFailed ? <SaveFailedBanner /> : null}
        <EmptyState
          programOptions={programOptions}
          onCreate={handleCreatePlan}
          onUploadTranscript={() => setTranscriptOpen(true)}
        />
        <TranscriptImportModal
          isOpen={transcriptOpen}
          onClose={() => setTranscriptOpen(false)}
          onApplyPlan={handleApplyTranscript}
          catalogCodes={allCourseCodesSet}
        />
      </>
    );
  }

  const programName =
    programOptions.find((p) => p.id === plan.programId)?.name ?? "—";

  return (
    <div className="flex flex-col gap-5">
      {saveFailed ? <SaveFailedBanner /> : null}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Current plan
          </span>
          <span className="font-medium truncate">{programName}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {planSubtitle(plan)}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 underline-offset-4 hover:underline"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400 underline-offset-4 hover:underline"
          >
            Reset plan
          </button>
        </div>
      </div>

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
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}

      <div className="flex flex-col lg:flex-row gap-5">
        <div className="flex-1 min-w-0">
          <Timeline
            plan={plan}
            issuesPerSlot={issuesPerSlot}
            onSlotClick={handleOpenPicker}
            onRemoveCourse={handleRemoveCourse}
          />
        </div>
        <AuditPanel plan={plan} />
      </div>

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
        <PlanSettings
          plan={plan}
          programOptions={programOptions}
          specializationsByProgram={specializationsByProgram}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      ) : null}
    </div>
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

function SaveFailedBanner() {
  return (
    <div
      role="status"
      className="rounded-lg border border-rose-300 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-rose-900 dark:text-rose-200"
    >
      Could not save your plan — your browser storage may be full or blocked.
      Recent changes are not persisted.
    </div>
  );
}

function planSubtitle(plan: LocalPlan): string {
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
