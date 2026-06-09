import { Icon } from './Icon';

const VARIANTS = {
  success: 'bg-secondary/10 text-secondary border-secondary/25',
  warn:    'bg-warn/10 text-warn border-warn/25',
  error:   'bg-error/10 text-error border-error/25',
  info:    'bg-primary/10 text-primary border-primary/25',
  neutral: 'bg-surface-container text-on-surface-variant border-outline-variant/25',
  stark:   'bg-tertiary/10 text-tertiary border-tertiary/25',
} as const;

export type BadgeVariant = keyof typeof VARIANTS;

/** Small pill label with a colour variant and optional leading icon. */
export function Badge({ variant = 'neutral', icon, children, className }: {
  variant?: BadgeVariant;
  /** Material Symbol name (prefer `ICONS.<concept>`). */
  icon?: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium leading-none ${VARIANTS[variant]}${className ? ` ${className}` : ''}`}
    >
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
