"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { Modal } from "./Modal";
import { useModalExit } from "./useModalExit";

interface Props {
  planName: string;
  shareToken: string | null;
  onClose: () => void;
}

/**
 * Modal showing the public share link for a plan. Mounted by the sidebar
 * after clicking the link icon; sharing is enabled automatically by the
 * caller before mount, so by the time this renders a token usually exists.
 * While the optimistic enable is in flight, `shareToken` is briefly null
 * and we show a "Generating link…" placeholder.
 *
 * Dismissed by × button, Escape, or backdrop click — no Stop sharing
 * affordance here; revoking sharing is a deliberate enough action that
 * it doesn't belong in the casual "grab a link" flow.
 */
export function ShareModal({ planName, shareToken, onClose }: Props) {
  const { isClosing, handleClose } = useModalExit(onClose);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const url =
    shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/p/${shareToken}`
      : null;

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      inputRef.current?.select();
    }
  }

  return (
    <Modal
      isClosing={isClosing}
      onClose={handleClose}
      titleId="share-modal-title"
    >
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 flex items-center justify-between">
        <h2 id="share-modal-title" className="text-sm font-medium truncate">
          Share "{planName}"
        </h2>
        <Button variant="icon" onClick={handleClose} aria-label="Close">
          <span aria-hidden="true">×</span>
        </Button>
      </header>

      <div className="px-4 py-4 flex flex-col gap-3">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Anyone with this link can view this plan (read-only).
        </p>
        {url ? (
          <input
            ref={inputRef}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Share URL"
            className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-2 text-xs font-mono"
          />
        ) : (
          <div className="w-full rounded border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
            Generating link…
          </div>
        )}
        <Button onClick={handleCopy} disabled={!url} className="self-start">
          {copied ? "Copied!" : "Copy link"}
        </Button>
      </div>
    </Modal>
  );
}
