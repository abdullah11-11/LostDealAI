import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { ThemeSelector } from "@/components/theme-selector";
import { DensitySelector } from "@/components/device-preferences";
import { requireOrganization } from "@/lib/auth/server";

export const metadata: Metadata = { title: "General settings" };
export const dynamic = "force-dynamic";
export default async function GeneralSettings() {
  const { organization } = await requireOrganization("/settings");
  return <><Card title="Appearance" description="These preferences apply to this browser, including when you return."><div className="settings-row"><div><h3 className="text-sm font-medium">Theme</h3><p className="mt-1 text-sm text-secondary">Light, dark, or your device’s appearance.</p></div><ThemeSelector compact /></div><div className="settings-row"><div><h3 className="text-sm font-medium">Table density</h3><p className="mt-1 text-sm text-secondary">Choose more breathing room or tighter rows.</p></div><DensitySelector /></div></Card><Card title="Workspace"><div className="settings-row"><div><h3 className="text-sm font-medium">Name</h3><p className="mt-1 break-words text-base text-secondary">{organization.name}</p></div></div><div className="settings-row"><div><h3 className="text-sm font-medium">Industry</h3><p className="mt-1 text-base text-secondary">{organization.industry || "Not recorded"}</p></div></div><div className="settings-row"><p className="text-sm leading-6 text-secondary">Workspace details are read only here. Appearance preferences affect this device; they do not change shared workspace data.</p></div></Card></>;
}
