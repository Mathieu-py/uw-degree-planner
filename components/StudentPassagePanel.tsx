"use client";

import { useEffect, useState } from "react";
import { enumerateChoiceGroups } from "@/lib/choiceGroups";
import {
  loadExtras,
  rebaseCompletedCourses,
  saveExtras,
  savePrimarySource,
} from "@/lib/completedCourses";
import {
  DEFAULT_STUDENT_PASSAGE,
  decodeStudentPassage,
  mergeStudentPassageIntoParams,
} from "@/lib/filterState";
import { isTermLetter, PROGRAMS } from "@/lib/programs";
import { safeGetItem, safeSetItem } from "@/lib/storage";
import { applyTranscriptToStudentPassage } from "@/lib/transcript/applyHelpers";
import type { StudentPassage } from "@/lib/types";
import { CompletedCoursesInput } from "./filter/CompletedCoursesInput";
import { Section } from "./filter/Section";
import {
  SetupModal,
  type SetupModalApplyPayload,
} from "./filter/SetupModal";
import {
  TranscriptImportModal,
  type TranscriptImportPayload,
} from "./filter/TranscriptImportModal";
import { useFilterCommit } from "./filter/useFilterCommit";

interface Props {
  passage: StudentPassage;
  completedCourses: string[];
  onCompletedChange: (next: string[]) => void;
  allCourseCodes: string[];
}

const SORTED_PROGRAMS = Object.entries(PROGRAMS).sort(([, a], [, b]) =>
  a.name.localeCompare(b.name),
);

const SELECT_CLASS =
  "w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs";

const GET_STARTED_DISMISSED_KEY = "uwfinder.getStartedDismissed";

/**
 * True if the program has any choice group with more matches in
 * `completedCourses` than its `selectMax` permits — i.e. the student
 * picked-1 group has two satisfiers and the picker can't infer which
 * one counts toward the requirement. Used to decide whether to nudge
 * the user into the setup modal after a transcript apply.
 */
function hasOverSatisfiedGroup(
  programId: string,
  completedCourses: string[],
): boolean {
  const program = PROGRAMS[programId];
  if (!program) return false;
  const completedSet = new Set(completedCourses);
  for (const entry of enumerateChoiceGroups(program)) {
    if (entry.selectMax === undefined) continue;
    const matches = entry.options.filter((o) => completedSet.has(o));
    if (matches.length > entry.selectMax) return true;
  }
  return false;
}

export function StudentPassagePanel({
  passage,
  completedCourses,
  onCompletedChange,
  allCourseCodes,
}: Props) {
  const commitPassage = useFilterCommit(mergeStudentPassageIntoParams);
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [getStartedDismissed, setGetStartedDismissed] = useState(true);

  // Hydrate the "Get started" dismissed flag from localStorage. Initial
  // state is `true` (hidden) so SSR + first paint don't flash the card to
  // returning users; the effect flips it to `false` only if the user has
  // never dismissed it.
  useEffect(() => {
    setGetStartedDismissed(
      safeGetItem(GET_STARTED_DISMISSED_KEY) === "1",
    );
  }, []);

  function dismissGetStarted() {
    safeSetItem(GET_STARTED_DISMISSED_KEY, "1");
    setGetStartedDismissed(true);
  }

  // URL is source of truth for prog/term (router.replace is async; the prop
  // can lag in a transition). The live URL is decoded for those fields;
  // `completedCourses` comes from the prop (parent owns it via useState,
  // backed by localStorage). `decodeStudentPassage` always returns
  // completedCourses: [], so we overwrite it from the prop.
  function patchPassage(delta: Partial<StudentPassage>) {
    const live =
      typeof window !== "undefined"
        ? decodeStudentPassage(new URLSearchParams(window.location.search))
        : passage;
    const next = { ...live, ...delta };

    const baselineChanged =
      delta.programId !== undefined ||
      delta.currentTerm !== undefined ||
      delta.specializationId !== undefined ||
      delta.choiceGroupSelections !== undefined;

    if (baselineChanged) {
      onCompletedChange(rebaseCompletedCourses(loadExtras(), next));
      savePrimarySource("baseline");
    }

    commitPassage(next);
  }

  // Manual gesture (CompletedCoursesInput): diff against the current list to
  // detect adds/removes, then keep the extras layer in sync. Adds become
  // extras; removes from extras shrink it; removes of primary-layer courses
  // (not in extras) leave extras alone — the removal is "local to current
  // seed" and will be undone by the next re-seed if the new baseline still
  // contains the course.
  function handleManualCompletedChange(nextList: string[]) {
    const prev = new Set(completedCourses);
    const nextSet = new Set(nextList);
    const added = nextList.filter((c) => !prev.has(c));
    const removed = completedCourses.filter((c) => !nextSet.has(c));
    if (added.length > 0 || removed.length > 0) {
      const extrasSet = new Set(loadExtras());
      for (const c of added) extrasSet.add(c);
      for (const c of removed) extrasSet.delete(c);
      saveExtras([...extrasSet]);
    }
    onCompletedChange(nextList);
  }

  // Explicit "wipe everything" path. Goes direct rather than through
  // patchPassage so the intent is unambiguous: zero passage state, zero
  // completedCourses. Routing through patchPassage would invoke rebase logic
  // we don't want here.
  function clearPassage() {
    onCompletedChange([]);
    saveExtras([]);
    savePrimarySource(null);
    commitPassage(DEFAULT_STUDENT_PASSAGE);
  }

  // Transcript IS the source of truth — skip the prog/term rebase that
  // patchPassage would do. Replace passage in URL and completedCourses in
  // localStorage with the payload, then close the modal. Extras layer is
  // reset; primarySource flips to 'transcript'.
  //
  // Per D4: auto-open the setup modal only if variant pre-fill discovers
  // over-satisfied groups (a "pick 1" group where the student took two
  // options). User needs to disambiguate; otherwise the inferred picks
  // are unambiguous and we don't disturb the user.
  function handleTranscriptApply(payload: TranscriptImportPayload) {
    const next = applyTranscriptToStudentPassage(payload);
    commitPassage(next);
    onCompletedChange(payload.codes);
    saveExtras([]);
    savePrimarySource("transcript");
    setTranscriptModalOpen(false);
    if (next.programId && hasOverSatisfiedGroup(next.programId, payload.codes)) {
      setSetupModalOpen(true);
    }
  }

  function handleSetupApply(next: SetupModalApplyPayload) {
    patchPassage({
      specializationId: next.specializationId,
      currentTerm: next.currentTerm,
      choiceGroupSelections: next.choiceGroupSelections,
    });
    setSetupModalOpen(false);
  }

  const selectedProgram = passage.programId
    ? PROGRAMS[passage.programId]
    : null;
  const term = isTermLetter(passage.currentTerm) ? passage.currentTerm : null;
  const hasPassageState =
    passage.programId !== null ||
    passage.currentTerm !== null ||
    completedCourses.length > 0;
  const showGetStarted =
    !getStartedDismissed &&
    passage.programId === null &&
    completedCourses.length === 0;

  return (
    <>
      {showGetStarted && (
        <div className="rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-xs font-semibold">Get started</h3>
            <button
              type="button"
              onClick={dismissGetStarted}
              aria-label="Dismiss"
              className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 text-base leading-none -mt-0.5"
            >
              ×
            </button>
          </div>
          <p className="text-xs text-zinc-700 dark:text-zinc-300">
            Pick your program below to seed your completed courses, or
            upload your transcript (PDF) to import them from Quest.
          </p>
        </div>
      )}

      <Section title="Program">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Program
            </span>
            <select
              value={passage.programId ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                // Program change is a re-seed: spec, term, and choice-group
                // picks are all program-scoped (spec slug + AST path keys +
                // term schedule), so they're cleared on every change. The
                // user then fills them via the setup modal.
                patchPassage({
                  programId: id,
                  specializationId: null,
                  currentTerm: null,
                  choiceGroupSelections: {},
                });
                // Auto-open setup modal so the user can fill spec/term/picks
                // for the new program in one place. Per D4, only on program
                // change (not on subsequent dropdown toggles), and only when
                // a real program is selected.
                if (id !== null) setSetupModalOpen(true);
              }}
              className={SELECT_CLASS}
            >
              <option value="">Select a program…</option>
              {SORTED_PROGRAMS.map(([id, p]) => (
                <option key={id} value={id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              System of study
            </span>
            <select
              value={passage.systemOfStudy ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                patchPassage({
                  systemOfStudy:
                    v === "coop" || v === "regular" ? v : null,
                });
              }}
              className={SELECT_CLASS}
            >
              <option value="">Not specified</option>
              <option value="coop">Co-op</option>
              <option value="regular">Regular</option>
            </select>
          </label>

          {selectedProgram && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {selectedProgram.kind === "flexible"
                ? `Flexible program — all required courses are seeded as completed. (As of ${selectedProgram.asOf}.)`
                : `Sourced from UW calendar (as of ${selectedProgram.asOf}).`}
            </p>
          )}

          {selectedProgram && (
            <button
              type="button"
              onClick={() => setSetupModalOpen(true)}
              className="self-start rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Edit setup
            </button>
          )}
        </div>
      </Section>

      <Section title="Completed courses">
        <CompletedCoursesInput
          value={completedCourses}
          allCourseCodes={allCourseCodes}
          onChange={handleManualCompletedChange}
        />
        <button
          type="button"
          onClick={() => setTranscriptModalOpen(true)}
          className="self-start rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          ↗ Upload transcript (PDF)
        </button>
        {hasPassageState && (
          <button
            type="button"
            onClick={clearPassage}
            className="self-start text-xs text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50 underline-offset-2 hover:underline"
          >
            Clear program & completed courses
          </button>
        )}
      </Section>

      <TranscriptImportModal
        isOpen={transcriptModalOpen}
        onClose={() => setTranscriptModalOpen(false)}
        onApply={handleTranscriptApply}
        allCourseCodes={allCourseCodes}
        currentCompletedCount={completedCourses.length}
      />

      {selectedProgram && (
        <SetupModal
          isOpen={setupModalOpen}
          onClose={() => setSetupModalOpen(false)}
          onApply={handleSetupApply}
          program={selectedProgram}
          initialSpecializationId={passage.specializationId}
          initialCurrentTerm={term}
          initialSelections={passage.choiceGroupSelections}
          completedCourses={completedCourses}
        />
      )}
    </>
  );
}
