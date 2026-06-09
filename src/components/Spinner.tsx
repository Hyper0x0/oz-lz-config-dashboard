import { ICONS } from './Icon';

/**
 * The one spinner used everywhere (scan, send, RPC test, …).
 * Replaces ad-hoc `animate-spin progress_activity` spans and pulsing emoji.
 */
export function Spinner({ size = 'md', className }: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}): JSX.Element {
  const px = size === 'sm' ? 14 : size === 'lg' ? 22 : 18;
  return (
    <span
      className={`material-symbols-outlined animate-spin${className ? ` ${className}` : ''}`}
      style={{ fontSize: px }}
      aria-hidden
    >
      {ICONS.loading}
    </span>
  );
}
