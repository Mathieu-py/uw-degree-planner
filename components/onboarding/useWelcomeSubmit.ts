"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useAuthState } from "@/lib/auth/store";
import { NEW_PLAN_NAME } from "@/lib/constants";
import { logError } from "@/lib/log";
import { completedCoursesFromPlan } from "@/lib/plan/derive";
import { specsAfterDoubleDegreeSwap } from "@/lib/plan/doubleDegree";
import { buildEmptySlots } from "@/lib/plan/sequence";
import { emptyPlan } from "@/lib/plan/storage";
import { saveNewPlan, usePlanList } from "@/lib/plan/sync/usePlanList";
import { applyTranscriptToPlan } from "@/lib/plan/transcriptApply";
import type { LocalPlan, Stream } from "@/lib/plan/types";
import { programIdsTermSpan } from "@/lib/programs/meta";
import type { TranscriptParseResult } from "@/lib/transcript/types";

interface Args {
  parseResult: TranscriptParseResult | null;
  programIds: string[];
  stream: Stream;
  startTermId: number;
  /** Resolves manual-onboarding variant choices into the plan before saving. */
  applyVariants: (plan: LocalPlan) => Promise<LocalPlan>;
}

/**
 * Builds the onboarding draft plan (transcript-derived or empty) and saves it to
 * the right home — a Supabase row when signed in, localStorage when anon — then
 * routes to it. Owns the build/save busy + error state.
 */
export function useWelcomeSubmit({
  parseResult,
  programIds,
  stream,
  startTermId,
  applyVariants,
}: Args) {
  const router = useRouter();
  const { isAuthed } = useAuthState();
  const { create } = usePlanList(isAuthed);
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const buildPlan = useCallback((): LocalPlan => {
    const mintId = () => crypto.randomUUID();
    // Plan length follows the longest selected program (6 for Three-Year
    // General, else 8; empty ⇒ 8).
    const numAcademicTerms = programIdsTermSpan(programIds);
    if (parseResult) {
      const { plan } = applyTranscriptToPlan(parseResult, {
        stream,
        includedUnrecognized: new Set<string>(),
        mintId,
        numAcademicTerms,
      });
      // Honour programs the user corrected in review; keep only detected
      // specializations whose program is still on the plan. A double-degree swap
      // re-keys a still-valid spec onto the packaged plan first — parity with
      // PlanSettingsModal.
      const detectedSpecs = specsAfterDoubleDegreeSwap(
        parseResult.detectedProgramIds,
        plan.specializationIds,
        programIds,
      );
      return {
        ...plan,
        programIds,
        specializationIds: Object.fromEntries(
          Object.entries(detectedSpecs).filter(([pid]) =>
            programIds.includes(pid),
          ),
        ),
      };
    }
    return {
      ...emptyPlan(),
      programIds,
      stream,
      startTermId,
      slots: buildEmptySlots(startTermId, stream, mintId, numAcademicTerms),
    };
  }, [parseResult, programIds, stream, startTermId]);

  // Built once, reused for the review preview and the save.
  const draftPlan = useMemo(() => buildPlan(), [buildPlan]);
  const placedCount = parseResult
    ? completedCoursesFromPlan(draftPlan).length
    : 0;

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setBuildError(null);
    try {
      // Slot ids are already fresh — buildPlan mints them — so no reseed.
      const finalPlan = await applyVariants(draftPlan);
      const route = await saveNewPlan({
        isAuthed,
        plan: finalPlan,
        name: NEW_PLAN_NAME,
        create,
      });
      if (route) {
        router.push(route);
      } else {
        setBuildError("Couldn't save your plan. Please try again.");
        setBusy(false);
      }
    } catch (err) {
      logError("Failed to build/save plan:", err);
      setBuildError("Couldn't build your plan. Please try again.");
      setBusy(false);
    }
  }, [busy, applyVariants, draftPlan, isAuthed, create, router]);

  return { draftPlan, placedCount, busy, buildError, submit };
}
