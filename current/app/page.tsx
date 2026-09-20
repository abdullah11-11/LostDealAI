import type { Metadata } from "next";
import { HomeContent } from "@/components/marketing/home-content";

export const metadata: Metadata = {
  title: "Find the Lost Deals Worth Recovering",
  description: "Turn closed-lost sales data into evidence-grounded analysis, Recovery Scores and clear next actions with LostDeal AI.",
  alternates: { canonical: "/" },
  openGraph: { title: "LostDeal AI — Find the Lost Deals Worth Recovering", description: "Lost deals in. Best recovery opportunities out.", url: "/", images: [{ url: "/og.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: "LostDeal AI — Find the Lost Deals Worth Recovering", description: "Lost deals in. Best recovery opportunities out.", images: ["/og.png"] },
};

export default function Home() { return <HomeContent />; }
