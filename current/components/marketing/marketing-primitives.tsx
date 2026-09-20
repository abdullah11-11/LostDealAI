import Link from "next/link";
import type { ReactNode } from "react";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function marketingButtonStyles(
  variant: "primary" | "secondary" | "dark" = "primary",
  className?: string,
) {
  return classes(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-extrabold transition-[transform,background-color,border-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marketing-orange focus-visible:ring-offset-2 active:translate-y-px",
    variant === "primary" && "border border-marketing-orange bg-marketing-orange text-marketing-ink hover:border-marketing-orange-dark hover:bg-marketing-orange-dark hover:text-white focus-visible:ring-offset-marketing-ivory",
    variant === "secondary" && "border border-marketing-line bg-marketing-white text-marketing-ink hover:border-marketing-ink hover:bg-marketing-cream focus-visible:ring-offset-marketing-ivory",
    variant === "dark" && "border border-white/20 bg-marketing-white/8 text-white hover:border-white/35 hover:bg-marketing-white/14 focus-visible:ring-offset-marketing-ink",
    className,
  );
}

export function MarketingLinkButton({
  href,
  children,
  variant = "primary",
  className,
  ...props
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "dark";
  className?: string;
} & Omit<React.ComponentProps<typeof Link>, "href" | "children" | "className">) {
  return (
    <Link href={href} className={marketingButtonStyles(variant, className)} {...props}>
      {children}
    </Link>
  );
}

export function MarketingEyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p className={classes(
      "text-xs font-black uppercase tracking-[0.18em]",
      dark ? "text-marketing-orange-soft" : "text-marketing-orange-dark",
    )}>
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  dark = false,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  dark?: boolean;
  className?: string;
}) {
  return (
    <div className={classes(
      "max-w-3xl",
      align === "center" && "mx-auto text-center",
      className,
    )}>
      <MarketingEyebrow dark={dark}>{eyebrow}</MarketingEyebrow>
      <h2 className={classes(
        "mt-4 text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-4xl lg:text-5xl",
        dark ? "text-white" : "text-marketing-ink",
      )}>
        {title}
      </h2>
      {description && (
        <p className={classes(
          "mt-5 text-pretty text-base leading-7 sm:text-lg sm:leading-8",
          dark ? "text-marketing-ink-muted" : "text-marketing-slate",
        )}>
          {description}
        </p>
      )}
    </div>
  );
}

export function MarketingSection({
  children,
  id,
  className,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={classes("scroll-mt-24 px-5 py-20 sm:px-8 sm:py-24 lg:px-10 lg:py-30", className)}>
      <div className="mx-auto max-w-7xl">{children}</div>
    </section>
  );
}

export function SectionNumber({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex size-10 items-center justify-center rounded-full border border-marketing-orange/35 bg-marketing-orange-soft text-xs font-black text-marketing-orange-dark">
      {children}
    </span>
  );
}
