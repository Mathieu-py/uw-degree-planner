"use client";

import { useState } from "react";
import { Icon } from "./Icon";

interface Props {
  onFile: (file: File | undefined) => void;
  busy: boolean;
  /** Idle prompt, e.g. "Choose a PDF or drop it here". */
  label: string;
  /** Shown while `busy`. */
  busyLabel?: string;
  accept?: string;
  /** Sizing/layout the caller owns (padding, flex-1); the base handles chrome. */
  className?: string;
}

/**
 * PDF drop target: click-to-pick or drag-and-drop, with the "never uploaded"
 * affordance. Extraction/parse belong to the caller (useTranscriptUpload) — this
 * is presentation plus the drag highlight only.
 */
export function Dropzone({
  onFile,
  busy,
  label,
  busyLabel = "Reading…",
  accept = "application/pdf,.pdf",
  className = "",
}: Props) {
  const [dragActive, setDragActive] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault(); // required so the drop event fires
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        // Ignore leaves into descendants (e.g. the hidden input).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragActive(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        // Honour the same disabled={busy} the input has, so a drop can't start a
        // second parse while one is in flight.
        if (busy) return;
        onFile(e.dataTransfer.files?.[0]);
      }}
      className={`flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed bg-bg-2 text-center cursor-pointer transition-colors hover:border-accent-bg hover:bg-accent-soft focus-within:border-accent-bg focus-within:ring-2 focus-within:ring-accent-bg/40 ${
        dragActive ? "border-accent-bg bg-accent-soft" : "border-line-2"
      } ${className}`}
    >
      <Icon name="upload" size="lg" className="text-ink-3" aria-hidden="true" />
      <span className="text-sm font-medium text-ink">
        {busy ? busyLabel : label}
      </span>
      <span className="text-[12.5px] text-ink-3 inline-flex items-center gap-1.5">
        <span className="text-met">
          <Icon name="shield" size="xs" aria-hidden="true" />
        </span>
        Parsed in your browser · never uploaded
      </span>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        disabled={busy}
        onChange={(e) => onFile(e.target.files?.[0])}
        // Clear so re-selecting the same PDF still fires onChange.
        onClick={(e) => {
          (e.target as HTMLInputElement).value = "";
        }}
      />
    </label>
  );
}
