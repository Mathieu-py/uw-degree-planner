"use client";

import { useEffect, useRef, useState } from "react";
import { rebaseCompletedCourses } from "@/lib/completedCourses";
import {
  DEFAULT_STUDENT_PASSAGE,
  decodeStudentPassage,
  mergeStudentPassageIntoParams,
} from "@/lib/filterState";
import {
  isTermLetter,
  PROGRAMS,
  TERM_LETTERS,
  type TermLetter,
} from "@/lib/programs";
import { applyTranscriptToStudentPassage } from "@/lib/transcript/applyHelpers";
import type { StudentPassage } from "@/lib/types";
import { CompletedCoursesInput } from "./filter/CompletedCoursesInput";
import { Section } from "./filter/Section";
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

export function StudentPassagePanel({
  passage,
  completedCourses,
  onCompletedChange,
  allCourseCodes,
}: Props) {
  const commitPassage = useFilterCommit(mergeStudentPassageIntoParams);
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);

  const completedCoursesRef = useRef(completedCourses);
  useEffect(() => {
    completedCoursesRef.current = completedCourses;
  }, [completedCourses]);

  // URL is source of truth (router.replace is async). On prog/term change,
  // rebase the localStorage list through the new baseline so the table updates
  // immediately. The live list comes from the ref (localStorage-backed) —
  // `decodeStudentPassage` always returns [] for completedCourses.
  function patchPassage(delta: Partial<StudentPassage>) {
    const live =
      typeof window !== "undefined"
        ? decodeStudentPassage(new URLSearchParams(window.location.search))
        : passage;
    const next = { ...live, ...delta };

    if (delta.programId !== undefined || delta.currentTerm !== undefined) {
      onCompletedChange(
        rebaseCompletedCourses(
          { ...live, completedCourses: completedCoursesRef.current },
          next.programId,
          next.currentTerm,
        ),
      );
    }

    commitPassage(next);
  }

  // Explicit "wipe everything" path. Bypasses patchPassage's rebase because
  // `completedCoursesRef` updates one tick behind state — if we routed through
  // patchPassage with `programId: null, currentTerm: null`, rebase would see
  // the stale list and project the extras forward. Going direct keeps the
  // intent unambiguous: zero passage state, zero completedCourses.
  function clearPassage() {
    onCompletedChange([]);
    commitPassage(DEFAULT_STUDENT_PASSAGE);
  }

  // Transcript IS the source of truth — skip the prog/term rebase that
  // patchPassage would do. Replace passage in URL and completedCourses in
  // localStorage with the payload, then close the modal.
  function handleTranscriptApply(payload: TranscriptImportPayload) {
    const next = applyTranscriptToStudentPassage(payload);
    commitPassage(next);
    onCompletedChange(payload.codes);
    setTranscriptModalOpen(false);
  }

  const selectedProgram = passage.programId
    ? PROGRAMS[passage.programId]
    : null;
  const isFlexible = selectedProgram?.kind === "flexible";
  const term = isTermLetter(passage.currentTerm) ? passage.currentTerm : null;
  const hasPassageState =
    passage.programId !== null ||
    passage.currentTerm !== null ||
    completedCourses.length > 0;

  return (
    <>
      <Section title="Program & term">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Program
            </span>
            <select
              value={passage.programId ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                const next = id ? PROGRAMS[id] : null;
                // Flexible programs have no term schedule; clear any stale term
                // so the URL state doesn't carry a value the UI no longer shows.
                patchPassage({
                  programId: id,
                  ...(next?.kind === "flexible" ? { currentTerm: null } : {}),
                });
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

          {!isFlexible && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                Current term
              </span>
              <select
                value={term ?? ""}
                onChange={(e) =>
                  patchPassage({
                    currentTerm: isTermLetter(e.target.value)
                      ? e.target.value
                      : null,
                  })
                }
                className={SELECT_CLASS}
              >
                <option value="">Select a term…</option>
                {TERM_LETTERS.map((t: TermLetter) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}

          {selectedProgram && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {isFlexible
                ? `Flexible program — all required courses are seeded as completed. (As of ${selectedProgram.asOf}.)`
                : `Sourced from UW calendar (as of ${selectedProgram.asOf}).`}
            </p>
          )}
        </div>
      </Section>

      <Section title="Completed courses">
        <CompletedCoursesInput
          value={completedCourses}
          allCourseCodes={allCourseCodes}
          onChange={onCompletedChange}
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
    </>
  );
}
