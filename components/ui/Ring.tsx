// Locked stroke-to-size ratio (3.5 at 34px, per the design handoff) so a larger
// ring is a scaled smaller one rather than a differently-proportioned shape (#141).
const RING_RATIO = 3.5 / 34;

/** SVG donut progress ring. Geometry per the design handoff. */
export function Ring({
  pct,
  size = 34,
  stroke,
  tone,
}: {
  pct: number;
  size?: number;
  /** Override the derived stroke; defaults to the locked size×ratio. */
  stroke?: number;
  /** "neutral" → a muted (non-green) fill, for optional groups with no target. */
  tone?: "neutral";
}) {
  const strokeW = stroke ?? size * RING_RATIO;
  const r = (size - strokeW) / 2;
  const circ = 2 * Math.PI * r;
  const clampedPct = Math.max(0, Math.min(pct, 100));
  const offset = circ * (1 - clampedPct / 100);
  const color =
    tone === "neutral"
      ? "var(--ink-3)"
      : pct >= 100
        ? "var(--met)"
        : pct > 0
          ? "var(--partial)"
          : "var(--missing)";
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flex: "none" }}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--bg-3)"
        strokeWidth={strokeW}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="av-ring-fill"
      />
    </svg>
  );
}
