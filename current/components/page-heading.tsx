export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="text-xs font-bold tracking-[0.08em] text-brand-content">{eyebrow}</p>}
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.025em] text-content sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">{description}</p>
      </div>
      {action}
    </div>
  );
}

export const PageHeading = PageHeader;
