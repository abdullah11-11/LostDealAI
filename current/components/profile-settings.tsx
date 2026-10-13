"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { normalizeProfileName } from "@/lib/settings/profile-name";

export function ProfileSettings({ fullName }: { fullName: string }) {
  const router = useRouter();
  const [name, setName] = useState(fullName);
  const [savedName, setSavedName] = useState(fullName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalizedName = normalizeProfileName(name);
    if (!normalizedName) { setError("Use a display name between 1 and 100 characters."); return; }
    setBusy(true); setMessage(null); setError(null);
    try {
      const response = await fetch("/api/settings/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: normalizedName }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.fullName !== "string") { setError(payload?.error || "Your display name could not be saved."); return; }
      setName(payload.fullName); setSavedName(payload.fullName); setMessage("Display name saved."); router.refresh();
    } catch { setError("Your display name could not be saved. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-4 p-5 sm:p-6" aria-label="Profile settings"><Input id="profile-full-name" label="Display name" autoComplete="name" maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={busy} description="Shown in your account menu. This does not change your workspace role." error={error ?? undefined} /><Button type="submit" loading={busy} disabled={name.trim() === savedName}>{busy ? "Saving…" : "Save name"}</Button>{message && <p role="status" className="text-sm text-success-content">{message}</p>}</form>;
}
