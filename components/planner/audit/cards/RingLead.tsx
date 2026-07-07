import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Ring } from "@/components/ui/Ring";

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
