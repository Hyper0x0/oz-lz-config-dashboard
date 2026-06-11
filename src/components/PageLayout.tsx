interface PageLayoutProps {
  main: React.ReactNode;
  sidebar: React.ReactNode;
}

export function PageLayout({ main, sidebar }: PageLayoutProps): JSX.Element {
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-8 space-y-6 panel-stack">{main}</div>
      <div className="col-span-12 lg:col-span-4">
        <div className="sticky top-[88px] space-y-6">{sidebar}</div>
      </div>
    </div>
  );
}
