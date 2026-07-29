"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/states/ErrorScreen";
import { reportBoundaryError } from "@/lib/log";

export default function RootErrorBoundary({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    if (!error.digest) reportBoundaryError(error);
  }, [error]);

  return (
    <ErrorScreen
      kind="500"
      eyebrow="Error 500 · Something went wrong"
      title="That's on us, not you."
      body="We hit an unexpected error loading this page. Try again in a moment — if it keeps happening, let us know on GitHub."
      primary={{ label: "Try again", onClick: () => unstable_retry() }}
      secondary={{ label: "Back home", href: "/" }}
      reference={error.digest ?? null}
    />
  );
}
