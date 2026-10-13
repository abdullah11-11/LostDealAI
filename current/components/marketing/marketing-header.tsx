"use client";

import { ArrowUpRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { MARKETING_NAVIGATION } from "@/lib/marketing/content";
import { marketingButtonStyles } from "@/components/marketing/marketing-primitives";

export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const navigationToggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
        setOpen(false);
        navigationToggle.current?.focus();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-marketing-line/80 bg-marketing-ivory/94 backdrop-blur-md">
      <div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-10">
        <BrandLogo size="sm" />

        <nav aria-label="Marketing navigation" className="hidden items-center gap-1 lg:flex">
          {MARKETING_NAVIGATION.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-full px-4 py-2 text-sm font-bold text-marketing-slate transition-colors hover:bg-marketing-cream hover:text-marketing-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marketing-orange"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            href="/login"
            className="rounded-full px-4 py-2 text-sm font-bold text-marketing-slate transition-colors hover:text-marketing-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marketing-orange"
          >
            Sign In
          </Link>
          <Link href="/product" className={marketingButtonStyles("primary", "min-h-10 px-4")}>
            Explore Product <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </div>

        <button
          ref={navigationToggle}
          type="button"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="marketing-mobile-navigation"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex size-11 items-center justify-center rounded-full border border-marketing-line bg-marketing-white text-marketing-ink transition-colors hover:border-marketing-ink lg:hidden"
        >
          {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
        </button>
      </div>

      <nav
        id="marketing-mobile-navigation"
        aria-label="Mobile marketing navigation"
        hidden={!open}
        className="border-t border-marketing-line bg-marketing-ivory px-5 pb-5 pt-3 lg:hidden"
      >
        <div className="mx-auto grid max-w-7xl gap-1">
          {MARKETING_NAVIGATION.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-base font-bold text-marketing-ink transition-colors hover:bg-marketing-cream"
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-marketing-line pt-4">
            <Link href="/login" onClick={() => setOpen(false)} className={marketingButtonStyles("secondary", "px-3")}>Sign In</Link>
            <Link href="/product" onClick={() => setOpen(false)} className={marketingButtonStyles("primary", "px-3")}>Explore</Link>
          </div>
        </div>
      </nav>
    </header>
  );
}
