"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { useModalExit } from "@/lib/hooks/useModalExit";

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
      <ModalHeader titleId="share-modal-title" onClose={handleClose}>
        Share "{planName}"
      </ModalHeader>

      <div className="px-4 py-4 flex flex-col gap-3">
        <p id="share-link-desc" className="text-[13.5px] text-ink-2">
          Anyone with this link can{" "}
          <span className="text-ink font-medium">view</span> this plan —
          read-only. They can duplicate it to their own account, but can't edit
          yours.
        </p>
        {url ? (
          <div className="flex items-center gap-2.5 pl-3 pr-2 py-[7px] border border-line-2 rounded-[10px] bg-bg-2">
            <span className="text-ink-3 shrink-0">
              <Icon name="share" size="sm" aria-hidden="true" />
            </span>
            <input
              ref={inputRef}
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Share URL"
              aria-describedby="share-link-desc"
              className="flex-1 min-w-0 bg-transparent text-[13px] font-mono text-ink outline-none truncate"
            />
            <Button
              variant={copied ? "brand" : "primary"}
              size="sm"
              onClick={handleCopy}
              className="shrink-0 gap-1.5"
            >
              <Icon
                name={copied ? "check" : "copy"}
                size="sm"
                aria-hidden="true"
              />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        ) : (
          <div className="w-full rounded-[10px] border border-dashed border-line-2 bg-bg-2 px-3 py-2.5 text-[13px] text-ink-3">
            Generating link…
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose}>
          Done
        </Button>
      </ModalFooter>
    </Modal>
  );
}
