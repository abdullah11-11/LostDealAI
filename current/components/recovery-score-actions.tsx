"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, LoaderCircle, RefreshCw } from "lucide-react";

import { buttonStyles } from "@/components/ui";

type Mode = "unscored" | "refresh";
type BatchResult = {
  selected: number;
  completed: number;
  failed: number;
  skipped: number;
  remaining: number;
  nextCursor: string | null;
};

export function RecoveryScoreActions({
  unscoredCount,
  analyzedCount,
  batchLimit,
}: {
  unscoredCount: number;
  analyzedCount: number;
  batchLimit: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Mode | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: Mode) {
    if (loading) return;
    setLoading(true);
    setMessage(null);
    setError(null);
    let cursor: string | null = null;
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    try {
      for (let chunk = 0; chunk < 100; chunk += 1) {
        const response = await fetch("/api/deals/score-batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode, cursor }),
        });
        const payload = await response.json().catch(() => null) as { error?: string; result?: BatchResult } | null;
        if (!response.ok || !payload?.result) throw new Error(payload?.error || "Recovery Scores could not be calculated right now.");
        completed += payload.result.completed;
        failed += payload.result.failed;
        skipped += payload.result.skipped;
        cursor = payload.result.nextCursor;
        if (!cursor) break;
      }
      setMessage(`${completed} ${completed === 1 ? "score" : "scores"} calculated. ${failed + skipped} ${failed + skipped === 1 ? "needs" : "need"} retry. No AI usage.`);
      setConfirming(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recovery Scores could not be calculated right now.");
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    const count = confirming === "unscored" ? unscoredCount : analyzedCount;
    return (
      <div className="max-w-sm rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3 text-left">
        <p className="text-sm font-bold text-success-content">
          {confirming === "unscored" ? `Calculate Recovery Scores for ${count} unscored ${count === 1 ? "deal" : "deals"}?` : `Refresh Recovery Scores for ${count} analyzed ${count === 1 ? "deal" : "deals"}?`}
        </p>
        <p className="mt-1 text-xs leading-5 text-success-content">This recalculates deterministic scores using current deal age. It does not use AI credits. No AI usage.</p>
        <p className="mt-1 text-[13px] text-success-content">Records are processed in controlled batches of {batchLimit}.</p>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={loading} onClick={() => setConfirming(null)} className={buttonStyles("outline", "h-9 px-3")}>Cancel</button>
          <button type="button" disabled={loading} onClick={() => run(confirming)} className={buttonStyles("primary", "h-9 px-3")}>
            {loading && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
            {loading ? "Calculating…" : "Confirm"}
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-xs leading-5 text-danger-content">{error}</p>}
      </div>
    );
  }

  return (
    <div className="sm:text-right">
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {unscoredCount > 0 && (
          <button type="button" onClick={() => setConfirming("unscored")} className={buttonStyles("outline")}>
            <Calculator aria-hidden="true" className="size-4" /> Score Unscored Deals
          </button>
        )}
        {analyzedCount > 0 && (
          <button type="button" onClick={() => setConfirming("refresh")} className={buttonStyles("outline")}>
            <RefreshCw aria-hidden="true" className="size-4" /> Refresh Scores
          </button>
        )}
      </div>
      {message && <p role="status" className="mt-2 max-w-lg text-xs leading-5 text-secondary">{message}</p>}
      {error && <p role="alert" className="mt-2 max-w-lg text-xs leading-5 text-danger-content">{error}</p>}
    </div>
  );
}
