import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyPage } from "@/components/marketing/policy-page";
import { approvedLaunchDetails } from "@/lib/marketing/launch";
import { getPolicySections } from "@/lib/marketing/policies";
export const metadata: Metadata = { title: "Terms of Service", alternates: { canonical: "/terms" } };
export default function Page() {
  if (!approvedLaunchDetails) notFound();
  return <PolicyPage title="Terms of Service" effectiveDate={approvedLaunchDetails.effectiveDate} sections={getPolicySections("terms", approvedLaunchDetails)} />;
}
