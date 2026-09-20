"use client";

import Link from "next/link";
import { buttonStyles } from "@/components/ui";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-panel p-8 text-center">
        <p className="text-sm font-bold text-danger-content">Something went wrong</p>
        <h1 className="mt-3 text-2xl font-semibold text-content">LostDeal AI could not load this page</h1>
        <p className="mt-3 text-sm leading-6 text-secondary">No data was changed. Try loading the page again.</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button onClick={reset} className={buttonStyles()}>Try Again</button>
          <Link href="/" className={buttonStyles("outline")}>Go Home</Link>
        </div>
      </div>
    </main>
  );
}
