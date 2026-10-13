import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDeal, type TrustedDealSource } from "@/lib/ai/analyze-deal";
import { analyzeDeepDeal } from "@/lib/ai/deep-analysis";
import { DealAnalysisError, toDealAnalysisError } from "@/lib/ai/errors";

const source: TrustedDealSource = {
  dealValue: "1200", quoteDate: "2026-10-01", serviceType: "Fictional maintenance quote",
  status: "lost", salesNotes: "Fictional prospect deferred the quote until next month's budget review.", transcript: null,
};
const exhaustedCodes = ["insufficient_quota", "organization_spend_limit_exceeded", "project_spend_limit_exceeded"] as const;

for (const code of exhaustedCodes) {
  test(`provider ${code} is a safe non-retryable failure even with HTTP 429`, () => {
    const error = toDealAnalysisError({ status: 429, code, message: "synthetic private payload", request: { body: "synthetic source" } });
    assert.equal(error.code, "ANALYSIS_FAILED");
    assert.equal(error.retryable, false);
    assert.equal(error.diagnosticCategory, "provider_unavailable");
    assert.doesNotMatch(error.message, /synthetic|spend_limit|quota/);
  });
  for (const [mode, run] of [["Standard", analyzeDeal], ["Deep", analyzeDeepDeal]] as const) {
    test(`${mode} does not automatically retry provider ${code}`, async () => {
      let providerCalls = 0;
      await assert.rejects(run(source, async () => {
        providerCalls += 1;
        throw { status: 429, code, message: "synthetic private payload" };
      }), (error: unknown) => error instanceof DealAnalysisError && error.code === "ANALYSIS_FAILED" && !error.retryable);
      assert.equal(providerCalls, 1);
    });
  }
}

for (const [mode, run] of [["Standard", analyzeDeal], ["Deep", analyzeDeepDeal]] as const) {
  test(`${mode} preserves the one bounded retry for a temporary rate limit`, async () => {
    let providerCalls = 0;
    await assert.rejects(run(source, async () => {
      providerCalls += 1;
      throw { status: 429, code: "rate_limit_exceeded" };
    }), (error: unknown) => error instanceof DealAnalysisError && error.code === "AI_RATE_LIMITED" && error.retryable);
    assert.equal(providerCalls, 2);
  });
}
test("known spend exhaustion takes priority over a misleading timeout error name", () => {
  assert.equal(toDealAnalysisError({ status: 429, code: "PROJECT_SPEND_LIMIT_EXCEEDED", name: "APIConnectionTimeoutError" }).retryable, false);
});
test("existing trusted analysis errors retain their identity and transient server errors retain their retry", () => {
  const trusted = new DealAnalysisError("AI_REFUSAL", false, "provider_refusal");
  assert.equal(toDealAnalysisError(trusted), trusted);
  assert.equal(toDealAnalysisError({ status: 503 }).retryable, true);
});
