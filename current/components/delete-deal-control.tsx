"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2 } from "lucide-react";

import { Dialog } from "@/components/dialog";
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

  return <div>
    <button type="button" onClick={() => { setConfirming(true); setError(null); }} className={buttonStyles("outline", "border-red-500/35 text-danger-content hover:bg-red-500/10")}><Trash2 aria-hidden="true" className="size-4" /> Delete Deal</button>
    <Dialog open={confirming} closeDisabled={deleting} onClose={() => { if (!deleting) { setConfirming(false); setError(null); } }} title="Permanently delete this deal?" description="This action cannot be undone.">
      <p className="text-base leading-7 text-secondary">Deleting this deal removes the stored deal and its LostDeal AI analysis from this workspace. Recorded usage is preserved.</p>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={deleting} onClick={() => { setConfirming(false); setError(null); }} className={buttonStyles("outline")}>Cancel</button><button type="button" disabled={deleting} onClick={() => void deleteDeal()} className={buttonStyles("destructive")}>{deleting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Trash2 aria-hidden="true" className="size-4" />}{deleting ? "Deleting…" : "Yes, Delete Deal"}</button></div>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger-content">{error}</p>}
    </Dialog>
  </div>;
}
