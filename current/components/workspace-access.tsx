"use client";

import { createContext, useContext, type ReactNode } from "react";

type WorkspaceAccess = { restricted: boolean; status: string | null };
const AccessContext = createContext<WorkspaceAccess>({ restricted: false, status: null });

/** Presentation only. Every mutation retains its independent server authorization. */
export function WorkspaceAccessProvider({ access, children }: { access: WorkspaceAccess; children: ReactNode }) {
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}
export function useWorkspaceAccess() { return useContext(AccessContext); }

export function WorkspaceAccessNotice() {
  const access = useWorkspaceAccess();
  if (!access.restricted) return null;
  return <aside className="mb-6 flex flex-col gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
    <p className="text-secondary"><strong className="font-semibold text-content">{access.status === "canceled" ? "Your subscription has ended." : access.status === "past_due" ? "Your payment needs attention." : access.status === "paused" ? "Your subscription is paused." : "Plan access is temporarily unavailable."}</strong> Your saved deals and analyses remain readable. New imports and AI work need an active plan.</p>
    <a href="/account" className="shrink-0 rounded-md py-2 font-semibold text-brand-content hover:underline">Review billing</a>
  </aside>;
}
