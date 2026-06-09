/**
 * Canonical iconography — one Material Symbol per shared meaning.
 *
 * This is the single source of truth for status/action icons across the app.
 * Do NOT use raw emoji (⏳ ✓ ✗ ↗ ✕) or ad-hoc symbol names for these concepts —
 * import `Icon` / `ICONS` / `StatusIcon` / `Spinner` (see Spinner.tsx) instead.
 */

/** Semantic concept → Material Symbol name. */
export const ICONS = {
  pending:  'hourglass_top',     // waiting on a timelock / not yet ready
  loading:  'progress_activity', // in-flight async work (use <Spinner/>)
  ready:    'bolt',              // ready to execute
  success:  'check_circle',      // done / confirmed
  error:    'cancel',            // failed / rejected
  warn:     'warning',           // caution
  info:     'info',              // neutral note
  copy:     'content_copy',      // copy to clipboard
  copied:   'check',             // copy confirmation
  external: 'open_in_new',       // open in explorer / new tab
  close:    'close',             // dismiss
  check:    'check',             // inline affirmative tick
} as const;

export type IconName = string;

interface IconProps {
  /** Material Symbol name. Prefer `ICONS.<concept>` for shared meanings. */
  name: IconName;
  /** Pixel font-size. Omit to inherit surrounding font-size. */
  size?: number;
  className?: string;
  /** Tooltip text. When set, the icon is exposed to a11y; otherwise it is hidden. */
  title?: string;
}

/** Thin wrapper around a Material Symbol glyph. */
export function Icon({ name, size, className, title }: IconProps): JSX.Element {
  return (
    <span
      className={`material-symbols-outlined${className ? ` ${className}` : ''}`}
      style={size ? { fontSize: size } : undefined}
      title={title}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      {name}
    </span>
  );
}

/** Status kind → icon + Tailwind colour class. */
const STATUS: Record<string, { icon: string; cls: string }> = {
  success: { icon: ICONS.success, cls: 'text-secondary' },
  error:   { icon: ICONS.error,   cls: 'text-error' },
  warn:    { icon: ICONS.warn,    cls: 'text-warn' },
  info:    { icon: ICONS.info,    cls: 'text-primary' },
  pending: { icon: ICONS.pending, cls: 'text-primary' },
  ready:   { icon: ICONS.ready,   cls: 'text-secondary' },
};

export type StatusKind = keyof typeof STATUS;

/** A status glyph with the canonical colour baked in. */
export function StatusIcon({ kind, size, className, title }: {
  kind: StatusKind;
  size?: number;
  className?: string;
  title?: string;
}): JSX.Element {
  const s = STATUS[kind];
  return <Icon name={s.icon} size={size} title={title} className={`${s.cls}${className ? ` ${className}` : ''}`} />;
}
