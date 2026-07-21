import type { PlanSlot } from "@/lib/plan/types";
import type { TermOption, TermState } from "./termOptions";

/**
 * Classes for the catalog add-flow's modal list buttons — the per-term options
 * below and the signed-in plan picker ({@link TermPickerAuthed}). Both are
 * full-width left-aligned rows on a hairline border that grey out when disabled.
 */
export const optionButtonClasses =
  "flex items-center justify-between gap-3 rounded-[9px] border border-line px-3 py-2.5 text-left transition-colors hover:bg-bg-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent";

/**
 * Presentational term-option list shared by the catalog's signed-out and
 * signed-in add flows. Prereq/antireq gaps only warn (a chip); the sole
 * disablers are "already placed" and `busy` — program blocks are plan-level and
 * handled upstream. `justAdded` suppresses the "already placed" banner once the
 * footer's "Added to … ✓" already confirms this session's add.
 */
export function TermOptionList({
  options,
  alreadyIn,
  justAdded = false,
  busy = false,
  onPick,
}: {
  options: TermOption[];
  alreadyIn: string | null;
  justAdded?: boolean;
  busy?: boolean;
  onPick: (slot: PlanSlot, label: string) => void;
}) {
  return (
    <>
      {alreadyIn && !justAdded ? (
        <p className="rounded-[8px] bg-met-soft text-met text-xs px-3 py-2">
          Already placed in {alreadyIn}.
        </p>
      ) : null}
      {options.map((opt) => (
        <button
          key={opt.slot.id}
          type="button"
          // Prereq/antireq gaps stay addable (chip only); program blocks are
          // handled upstream. Only already-placed / in-flight save disables.
          disabled={alreadyIn !== null || busy}
          onClick={() => onPick(opt.slot, opt.label)}
          title={opt.hint}
          className={optionButtonClasses}
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
