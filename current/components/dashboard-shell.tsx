"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { BarChart3, BriefcaseBusiness, ChevronDown, CreditCard, LayoutDashboard, ListOrdered, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, UploadCloud } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/brand-logo";
import { useSidebarPreference } from "@/components/device-preferences";
import { Dialog } from "@/components/dialog";
import { WorkspaceAccessProvider, WorkspaceAccessNotice } from "@/components/workspace-access";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/deals", label: "Deals", icon: BriefcaseBusiness },
  { href: "/recovery", label: "Recovery Queue", icon: ListOrdered },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/upload", label: "Imports", icon: UploadCloud },
];
function sectionForPath(pathname: string) {
  if (pathname.startsWith("/deals/")) return "Deal intelligence";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname === "/account") return "Billing & plan";
  return nav.find(item => item.href === pathname)?.label ?? "Workspace";
}
function initialsFor(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "U";
}

export function DashboardShell({ children, organizationName, userName, planName, subscriptionStatus, providerActionsRestricted }: {
  children: React.ReactNode; organizationName: string; userName: string; planName: string | null; subscriptionStatus: string | null; providerActionsRestricted: boolean;
}) {
  const pathname = usePathname();
  const accountMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (accountMenu.current) accountMenu.current.open = false; }, [pathname]);
  useEffect(() => { const close = (event: PointerEvent) => { if (accountMenu.current && !accountMenu.current.contains(event.target as Node)) accountMenu.current.open = false; }; document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close); }, []);
  const { collapsed, toggle } = useSidebarPreference();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeNavigation = () => setMobileOpen(false);
  function links(mobile = false) {
    return <nav aria-label={mobile ? "Mobile workspace navigation" : "Dashboard navigation"} className="space-y-1">
      {nav.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href === "/deals" && pathname.startsWith("/deals/"));
        return <Link key={href} href={href} onClick={closeNavigation} title={label} aria-label={label} aria-current={active ? "page" : undefined} className={`workspace-link flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${active ? "bg-panel text-content shadow-xs ring-1 ring-line" : "text-secondary hover:bg-panel-hover hover:text-content"}`}>
          <Icon aria-hidden="true" className={`size-[18px] shrink-0 ${active ? "text-brand-content" : ""}`} /><span className={mobile ? "" : "sidebar-label"}>{label}</span>
        </Link>;
      })}
    </nav>;
  }
  function settingsLinks(mobile = false) {
    return <nav aria-label={mobile ? "Mobile account navigation" : "Account navigation"} className="space-y-1">
      <a href="/account" title="Billing & plan" aria-label="Billing & plan" onClick={closeNavigation} aria-current={pathname === "/account" ? "page" : undefined} className="workspace-link flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-secondary hover:bg-panel-hover"><CreditCard aria-hidden="true" className="size-[18px] shrink-0" /><span className={mobile ? "" : "sidebar-label"}>Billing &amp; plan</span></a>
      <Link href="/settings" title="Settings" aria-label="Settings" onClick={closeNavigation} aria-current={pathname.startsWith("/settings") ? "page" : undefined} className="workspace-link flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-secondary hover:bg-panel-hover"><Settings aria-hidden="true" className="size-[18px] shrink-0" /><span className={mobile ? "" : "sidebar-label"}>Settings</span></Link>
    </nav>;
  }
  return <WorkspaceAccessProvider access={{ restricted: providerActionsRestricted, status: subscriptionStatus }}><div className="app-workspace min-h-screen bg-background">
    <a className="skip-link" href="#workspace-content">Skip to workspace content</a>
    <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-sidebar lg:flex">
      <div className="flex h-16 items-center px-5"><div className="sidebar-wordmark"><BrandLogo size="sm" /></div><div className="sidebar-iconmark"><BrandLogo compact size="sm" /></div></div>
      <div className="mx-3 mb-5 border-b border-line px-3 pb-5">
        <p className="sidebar-label truncate text-sm font-semibold text-content" title={organizationName}>{organizationName}</p>
        <a href="/account" className="sidebar-label mt-1 inline-flex items-center gap-1.5 text-xs text-secondary">{planName ?? "Plan unavailable"}<span aria-hidden="true">·</span>{subscriptionStatus === "active" ? "Workspace" : subscriptionStatus === "canceled" ? "Read access" : subscriptionStatus?.replaceAll("_", " ") ?? "Status unavailable"}</a>
      </div>
      <div className="flex-1 px-3">{links()}</div>
      <div className="space-y-3 p-3">{settingsLinks()}<button type="button" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} className="workspace-link flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-secondary hover:bg-panel-hover">{collapsed ? <PanelLeftOpen aria-hidden="true" className="size-[18px] shrink-0" /> : <PanelLeftClose aria-hidden="true" className="size-[18px] shrink-0" />}<span className="sidebar-label">Collapse sidebar</span></button></div>
    </aside>
    <div className="app-content min-w-0">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-panel/95 px-4 backdrop-blur-sm sm:px-7">
        <div className="flex min-w-0 items-center gap-3"><button type="button" onClick={() => setMobileOpen(true)} aria-label="Open workspace navigation" aria-expanded={mobileOpen} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-panel-hover lg:hidden"><Menu aria-hidden="true" className="size-5" /></button><span className="truncate text-sm font-medium text-content">{sectionForPath(pathname)}</span></div>
        <details ref={accountMenu} className="relative" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
          <summary className="flex min-h-11 list-none items-center gap-2 rounded-lg px-2 text-sm text-secondary hover:bg-panel-hover [&::-webkit-details-marker]:hidden" aria-label={`Account menu for ${userName}`}><span className="flex size-8 items-center justify-center rounded-full bg-panel-hover text-xs font-semibold text-content">{initialsFor(userName)}</span><span className="hidden sm:inline">{userName}</span><ChevronDown aria-hidden="true" className="size-4" /></summary>
          <div className="absolute right-0 top-13 w-64 rounded-xl border border-line bg-panel p-2 shadow-lg">
            <div className="border-b border-line px-3 py-3"><p className="truncate text-sm font-semibold text-content">{userName}</p><p className="mt-1 truncate text-xs text-secondary">{organizationName}</p></div>
            <Link href="/settings/account" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-panel-hover">Account settings</Link><a href="/account" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-panel-hover">Billing &amp; plan</a><form action={logoutAction}><button aria-label="Log out" className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-panel-hover" type="submit"><LogOut aria-hidden="true" className="size-4" />Log out</button></form>
          </div>
        </details>
      </header>
      <main id="workspace-content" className="min-w-0 px-4 py-6 sm:px-7 sm:py-8 lg:px-9"><WorkspaceAccessNotice />{children}</main>
    </div>
    <Dialog open={mobileOpen} onClose={closeNavigation} title={organizationName} description={planName ?? "Your workspace"} className="nav-dialog"><div className="space-y-6">{links(true)}<div className="border-t border-line pt-4">{settingsLinks(true)}</div></div></Dialog>
  </div></WorkspaceAccessProvider>;
}
