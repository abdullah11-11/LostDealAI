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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {eyebrow && <p className="text-xs font-semibold text-secondary">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-content sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-base leading-6 text-secondary">{description}</p>
      </div>
      {action}
    </div>
  );
}

export const PageHeading = PageHeader;
