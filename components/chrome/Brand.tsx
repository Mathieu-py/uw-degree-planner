import Link from "next/link";

interface BrandProps {
  /** Render the muted "· planner" subtitle after the name. */
  sub?: boolean;
  href?: string;
  className?: string;
}

/**
 * Wordmark: the CSS brand-mark square (ink with a gold diagonal + mono "W")
 * plus the product name. Used in the nav and footer. The mark styling lives in
 * globals.css (`.brand`, `.brand-mark`).
 */
export function Brand({ sub = false, href = "/", className }: BrandProps) {
  return (
    <Link href={href} className={`brand ${className ?? ""}`.trim()}>
      <span className="brand-mark" aria-hidden="true">
        <span>W</span>
      </span>
      <span className="brand-name">
        UW Degree Planner{sub ? <span className="sub"> · planner</span> : null}
      </span>
    </Link>
  );
}
