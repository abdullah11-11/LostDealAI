import { assertLiveCatalogAuthority, createLiveWebhookHandler, liveCatalog } from "../_shared/paddle-live.ts";

// Dormant source only. Persistent deployment/secrets/catalog adoption require approval.
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
// Edge secrets are project-wide: never flip the Sandbox receiver's variables.
const configuration = () => ({
  PADDLE_ENVIRONMENT: Deno.env.get("PADDLE_LIVE_ENVIRONMENT"),
  PADDLE_STARTER_PRICE_ID: Deno.env.get("PADDLE_LIVE_STARTER_PRICE_ID"),
  PADDLE_PRO_PRICE_ID: Deno.env.get("PADDLE_LIVE_PRO_PRICE_ID"),
  ...Object.fromEntries(["PADDLE_LIVE_CATALOG_REVISION", "PADDLE_LIVE_STARTER_PRODUCT_ID", "PADDLE_LIVE_PRO_PRODUCT_ID"].map(name => [name, Deno.env.get(name)])),
});
Deno.serve(createLiveWebhookHandler({
  environment: () => Deno.env.get("PADDLE_LIVE_ENVIRONMENT"),
  secret: () => Deno.env.get("PADDLE_LIVE_WEBHOOK_SECRET"),
  catalog: () => liveCatalog(configuration()),
  async synchronize(event) {
    const url = Deno.env.get("SUPABASE_URL");
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const key = Deno.env.get("LOSTDEAL_PUBLISHABLE_KEY") || keys.default;
    const authority = Deno.env.get("PADDLE_LIVE_BILLING_AUTHORITY_SECRET");
    if (!url || !key?.startsWith("sb_publishable_") || !authority || !/^[0-9a-f]{64}$/i.test(authority)) throw new Error("CONFIGURATION_REQUIRED");
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const result = await fetch(`${url}/rest/v1/rpc/${name}`, {
        method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ target_authority_secret: authority, ...args }), signal: AbortSignal.timeout(4000),
      });
      if (!result.ok) throw new Error("DATABASE_FAILURE");
      return result.json();
    };
    assertLiveCatalogAuthority(liveCatalog(configuration()), await rpc("get_live_billing_configuration", {}));
    const outcome = await rpc("synchronize_paddle_live_subscription", { target_event: event });
    if (typeof outcome !== "string") throw new Error("DATABASE_FAILURE");
    return outcome;
  },
}));
