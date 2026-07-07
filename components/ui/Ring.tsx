/** SVG donut progress ring. Geometry per the design handoff. */
export function Ring({
  pct,
  size = 34,
  stroke = 3.5,
  tone,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  /** "neutral" → a muted (non-green) fill, for optional groups with no target. */
  tone?: "neutral";
}) {
  const r = (size - stroke) / 2;
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
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="av-ring-fill"
        style={{ transition: "stroke-dashoffset .4s ease" }}
      />
    </svg>
  );
}
