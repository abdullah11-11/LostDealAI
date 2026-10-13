import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import ts from "typescript";
import type { PGlite } from "@electric-sql/pglite";
import { fixtureSecret, orgA, userA } from "./postgres-fixture";

const require = createRequire(import.meta.url);
const origin = "https://lostdeal-ai.equal-dune-2306.chatgpt.site";
type Row = Record<string, unknown>;
type Reply = { data: unknown; error: { message: string; code?: string } | null; count?: number };
export type Operation = "standard" | "deep" | "mapping" | "auto" | "import";

/** Actual server modules, actual PostgreSQL RPC bodies, isolated Auth/D1/provider boundaries.
 * PGlite is a single queued connection; these tests do not claim multi-session lock testing.
 * No Supabase SDK, network client, environment secret or paid runner is instantiated. */
export function serverHarness(db: PGlite, mode: "SHADOW" | "ENFORCED" = "ENFORCED") {
  const modules = new Map<string, Row>();
  const calls = { standard: 0, deep: 0, mapping: 0, auto: 0 };
  let providerFails = false;
  let pause: (() => Promise<void>) | null = null;
  let rpcTail = Promise.resolve();
  const unavailable = new Set<string>();
  const lostReplies = new Map<string, number>();
  const client = {
    from(table: string) {
      assert.match(table, /^[a-z_]+$/);
      let projection = "*";
      const predicates: string[] = [];
      const values: unknown[] = [];
      let limit: number | null = null;
      let single = false;
      let options: { head?: boolean; count?: string } = {};
      const execute = async (): Promise<Reply> => {
        if (unavailable.has(table)) return { data: null, error: { message: "isolated unavailable table" } };
        try {
          const result = await db.query<Row>(`select ${projection} from public.${table}${predicates.length ? " where " + predicates.join(" and ") : ""}${limit === null ? "" : " limit " + limit}`, values);
          const rows = JSON.parse(JSON.stringify(result.rows)) as Row[];
          return { data: options.head ? null : single ? rows[0] ?? null : rows, error: null, count: rows.length };
        } catch (error) { return { data: null, error: safeError(error) }; }
      };
      const query = {
        select(columns: string, selectedOptions = {}) { assert.match(columns, /^(\*|[a-z_,]+)$/); projection = columns; options = selectedOptions; return query; },
        eq(column: string, value: unknown) { assert.match(column, /^[a-z_]+$/); values.push(value); predicates.push(`${column}=$${values.length}`); return query; },
        in(column: string, selected: unknown[]) { assert.match(column, /^[a-z_]+$/); predicates.push(selected.length ? `${column} in (${selected.map(value => { values.push(value); return "$" + values.length; }).join(",")})` : "false"); return query; },
        limit(value: number) { assert.ok(Number.isSafeInteger(value) && value >= 0); limit = value; return query; },
        maybeSingle() { single = true; return execute(); },
        then<T>(resolve: (value: Reply) => T, reject?: (reason: unknown) => T) { return execute().then(resolve, reject); },
      };
      return query;
    },
    async rpc(name: string, args: Row): Promise<Reply> {
      assert.match(name, /^(reserve_organization_usage|release_unused_usage|commit_organization_usage|claim_analysis_run|recover_analysis_run|fail_analysis_run|transition_deal_analysis|persist_deal_analysis|finalize_analysis_usage|persist_provider_operation|persist_deal_import|get_organization_usage)$/);
      if (unavailable.has(name)) return { data: null, error: { message: "isolated unavailable RPC" } };
      const previous = rpcTail;
      let release!: () => void;
      rpcTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const savepoint = "rpc_" + crypto.randomUUID().replaceAll("-", "");
      try {
        await db.exec("savepoint " + savepoint);
        const values = Object.values(args).map(value => value !== null && typeof value === "object" ? JSON.stringify(value) : value);
        const parameters = Object.keys(args).map((key, index) => { assert.match(key, /^[a-z_]+$/); return `${key}=>$${index + 1}`; }).join(",");
        const tableResult = name === "reserve_organization_usage" || name === "get_organization_usage";
        const result = await db.query<Row>(tableResult ? `select * from public.${name}(${parameters})` : `select public.${name}(${parameters}) as result`, values);
        await db.exec("release savepoint " + savepoint);
        const remaining = lostReplies.get(name) ?? 0;
        if (remaining) { lostReplies.set(name, remaining - 1); return { data: null, error: { message: "isolated lost successful response" } }; }
        return { data: JSON.parse(JSON.stringify(tableResult ? result.rows : result.rows[0].result)), error: null };
      } catch (error) {
        await db.exec("rollback to savepoint " + savepoint + "; release savepoint " + savepoint);
        return { data: null, error: safeError(error) };
      } finally { release(); }
    },
  };
  async function provider(kind: keyof typeof calls) {
    calls[kind]++;
    if (pause) await pause();
    if (providerFails) throw new Error("isolated provider failure");
  }
  function load<T>(path: string): T {
    if (modules.has(path)) return modules.get(path) as T;
    const exports: Row = {};
    modules.set(path, exports);
    const code = ts.transpileModule(readFileSync(new URL("../../" + path, import.meta.url), "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const isolatedRequire = (name: string): unknown => {
      if (name === "server-only") return {};
      if (name === "next/server") return { NextResponse: { json: Response.json } };
      if (name === "@/lib/billing/config") return { getBillingEnforcementMode: () => mode, getBillingUsageAuthoritySecret: () => fixtureSecret };
      if (name === "@/lib/supabase/server") return { createClient: async () => client };
      if (name === "@/lib/security/route-auth") return { getAuthorizedRouteContext: async () => ({ context: { supabase: client, identity: { id: userA }, organization: { id: orgA, name: "Isolated Trial", role: "owner" } } }) };
      if (name === "@/lib/security/rate-limit") return { enforceRateLimitOrRespond: async () => null };
      if (name === "@/lib/scoring/score-service") return { scoreAuthorizedDeal: async () => ({ status: "completed" }) };
      if (name === "@/lib/ai/openai-runner" || name === "@/lib/ai/deep-openai-runner") return { runOpenAIAnalysis: async () => { throw new Error("Unexpected default paid runner"); }, runOpenAIDeepAnalysis: async () => { throw new Error("Unexpected default paid runner"); } };
      if (name === "@/lib/csv/ai-mapping-runner") return { runOpenAiMapping: async () => { await provider("mapping"); return { suggestions: [] }; }, createOpenAiMappingRunner: () => async () => { await provider("mapping"); return { suggestions: [] }; } };
      if (name === "@/lib/csv/auto-convert-runner") return { getAutoConvertModel: () => "isolated", runOpenAiAutoConvertExtraction: async (request: { rows: { row_reference: number }[] }) => { await provider("auto"); return { results: request.rows.map(row => ({ row_reference: row.row_reference, fields: [] })) }; } };
      if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
      assert.ok(name === "zod" || name === "papaparse" || name.startsWith("node:"), "Unexpected runtime dependency: " + name);
      return require(name);
    };
    const evaluate = new Script("(function(require,exports){" + code + "\n})", { filename: path }).runInThisContext();
    evaluate(isolatedRequire, exports);
    return exports as T;
  }
  const usage = load<typeof import("@/lib/billing/usage")>("lib/billing/usage.ts");
  const standard = load<typeof import("@/lib/ai/deal-analysis-service")>("lib/ai/deal-analysis-service.ts");
  const deep = load<typeof import("@/lib/ai/deep-analysis-service")>("lib/ai/deep-analysis-service.ts");
  async function invoke(operation: Operation, id: string, rows = 1, retry?: { rowNumbers: readonly number[]; recipe: unknown }): Promise<{ status: string | number; body?: Row }> {
    if (operation === "standard") return standard.analyzeAuthorizedDeal(client as never, orgA, id, async () => { await provider("standard"); return { analysis: coreAnalysis(), model: "isolated", responseId: "fixture", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; });
    if (operation === "deep") return deep.analyzeAuthorizedDeepDeal(client as never, orgA, id, id, true, async () => { await provider("deep"); return { analysis: deepAnalysis(), model: "isolated", responseId: "fixture", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; });
    const path = operation === "mapping" ? "suggest-mapping" : operation === "auto" ? "auto-convert" : "import";
    const route = load<{ POST(request: Request): Promise<Response> }>(`app/api/uploads/${path}/route.ts`);
    let request: Request;
    if (operation === "mapping") request = new Request(origin + "/api/uploads/suggest-mapping", { method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": id }, body: JSON.stringify({ columns: [{ source_column: "Mystery", profile: "short_text", samples: ["Synthetic quote"] }] }) });
    else {
      const form = new FormData();
      const csv = operation === "auto" ? ["Status,Notes", ...Array.from({ length: rows }, (_, index) => `Lost,Synthetic unresolved quote ${index + 1}`)].join("\n") : ["external_deal_id,customer_name,deal_value,quote_date,status,sales_notes", ...Array.from({ length: rows }, (_, index) => `${id}-${index},Synthetic customer,25,2026-01-01,Lost,Customer postponed the job.`)].join("\n");
      form.set("file", new File([csv], "synthetic.csv", { type: "text/csv" }));
      if (operation === "auto") {
        form.set("operation_id", id);
        if (retry) {
          form.set("row_numbers", JSON.stringify(retry.rowNumbers));
          form.set("mapping_recipe", JSON.stringify(retry.recipe));
        }
      }
      if (operation === "import") {
        const mapping = load<typeof import("@/lib/csv/mapping")>("lib/csv/mapping.ts");
        form.set("mapping_recipe", JSON.stringify(mapping.createMappingPlan(csv.split("\n")[0].split(",")).recipe));
      }
      request = new Request(origin + "/api/uploads/" + path, { method: "POST", headers: { origin, "idempotency-key": id }, body: form });
    }
    const result = await route.POST(request);
    return { status: result.status, body: await result.json() as Row };
  }
  return { calls, client, usage, invoke, unavailable, lostReplies, failProvider(value: boolean) { providerFails = value; }, pauseProvider(value: (() => Promise<void>) | null) { pause = value; } };
}

function safeError(error: unknown): { message: string; code?: string } {
  return { message: error instanceof Error ? error.message : String(error), code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined };
}
function coreAnalysis() {
  return { lost_reason: "FINANCING" as const, lost_reason_detail: "The monthly payment and financing structure prevented the purchase.", buying_intent_score: 82, confidence_score: 91,
    evidence: [{ source: "TRANSCRIPT" as const, excerpt: "I like the system. The monthly payment is too high for us right now." }], positive_signals: ["Customer explicitly likes the proposed system."], negative_signals: ["Monthly payment does not fit the customer situation."],
    recommended_action: "Review approved payment structures without promising terms or leading with a discount.", recommended_timing: "After confirming approved payment structures.", recommended_channel: "HUMAN_CALL" as const, follow_up_message: "Would it be helpful to review the available payment structures together?" };
}
function deepAnalysis() {
  const grounded = { explanation: "The monthly payment is the supported blocker while product interest is explicit.", evidence_indices: [0] };
  return { ...coreAnalysis(), deep: {
    primary_blocker: { reason: "FINANCING" as const, ...grounded }, secondary_blockers: [], recovery_thesis: grounded,
    customer_readiness: { level: "MEDIUM" as const, ...grounded }, objection_hierarchy: [{ reason: "FINANCING" as const, ...grounded }],
    decision_dynamics: { explanation: "No supported decision-maker issue identified.", evidence_indices: [] },
    timing_interpretation: { category: "INSUFFICIENT_EVIDENCE" as const, explanation: "The source does not identify a timing event.", evidence_indices: [] },
    price_value_interpretation: { category: "FINANCING_OR_PAYMENT_STRUCTURE" as const, ...grounded },
    competitor_dynamics: { category: "NO_MEANINGFUL_EVIDENCE" as const, explanation: "No competitor is identified in the source.", evidence_indices: [] },
    recovery_strategy: { objective: "Review approved payment structures.", recommended_angle: "Clarify monthly affordability while preserving product value.", lead_with: "The stated monthly-payment concern.", avoid_leading_with: "An immediate discount or invented financing promise.", next_best_step: "Review approved options internally, then have a human call.", evidence_indices: [0] },
    recovery_risk: { level: "MEDIUM" as const, ...grounded }, margin_discount_caution: { assessment: "PREMATURE" as const, ...grounded },
    follow_up_strategy: { communication_objective: "Confirm whether reviewing approved structures is useful.", tone: "Consultative.", key_point_to_address: "The stated monthly-payment concern.", key_point_to_avoid: "Unapproved terms or an automatic discount.", recommended_sequence: ["Acknowledge product interest.", "Clarify the monthly payment."], evidence_indices: [0] },
  } };
}
