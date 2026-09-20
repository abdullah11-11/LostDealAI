import { createWebhookHandler } from "../_shared/paddle.ts";

// Only this entry point uses the Deno runtime. No admin client or service key.
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
Deno.serve(createWebhookHandler({
  environment: () => Deno.env.get("PADDLE_ENVIRONMENT"),
  secret: () => Deno.env.get("PADDLE_WEBHOOK_SECRET"),
  async synchronize(event) {
    const url = Deno.env.get("SUPABASE_URL");
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const key = Deno.env.get("LOSTDEAL_PUBLISHABLE_KEY") || keys.default;
    const authority = Deno.env.get("BILLING_USAGE_AUTHORITY_SECRET");
    if (!url || !key?.startsWith("sb_publishable_") || !authority) throw new Error("CONFIGURATION_REQUIRED");
    const result = await fetch(`${url}/rest/v1/rpc/synchronize_paddle_subscription`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ target_authority_secret: authority, target_event: event }),
      signal: AbortSignal.timeout(4000),
    });
    if (!result.ok) throw new Error("DATABASE_FAILURE");
    const outcome = await result.json();
    if (typeof outcome !== "string") throw new Error("DATABASE_FAILURE");
    return outcome;
  },
}));
