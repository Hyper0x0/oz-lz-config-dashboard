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
    <section className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-primary text-lg">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-headline text-base font-bold text-on-surface m-0">{title}</h3>
          {subtitle && <p className="text-[11px] text-on-surface-variant m-0">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
