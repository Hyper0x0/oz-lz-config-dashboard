interface SectionProps {
  icon: string;
  title: string;
  subtitle?: string;
  /** Optional content rendered to the right of the title row */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function Section({ icon, title, subtitle, actions, children }: SectionProps): JSX.Element {
  return (
    <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-primary text-lg">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-headline text-[15px] font-semibold text-on-surface m-0">{title}</h3>
          {subtitle && <p className="text-[12px] text-on-surface-variant m-0 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
