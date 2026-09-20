"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2 } from "lucide-react";

import { buttonStyles } from "@/components/ui";

export function DeleteDealControl({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteDeal() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch("/api/deals/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deal_id: dealId }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(payload?.error || "The deal could not be deleted right now.");
        return;
      }
      router.replace("/deals?notice=deleted");
      router.refresh();
    } catch {
      setError("The deal could not be deleted right now.");
    } finally {
      setDeleting(false);
    }
  }

  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          onClick={() => { setConfirming(true); setError(null); }}
          className={buttonStyles("outline", "border-red-500/35 text-danger-content hover:bg-red-500/10")}
        >
          <Trash2 aria-hidden="true" className="size-4" /> Delete Deal
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-red-500/35 bg-red-500/10 p-4">
      <p className="text-sm font-bold text-danger-content">Permanently delete this deal?</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-danger-content">
        Deleting this deal removes the stored deal and its LostDeal AI analysis from this workspace. This action cannot be undone.
      </p>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          disabled={deleting}
          onClick={() => { setConfirming(false); setError(null); }}
          className={buttonStyles("outline")}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={() => void deleteDeal()}
          className={buttonStyles("destructive")}
        >
          {deleting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Trash2 aria-hidden="true" className="size-4" />}
          {deleting ? "Deleting…" : "Yes, Delete Deal"}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger-content">{error}</p>}
    </div>
  );
}
