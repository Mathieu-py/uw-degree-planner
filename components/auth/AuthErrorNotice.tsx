"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";

/**
 * OAuth failures redirect to `/?auth_error=<reason>`; without this the bounce is
 * silent. Read client-side (useSearchParams) so the landing page stays static;
 * the message is generic — we never render the raw reason.
 */
export function AuthErrorNotice() {
  const params = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !params.get("auth_error")) return null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 lg:px-6 pt-4">
      <Alert
        size="md"
        aria-live="assertive"
        className="flex items-center justify-between gap-3"
      >
        <span>Sign-in didn't complete. Please try again.</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-xs font-semibold underline underline-offset-2"
        >
          Dismiss
        </button>
      </Alert>
    </div>
  );
}
