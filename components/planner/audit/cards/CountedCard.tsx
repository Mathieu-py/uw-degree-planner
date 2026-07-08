import type { ReactNode } from "react";
import { progressPct } from "@/lib/format";
import { Recede } from "./Recede";
import { RingLead } from "./RingLead";
import { StatusCard } from "./StatusCard";
import { StatusPill } from "./StatusPill";

/**
 * The shared "counted requirement" shell: a progress card that recedes to a
 * green confirmation once complete. Every count/unit-based kind (required
 * courses, subject pool, breadth, finite electives, level floor) renders into
 * this so the tone, ring, "In progress" pill, and recede handoff stay identical.
 *
 * `done`/`need` drive the tone + ring %; `num` is the ring's display value
 * (already unit-formatted where needed). The active body is `children`; the
 * receded body is `recedeChildren` (usually just the satisfying chips).
 */
export function CountedCard({
  title,
  caption,
  done,
  need,
  num,
  complete,
  recedeMeta,
  recedeCaption,
  recedeChildren,
  children,
}: {
  title: string;
  caption?: string;
  done: number;
  need: number;
  num: ReactNode;
  complete: boolean;
  recedeMeta: string;
  recedeCaption?: string;
  recedeChildren: ReactNode;
  children: ReactNode;
}) {
  if (complete) {
    return (
      <Recede title={title} caption={recedeCaption} meta={recedeMeta}>
        {recedeChildren}
      </Recede>
    );
  }
  return (
    <StatusCard
      tone={done > 0 ? "partial" : "missing"}
      lead={<RingLead pct={progressPct(done, need)} num={num} />}
      title={title}
      caption={caption}
      pill={
        done > 0 ? (
          <StatusPill variant="progress" label="In progress" />
        ) : undefined
      }
    >
      {children}
    </StatusCard>
  );
}

/**
 * The shared "open volume" shell: an open-ended requirement with no honest
 * completion target (free electives, an open explore list). A neutral ring shows
 * how many are placed, and an "Open" pill signals it never gates the degree.
 */
export function OpenCard({
  title,
  caption,
  num,
  children,
}: {
  title: string;
  caption?: string;
  num: ReactNode;
  children: ReactNode;
}) {
  return (
    <StatusCard
      tone="missing"
      lead={<RingLead pct={0} num={num} tone="neutral" />}
      title={title}
      caption={caption}
      pill={<StatusPill variant="none" label="Open" />}
    >
      {children}
    </StatusCard>
  );
}
