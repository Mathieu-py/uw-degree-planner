import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

/** Centered status line used while a plan list / plan loads. */
export function StatusBody({ children }: { children: ReactNode }) {
  return <p className="u-body py-4 text-center">{children}</p>;
}

/**
 * Shown in place of the term list when a program/faculty restriction closes the
 * course to the plan's program. Program eligibility is plan-level, so it's
 * stated once here rather than disabling every term.
 */
export function ProgramBlockedBody() {
  return (
    <p className="rounded-[8px] bg-danger-soft text-danger text-xs px-3 py-3 text-center">
      This course isn't open to your program.
    </p>
  );
}

/** Centered error message with an optional retry button. */
export function ErrorBody({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 text-center">
      <p className="rounded-[8px] bg-danger-soft text-danger text-xs px-3 py-2">
        {message}
      </p>
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="self-center"
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Humanize the error codes the plan server actions return. */
export function serverActionError(code: string): string {
  switch (code) {
    case "not_authenticated":
      return "Your session expired — please sign in again.";
    case "snapshot_too_large":
      return "This plan is too large to save.";
    case "not_found":
    case "not_found_or_unauthorized":
      return "That plan is no longer available.";
    default:
      return "Couldn't save. Try again.";
  }
}
