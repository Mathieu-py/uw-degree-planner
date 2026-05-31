"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useAuthState } from "@/lib/auth/store";
import { NEW_PLAN_NAME } from "@/lib/constants";
import { logError } from "@/lib/log";
import { completedCoursesFromPlan } from "@/lib/plan/derive";
import { buildEmptySlots } from "@/lib/plan/sequence";
import { toSnapshot } from "@/lib/plan/server/serialize";
import { emptyPlan, savePlan } from "@/lib/plan/storage";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import { applyTranscriptToPlan } from "@/lib/plan/transcriptApply";
import type { LocalPlan, Stream } from "@/lib/plan/types";
import { KNOWN_TERMS, makeTermId } from "@/lib/terms";
import { parseTranscript } from "@/lib/transcript/parse";
import { extractTextFromPdf } from "@/lib/transcript/pdfText";
import type { TranscriptParseResult } from "@/lib/transcript/types";

interface ProgramOption {
  id: string;
  name: string;
}

const STREAMS: Array<{ value: Stream; label: string }> = [
  { value: "regular", label: "Regular" },
  { value: "stream4", label: "Stream 4 co-op" },
  { value: "stream8", label: "Stream 8 co-op" },
];

const STEPS = ["Set up", "Review"] as const;
const INPUT =
  "w-full h-[42px] rounded-[9px] border border-line-2 bg-bg text-ink px-[13px] text-sm outline-none focus:border-accent-bg";

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
  const [programId, setProgramId] = useState(programOptions[0]?.id ?? "");
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
      if (result.detectedProgramId) setProgramId(result.detectedProgramId);
      if (result.detectedSystemOfStudy === "coop") setStream("stream8");
    } catch (err) {
      logError("PDF parsing failed in onFile:", err);
      setParseError("Couldn't read that PDF. Try a Quest transcript export.");
    } finally {
      setParsing(false);
    }
  }

  const buildPlan = useCallback((): LocalPlan => {
    const mintId = () => crypto.randomUUID();
    if (parseResult) {
      return applyTranscriptToPlan(parseResult, {
        stream,
        includedUnrecognized: new Set<string>(),
        mintId,
      }).plan;
    }
    return {
      ...emptyPlan(),
      programId,
      stream,
      startTermId,
      slots: buildEmptySlots(startTermId, stream, mintId),
    };
  }, [parseResult, programId, stream, startTermId]);

  async function build() {
    if (busy) return;
    setBusy(true);
    setBuildError(null);
    try {
      const next = buildPlan();
      if (isAuthed) {
        const id = await create(NEW_PLAN_NAME, toSnapshot(next));
        if (id) router.push(`/plan?planId=${id}`);
        else setBusy(false);
      } else {
        savePlan(next);
        router.push("/plan");
      }
    } catch (err) {
      logError("Failed to build/save plan:", err);
      setBuildError("Couldn't build your plan. Please try again.");
      setBusy(false);
    }
  }

  const programName =
    programOptions.find((p) => p.id === programId)?.name ?? "your program";
  const draftPlan = useMemo(() => buildPlan(), [buildPlan]);
  const placedCount = parseResult
    ? completedCoursesFromPlan(draftPlan).length
    : 0;

  return (
    <div className="section">
      <div className="mx-auto w-full max-w-[880px] flex flex-col gap-8">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="u-h1">Let's set up your plan</h1>
          <p className="u-body">
            Upload your Quest transcript — or pick your program to start from
            scratch.
          </p>
        </div>

        <Stepper step={step} />

        {step === 0 ? (
          <div className="card p-6 flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="u-h3">Start from your transcript</h2>
              <p className="u-body text-[14px]">
                Upload your Quest transcript PDF — we'll detect your program,
                term, and co-op stream and auto-place every past course. Parsed
                in your browser; it never leaves your device.
              </p>
            </div>

            <label className="flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-2 bg-bg-2 px-6 py-10 text-center cursor-pointer hover:border-accent-bg hover:bg-accent-soft transition-colors">
              <Icon name="upload" size="lg" className="text-ink-3" />
              <span className="text-sm font-medium text-ink">
                {parsing ? "Reading…" : "Choose a PDF or drop it here"}
              </span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>

            {parseError ? (
              <p className="rounded-[8px] border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
                {parseError}
              </p>
            ) : null}

            {parseResult ? (
              <div className="flex items-center justify-between gap-3 rounded-[10px] bg-met-soft px-3 py-2.5 text-sm text-met">
                <span>
                  Detected <b>{programName}</b> · {streamText(stream)}
                  {parseResult.detectedCurrentTerm
                    ? ` · through ${parseResult.detectedCurrentTerm}`
                    : ""}{" "}
                  · {parseResult.courses.length} course
                  {parseResult.courses.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => setParseResult(null)}
                  className="shrink-0 text-ink-2 underline hover:text-ink"
                >
                  Clear
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-3">
                  <span className="h-px flex-1 bg-line" />
                  Or set up manually
                  <span className="h-px flex-1 bg-line" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Program">
                    {(id) => (
                      <select
                        id={id}
                        className={INPUT}
                        value={programId}
                        onChange={(e) => setProgramId(e.target.value)}
                      >
                        {programOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Start term (1A)">
                    {(id) => (
                      <select
                        id={id}
                        className={INPUT}
                        value={startTermId}
                        onChange={(e) => setStartTermId(Number(e.target.value))}
                      >
                        {fallTerms.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Co-op stream">
                    {(id) => (
                      <select
                        id={id}
                        className={INPUT}
                        value={stream}
                        onChange={(e) => setStream(e.target.value as Stream)}
                      >
                        {STREAMS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>
              </>
            )}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="card p-6 flex flex-col gap-3">
            <h2 className="u-h3">Review</h2>
            {parseResult ? (
              <p className="u-body">
                We'll build a plan from your transcript — <b>{placedCount}</b>{" "}
                past course{placedCount === 1 ? "" : "s"} auto-placed, ready for
                you to plan the rest.
              </p>
            ) : (
              <p className="u-body">
                We'll create an empty <b>{streamText(stream)}</b>{" "}
                <b>{programName}</b> plan starting{" "}
                <b>{fallTerms.find((t) => t.id === startTermId)?.label}</b>.
              </p>
            )}
          </div>
        ) : null}

        {buildError ? (
          <p className="rounded-[8px] border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
            {buildError}
          </p>
        ) : null}

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
              className="inline-flex h-[42px] items-center gap-2 rounded-[9px] bg-primary px-[18px] text-sm font-semibold text-primary-ink hover:bg-primary-hover"
            >
              Continue
              <Icon name="arrow" size="sm" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={build}
              disabled={busy}
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
  if (stream === "stream4") return "Stream 4 co-op";
  if (stream === "stream8") return "Stream 8 co-op";
  return "regular";
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-3">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                  done
                    ? "bg-met text-bg"
                    : active
                      ? "bg-primary text-primary-ink"
                      : "border border-line-2 text-ink-3"
                }`}
              >
                {done ? (
                  <Icon name="check" size="xs" aria-hidden="true" />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`text-sm font-medium ${active ? "text-ink" : "text-ink-3"}`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 ? (
              <span className="h-px w-8 bg-line-2" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
