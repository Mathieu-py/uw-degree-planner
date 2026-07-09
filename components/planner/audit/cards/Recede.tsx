import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

/**
 * The satisfied state — a slim green confirmation row that *recedes* so the
 * panel stays focused on outstanding work, while still giving an unmistakable
 * "done" signal. Native `<details>`: collapsed by default, click to reveal the
 * satisfying chips. No store state.
 */
export function Recede({
  title,
  caption,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  caption?: string;
  /** Mono count, e.g. "6/6"; omit for choose-one / compound picks. */
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="sat-a" open={defaultOpen}>
      <summary className="sat-a-head">
        <span className="sat-a-check">
          <Icon name="check" size="xs" aria-hidden="true" />
        </span>
        <span className="sat-a-ct">
          <div className="sat-a-title">{title}</div>
          {caption ? <div className="sat-a-sub">{caption}</div> : null}
        </span>
        {meta ? <span className="sat-a-meta">{meta}</span> : null}
        <span className="sat-a-chev">
          <Icon name="chevronRight" size="xs" aria-hidden="true" />
        </span>
      </summary>
      <div className="sat-a-body">{children}</div>
    </details>
  );
}
