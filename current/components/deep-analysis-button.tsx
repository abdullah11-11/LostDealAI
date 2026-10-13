"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, LoaderCircle, RotateCcw } from "lucide-react";

import { buttonStyles } from "@/components/ui";
import { clientOperation } from "@/lib/security/client-operation";
import { useWorkspaceAccess } from "@/components/workspace-access";

export function DeepAnalysisButton({
  dealId,
  rerun = false,
  label,
  primary = true,
  savedResultOnly = false,
}: {
  dealId: string;
  rerun?: boolean;
  label?: string;
  primary?: boolean;
  savedResultOnly?: boolean;
}) {
  const router = useRouter();
  const { restricted } = useWorkspaceAccess();
  const blocked = restricted && !savedResultOnly;
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function analyze() {
    if (loading || blocked) return;
    setLoading(true);
    setMessage("Deep Recovery Analysis is processing this deal. Keep this page open.");
    try {
      const operation = await clientOperation("deep-analysis", { dealId, rerun });
      const response = await fetch("/api/deals/analyze-deep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deal_id: dealId,
          operation_id: operation.id,
          rerun,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; message?: string; status?: string } | null;
      if (!response.ok && response.status !== 409) {
        setMessage(payload?.error || "We couldn't complete Deep Recovery Analysis right now. Please try again.");
        return;
      }
      setMessage(payload?.message || "Deep Recovery Analysis completed.");
      if (payload?.status === "completed") operation.complete();
      router.refresh();
    } catch {
      setMessage("We couldn't complete Deep Recovery Analysis right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const buttonLabel = label || (rerun ? "Re-run Deep Analysis" : "Run Deep Analysis");
  return (
    <div>
      <button
        type="button"
        onClick={analyze}
        disabled={loading || blocked}
        title={blocked ? "An active plan is required for new AI analyses." : undefined}
        className={buttonStyles(primary ? "primary" : "outline", "w-full sm:w-auto")}
      >
        {loading
          ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          : rerun
            ? <RotateCcw aria-hidden="true" className="size-4" />
            : <BrainCircuit aria-hidden="true" className="size-4" />}
        {loading ? "Analyzing…" : buttonLabel}
      </button>
      {message && <p role="status" aria-live="polite" className="mt-3 max-w-xl text-xs leading-5 text-secondary">{message}</p>}
    </div>
  );
}
