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
    <section className="panel p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="panel-glyph">
          <span className="material-symbols-outlined text-primary text-lg">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-headline text-[15px] font-semibold tracking-tight text-on-surface m-0">{title}</h3>
          {subtitle && <p className="text-[12px] text-on-surface-variant m-0 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
