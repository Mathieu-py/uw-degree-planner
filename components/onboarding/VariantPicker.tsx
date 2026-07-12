"use client";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatCourseCode } from "@/lib/format";
// Type-only: importing the value side of @/lib/programs would bundle
// programs.json into the onboarding client (the whole point of the digest).
import type { VariantGroup } from "@/lib/requirements/variantGroups";

interface Props {
  groups: VariantGroup[];
  /** groupKey → selected course codes. */
  value: Record<string, string[]>;
  onChange: (key: string, codes: string[]) => void;
}

/** At most one option — pick(N,1) or "no more than 1". */
function isSingle(g: VariantGroup): boolean {
  return g.selectMax === 1;
}

function hintFor(g: VariantGroup): string {
  if (isSingle(g)) return "Choose 1";
  const { selectMin: min, selectMax: max } = g;
  if (min && max && min === max) return `Choose ${min}`;
  if (min) return `Pick at least ${min}`;
  if (max) return `Choose up to ${max}`;
  return "Optional — choose any";
}

const CHIP_BASE =
  "font-mono text-xs font-semibold px-2 py-1 rounded-[6px] border transition-colors";

function chipClass(selected: boolean, disabled: boolean): string {
  if (selected)
    return `${CHIP_BASE} bg-accent-soft text-accent border-accent-line`;
  if (disabled)
    return `${CHIP_BASE} bg-bg-2 text-ink-3 border-line-2 opacity-50 cursor-not-allowed`;
  return `${CHIP_BASE} bg-bg-3 text-ink border-line hover:border-accent-bg cursor-pointer`;
}

function GroupBlock({
  group,
  value,
  onChange,
}: {
  group: VariantGroup;
  value: string[];
  onChange: (codes: string[]) => void;
}) {
  const single = isSingle(group);
  const atMax = group.selectMax != null && value.length >= group.selectMax;

  const toggle = (code: string) => {
    const selected = value.includes(code);
    if (single) {
      onChange(selected ? [] : [code]); // re-click clears — everything is skippable
      return;
    }
    if (selected) {
      onChange(value.filter((c) => c !== code));
    } else if (!atMax) {
      onChange([...value, code]);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink">
          {group.description}
        </span>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-3">
          {hintFor(group)}
        </span>
      </div>
      {/* Toggle buttons (not a radiogroup): single-select just means picking one
          deselects the rest — the visible description labels the set and the
          "Choose 1" hint carries the rule; aria-pressed announces each state. */}
      <div className="flex flex-wrap gap-1.5">
        {group.options.map((code) => {
          const selected = value.includes(code);
          const disabled = !single && !selected && atMax;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => toggle(code)}
              className={chipClass(selected, disabled)}
            >
              {formatCourseCode(code)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Batch resolver for a program's variant choices during manual onboarding (#84).
 * Flexible groups render flat; engineering groups group under their term header
 * (first-appearance order, which `enumerateVariantGroups` emits in 1A→4B order).
 * Everything is optional — a group left empty is simply skipped.
 */
export function VariantPicker({ groups, value, onChange }: Props) {
  const flat: VariantGroup[] = [];
  const termOrder: string[] = [];
  const byTerm = new Map<string, VariantGroup[]>();
  for (const g of groups) {
    if (g.termLabel === null) {
      flat.push(g);
      continue;
    }
    let bucket = byTerm.get(g.termLabel);
    if (!bucket) {
      bucket = [];
      byTerm.set(g.termLabel, bucket);
      termOrder.push(g.termLabel);
    }
    bucket.push(g);
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13.5px] text-ink-2">
        Optional — pick the versions you're taking; skip anything you're unsure
        about. You can change these anytime on your plan.
      </p>

      {flat.length > 0 ? (
        <div className="flex flex-col gap-4">
          {flat.map((g) => (
            <GroupBlock
              key={g.key}
              group={g}
              value={value[g.key] ?? []}
              onChange={(codes) => onChange(g.key, codes)}
            />
          ))}
        </div>
      ) : null}

      {termOrder.map((t) => (
        <div key={t} className="flex flex-col gap-3">
          <Eyebrow>Term {t}</Eyebrow>
          {(byTerm.get(t) ?? []).map((g) => (
            <GroupBlock
              key={g.key}
              group={g}
              value={value[g.key] ?? []}
              onChange={(codes) => onChange(g.key, codes)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
