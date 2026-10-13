"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, LoaderCircle, RotateCcw } from "lucide-react";

import { buttonStyles } from "@/components/ui";
import { useWorkspaceAccess } from "@/components/workspace-access";

export function AnalyzeDealButton({
  dealId,
  retry = false,
  label,
  primary = true,
  savedResultOnly = false,
}: {
  dealId: string;
  retry?: boolean;
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
    setMessage("LostDeal AI is analyzing this deal. Keep this page open.");
    try {
      const response = await fetch("/api/deals/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deal_id: dealId }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; message?: string; status?: string } | null;
      if (!response.ok && response.status !== 409) {
        setMessage(payload?.error || "We couldn't analyze this deal right now. Please try again.");
        return;
      }
      setMessage(payload?.message || "Analysis completed.");
      router.refresh();
    } catch {
      setMessage("We couldn't analyze this deal right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={analyze} disabled={loading || blocked} title={blocked ? "An active plan is required for new AI analyses." : undefined} className={buttonStyles(primary ? "primary" : "outline", "w-full sm:w-auto")}>
        {loading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : retry ? <RotateCcw aria-hidden="true" className="size-4" /> : <Bot aria-hidden="true" className="size-4" />}
        {loading ? "Analyzing…" : label || (retry ? "Retry Analysis" : "Analyze Deal")}
      </button>
      {message && <p role="status" aria-live="polite" className="mt-3 text-xs leading-5 text-secondary">{message}</p>}
    </div>
  );
}
