import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { buttonStyles } from "@/components/ui";

export const metadata: Metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background px-5 py-6 sm:px-10">
      <BrandLogo size="lg" />
      <section className="mx-auto flex w-full max-w-lg flex-1 items-center py-12">
        <div className="w-full rounded-2xl border border-line bg-panel px-6 py-10 text-center shadow-sm sm:px-10">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <MailCheck aria-hidden="true" className="size-7" />
          </span>
          <p className="mt-7 text-xs font-bold uppercase tracking-[0.16em] text-brand">One more step</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-content">Check your email</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-secondary">
            Use the verification link in your email to confirm your LostDeal AI account. After confirmation, you’ll continue to workspace setup.
          </p>
          <p className="mt-4 text-xs leading-5 text-secondary">If you do not see it, check spam or wait a few minutes before trying again.</p>
          <Link href="/login" className={buttonStyles("outline", "mt-8")}>Return to login</Link>
        </div>
      </section>
    </main>
  );
}
