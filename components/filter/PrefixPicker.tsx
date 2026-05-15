"use client";

import { useState } from "react";
import { Chip } from "./Chip";

interface Props {
  selected: string[];
  known: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
}

export function PrefixPicker({ selected, known, onChange, emptyLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  function toggle(prefix: string) {
    const p = prefix.toUpperCase();
    onChange(selected.includes(p) ? selected.filter((s) => s !== p) : [...selected, p].sort());
  }

  function remove(prefix: string) {
    onChange(selected.filter((s) => s !== prefix));
  }

  function addCustom() {
    const p = custom.trim().toUpperCase();
    if (!p || selected.includes(p)) {
      setCustom("");
      return;
    }
    onChange([...selected, p].sort());
    setCustom("");
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {selected.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => remove(p)}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 px-2 py-0.5 text-xs font-medium font-mono"
              title={`Remove ${p}`}
            >
              {p}
              <span className="text-zinc-400 dark:text-zinc-500">×</span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="self-start text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 underline-offset-2 hover:underline"
      >
        {open ? "Hide picker" : "Pick from known prefixes…"}
      </button>

      {open && (
        <div className="max-h-48 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800 p-2 flex flex-wrap gap-1">
          {known.map((p) => (
            <Chip key={p} active={selected.includes(p)} onClick={() => toggle(p)}>
              <span className="font-mono">{p}</span>
            </Chip>
          ))}
        </div>
      )}

      <div className="flex gap-1">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Add prefix (e.g. PHIL)…"
          className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs uppercase placeholder:normal-case placeholder:text-zinc-400"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={custom.trim() === ""}
          className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          Add
        </button>
      </div>
    </div>
  );
}
