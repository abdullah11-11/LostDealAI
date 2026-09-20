import { performance } from "node:perf_hooks";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { analyzeDeal, type AnalysisModelRunner } from "@/lib/ai/analyze-deal";
import { AI_CONFIG } from "@/lib/ai/config";
import { DealAnalysisSchema } from "@/lib/ai/deal-analysis-schema";
import { analyzeDeepDeal, type DeepAnalysisModelRunner } from "@/lib/ai/deep-analysis";
import {
  ANALYSIS_BENCHMARK_CASES,
  evaluateDeepBenchmark,
  evaluateStandardBenchmark,
} from "@/lib/ai/analysis-benchmark";
import { DeepDealAnalysisSchema } from "@/lib/ai/deep-analysis-schema";
import { LOSTDEAL_DEEP_ANALYSIS_INSTRUCTIONS } from "@/lib/ai/deep-instructions";
import { DealAnalysisError } from "@/lib/ai/errors";
import { buildDealAnalysisUserPrompt, LOSTDEAL_ANALYSIS_INSTRUCTIONS } from "@/lib/ai/instructions";

const MODEL_PRICES = Object.freeze({
  "gpt-5.6-luna": { input: 0.20, output: 1.20 },
  "gpt-5.6-terra": { input: 2.00, output: 12.00 },
  "gpt-5.6-sol": { input: 4.00, output: 20.00 },
});

const stage = process.argv.includes("--stage=2") ? 2 : 1;
const maxCallsArgument = process.argv.find((argument) => argument.startsWith("--max-calls="));
const maxCalls = maxCallsArgument ? Number(maxCallsArgument.split("=")[1]) : stage === 1 ? 20 : 8;
const stageCaseIds = stage === 1
  ? ["financing-not-price", "true-price-competitor", "multiple-blockers-long", "weak-insufficient"]
  : ["event-timing", "explicit-decision-maker", "generic-competitor", "trust-concern"];
const cases = ANALYSIS_BENCHMARK_CASES.filter((item) => stageCaseIds.includes(item.id));

if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY_MISSING");
if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 28) throw new Error("INVALID_CALL_BUDGET");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 0,
  timeout: AI_CONFIG.requestTimeoutMs,
});

let providerCalls = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCost = 0;
const results: Array<Record<string, unknown>> = [];

function price(model: keyof typeof MODEL_PRICES, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_PRICES[model];
  return inputTokens / 1_000_000 * rates.input + outputTokens / 1_000_000 * rates.output;
}

function findRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) return false;
  return output.some((item) => {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) return false;
    return item.content.some((content: unknown) => content && typeof content === "object" && "type" in content && content.type === "refusal");
  });
}

function standardRunner(model: keyof typeof MODEL_PRICES): AnalysisModelRunner {
  return async (input) => {
    const response = await openai.responses.parse({
      model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: AI_CONFIG.maxOutputTokens,
      input: [
        { role: "developer", content: LOSTDEAL_ANALYSIS_INSTRUCTIONS },
        { role: "user", content: buildDealAnalysisUserPrompt(input) },
      ],
      text: { format: zodTextFormat(DealAnalysisSchema, "lostdeal_analysis_benchmark") },
    });
    if (findRefusal(response.output)) throw new DealAnalysisError("AI_REFUSAL");
    if (response.status === "incomplete" || !response.output_parsed) throw new DealAnalysisError("AI_RESPONSE_INVALID");
    return {
      analysis: response.output_parsed,
      responseId: response.id || null,
      model: response.model || model,
      usage: response.usage ? {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      } : null,
    };
  };
}

function deepRunner(model: "gpt-5.6-terra" | "gpt-5.6-sol"): DeepAnalysisModelRunner {
  return async (input) => {
    const response = await openai.responses.parse({
      model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: AI_CONFIG.deepMaxOutputTokens,
      input: [
        { role: "developer", content: LOSTDEAL_DEEP_ANALYSIS_INSTRUCTIONS },
        { role: "user", content: buildDealAnalysisUserPrompt(input) },
      ],
      text: { format: zodTextFormat(DeepDealAnalysisSchema, "lostdeal_deep_analysis_benchmark") },
    });
    if (findRefusal(response.output)) throw new DealAnalysisError("AI_REFUSAL");
    if (response.status === "incomplete" || !response.output_parsed) throw new DealAnalysisError("AI_RESPONSE_INVALID");
    return {
      analysis: response.output_parsed,
      responseId: response.id || null,
      model: response.model || model,
      usage: response.usage ? {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      } : null,
    };
  };
}

async function runStandard(model: keyof typeof MODEL_PRICES, caseData: (typeof cases)[number]) {
  if (providerCalls >= maxCalls) throw new Error("BENCHMARK_CALL_BUDGET_REACHED");
  const baseRunner = standardRunner(model);
  const started = performance.now();
  const runner: typeof baseRunner = async (input) => {
    if (providerCalls >= maxCalls) throw new Error("BENCHMARK_CALL_BUDGET_REACHED");
    providerCalls += 1;
    return baseRunner(input);
  };
  try {
    const completed = await analyzeDeal(caseData.source, runner);
    const evaluation = evaluateStandardBenchmark(caseData, completed.analysis);
    const inputTokens = completed.metadata.input_tokens ?? 0;
    const outputTokens = completed.metadata.output_tokens ?? 0;
    const cost = price(model, inputTokens, outputTokens);
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCost += cost;
    results.push({
      stage,
      mode: "STANDARD",
      model,
      case: caseData.id,
      success: true,
      checks: evaluation.checks,
      score: `${evaluation.passed}/${evaluation.total}`,
      primary_reason: completed.analysis.lost_reason,
      buying_intent: completed.analysis.buying_intent_score,
      action: completed.analysis.recommended_action.slice(0, 220),
      follow_up: completed.analysis.follow_up_message?.slice(0, 220) ?? null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: Math.round(performance.now() - started),
      cost_usd: Number(cost.toFixed(6)),
    });
  } catch (error) {
    results.push({
      stage,
      mode: "STANDARD",
      model,
      case: caseData.id,
      success: false,
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      latency_ms: Math.round(performance.now() - started),
    });
  }
}

async function runDeep(model: "gpt-5.6-terra" | "gpt-5.6-sol", caseData: (typeof cases)[number]) {
  if (providerCalls >= maxCalls) throw new Error("BENCHMARK_CALL_BUDGET_REACHED");
  const baseRunner = deepRunner(model);
  const started = performance.now();
  const runner: typeof baseRunner = async (input) => {
    if (providerCalls >= maxCalls) throw new Error("BENCHMARK_CALL_BUDGET_REACHED");
    providerCalls += 1;
    return baseRunner(input);
  };
  try {
    const completed = await analyzeDeepDeal(caseData.source, runner);
    const evaluation = evaluateDeepBenchmark(caseData, completed.analysis);
    const inputTokens = completed.metadata.input_tokens ?? 0;
    const outputTokens = completed.metadata.output_tokens ?? 0;
    const cost = price(model, inputTokens, outputTokens);
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCost += cost;
    results.push({
      stage,
      mode: "DEEP",
      model,
      case: caseData.id,
      success: true,
      checks: evaluation.checks,
      score: `${evaluation.passed}/${evaluation.total}`,
      primary_reason: completed.analysis.lost_reason,
      secondary_reasons: completed.analysis.deep.secondary_blockers.map((item) => item.reason),
      thesis: completed.analysis.deep.recovery_thesis.explanation.slice(0, 260),
      strategy: completed.analysis.deep.recovery_strategy.recommended_angle.slice(0, 260),
      discount: completed.analysis.deep.margin_discount_caution.assessment,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: Math.round(performance.now() - started),
      cost_usd: Number(cost.toFixed(6)),
    });
  } catch (error) {
    results.push({
      stage,
      mode: "DEEP",
      model,
      case: caseData.id,
      success: false,
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      latency_ms: Math.round(performance.now() - started),
    });
  }
}

for (const caseData of cases) {
  if (stage === 1) {
    for (const model of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"] as const) {
      await runStandard(model, caseData);
      console.log(JSON.stringify(results.at(-1)));
    }
  }
  for (const model of ["gpt-5.6-terra", "gpt-5.6-sol"] as const) {
    await runDeep(model, caseData);
    console.log(JSON.stringify(results.at(-1)));
  }
}

console.log(JSON.stringify({
  summary: true,
  research_date: "2026-09-02",
  stage,
  reasoning_effort: "low",
  standard_prompt_version: "standard-1.0",
  standard_schema_version: "standard-1.0",
  deep_prompt_version: "deep-1.0",
  deep_schema_version: "deep-1.0",
  provider_calls: providerCalls,
  input_tokens: totalInputTokens,
  output_tokens: totalOutputTokens,
  cost_usd: Number(totalCost.toFixed(6)),
  official_sources: [
    "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
    "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
    "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
    "https://developers.openai.com/api/docs/pricing",
  ],
}));
