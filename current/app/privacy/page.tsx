import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyPage } from "@/components/marketing/policy-page";
import { approvedLaunchDetails } from "@/lib/marketing/launch";
import { getPolicySections } from "@/lib/marketing/policies";
export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" } };
export default function Page() {
  if (!approvedLaunchDetails) notFound();
  return <PolicyPage title="Privacy Policy" effectiveDate={approvedLaunchDetails.effectiveDate} sections={getPolicySections("privacy", approvedLaunchDetails)} />;
}
