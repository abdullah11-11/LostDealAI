"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, LoaderCircle } from "lucide-react";

import { buttonStyles } from "@/components/ui";

export function CalculateRecoveryScoreButton({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function calculate() {
    if (loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/deals/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deal_id: dealId }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setMessage(payload?.error || "We couldn't calculate the Recovery Score right now.");
        return;
      }
      setMessage("Recovery Score calculated with no AI usage.");
      router.refresh();
    } catch {
      setMessage("We couldn't calculate the Recovery Score right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={calculate} disabled={loading} className={buttonStyles("primary")}>
        {loading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Calculator aria-hidden="true" className="size-4" />}
        {loading ? "Calculating…" : "Calculate Recovery Score"}
      </button>
      <p className="mt-2 text-xs leading-5 text-secondary">Deterministic calculation · No AI usage</p>
      {message && <p role="status" aria-live="polite" className="mt-2 text-xs leading-5 text-secondary">{message}</p>}
    </div>
  );
}

