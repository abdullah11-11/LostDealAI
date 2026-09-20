"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, LoaderCircle } from "lucide-react";

import { buttonStyles } from "@/components/ui";

type BatchResult = {
  selected: number;
  completed: number;
  failed: number;
  skipped: number;
  remainingPending: number;
};

export function AnalyzePendingDeals({ pendingCount, batchLimit }: { pendingCount: number; batchLimit: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const batchCount = Math.min(pendingCount, batchLimit);

  async function analyzeBatch() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/deals/analyze-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null) as { error?: string; result?: BatchResult } | null;
      if (!response.ok || !payload?.result) {
        setError(payload?.error || "Pending deals could not be analyzed right now. Please try again.");
        return;
      }
      setResult(payload.result);
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Pending deals could not be analyzed right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <div className="sm:text-right">
        <button type="button" onClick={() => setConfirming(true)} className={buttonStyles("outline")}>
          <Bot aria-hidden="true" className="size-4" /> Analyze Pending Deals
        </button>
        {result && (
          <p role="status" className="mt-2 max-w-sm text-xs leading-5 text-secondary">
            {result.completed} {result.completed === 1 ? "deal" : "deals"} analyzed. {result.failed} {result.failed === 1 ? "deal needs" : "deals need"} retry.{result.remainingPending > 0 ? ` ${result.remainingPending} pending remain.` : ""}
          </p>
        )}
        {error && <p role="alert" className="mt-2 max-w-sm text-xs leading-5 text-danger-content">{error}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-sm rounded-xl border border-brand/30 bg-brand/10 p-3 text-left">
      <p className="text-sm font-bold text-content">Analyze {batchCount} pending {batchCount === 1 ? "deal" : "deals"}?</p>
      <p className="mt-1 text-xs leading-5 text-secondary">This will use AI processing. A maximum of {batchLimit} deals runs at once.</p>
      <p className="mt-1 text-[11px] leading-5 text-secondary">Relevant sales notes or transcripts are sent to the configured AI provider. Avoid unnecessary sensitive personal information.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={loading} onClick={() => setConfirming(false)} className={buttonStyles("outline", "h-9 px-3")}>Cancel</button>
        <button type="button" disabled={loading} onClick={analyzeBatch} className={buttonStyles("primary", "h-9 px-3")}>
          {loading && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
          {loading ? "Analyzing…" : "Confirm"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-danger-content">{error}</p>}
    </div>
  );
}
