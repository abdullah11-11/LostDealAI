"use client";

import { buttonStyles } from "@/components/ui";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[65vh] max-w-xl items-center">
      <div className="w-full rounded-2xl border border-red-500/35 bg-panel p-8 text-center">
        <p className="text-sm font-bold text-danger-content">Dashboard error</p>
        <h1 className="mt-3 text-xl font-bold text-content">This view could not load</h1>
        <p className="mt-2 text-sm text-secondary">Your data has not been changed.</p>
        <button onClick={reset} className={buttonStyles("primary", "mt-6")}>Try Again</button>
      </div>
    </div>
  );
}
