import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Ring } from "@/components/ui/Ring";
import { formatCourseCode, progressPct } from "@/lib/format";

export type PillVariant = "progress" | "none" | "decide" | "note";

/** The status pill parked top-right in a Status Card header. */
export function StatusPill({
  variant,
  label,
}: {
  variant: PillVariant;
  label: string;
}) {
  return <span className={`cd-pill ${variant}`}>{label}</span>;
}

/** A satisfied course/option — the green "met" chip. Code only; the course
 *  name lives in the tooltip to keep the row compact. */
export function MetChip({ code, name }: { code: string; name?: string }) {
  const label = formatCourseCode(code);
  return (
    <span className="cd-chip met" title={name ? `${label} — ${name}` : label}>
      <Icon name="check" size="xs" aria-hidden="true" />
      {label}
    </span>
  );
}

/** A course placed illegally (before its prereqs / in an antireq conflict) —
 *  shown, but not credited until the placement is valid. */
export function WarnChip({ code, name }: { code: string; name?: string }) {
  const label = formatCourseCode(code);
  return (
    <span
      className="cd-chip warn"
      title={`${label}${name ? ` — ${name}` : ""} is placed before its prereqs or in an antireq conflict — it shows on your timeline, but doesn't credit the degree until the placement is valid.`}
    >
      <Icon name="warning" size="xs" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * The browse action — a dashed split-row parked at the foot of a criteria-based
 * card body (subject pool / breadth / open elective). The left descriptor bakes
 * in the outstanding amount ("Add 1 more"); the right action opens the catalog
 * picker. Callers omit it entirely in the read-only view (no `onDrill`).
 */
export function FindRow({
  label,
  onFind,
}: {
  label: string;
  onFind: () => void;
}) {
  return (
    <button
      type="button"
      className="br4-dash br4-split"
      onClick={onFind}
      aria-label={`${label} — find courses`}
    >
      <span className="lbl">{label}</span>
      <span className="act">
        <Icon name="search" size="xs" aria-hidden="true" />
        Find courses
      </span>
    </button>
  );
}

/** Status lead: a progress ring with its satisfied count centred inside. Reuses
 *  the existing `.av-ring-*` overlay so `Ring` stays a shared primitive. */
export function RingLead({
  pct,
  num,
  tone,
}: {
  pct: number;
  num: ReactNode;
  tone?: "neutral";
}) {
  return (
    <span className="av-ring-wrap">
      <Ring pct={pct} tone={tone} />
      <span className="av-ring-num">{num}</span>
    </span>
  );
}

/** Status lead for advisory (non-progress) requirements: a neutral glyph that
 *  sets notes apart from actionable, ring-bearing cards. */
export function GlyphLead({ name }: { name: IconName }) {
  return (
    <span className="cd-glyph">
      <Icon name={name} size="sm" aria-hidden="true" />
    </span>
  );
}

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
