import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RECOVERY_SCORING_VERSION, REASON_RECOVERABILITY, SCORING_BATCH_LIMIT } from "@/lib/scoring/constants";
import { calculateRecencyScore, calculateRecoveryScore, recoveryPriorityForScore } from "@/lib/scoring/recovery-score";
import {
  scoreBatchWithStore,
  scoreDealWithStore,
  type RecoveryScoringStore,
  type ScorableAnalysisRow,
  type ScorePersistenceData,
} from "@/lib/scoring/score-analysis";

const asOfDate = "2026-08-19";

function dateDaysAgo(days: number): string {
  return new Date(Date.UTC(2026, 7, 19 - days)).toISOString().slice(0, 10);
}

function scoringInput(overrides: Partial<Parameters<typeof calculateRecoveryScore>[0]> = {}) {
  return {
    buyingIntentScore: 65,
    confidenceScore: 96,
    lostReason: "FINANCING" as const,
    recommendedChannel: "HUMAN_CALL" as const,
    evidenceCount: 1,
    quoteDate: "2026-08-12",
    asOfDate,
    ...overrides,
  };
}

function analysisRow(id: string, overrides: Partial<ScorableAnalysisRow> = {}): ScorableAnalysisRow {
  return {
    dealId: id,
    quoteDate: "2026-08-12",
    analysisStatus: "completed",
    recoveryScore: null,
    modelMetadata: { model: "gpt-5.6", response_id: "resp_synthetic", total_tokens: 480 },
    lost_reason: "FINANCING",
    lost_reason_detail: "Financing concern.",
    buying_intent_score: 65,
    confidence_score: 96,
    evidence: [{ source: "SALES_NOTES", excerpt: "The payment is too high." }],
    positive_signals: [],
    negative_signals: ["Payment concern"],
    recommended_action: "Discuss available payment structures.",
    recommended_timing: "Within 48 hours",
    recommended_channel: "HUMAN_CALL",
    follow_up_message: "Would you like to discuss available payment structures?",
    ...overrides,
  };
}

function memoryScoringStore(rows: ScorableAnalysisRow[], allowedIds = rows.map((row) => row.dealId)) {
  const source = new Map(rows.map((row) => [row.dealId, row]));
  const allowed = new Set(allowedIds);
  const persisted = new Map<string, ScorePersistenceData>();
  const store: RecoveryScoringStore = {
    async fetch(dealId) {
      return allowed.has(dealId) ? source.get(dealId) ?? null : null;
    },
    async persist(dealId, data) {
      if (!allowed.has(dealId)) return false;
      persisted.set(dealId, data);
      const row = source.get(dealId);
      if (row) row.recoveryScore = data.recovery_score;
      return true;
    },
    async countCandidates(mode, afterDealId) {
      return [...source.values()].filter((row) => allowed.has(row.dealId) && row.analysisStatus === "completed" && (!afterDealId || row.dealId > afterDealId) && (mode === "refresh" || row.recoveryScore === null)).length;
    },
    async listCandidateIds(mode, afterDealId, limit) {
      return [...source.values()]
        .filter((row) => allowed.has(row.dealId) && row.analysisStatus === "completed" && (!afterDealId || row.dealId > afterDealId) && (mode === "refresh" || row.recoveryScore === null))
        .map((row) => row.dealId)
        .sort()
        .slice(0, limit);
    },
  };
  return { store, persisted, source };
}

test("V1 uses the exact reason recoverability table and central version", () => {
  assert.equal(RECOVERY_SCORING_VERSION, "1.0");
  assert.deepEqual(REASON_RECOVERABILITY, {
    NO_FOLLOW_UP: 85, TIMING: 80, FINANCING: 75, DECISION_MAKER: 70,
    AVAILABILITY: 65, PRICE: 60, NO_RESPONSE: 45, TRUST: 40, OTHER: 35,
    COMPETITOR: 30, PRODUCT_FIT: 30, BAD_EXPERIENCE: 25, NOT_QUALIFIED: 10,
  });
});

test("exact financing fixture produces 74 and HIGH", () => {
  const result = calculateRecoveryScore(scoringInput());
  assert.equal(result.baseScore, 75);
  assert.equal(result.confidenceMultiplier, 0.988);
  assert.equal(result.preCapScore, 74.1);
  assert.equal(result.recoveryScore, 74);
  assert.equal(result.recoveryPriority, "HIGH");
  assert.match(result.scoreExplanation, /Recovery Score 74\/100 \(High\)/);
  assert.doesNotMatch(result.scoreExplanation, /probability|chance/i);
});

test("competitor plus NO_ACTION is capped exactly at 20 and LOW", () => {
  const result = calculateRecoveryScore(scoringInput({
    buyingIntentScore: 85, confidenceScore: 98, lostReason: "COMPETITOR",
    recommendedChannel: "NO_ACTION", quoteDate: asOfDate,
  }));
  assert.ok(result.preCapScore > 20);
  assert.equal(result.recoveryScore, 20);
  assert.equal(result.recoveryPriority, "LOW");
  assert.ok(result.appliedCaps.some((cap) => cap.code === "NO_ACTION_CAP" && cap.limitedScore));
});

test("weak information remains LOW under low-confidence and evidence caps", () => {
  const result = calculateRecoveryScore(scoringInput({
    buyingIntentScore: 10, confidenceScore: 10, lostReason: "OTHER", evidenceCount: 0, quoteDate: asOfDate,
  }));
  assert.equal(result.recoveryScore, 26);
  assert.equal(result.recoveryPriority, "LOW");
  assert.deepEqual(result.appliedCaps.map((cap) => cap.code), ["LOW_CONFIDENCE_20_CAP", "NO_EVIDENCE_CAP"]);
});

test("NOT_QUALIFIED can never exceed 15", () => {
  const result = calculateRecoveryScore(scoringInput({
    buyingIntentScore: 80, confidenceScore: 90, lostReason: "NOT_QUALIFIED", quoteDate: asOfDate,
  }));
  assert.equal(result.recoveryScore, 15);
  assert.equal(result.recoveryPriority, "LOW");
  assert.ok(result.appliedCaps.some((cap) => cap.code === "NOT_QUALIFIED_CAP"));
});

test("recent TIMING fixture follows the exact formula", () => {
  const result = calculateRecoveryScore(scoringInput({
    buyingIntentScore: 70, confidenceScore: 90, lostReason: "TIMING", quoteDate: asOfDate,
  }));
  assert.equal(result.baseScore, 79);
  assert.equal(result.preCapScore, 76.63);
  assert.equal(result.recoveryScore, 77);
  assert.equal(result.recoveryPriority, "HIGH");
});

test("all recency boundaries use UTC-safe DATE-only arithmetic", () => {
  const cases: Array<[number, number]> = [
    [0, 100], [14, 100], [15, 90], [30, 90], [31, 75], [60, 75],
    [61, 60], [90, 60], [91, 40], [180, 40], [181, 20], [365, 20], [366, 10],
  ];
  for (const [days, expected] of cases) {
    assert.deepEqual(calculateRecencyScore(dateDaysAgo(days), asOfDate), { score: expected, ageDays: days, notes: [] });
  }
  assert.deepEqual(calculateRecencyScore(null, asOfDate), { score: 50, ageDays: null, notes: [] });
  assert.deepEqual(calculateRecencyScore("2026-08-20", asOfDate), { score: 50, ageDays: -1, notes: ["FUTURE_QUOTE_DATE"] });
  assert.equal(calculateRecencyScore("2026-03-08", "2026-03-09").ageDays, 1);
  assert.equal(calculateRecencyScore("2026-11-01", "2026-11-02").ageDays, 1);
});

test("priority thresholds are exact", () => {
  assert.equal(recoveryPriorityForScore(0), "LOW");
  assert.equal(recoveryPriorityForScore(44), "LOW");
  assert.equal(recoveryPriorityForScore(45), "MEDIUM");
  assert.equal(recoveryPriorityForScore(69), "MEDIUM");
  assert.equal(recoveryPriorityForScore(70), "HIGH");
  assert.equal(recoveryPriorityForScore(100), "HIGH");
});

test("confidence caps honor 20, 21–39, and 40 boundaries", () => {
  const strong = { buyingIntentScore: 100, lostReason: "NO_FOLLOW_UP" as const, quoteDate: asOfDate };
  const at20 = calculateRecoveryScore(scoringInput({ ...strong, confidenceScore: 20 }));
  const at21 = calculateRecoveryScore(scoringInput({ ...strong, confidenceScore: 21 }));
  const at39 = calculateRecoveryScore(scoringInput({ ...strong, confidenceScore: 39 }));
  const at40 = calculateRecoveryScore(scoringInput({ ...strong, confidenceScore: 40 }));
  assert.equal(at20.recoveryScore, 40);
  assert.equal(at21.recoveryScore, 60);
  assert.equal(at39.recoveryScore, 60);
  assert.ok(at40.recoveryScore > 60);
  assert.equal(at40.appliedCaps.some((cap) => cap.code.startsWith("LOW_CONFIDENCE")), false);
});

test("missing evidence caps a strong score at 55 and grounded evidence removes that cap", () => {
  const strong = { buyingIntentScore: 100, confidenceScore: 100, lostReason: "NO_FOLLOW_UP" as const, quoteDate: asOfDate };
  const absent = calculateRecoveryScore(scoringInput({ ...strong, evidenceCount: 0 }));
  const present = calculateRecoveryScore(scoringInput({ ...strong, evidenceCount: 1 }));
  assert.equal(absent.recoveryScore, 55);
  assert.ok(present.recoveryScore > 55);
  assert.ok(absent.appliedCaps.some((cap) => cap.code === "NO_EVIDENCE_CAP"));
  assert.equal(present.appliedCaps.some((cap) => cap.code === "NO_EVIDENCE_CAP"), false);
});

test("score, priority, breakdown, and explanation are deterministic over 100 runs", () => {
  const first = calculateRecoveryScore(scoringInput());
  for (let index = 0; index < 100; index += 1) assert.deepEqual(calculateRecoveryScore(scoringInput()), first);
});

test("all supported input extremes produce an integer from 0 to 100", () => {
  for (const lostReason of Object.keys(REASON_RECOVERABILITY)) {
    for (const buyingIntentScore of [0, 1, 44, 45, 69, 70, 99, 100]) {
      for (const confidenceScore of [0, 20, 21, 39, 40, 100]) {
        const result = calculateRecoveryScore(scoringInput({
          lostReason: lostReason as keyof typeof REASON_RECOVERABILITY,
          buyingIntentScore,
          confidenceScore,
          quoteDate: buyingIntentScore % 2 ? null : "2025-08-18",
        }));
        assert.equal(Number.isInteger(result.recoveryScore), true);
        assert.ok(result.recoveryScore >= 0 && result.recoveryScore <= 100);
      }
    }
  }
});

test("scoring persists score fields and merges existing AI metadata", async () => {
  const fixture = memoryScoringStore([analysisRow("deal-a")]);
  const result = await scoreDealWithStore(fixture.store, "deal-a", asOfDate, "2026-08-19T12:00:00.000Z");
  assert.deepEqual(result, { status: "completed", score: 74, priority: "HIGH" });
  const saved = fixture.persisted.get("deal-a");
  assert.ok(saved);
  assert.equal(saved.model_metadata.model, "gpt-5.6");
  assert.equal(saved.model_metadata.response_id, "resp_synthetic");
  assert.equal(saved.model_metadata.total_tokens, 480);
  assert.equal(saved.model_metadata.scoring.version, "1.0");
  assert.equal(saved.model_metadata.scoring.final_score, 74);
  assert.match(saved.score_explanation, /LostDeal Recovery Scoring v1\.0/);
});

test("only completed, tenant-visible analyses score and no status is mutated on failure", async () => {
  const pending = analysisRow("pending", { analysisStatus: "pending" });
  const tenantA = analysisRow("tenant-a");
  const tenantB = analysisRow("tenant-b");
  const fixtureA = memoryScoringStore([pending, tenantA, tenantB], ["pending", "tenant-a"]);
  assert.deepEqual(await scoreDealWithStore(fixtureA.store, "pending", asOfDate), { status: "not_scorable" });
  assert.deepEqual(await scoreDealWithStore(fixtureA.store, "tenant-b", asOfDate), { status: "not_found" });
  assert.equal(pending.analysisStatus, "pending");
  assert.equal(fixtureA.persisted.has("tenant-b"), false);
  const fixtureB = memoryScoringStore([tenantA, tenantB], ["tenant-b"]);
  assert.deepEqual(await scoreDealWithStore(fixtureB.store, "tenant-a", asOfDate), { status: "not_found" });
});

test("batch refresh remains isolated to the active tenant in both directions", async () => {
  const rowsForA = [analysisRow("tenant-a"), analysisRow("tenant-b")];
  const fixtureA = memoryScoringStore(rowsForA, ["tenant-a"]);
  const refreshedA = await scoreBatchWithStore(fixtureA.store, "refresh", asOfDate);
  assert.equal(refreshedA.completed, 1);
  assert.deepEqual([...fixtureA.persisted.keys()], ["tenant-a"]);

  const rowsForB = [analysisRow("tenant-a"), analysisRow("tenant-b")];
  const fixtureB = memoryScoringStore(rowsForB, ["tenant-b"]);
  const refreshedB = await scoreBatchWithStore(fixtureB.store, "refresh", asOfDate);
  assert.equal(refreshedB.completed, 1);
  assert.deepEqual([...fixtureB.persisted.keys()], ["tenant-b"]);
});

test("backfill and refresh use controlled batches with partial failure isolation", async () => {
  const rows = Array.from({ length: SCORING_BATCH_LIMIT + 5 }, (_, index) => analysisRow(`deal-${String(index).padStart(3, "0")}`));
  const fixture = memoryScoringStore(rows);
  const originalPersist = fixture.store.persist;
  fixture.store.persist = async (id, data) => id === "deal-003" ? false : originalPersist(id, data);
  const first = await scoreBatchWithStore(fixture.store, "unscored", asOfDate);
  assert.equal(first.selected, SCORING_BATCH_LIMIT);
  assert.equal(first.completed, SCORING_BATCH_LIMIT - 1);
  assert.equal(first.failed, 1);
  assert.equal(first.remaining, 5);
  assert.equal(typeof first.nextCursor, "string");
  const second = await scoreBatchWithStore(fixture.store, "unscored", asOfDate, first.nextCursor);
  assert.equal(second.completed, 5);
  assert.equal(second.remaining, 0);
  const refresh = await scoreBatchWithStore(fixture.store, "refresh", asOfDate);
  assert.equal(refresh.selected, SCORING_BATCH_LIMIT);
});

test("the scoring implementation has no OpenAI, deal-value, notes, or transcript dependency", async () => {
  const sources = await Promise.all([
    "lib/scoring/recovery-score.ts",
    "lib/scoring/score-analysis.ts",
    "lib/scoring/score-service.ts",
  ].map((path) => readFile(path, "utf8")));
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /from ["']openai["']|getOpenAIClient|runOpenAIAnalysis/);
  assert.doesNotMatch(joined, /deal_value|sales_notes|transcript/);
});
