"use client";

import { Select } from "@/components/ui/Select";
import type { ProgramOption } from "@/lib/programs";

interface Props {
  programOptions: ProgramOption[];
  /** Selected program ids, in order. The first is the primary. */
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Chip-style multi-program picker: removable chips for the chosen programs plus
 * a `<select>` to add another (offering only not-yet-chosen options). Used by
 * Plan Settings and onboarding so a double-degree student can audit against more
 * than one program (issue #32). The first chip is the primary — it anchors the
 * plan's single specialization.
 */
export function ProgramMultiSelect({
  programOptions,
  selected,
  onChange,
}: Props) {
  const nameById = new Map(programOptions.map((p) => [p.id, p.name]));
  const available = programOptions.filter((p) => !selected.includes(p.id));
  const showPrimaryHint = selected.length > 1;

  function add(id: string) {
    if (!id || selected.includes(id)) return;
    onChange([...selected, id]);
  }
  function remove(id: string) {
    onChange(selected.filter((x) => x !== id));
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((id, i) => {
            const name = nameById.get(id) ?? id;
            return (
              <li key={id}>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  {showPrimaryHint && i === 0 ? (
                    <span className="text-[10px] uppercase tracking-wider text-accent/70">
                      Primary
                    </span>
                  ) : null}
                  {name}
                  <button
                    type="button"
                    onClick={() => remove(id)}
                    aria-label={`Remove ${name}`}
                    className="text-accent/70 hover:text-accent"
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Select
        aria-label="Add a program"
        value=""
        onChange={(e) => add(e.target.value)}
        disabled={available.length === 0}
      >
        <option value="">
          {selected.length === 0 ? "Select a program…" : "Add another program…"}
        </option>
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
