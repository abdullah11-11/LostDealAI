"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, ChevronRight, CircleUserRound, Gauge, LogOut, UploadCloud } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeSelector } from "@/components/theme-selector";

const nav = [
  { href: "/dashboard", label: "Overview", icon: BarChart3 },
  { href: "/deals", label: "Deals", icon: Building2 },
  { href: "/upload", label: "Upload Deals", icon: UploadCloud },
];

function sectionForPath(pathname: string) {
  if (pathname.startsWith("/deals/")) return "Deal Intelligence";
  if (pathname === "/deals") return "Lost Deals";
  if (pathname === "/upload") return "Upload Deals";
  if (pathname === "/account") return "Plan & Usage";
  return "Recovery Overview";
}

function NavLinks({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard navigation" className={mobile ? "flex min-w-max gap-1.5" : "space-y-1.5"}>
      {nav.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href === "/deals" && pathname.startsWith("/deals/"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 ${active ? "border-brand/25 bg-brand/10 text-brand-content" : "border-transparent text-secondary hover:bg-panel-hover hover:text-content"}`}
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

export function DashboardShell({ children, organizationName, userName }: {
  children: React.ReactNode;
  organizationName: string;
  userName: string;
}) {
  const pathname = usePathname();
  const initials = initialsFor(userName);
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-sidebar lg:flex lg:flex-col">
        <div className="flex h-16 items-center border-b border-line px-5"><BrandLogo /></div>
        <div className="flex-1 px-3 py-4">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Workspace</p>
          <NavLinks />
        </div>
        <div className="border-t border-line p-3">
          <div className="rounded-xl border border-line bg-panel p-3">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-raised text-secondary">
                <CircleUserRound aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-content">{organizationName}</p>
                <p className="mt-0.5 truncate text-[11px] text-secondary">{userName}</p>
              </div>
            </div>
            <div className="mt-3 border-t border-line pt-3"><ThemeSelector /></div>
            <a href="/account" className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-secondary transition-colors hover:bg-panel-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">
              <Gauge aria-hidden="true" className="size-3.5" /> Plan &amp; Usage
            </a>
            <form action={logoutAction}>
              <button type="submit" className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-secondary transition-colors hover:bg-panel-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">
                <LogOut aria-hidden="true" className="size-3.5" /> Log out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-line bg-background/95 backdrop-blur-sm">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden"><BrandLogo compact /></div>
            <div className="hidden min-w-0 lg:block">
              <p className="truncate text-xs font-semibold text-muted">{organizationName}</p>
              <p className="mt-0.5 text-sm font-bold text-content">{sectionForPath(pathname)}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="lg:hidden"><ThemeSelector compact /></div>
              <a href="/account" className="flex size-9 items-center justify-center rounded-lg border border-line-strong bg-panel text-xs font-extrabold text-secondary lg:hidden" title={`${organizationName} · ${userName} · Plan & Usage`} aria-label={`${organizationName}, signed in as ${userName}. Open Plan and Usage.`}>
                {initials}
              </a>
              <form action={logoutAction} className="lg:hidden">
                <button type="submit" aria-label="Log out" title="Log out" className="flex size-9 items-center justify-center rounded-lg border border-line-strong bg-panel text-secondary transition-colors hover:bg-panel-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">
                  <LogOut aria-hidden="true" className="size-4" />
                </button>
              </form>
              <Link href="/upload" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-brand bg-brand px-3.5 text-sm font-bold text-on-brand transition-colors hover:border-brand-hover hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">
                <span className="hidden sm:inline">Import deals</span><span className="sm:hidden">Import</span><ChevronRight aria-hidden="true" className="size-3.5" />
              </Link>
            </div>
          </div>
          <div className="overflow-x-auto border-t border-line px-3 py-2 lg:hidden"><NavLinks mobile /></div>
        </header>
        <main className="min-w-0 px-4 py-6 sm:px-6 sm:py-7 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
