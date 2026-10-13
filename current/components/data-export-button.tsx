"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui";

export function DataExportButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function download() {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/exports/deals", { cache: "no-store" });
      if (!response.ok) { const payload = await response.json().catch(() => null); setMessage(payload?.error || "Your export could not be prepared."); return; }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "lostdeal-workspace-deals.csv";
      document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      setMessage("Your deal-source CSV is ready. Store it securely; it includes your imported notes and transcripts.");
    } catch { setMessage("Your export could not be prepared. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <div><Button variant="outline" onClick={() => void download()} loading={busy}><Download aria-hidden="true" className="size-4" />{busy ? "Preparing export…" : "Export deal sources"}</Button>{message && <p role="status" className="mt-3 max-w-lg text-sm leading-6 text-secondary">{message}</p>}</div>;
}
