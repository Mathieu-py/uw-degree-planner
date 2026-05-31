interface SkeletonProps {
  /** Extra classes for sizing (e.g. "h-4 w-32"). */
  className?: string;
}

/**
 * Shimmer placeholder for loading states. Wraps the `.sk` class (which owns
 * the shimmer keyframes) from globals.css; pass width/height via `className`.
 */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden="true" className={`sk ${className ?? ""}`.trim()} />;
}
