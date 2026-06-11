/**
 * Loading skeleton — shimmering placeholder for content that is still loading.
 *
 * Canonical loading affordance for laid-out content (lists, result rows, cards).
 * For in-flight async work on a button or inline status, prefer `<Spinner>`.
 */

interface SkeletonProps {
  /** Tailwind sizing/spacing classes (e.g. `h-4 w-32`). */
  className?: string;
}

/** A single shimmering bar. */
export function Skeleton({ className }: SkeletonProps): JSX.Element {
  return <span className={`skeleton${className ? ` ${className}` : ''}`} />;
}

/** A stack of `rows` skeleton bars — the common "loading a list/result" shape. */
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }): JSX.Element {
  return (
    <div className={`flex flex-col gap-2${className ? ` ${className}` : ''}`}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
