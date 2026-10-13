"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/page-heading";

const sections = [
  { href: "/settings", label: "General" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/analysis", label: "Analysis & data" },
  { href: "/settings/privacy", label: "Privacy & security" },
  { href: "/account", label: "Billing & plan" },
  { href: "/settings/help", label: "Help" },
];
export function SettingsFrame({ children, title = "Settings", description = "Make the workspace work for you. Manage your account, data and plan in one place." }: { children: React.ReactNode; title?: string; description?: string }) {
  const pathname = usePathname();
  return <div className="mx-auto max-w-6xl"><PageHeader title={title} description={description} /><div className="mt-7 grid items-start gap-6 lg:grid-cols-[190px_minmax(0,1fr)]"><nav aria-label="Settings sections" className="flex flex-wrap gap-1 lg:flex-col">{sections.map(item => item.href === "/account" ? <a key={item.href} href="/account" aria-current={pathname === item.href ? "page" : undefined} className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${pathname === item.href ? "bg-panel text-content ring-1 ring-line" : "text-secondary hover:bg-panel-hover"}`}>{item.label}</a> : <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${pathname === item.href ? "bg-panel text-content ring-1 ring-line" : "text-secondary hover:bg-panel-hover"}`}>{item.label}</Link>)}</nav><div className="min-w-0 space-y-6">{children}</div></div></div>;
}
