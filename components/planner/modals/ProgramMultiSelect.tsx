"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { type ProgramOption, splitProgramName } from "@/lib/programs";
import { ProgramSearchPalette } from "./ProgramSearchPalette";

interface Props {
  programOptions: ProgramOption[];
  /** Selected program ids, in order. The first is the primary. */
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Slim multi-program picker: a compact single-line list of chosen programs over
 * a quiet "+ Add another program" link that opens a searchable, faculty-filtered
 * command palette ({@link ProgramSearchPalette}) for adding more. Used by Plan
 * Settings and onboarding so a double-degree student can audit against more than
 * one program. The first row is the primary — it anchors the plan's
 * single specialization and is tagged "Primary" once a second program is added
 * (the rest read "Joint").
 */
export function ProgramMultiSelect({
  programOptions,
  selected,
  onChange,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const nameById = new Map(programOptions.map((p) => [p.id, p.name]));
  const showPrimaryHint = selected.length > 1;

  function toggle(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  }
  function remove(id: string) {
    onChange(selected.filter((x) => x !== id));
  }

  return (
    <div className="flex flex-col gap-1.5">
      {selected.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {selected.map((id, i) => {
            const name = nameById.get(id) ?? id;
            const { title } = splitProgramName(name);
            const primary = showPrimaryHint && i === 0;
            return (
              <li key={id} className="flex items-center gap-2.5 py-2.5 pr-1.5">
                <span
                  className={`flex-none w-[3px] self-stretch rounded-[2px] ${
                    primary ? "bg-accent-bg" : "bg-line-2"
                  }`}
                />
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-semibold text-ink">
                    {title}
                  </span>
                </div>
                {showPrimaryHint ? (
                  <span
                    className={`flex-none text-[10px] font-semibold uppercase tracking-[0.06em] ${
                      primary ? "text-accent" : "text-ink-3"
                    }`}
                  >
                    {primary ? "Primary" : "Joint"}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => remove(id)}
                  aria-label={`Remove ${name}`}
                  data-program-id={id}
                  className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <Icon name="close" size="xs" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {selected.length > 0 && programOptions.length > 0 ? (
        <div className="h-px bg-line" />
      ) : null}

      {programOptions.length > 0 ? (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-[7px] self-start rounded-[6px] px-0.5 py-1.5 text-[13px] font-semibold text-accent transition-colors hover:text-accent-ink dark:hover:text-accent-bg"
        >
          <Icon name="plusSign" size="sm" />
          {selected.length === 0 ? "Add a program" : "Add another program"}
        </button>
      ) : null}

      {pickerOpen ? (
        <ProgramSearchPalette
          options={programOptions}
          selected={selected}
          onToggle={toggle}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
