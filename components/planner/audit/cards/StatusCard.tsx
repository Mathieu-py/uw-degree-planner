import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

export type CardTone = "missing" | "partial" | "met";

/**
 * The active (unsatisfied / in-progress) requirement card — the shared chrome
 * every kind renders into: a status spine + lead, title/caption, an optional
 * status pill, and a body of "chips of what counts" (+ an optional `<FindRow>`
 * browse action). It's a collapsible `<details>` (expanded by default); a
 * *satisfied* requirement uses `<Recede>` instead.
 */
export function StatusCard({
  tone,
  lead,
  title,
  caption,
  pill,
  defaultOpen = true,
  children,
}: {
  tone: CardTone;
  lead: ReactNode;
  title: string;
  caption?: string;
  pill?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className={`cd-card${tone === "missing" ? "" : ` ${tone}`}`}
      open={defaultOpen}
    >
      <summary className="cd-cardhead">
        {lead}
        {/* Spans (block via CSS): <div> inside <span>/<summary> is invalid HTML. */}
        <span className="cd-ct">
          <span className="cd-ct-title">{title}</span>
          {caption ? <span className="cd-ct-sub">{caption}</span> : null}
        </span>
        {pill ? <span className="br2-headright">{pill}</span> : null}
        <span className="cd-chev">
          <Icon name="chevronRight" size="xs" aria-hidden="true" />
        </span>
      </summary>
      <div className="cd-body">{children}</div>
    </details>
  );
}
