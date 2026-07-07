"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  doubleDegreeSuggestionMessage,
  suggestedDoubleDegree,
} from "@/lib/plan/doubleDegree";

interface Props {
  programIds: string[];
  /** Swap the two hand-picked standalone ids for the packaged double-degree id. */
  onAccept: (doubleDegreeId: string) => void;
  className?: string;
}

/**
 * Nudge shown when a hand-picked pair matches a packaged double degree (#103):
 * two standalone programs give only per-program rings, so we offer a one-click
 * switch to the single packaged plan for an accurate combined audit. Dismissible
 * — hand-picking stays allowed, and a student who genuinely wants the two audited
 * apart can clear it. Dismissal is tracked per matched plan, so it stays hidden
 * for that pair but a *different* packaged pair still surfaces its own nudge.
 */
export function DoubleDegreeSuggestion({
  programIds,
  onAccept,
  className,
}: Props) {
  const suggestion = suggestedDoubleDegree(programIds);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  if (!suggestion || suggestion.id === dismissedId) return null;

  return (
    <div
      className={`flex items-start gap-2 rounded-[8px] border border-partial bg-partial-soft px-3 py-2.5 text-xs text-ink-2 ${className ?? ""}`}
    >
      <Icon
        name="warning"
        size="xs"
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-partial"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span>{doubleDegreeSuggestionMessage(suggestion.program)}</span>
        <Button
          variant="primary"
          size="sm"
          className="self-start"
          onClick={() => onAccept(suggestion.id)}
        >
          Switch to packaged plan
        </Button>
      </div>
      <button
        type="button"
        onClick={() => setDismissedId(suggestion.id)}
        aria-label="Dismiss double-degree suggestion"
        className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink"
      >
        <Icon name="close" size="xs" />
      </button>
    </div>
  );
}
