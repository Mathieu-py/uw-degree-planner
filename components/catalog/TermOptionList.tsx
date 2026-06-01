import type { PlanSlot } from "@/lib/plan/types";
import { optionButtonClasses } from "./optionButtonClasses";
import type { TermOption, TermState } from "./termOptions";

/**
 * Presentational term-option list shared by the catalog's signed-out and
 * signed-in add flows. Renders the "already placed" banner plus one button
 * per academic term, disabling ineligible terms (and every term once the
 * course is already placed). `busy` disables interaction during an in-flight
 * server save.
 *
 * `justAdded` suppresses the "already placed" banner: once the user has placed
 * the course in this session, the footer's "Added to … ✓" is the confirmation,
 * so repeating it as an "already placed" warning would just be noise. The
 * banner is reserved for courses that were already in the plan on open.
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
          disabled={opt.state === "missing" || alreadyIn !== null || busy}
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
