"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useMemo, useState } from "react";
import { ProgramMultiSelect } from "@/components/planner/modals/ProgramMultiSelect";
import { Alert } from "@/components/ui/Alert";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Picker } from "@/components/ui/Picker";
import { SegmentedRadio } from "@/components/ui/SegmentedRadio";
import { useAuthState } from "@/lib/auth/store";
import { NEW_PLAN_NAME } from "@/lib/constants";
import { countNoun, pluralize } from "@/lib/format";
import { logError } from "@/lib/log";
import { completedCoursesFromPlan } from "@/lib/plan/derive";
import { buildEmptySlots } from "@/lib/plan/sequence";
import { toSnapshot } from "@/lib/plan/server/serialize";
import { emptyPlan, savePlan } from "@/lib/plan/storage";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import {
  applyTranscriptToPlan,
  detectStream,
} from "@/lib/plan/transcriptApply";
import { type LocalPlan, STREAM_OPTIONS, type Stream } from "@/lib/plan/types";
import {
  joinProgramNames,
  type ProgramOption,
  programIdsTermSpan,
} from "@/lib/programs";
import { KNOWN_TERMS, makeTermId, termLabel } from "@/lib/terms";
import { parseTranscript } from "@/lib/transcript/parse";
import { extractTextFromPdf } from "@/lib/transcript/pdfText";
import type { TranscriptParseResult } from "@/lib/transcript/types";

const STEPS = ["Set up", "Review"] as const;

export function WelcomeFlow({
  programOptions,
}: {
  programOptions: ProgramOption[];
}) {
  const router = useRouter();
  const { isAuthed } = useAuthState();
  const { create } = usePlanList({ isAuthed });

  const fallTerms = useMemo(
    () => KNOWN_TERMS.filter((t) => t.season === "Fall"),
    [],
  );

  const [step, setStep] = useState(0);
  const [programIds, setProgramIds] = useState<string[]>([]);
  const [stream, setStream] = useState<Stream>("regular");
  const [startTermId, setStartTermId] = useState<number>(() => {
    const currentFall = makeTermId(new Date().getFullYear(), "Fall");
    if (fallTerms.some((t) => t.id === currentFall)) return currentFall;
    return fallTerms[0]?.id ?? currentFall;
  });
  const [parseResult, setParseResult] = useState<TranscriptParseResult | null>(
    null,
  );
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  // False when co-op but the stream is undetectable — shows a confirm hint.
  const [streamConfident, setStreamConfident] = useState(true);
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setParsing(true);
    setParseError(null);
    try {
      const text = await extractTextFromPdf(file);
      const result = parseTranscript(text);
      setParseResult(result);
      // Always sync — a re-upload that detects nothing must clear stale ids.
      setProgramIds(result.detectedProgramIds);
      const detectedStream = detectStream(result);
      if (detectedStream) {
        setStream(detectedStream);
        setStreamConfident(true);
      } else if (result.detectedSystemOfStudy === "coop") {
        // Co-op but undetectable — default to the common Stream 8, ask to confirm.
        setStream("stream8");
        setStreamConfident(false);
      }
    } catch (err) {
      logError("PDF parsing failed in onFile:", err);
      setParseError("Couldn't read that PDF. Try a Quest transcript export.");
    } finally {
      setParsing(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault(); // required so the drop event fires
    setDragActive(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    // Ignore leaves into descendant nodes (e.g. the hidden file input); only
    // clear on a real exit of the dropzone.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragActive(false);
    }
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    onFile(e.dataTransfer.files?.[0]);
  }

  const buildPlan = useCallback((): LocalPlan => {
    const mintId = () => crypto.randomUUID();
    // Plan length follows the longest selected program (6 for Three-Year
    // General, else 8; empty ⇒ 8). See #105.
    const numAcademicTerms = programIdsTermSpan(programIds);
    if (parseResult) {
      const { plan } = applyTranscriptToPlan(parseResult, {
        stream,
        includedUnrecognized: new Set<string>(),
        mintId,
        numAcademicTerms,
      });
      // Honour programs the user corrected in review; keep only detected
      // specializations whose program is still on the plan.
      return {
        ...plan,
        programIds,
        specializationIds: Object.fromEntries(
          Object.entries(plan.specializationIds).filter(([pid]) =>
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

  const programName = joinProgramNames(
    programIds,
    (id) => programOptions.find((p) => p.id === id)?.name,
    "your program",
  );
  // Build once, reused for both the review preview and the save.
  const draftPlan = useMemo(() => buildPlan(), [buildPlan]);
  const placedCount = parseResult
    ? completedCoursesFromPlan(draftPlan).length
    : 0;

  async function build() {
    if (busy) return;
    setBusy(true);
    setBuildError(null);
    try {
      if (isAuthed) {
        const id = await create(NEW_PLAN_NAME, toSnapshot(draftPlan));
        if (id) {
          router.push(`/plan/${id}`);
        } else {
          setBuildError("Couldn't save your plan. Please try again.");
          setBusy(false);
        }
      } else {
        savePlan(draftPlan);
        router.push("/plan");
      }
    } catch (err) {
      logError("Failed to build/save plan:", err);
      setBuildError("Couldn't build your plan. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="px-7 py-8">
      <div className="mx-auto w-full max-w-[880px] flex flex-col gap-5">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="u-h1">Let's set up your plan</h1>
          <p className="u-body">
            {step === 0
              ? "Start the fast way with your transcript, or set things up by hand."
              : "Upload your Quest transcript — or pick your program to start from scratch."}
          </p>
        </div>

        <Stepper step={step} />

        {step === 0 ? (
          <div className="card grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]">
            {/* Left — fast path: transcript */}
            <div className="flex flex-col gap-4 p-[26px]">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
                  Fastest
                </span>
                <h2 className="u-h3">Upload your transcript</h2>
                <p className="u-body text-[14px]">
                  We'll detect your program, term, and co-op stream and
                  auto-place every past course.
                </p>
              </div>

              <label
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed bg-bg-2 px-6 py-9 text-center cursor-pointer transition-colors hover:border-accent-bg hover:bg-accent-soft ${
                  dragActive
                    ? "border-accent-bg bg-accent-soft"
                    : "border-line-2"
                }`}
              >
                <Icon name="upload" size="lg" className="text-ink-3" />
                <span className="text-sm font-medium text-ink">
                  {parsing ? "Reading…" : "Choose a PDF or drop it here"}
                </span>
                <small className="text-[12.5px] text-ink-3">
                  Parsed in your browser — never uploaded
                </small>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </label>

              {parseError ? <Alert>{parseError}</Alert> : null}

              {parseResult ? (
                <div className="flex items-center justify-between gap-3 rounded-[10px] bg-met-soft px-3 py-2.5 text-sm text-met">
                  <span>
                    Detected <b>{programName}</b> · {streamText(stream)}
                    {parseResult.detectedCurrentTerm
                      ? ` · through ${parseResult.detectedCurrentTerm}`
                      : ""}{" "}
                    · {countNoun(parseResult.courses.length, "course")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setParseResult(null);
                      setStreamConfident(true);
                    }}
                    className="shrink-0 text-ink-2 underline hover:text-ink"
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>

            {/* 1px column rule — hidden when the card collapses to one column */}
            <div className="hidden bg-line md:block" />

            {/* Right — manual setup */}
            <div className="flex flex-col gap-4 p-[26px]">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
                  Or by hand
                </span>
                <h2 className="u-h3">Set up manually</h2>
              </div>

              <Field label="Program">
                {() => (
                  <ProgramMultiSelect
                    programOptions={programOptions}
                    selected={programIds}
                    onChange={setProgramIds}
                  />
                )}
              </Field>
              <Field label="Start term (1A)">
                {(id) => (
                  <Picker
                    id={id}
                    value={String(startTermId)}
                    onChange={(v) => setStartTermId(Number(v))}
                    options={fallTerms.map((t) => ({
                      value: String(t.id),
                      label: t.label,
                    }))}
                  />
                )}
              </Field>
              <Field label="Co-op stream">
                {() => (
                  <SegmentedRadio
                    options={STREAM_OPTIONS}
                    value={stream}
                    onChange={setStream}
                    ariaLabel="Co-op stream"
                  />
                )}
              </Field>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="card p-6 flex flex-col gap-4">
            <h2 className="u-h3">Review</h2>
            {parseResult ? (
              <>
                <p className="u-body">
                  We'll build a plan from your transcript — <b>{placedCount}</b>{" "}
                  past {pluralize(placedCount, "course")} auto-placed
                  {draftPlan.startTermId ? (
                    <>
                      {" "}
                      starting <b>{termLabel(draftPlan.startTermId)}</b>
                    </>
                  ) : null}
                  . Confirm your program and stream below.
                </p>
                {!streamConfident ? (
                  <p className="rounded-[8px] border border-line-2 bg-bg-2 px-3 py-2 text-xs text-ink-2">
                    We couldn't tell your co-op stream apart from the
                    transcript, so we guessed <b>Stream 8</b>. Change it below
                    if that's wrong.
                  </p>
                ) : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Program">
                    {() => (
                      <ProgramMultiSelect
                        programOptions={programOptions}
                        selected={programIds}
                        onChange={setProgramIds}
                      />
                    )}
                  </Field>
                  <Field label="Co-op stream">
                    {() => (
                      <SegmentedRadio
                        options={STREAM_OPTIONS}
                        value={stream}
                        onChange={setStream}
                        ariaLabel="Co-op stream"
                      />
                    )}
                  </Field>
                </div>
              </>
            ) : (
              <p className="u-body">
                We'll create an empty <b>{streamText(stream)}</b>{" "}
                <b>{programName}</b> plan starting{" "}
                <b>{fallTerms.find((t) => t.id === startTermId)?.label}</b>.
              </p>
            )}
          </div>
        ) : null}

        {buildError ? <Alert>{buildError}</Alert> : null}

        {/* Footer nav */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="inline-flex h-[42px] items-center rounded-[9px] px-4 text-sm font-semibold text-ink-2 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={programIds.length === 0}
              className="inline-flex h-[42px] items-center gap-2 rounded-[9px] bg-primary px-[18px] text-sm font-semibold text-primary-ink hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
              <Icon name="arrow" size="sm" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={build}
              disabled={busy || programIds.length === 0}
              className="inline-flex h-[42px] items-center gap-2 rounded-[9px] bg-accent-bg px-[18px] text-sm font-semibold text-accent-ink hover:brightness-105 disabled:opacity-50"
            >
              {busy ? "Building…" : "Build my plan"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function streamText(stream: Stream): string {
  return STREAM_OPTIONS.find((s) => s.value === stream)?.label ?? stream;
}

function Stepper({ step }: { step: number }) {
  return (
    // 1fr auto 1fr grid: the connector is the middle (auto) column between two
    // equal-width side columns, so it sits dead-centre on the page no matter
    // how wide each step's label is. mx-auto centres the whole grid.
    <div className="mx-auto grid w-full max-w-[300px] grid-cols-[1fr_auto_1fr] items-center">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        // Labels flank the outside (first step's label left, last step's right)
        // so the connector runs centered between the two circles.
        const labelFirst = i === 0;
        const circle = (
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
              done
                ? "bg-met text-bg"
                : active
                  ? "bg-primary text-primary-ink"
                  : "border border-line-2 text-ink-3"
            }`}
          >
            {done ? <Icon name="check" size="xs" aria-hidden="true" /> : i + 1}
          </span>
        );
        const text = (
          <span
            className={`text-sm font-medium ${active ? "text-ink" : "text-ink-3"}`}
          >
            {label}
          </span>
        );
        return (
          <Fragment key={label}>
            <div
              className={`flex items-center gap-2 ${
                labelFirst ? "justify-end" : "justify-start"
              }`}
            >
              {labelFirst ? text : circle}
              {labelFirst ? circle : text}
            </div>
            {i < STEPS.length - 1 ? (
              <span className="mx-3 h-px w-10 bg-line-2" />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
