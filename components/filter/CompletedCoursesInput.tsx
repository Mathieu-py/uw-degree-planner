"use client";

import { useId, useMemo, useState } from "react";

interface Props {
  value: string[];
  allCourseCodes: string[];
  onChange: (next: string[]) => void;
}

export function CompletedCoursesInput({ value, allCourseCodes, onChange }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const knownCodes = useMemo(() => new Set(allCourseCodes), [allCourseCodes]);
  const datalistId = useId();
  const errorId = `${datalistId}-error`;

  function add() {
    const code = input.trim().toLowerCase();
    if (!code) {
      setError(null);
      return;
    }
    if (value.includes(code)) {
      setInput("");
      setError(null);
      return;
    }
    if (!knownCodes.has(code)) {
      setError(`"${code}" isn't in this term's catalog.`);
      return;
    }
    onChange([...value, code]);
    setInput("");
    setError(null);
  }

  function remove(code: string) {
    onChange(value.filter((c) => c !== code));
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => remove(c)}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200 px-2 py-0.5 text-xs font-medium font-mono"
              title={`Remove ${c}`}
            >
              {c}
              <span className="opacity-60">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1">
        <input
          type="text"
          list={datalistId}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add course (e.g. math116)…"
          className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs placeholder:text-zinc-400"
        />
        <button
          type="button"
          onClick={add}
          disabled={input.trim() === ""}
          className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          Add
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <datalist id={datalistId}>
        {allCourseCodes.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}
