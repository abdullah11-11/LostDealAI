import "server-only";
import { getBillingUsageAuthoritySecret } from "@/lib/billing/config";
import type { UsageReservation } from "@/lib/billing/usage";
import { CsvImportError } from "@/lib/csv/server";
import { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;
export const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function digest(value: BufferSource): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)), b => b.toString(16).padStart(2, "0")).join("");
}
export async function fingerprint(file: File | null, metadata: unknown): Promise<string> {
  const fileHash = file ? await digest(await file.arrayBuffer()) : "";
  return digest(new TextEncoder().encode(JSON.stringify({ fileHash, filename: file?.name ?? "", metadata })));
}
export async function readOperation(client: Client, organizationId: string, key: string, hash: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await client.from("provider_operation_results").select("request_fingerprint,result")
    .eq("organization_id", organizationId).eq("operation_key", key).maybeSingle();
  if (error) throw new CsvImportError("Saved operation state is temporarily unavailable. Retry the same request.", 503);
  if (!data) return null;
  if (data.request_fingerprint !== hash) throw new CsvImportError("This operation belongs to different input. Start a new operation.", 409);
  return data.result as Record<string, unknown>;
}
export async function saveOperation(client: Client, organizationId: string, key: string, hash: string,
  metric: "AI_MAPPING_REQUESTS" | "AUTO_CONVERT_ROWS", reservation: UsageReservation | null,
  units: number, result: Record<string, unknown>): Promise<Record<string, unknown>> {
  const secret = getBillingUsageAuthoritySecret();
  if (!secret) throw new CsvImportError("Usage metering is temporarily unavailable.", 503);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await client.rpc("persist_provider_operation", {
        target_authority_secret: secret, target_organization_id: organizationId, target_operation_key: key,
        target_fingerprint: hash, target_metric: metric, target_reservation_token: reservation?.reservationToken ?? null,
        target_units: units, target_result: result,
      });
      if (!error && data && typeof data === "object" && !Array.isArray(data)) return data;
    } catch { /* One idempotent retry covers a lost successful RPC response. */ }
  }
  throw new CsvImportError("The result could not be saved with its usage record. Retry the same operation.", 503);
}
