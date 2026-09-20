import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { buttonStyles } from "@/components/ui";

export const metadata: Metadata = { title: "Authentication issue" };

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background px-5 py-6 sm:px-10">
      <BrandLogo size="lg" />
      <section className="mx-auto flex w-full max-w-lg flex-1 items-center py-12">
        <div className="w-full rounded-2xl border border-line bg-panel px-6 py-10 text-center shadow-sm sm:px-10">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-red-500/10 text-danger-content">
            <CircleAlert aria-hidden="true" className="size-7" />
          </span>
          <h1 className="mt-7 text-3xl font-semibold tracking-tight text-content">We could not confirm that link</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-secondary">
            The confirmation link may be incomplete or expired. Request a new link by creating your account again, or log in if your email is already confirmed.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/login" className={buttonStyles("primary")}>Go to login</Link>
            <Link href="/signup" className={buttonStyles("outline")}>Create account</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
