"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import {
  ProgramFields,
  ProgramNotices,
} from "@/components/planner/modals/ProgramFields";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dropzone } from "@/components/ui/Dropzone";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Picker } from "@/components/ui/Picker";
import { SegmentedRadio } from "@/components/ui/SegmentedRadio";
import { countNoun, pluralize } from "@/lib/format";
import { detectStream } from "@/lib/plan/transcriptApply";
import { STREAM_OPTIONS, type Stream } from "@/lib/plan/types";
import { useStreamSuggestion } from "@/lib/plan/useStreamSuggestion";
import { joinProgramNames, type ProgramOption } from "@/lib/programs";
import { KNOWN_TERMS, makeTermId, termLabel } from "@/lib/terms";
import type { TranscriptParseResult } from "@/lib/transcript/types";
import { useTranscriptUpload } from "@/lib/transcript/useTranscriptUpload";
import { useVariantPicker } from "./useVariantPicker";
import { useWelcomeSubmit } from "./useWelcomeSubmit";
import { VariantPicker } from "./VariantPicker";

const STEPS = ["Set up", "Review"] as const;

export function WelcomeFlow({
  programOptions,
}: {
  programOptions: ProgramOption[];
}) {
  const fallTerms = useMemo(
    () => KNOWN_TERMS.filter((t) => t.season === "Fall"),
    [],
  );

  const [step, setStep] = useState(0);
  const [programIds, setProgramIds] = useState<string[]>([]);
  const { stream, setStream, setStreamManually, suggestForPrograms } =
    useStreamSuggestion("regular");
  const [startTermId, setStartTermId] = useState<number>(() => {
    const currentFall = makeTermId(new Date().getFullYear(), "Fall");
    if (fallTerms.some((t) => t.id === currentFall)) return currentFall;
    return fallTerms[0]?.id ?? currentFall;
  });
  // False when co-op but the stream is undetectable — shows a confirm hint.
  const [streamConfident, setStreamConfident] = useState(true);

  // Sync the detected program + stream from a fresh transcript parse. A
  // re-upload that detects nothing still clears stale ids; manual/explicit
  // choices win elsewhere.
  const handleParsed = useCallback(
    (result: TranscriptParseResult) => {
      setProgramIds(result.detectedProgramIds);
      const detected = detectStream(result);
      if (detected) {
        setStream(detected);
        setStreamConfident(true);
      } else if (result.detectedSystemOfStudy === "coop") {
        // Co-op but undetectable — default to the common Stream 8, ask to confirm.
        setStream("stream8");
        setStreamConfident(false);
      } else {
        // Non-coop with no detected stream → regular; reset so a prior PDF's
        // coop / low-confidence state can't linger across a re-upload.
        setStream("regular");
        setStreamConfident(true);
      }
    },
    [setStream],
  );
  const {
    parseResult,
    busy: parsing,
    error: parseError,
    onFile,
    reset: resetUpload,
  } = useTranscriptUpload(handleParsed);

  // Manual-onboarding variant picker. Transcript path skips it — placed courses
  // already resolve every choice.
  const variants = useVariantPicker({
    programIds,
    stream,
    enabled: !parseResult,
  });

  function handleProgramChange(next: string[]) {
    setProgramIds(next);
    // Manual pick pre-fills the co-op stream from the program's default; a
    // transcript-detected stream (locked) and an explicit choice both win.
    suggestForPrograms(next, startTermId, parseResult !== null);
  }

  const { draftPlan, placedCount, busy, buildError, submit } = useWelcomeSubmit(
    {
      parseResult,
      programIds,
      stream,
      startTermId,
      applyVariants: variants.applyTo,
    },
  );

  const programName = joinProgramNames(
    programIds,
    (id) => programOptions.find((p) => p.id === id)?.name,
    "your program",
  );
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

              <Dropzone
                onFile={onFile}
                busy={parsing}
                label="Choose a PDF or drop it here"
                className="flex-1 px-6 py-9"
              />

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
                      resetUpload();
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
                  <ProgramFields
                    programOptions={programOptions}
                    selected={programIds}
                    onChange={handleProgramChange}
                    onAcceptDoubleDegree={(id) => handleProgramChange([id])}
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
                    onChange={setStreamManually}
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
                <Field label="Program">
                  {() => (
                    <ProgramFields
                      programOptions={programOptions}
                      selected={programIds}
                      onChange={setProgramIds}
                      onAcceptDoubleDegree={(id) => handleProgramChange([id])}
                    />
                  )}
                </Field>
                <Field label="Co-op stream">
                  {() => (
                    <SegmentedRadio
                      options={STREAM_OPTIONS}
                      value={stream}
                      onChange={setStreamManually}
                      ariaLabel="Co-op stream"
                    />
                  )}
                </Field>
              </>
            ) : (
              <>
                <p className="u-body">
                  We'll create an empty <b>{streamText(stream)}</b>{" "}
                  <b>{programName}</b> plan starting{" "}
                  <b>{fallTerms.find((t) => t.id === startTermId)?.label}</b>.
                </p>
                <ProgramNotices
                  programIds={programIds}
                  onAcceptDoubleDegree={(id) => handleProgramChange([id])}
                />
                {variants.groups.length > 0 ? (
                  <div className="flex flex-col gap-3 border-t border-line pt-4">
                    <h3 className="u-h3 text-[15px]">Course choices</h3>
                    <VariantPicker
                      groups={variants.groups}
                      value={variants.selections}
                      onChange={variants.onChange}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {buildError ? <Alert>{buildError}</Alert> : null}

        {/* Footer nav */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setStep((s) => s + 1)}
              disabled={programIds.length === 0}
            >
              Continue
              <Icon name="arrow" size="sm" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              variant="brand"
              size="md"
              onClick={submit}
              disabled={busy || programIds.length === 0}
            >
              {busy ? "Building…" : "Build my plan"}
            </Button>
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
