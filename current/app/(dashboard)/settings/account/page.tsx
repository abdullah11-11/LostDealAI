import type { Metadata } from "next";
import Link from "next/link";
import { Card, Badge, buttonStyles } from "@/components/ui";
import { ProfileSettings } from "@/components/profile-settings";
import { requireOrganization } from "@/lib/auth/server";
import { logoutAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Account settings" };
export const dynamic = "force-dynamic";
export default async function AccountSettings() {
  const context = await requireOrganization("/settings/account");
  return <><Card title="Your profile" description="Manage the name shown in LostDeal."><ProfileSettings fullName={context.profileFullName || ""} /><div className="settings-row"><div><h3 className="text-sm font-medium">Sign-in email</h3><p className="mt-1 break-all text-base text-secondary">{context.identity.email}</p><p className="mt-2 text-xs text-secondary">Email changes are not available in this workspace.</p></div></div></Card><Card title="Workspace access"><div className="settings-row"><div><h3 className="text-sm font-medium">{context.organization.name}</h3><p className="mt-1 text-sm text-secondary">Your permissions are managed separately from profile details.</p></div><Badge>{context.organization.role === "owner" ? "Owner" : "Member"}</Badge></div></Card><Card title="Sign-in & session"><div className="settings-row"><div><h3 className="text-sm font-medium">Password</h3><p className="mt-1 text-sm text-secondary">Use the secure email recovery flow to set a new password.</p></div><Link href="/forgot-password" className={buttonStyles("outline")}>Reset password</Link></div><div className="settings-row"><div><h3 className="text-sm font-medium">Log out</h3><p className="mt-1 text-sm text-secondary">End your current LostDeal session.</p></div><form action={logoutAction}><button type="submit" className={buttonStyles("outline")}>Log out</button></form></div></Card></>;
}
