import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TableHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { LoaderCircle } from "lucide-react";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "border border-brand bg-brand text-on-brand hover:border-brand-hover hover:bg-brand-hover",
  secondary: "border border-line-strong bg-panel-raised text-content hover:bg-panel-hover",
  outline: "border border-line-strong bg-panel text-content hover:border-brand/45 hover:bg-panel-raised",
  ghost: "border border-transparent text-secondary hover:bg-panel-hover hover:text-content",
  destructive: "border border-red-500 bg-destructive text-white hover:bg-red-700",
};

export function buttonStyles(variant: ButtonVariant = "primary", className?: string) {
  return cn(
    "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:border-line disabled:bg-panel-hover disabled:text-disabled disabled:opacity-80",
    buttonVariants[variant],
    className,
  );
}

export function Button({
  variant = "primary",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button className={buttonStyles(variant, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ title, description, action, children, className }: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={cn("rounded-2xl border border-line bg-panel", className)}>
      {(title || description || action) && (
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            {title && <h2 className="text-base font-bold text-content">{title}</h2>}
            {description && <p className="mt-1 text-sm leading-6 text-secondary">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </article>
  );
}

type BadgeTone = "high" | "medium" | "low" | "pending" | "completed" | "failed" | "demo" | "neutral";

const badgeTones: Record<BadgeTone, string> = {
  high: "border-red-500/35 bg-red-500/10 text-danger-content",
  medium: "border-amber-500/35 bg-amber-500/10 text-warning-content",
  low: "border-slate-500/40 bg-slate-500/10 text-low-content",
  pending: "border-blue-500/35 bg-blue-500/10 text-info-content",
  completed: "border-emerald-500/35 bg-emerald-500/10 text-success-content",
  failed: "border-red-500/35 bg-red-500/10 text-danger-content",
  demo: "border-violet-500/35 bg-violet-500/10 text-demo-content",
  neutral: "border-line-strong bg-panel-raised text-secondary",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em]", badgeTones[tone], className)}>{children}</span>;
}

function FieldFrame({ id, label, description, error, children }: {
  id: string;
  label: string;
  description?: string;
  error?: string;
  children: ReactNode;
}) {
  const helperId = description || error ? `${id}-help` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-content">{label}</label>
      <div className="mt-2">{children}</div>
      {(error || description) && <p id={helperId} className={cn("mt-2 text-xs leading-5", error ? "text-danger-content" : "text-secondary")}>{error || description}</p>}
    </div>
  );
}

const fieldStyles = "h-11 w-full rounded-lg border border-line-strong bg-panel px-3.5 text-sm text-content outline-none transition-colors placeholder:text-muted hover:border-brand/45 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-panel-hover disabled:text-disabled";

export function Input({ id, label, description, error, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; description?: string; error?: string }) {
  const helperId = description || error ? `${id}-help` : undefined;
  return <FieldFrame id={id} label={label} description={description} error={error}><input id={id} aria-describedby={helperId} aria-invalid={Boolean(error) || undefined} className={cn(fieldStyles, error && "border-red-500 focus:border-red-400 focus:ring-red-500/20", className)} {...props} /></FieldFrame>;
}

export function Select({ id, label, description, error, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { id: string; label: string; description?: string; error?: string }) {
  const helperId = description || error ? `${id}-help` : undefined;
  return <FieldFrame id={id} label={label} description={description} error={error}><select id={id} aria-describedby={helperId} aria-invalid={Boolean(error) || undefined} className={cn(fieldStyles, error && "border-red-500 focus:border-red-400 focus:ring-red-500/20", className)} {...props}>{children}</select></FieldFrame>;
}

export function Textarea({ id, label, description, error, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { id: string; label: string; description?: string; error?: string }) {
  const helperId = description || error ? `${id}-help` : undefined;
  return <FieldFrame id={id} label={label} description={description} error={error}><textarea id={id} aria-describedby={helperId} aria-invalid={Boolean(error) || undefined} className={cn(fieldStyles, "min-h-28 resize-y py-3", error && "border-red-500 focus:border-red-400 focus:ring-red-500/20", className)} {...props} /></FieldFrame>;
}

export function Table({ label, headers, children, className, ...props }: TableHTMLAttributes<HTMLTableElement> & { label: string; headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full min-w-[760px] text-left", className)} aria-label={label} {...props}>
        <thead className="border-y border-line bg-panel-raised text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary"><tr>{headers.map((header) => <th key={header} scope="col" className="whitespace-nowrap px-5 py-3.5">{header}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-panel-raised px-6 py-10 text-center">
      {icon && <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-panel text-brand">{icon}</div>}
      <h3 className="mt-4 text-sm font-bold text-content">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-secondary">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-lg bg-panel-hover", className)} />;
}

export function StatCard({ label, value, context, status, icon, loading = false }: {
  label: string;
  value: string;
  context: string;
  status?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4"><div className="flex size-9 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-brand">{icon}</div>{status}</div>
      {loading ? <Skeleton className="mt-4 h-8 w-32" /> : <p className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-content">{value}</p>}
      <p className="mt-2 text-sm font-bold text-content">{label}</p>
      <p className="mt-1 text-xs leading-5 text-secondary">{context}</p>
    </article>
  );
}
