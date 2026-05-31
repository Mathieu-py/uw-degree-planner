"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";
import { useModalExit } from "@/lib/hooks/useModalExit";
import { completedSetFromPlan } from "@/lib/plan/derive";
import { loadPlan, savePlan } from "@/lib/plan/storage";
import type { LocalPlan, PlanSlot } from "@/lib/plan/types";
import { parsePrereqs } from "@/lib/prereqs/parse";
import { evaluate } from "@/lib/prereqs/satisfied";
import { termInfo } from "@/lib/terms";

type TermState = "eligible" | "check" | "missing";

interface TermOption {
  slot: PlanSlot;
  label: string;
  state: TermState;
  hint: string;
}

/**
 * Catalog "Add" flow. The catalog has no target term, so this reads the
 * signed-out local plan and runs the prereq check per academic term — a course
 * is "missing prereqs" in early terms and "eligible" once its prereqs sit in
 * earlier terms. Adding writes the course into the chosen term's slot.
 *
 * Signed-in multi-plan adds need a server round-trip and plan selection; until
 * that's wired, authed users are pointed at the planner.
 */
export function TermPicker({
  course,
  onClose,
}: {
  course: Course;
  onClose: () => void;
}) {
  const { isClosing, handleClose, animateOut } = useModalExit(onClose);
  const [plan, setPlan] = useState<LocalPlan | null>(() => loadPlan());
  const [addedTo, setAddedTo] = useState<string | null>(null);
  const code = course.code.toLowerCase();

  const prereqNode = useMemo(
    () => parsePrereqs(course.prereqs),
    [course.prereqs],
  );

  const alreadyIn = useMemo(() => {
    if (!plan) return null;
    const slot = plan.slots.find((s) => s.courses.some((c) => c.code === code));
    if (!slot) return null;
    return slot.termId !== null
      ? (termInfo(slot.termId)?.label ?? "your plan")
      : "your plan";
  }, [plan, code]);

  const options = useMemo<TermOption[]>(() => {
    if (!plan) return [];
    return plan.slots
      .filter((s) => s.position !== "pre" && !s.isCoop)
      .map((slot) => {
        const completed = completedSetFromPlan(plan, slot.termId ?? undefined);
        const result = prereqNode
          ? evaluate(prereqNode, { completed })
          : {
              satisfied: true,
              uncertain: false,
              missingCourses: [],
              rawRequirements: [],
            };
        const state: TermState = !result.satisfied
          ? "missing"
          : result.uncertain
            ? "check"
            : "eligible";
        const hint =
          state === "missing"
            ? `Needs ${result.missingCourses.map(formatCourseCode).join(", ") || "earlier prereqs"}`
            : state === "check"
              ? result.rawRequirements.join(" · ") || "Manual check"
              : "Prerequisites met";
        return {
          slot,
          label:
            slot.termId !== null
              ? (termInfo(slot.termId)?.label ?? slot.position)
              : slot.position,
          state,
          hint,
        };
      });
  }, [plan, prereqNode]);

  function addTo(slot: PlanSlot, label: string) {
    const current = plan;
    if (!current) return;
    // A course belongs in exactly one term; the option buttons are disabled
    // once it's placed, but guard here too so the writer can't ever duplicate.
    if (current.slots.some((s) => s.courses.some((c) => c.code === code)))
      return;
    const nextSlots = current.slots.map((s) =>
      s.id === slot.id ? { ...s, courses: [...s.courses, { code }] } : s,
    );
    const next = {
      ...current,
      slots: nextSlots,
      updatedAt: new Date().toISOString(),
    };
    savePlan(next);
    setPlan(next);
    setAddedTo(label);
  }

  const titleId = "term-picker-title";
  const niceCode = formatCourseCode(course.code);

  return (
    <Modal
      isClosing={isClosing}
      onClose={handleClose}
      titleId={titleId}
      className="max-w-md"
    >
      <header className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-3">
            Add to which term?
          </div>
          <h2 id={titleId} className="text-sm font-medium truncate">
            <span className="u-mono">{niceCode}</span> · {course.name}
          </h2>
        </div>
        <Button variant="icon" onClick={handleClose} aria-label="Close">
          <Icon name="close" size="md" aria-hidden="true" />
        </Button>
      </header>

      <div className="px-4 py-4 flex flex-col gap-2">
        {!plan ? (
          <div className="flex flex-col gap-3 py-4 text-center">
            <p className="u-body">
              You don't have a local plan yet. Start one to add courses.
            </p>
            <Link
              href="/plan"
              className="inline-flex items-center justify-center gap-2 h-[42px] px-[18px] rounded-[9px] bg-primary text-primary-ink text-sm font-semibold hover:bg-primary-hover self-center"
            >
              Open the planner
            </Link>
          </div>
        ) : (
          <>
            {alreadyIn ? (
              <p className="rounded-[8px] bg-met-soft text-met text-xs px-3 py-2">
                Already placed in {alreadyIn}.
              </p>
            ) : null}
            {options.map((opt) => (
              <button
                key={opt.slot.id}
                type="button"
                disabled={opt.state === "missing" || alreadyIn !== null}
                onClick={() => addTo(opt.slot, opt.label)}
                title={opt.hint}
                className="flex items-center justify-between gap-3 rounded-[9px] border border-line px-3 py-2.5 text-left transition-colors hover:bg-bg-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="u-mono text-xs font-bold">
                    {opt.slot.position}
                  </span>
                  <span className="text-sm truncate">{opt.label}</span>
                </span>
                <StateChip state={opt.state} />
              </button>
            ))}
          </>
        )}
      </div>

      <footer className="border-t border-line px-4 py-2.5 flex items-center justify-between gap-3">
        <span className="u-small">
          {addedTo ? (
            <span className="text-met">Added to {addedTo} ✓</span>
          ) : (
            "Ineligible terms are disabled"
          )}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void animateOut().then(onClose)}
        >
          Done
        </Button>
      </footer>
    </Modal>
  );
}

function StateChip({ state }: { state: TermState }) {
  if (state === "eligible") {
    return (
      <span className="shrink-0 rounded-full bg-met-soft text-met px-2 py-0.5 text-[10px] font-medium">
        Eligible
      </span>
    );
  }
  if (state === "check") {
    return (
      <span className="shrink-0 rounded-full bg-partial-soft text-partial px-2 py-0.5 text-[10px] font-medium">
        Check
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-danger-soft text-danger px-2 py-0.5 text-[10px] font-medium">
      Missing
    </span>
  );
}
