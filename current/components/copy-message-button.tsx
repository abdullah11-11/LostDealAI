"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { buttonStyles } from "@/components/ui";

export function CopyMessageButton({ message }: { message: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div>
      <button type="button" onClick={copyMessage} className={buttonStyles("primary", "w-full sm:w-auto")}>
        {status === "copied" ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
        {status === "copied" ? "Message Copied" : "Copy Message"}
      </button>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs leading-5 text-secondary">
        {status === "copied" ? "The persisted follow-up message is on your clipboard." : status === "failed" ? "Copy was unavailable. Select the message text and copy it manually." : "Copies only; LostDeal AI never sends it."}
      </p>
    </div>
  );
}
