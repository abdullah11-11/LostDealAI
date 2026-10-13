import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import ts from "typescript";
import type { PGlite } from "@electric-sql/pglite";
import { fixtureSecret, orgA, userA } from "./postgres-fixture";

const require = createRequire(import.meta.url);
type Row = Record<string, unknown>;
/** Actual server route/policy/SDK modules, actual isolated RPCs. Auth/rate-limit
 * boundaries are controlled fixtures. Caller replaces fetch with an exhaustive
 * provider stub, so no network, real account, billing or credential is used. */
export function billingHarness(db: PGlite, env: Record<string, string | undefined>, authority: string) {
  let owner = true;
  const calls: string[] = [];
  const modules = new Map<string, Row>();
  const client = {
    from(table: string) {
      assert.match(table, /^[a-z_]+$/); let columns = "*"; let column = ""; let value: unknown;
      return { select(selected: string) { assert.match(selected, /^[a-z_,*]+$/); columns = selected; return this; },
        eq(key: string, selected: unknown) { assert.match(key, /^[a-z_]+$/); column = key; value = selected; return this; },
        async maybeSingle() { try { return { data: (await db.query(`select ${columns} from public.${table} where ${column}=$1`, [value])).rows[0] ?? null, error: null }; } catch { return { data: null, error: { message: "isolated read failure" } }; } },
      };
    },
    async rpc(name: string, args: Row) {
      assert.match(name, /^(get_billing_subscription|get_organization_usage|get_live_billing_configuration|verify_live_billing_payment_link|create_live_billing_checkout_intent|create_billing_checkout_intent|begin_live_billing_operation|begin_billing_operation|abort_live_billing_operation|abort_billing_operation|synchronize_paddle_live_subscription|synchronize_paddle_subscription)$/);
      calls.push(name); const savepoint = "billing_" + crypto.randomUUID().replaceAll("-", ""); await db.exec("savepoint " + savepoint);
      try {
        const values = Object.values(args).map(value => value !== null && typeof value === "object" ? JSON.stringify(value) : value);
        const parameters = Object.keys(args).map((key, index) => { assert.match(key, /^[a-z_]+$/); return `${key}=>$${index + 1}`; }).join(",");
        const table = name === "get_organization_usage";
        const rows = (await db.query<Row>(table ? `select * from public.${name}(${parameters})` : `select public.${name}(${parameters}) as result`, values)).rows;
        await db.exec("release savepoint " + savepoint);
        return { data: table ? rows : rows[0].result, error: null };
      } catch { await db.exec("rollback to savepoint " + savepoint + ";release savepoint " + savepoint); return { data: null, error: { message: "isolated RPC failure" } }; }
    },
  };
  function load<T>(path: string): T {
    if (modules.has(path)) return modules.get(path) as T;
    const exports: Row = {}; modules.set(path, exports);
    const code = ts.transpileModule(readFileSync(new URL("../../" + path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const isolatedRequire = (name: string): unknown => {
      if (name === "server-only") return {};
      if (name === "next/server") return { NextResponse: { json: Response.json } };
      if (name === "@/lib/billing/config") return { getBillingEnforcementMode: () => "SHADOW", getBillingUsageAuthoritySecret: () => fixtureSecret, getLiveBillingAuthoritySecret: () => authority };
      if (name === "@/lib/security/route-auth") return { getAuthorizedRouteContext: async () => ({ context: { supabase: client, identity: { id: userA, email: "synthetic@fixture.test" }, organization: { id: orgA, role: owner ? "owner" : "member" } } }) };
      if (name === "@/lib/security/rate-limit") return { enforceRateLimitOrRespond: async () => null };
      if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
      if (name.startsWith("./")) return load(path.slice(0, path.lastIndexOf("/") + 1) + name.slice(2).replace(/\.ts$/, "") + ".ts");
      assert.ok(name === "zod" || name === "@paddle/paddle-node-sdk" || name.startsWith("node:"), "Unexpected billing dependency");
      return require(name);
    };
    new Script("(function(require,exports,process){" + code + "\n})", { filename: path }).runInThisContext()(isolatedRequire, exports, { env });
    return exports as T;
  }
  const routes = load<typeof import("@/lib/billing/routes")>("lib/billing/routes.ts");
  return { calls, routes, setOwner(value: boolean) { owner = value; }, request(action: string, plan?: string, origin = "https://lostdeal-ai.equal-dune-2306.chatgpt.site", body?: Row) {
    return new Request("https://lostdeal-ai.equal-dune-2306.chatgpt.site/api/billing/" + action, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body ?? (plan ? { plan } : {})) });
  } };
}
